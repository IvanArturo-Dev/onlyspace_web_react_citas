import { Router } from 'express';
import { appointmentController } from '../../controllers/appointment.controller';
import { authenticated } from '../../middleware/authenticated';
import { requireStaff } from '../../middleware/requireStaff';
import { requireAdmin } from '../../middleware/requireAdmin';

export const appointmentRoutes = Router();

// All /v1/appointments/* routes are appointment-management endpoints. They go
// through the composed `authenticated` chain (authMiddleware + ensureNotBlocked
// + touchLastSeen) followed by `requireStaff`, which allows the entrepreneur
// (ADMIN) OR one of their assistants (ASSISTANT). Tenant scoping is enforced by
// the handlers via `req.user.tenant_id`, which the login pins to the
// entrepreneur's tenant for both roles, so an assistant can only manage that
// tenant's appointments. The public booking endpoint lives under /v1/public
// and is intentionally not affected.

// --- Waitlist (lista de espera) + espacios en riesgo -----------------------
// IMPORTANTE ORDEN DE RUTAS: estas rutas ESTATICAS (/waitlist, /waitlist/:entryId/*,
// /at-risk) DEBEN declararse ANTES de las rutas parametricas /:id para que
// "waitlist"/"at-risk" no se capturen como un :id. Encolar/listar/whatsapp son
// staff; ofrecer/confirmar (mutaciones que crean/confirman citas) son ADMIN.

// POST /v1/appointments/waitlist — encola a un cliente (staff).
appointmentRoutes.post('/waitlist', ...authenticated, requireStaff, appointmentController.joinWaitlist);

// GET /v1/appointments/waitlist?service_id=&date= — cola FIFO (staff).
appointmentRoutes.get('/waitlist', ...authenticated, requireStaff, appointmentController.listWaitlist);

// POST /v1/appointments/waitlist/:entryId/offer — ofrece un espacio (ADMIN).
appointmentRoutes.post(
  '/waitlist/:entryId/offer',
  ...authenticated,
  requireAdmin,
  appointmentController.offerWaitlist
);

// GET /v1/appointments/waitlist/:entryId/whatsapp — link "espacio abierto" (staff).
appointmentRoutes.get(
  '/waitlist/:entryId/whatsapp',
  ...authenticated,
  requireStaff,
  appointmentController.waitlistWhatsapp
);

// POST /v1/appointments/waitlist/:entryId/confirm — confirma la oferta (ADMIN).
appointmentRoutes.post(
  '/waitlist/:entryId/confirm',
  ...authenticated,
  requireAdmin,
  appointmentController.confirmWaitlist
);

// GET /v1/appointments/at-risk — citas PENDING en las proximas 12h (staff).
appointmentRoutes.get('/at-risk', ...authenticated, requireStaff, appointmentController.listAtRisk);

// --- Reporte + estadisticas (PREMIUM-only, el 403 lo hace el handler) -------
// Rutas ESTATICAS declaradas ANTES de las parametricas /:id para que
// "report"/"monthly-stats" no se capturen como un :id. El guard de rol es
// requireStaff; el gating premium (403 PREMIUM_REQUIRED) lo aplica el handler.

// GET /v1/appointments/report — CSV de citas en un rango (default 90 dias).
appointmentRoutes.get('/report', ...authenticated, requireStaff, appointmentController.exportReport);

// GET /v1/appointments/monthly-stats — series por mes (default 6 meses).
appointmentRoutes.get(
  '/monthly-stats',
  ...authenticated,
  requireStaff,
  appointmentController.monthlyStats
);

// GET /v1/appointments
appointmentRoutes.get('/', ...authenticated, requireStaff, appointmentController.list);

// GET /v1/appointments/:id
appointmentRoutes.get('/:id', ...authenticated, requireStaff, appointmentController.get);

// POST /v1/appointments
appointmentRoutes.post('/', ...authenticated, requireStaff, appointmentController.create);

// PUT /v1/appointments/:id
appointmentRoutes.put('/:id', ...authenticated, requireStaff, appointmentController.update);

// PATCH /v1/appointments/:id  (reschedule/edit — matches design.md; same
// handler as PUT so both verbs work and no existing caller breaks).
appointmentRoutes.patch('/:id', ...authenticated, requireStaff, appointmentController.update);

// PATCH /v1/appointments/:id/status
appointmentRoutes.patch('/:id/status', ...authenticated, requireStaff, appointmentController.updateStatus);

// PATCH /v1/appointments/:id/archive
// Archives the appointment (non-destructive; hides it from the default listing).
// Same guard as the other appointment actions (requireStaff = ADMIN or ASSISTANT).
appointmentRoutes.patch('/:id/archive', ...authenticated, requireStaff, appointmentController.archive);

// PATCH /v1/appointments/:id/payment
appointmentRoutes.patch('/:id/payment', ...authenticated, requireStaff, appointmentController.updatePayment);

// PATCH /v1/appointments/:id/customer-phone   body: { phone }
// Lets staff capture/edit the client's phone (public bookings store
// 'sin-telefono') so a WhatsApp reminder link can be built.
appointmentRoutes.patch(
  '/:id/customer-phone',
  ...authenticated,
  requireStaff,
  appointmentController.updateCustomerPhone
);

// GET /v1/appointments/:id/whatsapp-reminder
// Builds a MANUAL wa.me reminder link + prefilled text (no message is ever
// sent; no messaging API is called).
appointmentRoutes.get(
  '/:id/whatsapp-reminder',
  ...authenticated,
  requireStaff,
  appointmentController.whatsappReminder
);

// Internal notes (bitacora) — staff-only, tenant-scoped, never exposed publicly.
// GET /v1/appointments/:id/notes
appointmentRoutes.get('/:id/notes', ...authenticated, requireStaff, appointmentController.listNotes);

// POST /v1/appointments/:id/notes   body: { body }
appointmentRoutes.post('/:id/notes', ...authenticated, requireStaff, appointmentController.addNote);

// DELETE /v1/appointments/:id/notes/:noteId
appointmentRoutes.delete(
  '/:id/notes/:noteId',
  ...authenticated,
  requireStaff,
  appointmentController.deleteNote
);

// DELETE /v1/appointments/:id
appointmentRoutes.delete('/:id', ...authenticated, requireStaff, appointmentController.cancel);

// GET /v1/appointments/:id/availability
appointmentRoutes.get(
  '/:id/availability',
  ...authenticated,
  requireStaff,
  appointmentController.checkAvailability
);
