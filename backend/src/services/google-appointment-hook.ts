import pino from 'pino';
import { prisma } from '../database/prisma.service';
import { googleIntegrationService } from './google-integration.service';
import { googleAccountService } from './google-account.service';

const logger = pino();

/** Acciones del ciclo de vida de la cita que disparan el hook de Google. */
export type GoogleHookAction = 'created' | 'confirmed' | 'rescheduled' | 'cancelled';

/**
 * Fires the Google Workspace integration after an appointment operation has
 * ALREADY been persisted. Mirrors `runLoyaltyHook`: it runs in a try/catch and
 * NEVER throws, so a Google failure (network/API error, disconnected account,
 * revoked token) can never roll back or block the appointment operation
 * (Requirements 2.5, 3.6, 4.5, 5.3). Errors are logged via pino and swallowed.
 *
 * All Google side effects resolve the ADMIN/tenant Google account through
 * `tenantId` (googleIntegrationService -> ensureAccessToken(tenantId)), so an
 * appointment booked by an ASSISTANT collaborator still lands the event / Meet /
 * contact on the entrepreneur's account (Requirement 6.2).
 *
 * Per action:
 *  - 'created':     create the Calendar event; persist google_event_id (and
 *                   video_call_url when a Meet link comes back). If the tenant
 *                   has save_contacts enabled, upsert the customer contact
 *                   (Requirement 4.1/4.2).
 *  - 'confirmed':   ensure/patch the event; when the appointment is online and a
 *                   Meet link is returned, persist video_call_url. Also persist
 *                   google_event_id if it was not stored yet (Meet generated at
 *                   confirmation time — Requirement 3.4).
 *  - 'rescheduled': patch the existing event (google_event_id present) to update
 *                   times; persist a changed Meet link.
 *  - 'cancelled':   delete the Calendar event and clear google_event_id.
 *
 * Google is purely additive and best-effort: the appointment's response,
 * validations and loyalty behavior are unchanged whether or not Google runs.
 */
export async function runGoogleAppointmentHook(
  action: GoogleHookAction,
  tenantId: string,
  appointmentId: string
): Promise<void> {
  try {
    // Reload the appointment with the relations needed to build the event /
    // contact payloads, scoped by tenant (aislamiento por tenant).
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId, tenant_id: tenantId },
      include: { customer: true, service: true },
    });

    if (!appointment) {
      return;
    }

    // Resolve the timezone from the appointment's branch when it has one; the
    // Appointment model has no direct branch relation, so load it by branch_id.
    // Falls back to null so the integration service uses its own default.
    let timeZone: string | null = null;
    if (appointment.branch_id) {
      const branch = await prisma.branch.findUnique({
        where: { id: appointment.branch_id, tenant_id: tenantId },
      });
      timeZone = branch?.timezone ?? null;
    }

    const eventInput = {
      google_event_id: appointment.google_event_id ?? null,
      service_name: appointment.service?.name ?? null,
      customer_name: appointment.customer?.name ?? null,
      notes: appointment.notes ?? null,
      start_time: appointment.start_time,
      end_time: appointment.end_time,
      time_zone: timeZone,
      location: appointment.location ?? null,
      modality: appointment.modality ?? null,
    };

    if (action === 'cancelled') {
      await googleIntegrationService.deleteAppointmentEvent(tenantId, eventInput);
      // Best-effort cleanup of the stored event id (the event no longer exists).
      if (appointment.google_event_id) {
        await prisma.appointment.update({
          where: { id: appointmentId, tenant_id: tenantId },
          data: { google_event_id: null },
        });
      }
      return;
    }

    // created / confirmed / rescheduled all sync (create or patch) the event.
    const result = await googleIntegrationService.syncAppointmentEvent(
      tenantId,
      eventInput
    );

    if (result) {
      const data: { google_event_id?: string; video_call_url?: string } = {};
      // Persist the event id when we did not have one yet.
      if (result.event_id && !appointment.google_event_id) {
        data.google_event_id = result.event_id;
      }
      // Persist the Meet link ONLY when the appointment has no video_call_url
      // yet. A manual URL takes priority and must never be overwritten by the
      // auto-generated Meet link (Requirement 4.1/4.2).
      if (result.meet_url && !appointment.video_call_url) {
        data.video_call_url = result.meet_url;
      }
      if (Object.keys(data).length > 0) {
        await prisma.appointment.update({
          where: { id: appointmentId, tenant_id: tenantId },
          data,
        });
      }
    }

    // On creation, optionally mirror the customer into Google Contacts when the
    // tenant enabled save_contacts (Requirement 4.1/4.2). Never runs otherwise.
    if (action === 'created' && appointment.customer) {
      const status = await googleAccountService.getStatus(tenantId);
      if (status.save_contacts) {
        await googleIntegrationService.upsertContact(tenantId, {
          name: appointment.customer.name ?? null,
          phone: appointment.customer.phone ?? null,
          email: appointment.customer.email ?? null,
        });
      }
    }
  } catch (error) {
    // Google must never break the appointment flow (Requirements 2.5, 3.6,
    // 4.5, 5.3). Log and swallow.
    logger.error(
      { err: error, appointmentId, action, tenantId },
      'Google hook failed after appointment operation'
    );
  }
}
