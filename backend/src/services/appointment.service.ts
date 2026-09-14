import pino from 'pino';
import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';
import { branchService, getPrimaryBranchId, isTenantPremium } from './branch.service';
import { loyaltyService } from './loyalty.service';
import { runGoogleAppointmentHook } from './google-appointment-hook';
import { customerCancellationService } from './customerCancellation.service';
import { waitlistService } from './waitlist.service';
import { notificationService } from './notification.service';

const logger = pino();

/**
 * Medianoche UTC (00:00:00.000Z) del dia calendario del Date dado. Mismo
 * convenio de dia que booking.service.ts / availability / holiday, usado como
 * inicio del rango de dia para la regla anti-duplicado.
 */
/**
 * Normalizes the appointment modality. Only the explicit "online" value maps to
 * "online"; any other value (undefined, null, invalid strings) falls back to
 * "in_person", matching the same criterion used by booking.service.
 */
function normalizeModality(m?: string | null): 'online' | 'in_person' {
  return m === 'online' ? 'online' : 'in_person';
}

/**
 * Normalizes a manual video-call URL for persistence. Only called when the
 * `video_call_url` field is present in the payload. Trims the value; an empty
 * string clears the link (returns null). A non-empty value MUST be an http(s)
 * URL, otherwise a 400 VALIDATION_ERROR is thrown so an invalid URL never
 * reaches the DB (Requirement 2.2/2.3).
 */
function normalizeVideoUrl(u?: string | null): string | null {
  const s = typeof u === 'string' ? u.trim() : '';
  if (s === '') return null;
  if (!/^https?:\/\//i.test(s)) {
    throw new HttpError('video_call_url debe ser una URL http(s) valida', 400, 'VALIDATION_ERROR');
  }
  return s;
}

function midnightUtcOf(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0)
  );
}

/**
 * Rango [inicio, fin) del dia calendario (UTC) al que pertenece `date`: usado
 * para acotar la busqueda de citas del mismo dia en la regla anti-duplicado.
 */
function dayRangeUtc(date: Date): { dayStart: Date; dayEnd: Date } {
  const dayStart = midnightUtcOf(date);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  return { dayStart, dayEnd };
}

/**
 * Fires the loyalty engine after an appointment status change has already been
 * persisted. Detects the COMPLETED transition and routes to the matching engine
 * entry point:
 *  - INTO COMPLETED (previous !== COMPLETED && next === COMPLETED) -> accumulate
 *  - OUT OF COMPLETED (previous === COMPLETED && next !== COMPLETED) -> reverse
 *
 * Loyalty is strictly best-effort: it runs in a try/catch and NEVER throws, so
 * a loyalty failure can never roll back or block the appointment status change
 * (Requirement 8.1). Errors are logged via pino and swallowed.
 */
async function runLoyaltyHook(
  appointment: { id: string; tenant_id: string; customer_id: string | null },
  previousStatus: string,
  nextStatus: string
): Promise<void> {
  try {
    const wasCompleted = previousStatus === 'COMPLETED';
    const isCompleted = nextStatus === 'COMPLETED';

    if (!wasCompleted && isCompleted) {
      await loyaltyService.onAppointmentCompleted({
        id: appointment.id,
        tenant_id: appointment.tenant_id,
        customer_id: appointment.customer_id,
      });
    } else if (wasCompleted && !isCompleted) {
      await loyaltyService.onAppointmentUncompleted({
        id: appointment.id,
        tenant_id: appointment.tenant_id,
        customer_id: appointment.customer_id,
      });
    }
  } catch (error) {
    // Loyalty must never break the appointment flow (Requirement 8.1).
    logger.error(
      { err: error, appointmentId: appointment.id, previousStatus, nextStatus },
      'Loyalty hook failed after appointment status change'
    );
  }
}

export const appointmentService = {
  async listAppointments(tenantId: string, params: any) {
    const {
      start_date,
      end_date,
      professional_id,
      status,
      branch_id,
      isPremium,
      page = 1,
      limit = 20,
    } = params;
    const skip = (page - 1) * limit;

    // Always scoped by tenant_id so an owner never sees another tenant's data
    // (Property 5: aislamiento por tenant). Archived appointments are excluded
    // by default so they disappear from every column (Property 2, Req 1.3/5.2).
    //
    // SEGUIMIENTO DE CITAS (Requirement 4.2, Property 6): el listado/consulta de
    // citas NO se gatea por premium ni por sucursal. Las citas de sucursales
    // EXTRA (aunque el tenant sea free) DEBEN seguir visibles para que el
    // emprendedor pueda darles seguimiento; por eso aqui NO se filtra por la
    // sucursal principal ni por el estado premium. El unico filtro por
    // `branch_id` posible es el explicito pedido en `params` (para acotar la
    // vista a una sucursal), nunca uno derivado del gating premium.
    const where: any = { tenant_id: tenantId, archived: false };

    if (isPremium === false) {
      // GATING PREMIUM: en free la vista de citas queda FORZADA a una ventana
      // limitada [hoy-7 dias, hoy+7 dias], sin importar el rango que venga en
      // start_date/end_date. Solo puede ver citas con start_time entre el inicio
      // del dia de hace 7 dias y el fin del dia de dentro de 7 dias. El premium
      // (o isPremium indefinido) respeta el rango recibido / ve todo.
      const now = new Date(Date.now());
      const startWindow = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 7, 0, 0, 0, 0)
      );
      const endWindow = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() + 7,
          23,
          59,
          59,
          999
        )
      );
      where.start_time = { gte: startWindow, lte: endWindow };
    } else if (start_date && end_date) {
      where.start_time = {
        gte: new Date(start_date),
        lte: new Date(end_date),
      };
    }

    if (professional_id) {
      where.professional_id = professional_id;
    }

    if (status) {
      where.status = status;
    }

    if (branch_id) {
      where.branch_id = branch_id;
    }

    const appointments = await prisma.appointment.findMany({
      where,
      skip,
      take: limit,
      orderBy: { start_time: 'asc' },
      include: {
        customer: true,
        service: true,
        professional: { include: { user: true } },
      },
    });

    const total = await prisma.appointment.count({ where });

    return { appointments, total, page, limit };
  },

  /**
   * PREMIUM-only: devuelve las citas del tenant en un rango [start, end] con el
   * cliente/servicio incluidos, para generar el reporte (CSV) en el controlador.
   * Scoped por tenant. Cuando no se pasa rango, el controlador aplica el default
   * (ultimos 90 dias). Excluye las archivadas para reflejar la vista real.
   */
  async listForReport(
    tenantId: string,
    range: { start: Date; end: Date }
  ): Promise<any[]> {
    const appointments = await prisma.appointment.findMany({
      where: {
        tenant_id: tenantId,
        archived: false,
        start_time: { gte: range.start, lte: range.end },
      },
      orderBy: { start_time: 'asc' },
      include: {
        customer: true,
        service: true,
      },
    });

    // Appointment no tiene relacion `branch` directa (solo `branch_id`
    // escalar), asi que se resuelven los nombres de sucursal en una sola
    // consulta scoped por tenant y se adjuntan a cada cita como `branch`.
    const branchIds = Array.from(
      new Set(
        appointments
          .map((a) => a.branch_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      )
    );

    let branchMap = new Map<string, { id: string; name: string }>();
    if (branchIds.length > 0) {
      const branches = await prisma.branch.findMany({
        where: { tenant_id: tenantId, id: { in: branchIds } },
        select: { id: true, name: true },
      });
      branchMap = new Map(branches.map((b) => [b.id, b]));
    }

    return appointments.map((a) => ({
      ...a,
      branch: a.branch_id ? branchMap.get(a.branch_id) ?? null : null,
    }));
  },

  /**
   * PREMIUM-only: series por mes de los ultimos `months` meses. Para cada mes
   * devuelve { month:'YYYY-MM', total, by_status:{...}, income }. Agrupa por el
   * mes (UTC) del start_time. income = suma de amount_paid de las citas NO
   * canceladas del mes. Scoped por tenant.
   */
  async monthlyStats(
    tenantId: string,
    months: number = 6
  ): Promise<
    Array<{
      month: string;
      total: number;
      by_status: {
        PENDING: number;
        CONFIRMED: number;
        COMPLETED: number;
        CANCELLED: number;
        NO_SHOW: number;
      };
      income: number;
    }>
  > {
    const monthsCount = Number.isInteger(months) && months > 0 ? months : 6;

    // Rango: desde el inicio (UTC) del mes que esta `monthsCount-1` meses atras
    // hasta el fin del mes actual.
    const now = new Date(Date.now());
    const startYear = now.getUTCFullYear();
    const startMonth = now.getUTCMonth() - (monthsCount - 1);
    const rangeStart = new Date(Date.UTC(startYear, startMonth, 1, 0, 0, 0, 0));
    const rangeEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0)
    );

    // Pre-inicializa un bucket por cada mes del rango para que los meses sin
    // citas aparezcan en cero (serie continua).
    const buckets = new Map<
      string,
      {
        month: string;
        total: number;
        by_status: {
          PENDING: number;
          CONFIRMED: number;
          COMPLETED: number;
          CANCELLED: number;
          NO_SHOW: number;
        };
        income: number;
      }
    >();

    for (let i = 0; i < monthsCount; i++) {
      const d = new Date(Date.UTC(startYear, startMonth + i, 1, 0, 0, 0, 0));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      buckets.set(key, {
        month: key,
        total: 0,
        by_status: { PENDING: 0, CONFIRMED: 0, COMPLETED: 0, CANCELLED: 0, NO_SHOW: 0 },
        income: 0,
      });
    }

    const appointments = await prisma.appointment.findMany({
      where: {
        tenant_id: tenantId,
        archived: false,
        start_time: { gte: rangeStart, lt: rangeEnd },
      },
      select: { start_time: true, status: true, amount_paid: true },
    });

    for (const appt of appointments) {
      const st = new Date(appt.start_time);
      const key = `${st.getUTCFullYear()}-${String(st.getUTCMonth() + 1).padStart(2, '0')}`;
      const bucket = buckets.get(key);
      if (!bucket) continue; // fuera del rango pre-inicializado

      bucket.total += 1;
      const status = appt.status as
        | 'PENDING'
        | 'CONFIRMED'
        | 'COMPLETED'
        | 'CANCELLED'
        | 'NO_SHOW';
      if (status in bucket.by_status) {
        bucket.by_status[status] += 1;
      }
      // income: solo citas NO canceladas.
      if (status !== 'CANCELLED') {
        bucket.income += Number(appt.amount_paid ?? 0);
      }
    }

    // Orden cronologico ascendente por mes.
    return Array.from(buckets.values()).sort((a, b) => a.month.localeCompare(b.month));
  },

  async getAppointment(tenantId: string, appointmentId: string) {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId, tenant_id: tenantId },
      include: {
        customer: true,
        service: true,
        professional: { include: { user: true } },
      },
    });

    if (!appointment) {
      throw new HttpError('Appointment not found', 404, 'APPOINTMENT_NOT_FOUND');
    }

    return appointment;
  },

  async createAppointment(tenantId: string, data: any) {
    const { customer_id, service_id, professional_id, start_time, notes, branch_id } = data;

    // Validate branch belongs to this tenant when provided. branchService.get
    // is scoped by tenantId, so a branch from another tenant throws 404
    // (Property 5: aislamiento por tenant). branch_id is optional for
    // backwards compatibility (null allowed).
    if (branch_id) {
      // Valida pertenencia (404 BRANCH_NOT_FOUND si es de otro tenant). Ademas,
      // branchService.get ya aplica el gating de GESTION y hoy lanza 403
      // PREMIUM_REQUIRED cuando el tenant es free y la sucursal no es la
      // principal (efecto colateral). Se mantiene aqui la validacion de
      // pertenencia.
      await branchService.get(tenantId, branch_id);

      // Salvaguarda EXPLICITA del flujo de AGENDADO (Requirements 4.3): en free,
      // agendar en una sucursal que no es la principal se bloquea con 403
      // PREMIUM_REQUIRED y un mensaje propio de agendado. branchService.get ya
      // habra lanzado 403 antes en este mismo caso, por lo que esta comprobacion
      // es una redundancia defensiva (documentacion viva del flujo de agendado y
      // proteccion si get cambiara su gating en el futuro). El premium no tiene
      // restriccion. NO se agenda en sucursal oculta (Property 5).
      const premium = await isTenantPremium(tenantId);
      if (!premium) {
        const primaryId = await getPrimaryBranchId(tenantId);
        if (branch_id !== primaryId) {
          throw new HttpError(
            'Agendar en esta sucursal es solo para premium',
            403,
            'PREMIUM_REQUIRED'
          );
        }
      }
    }

    // Validate customer exists
    const customer = await prisma.customer.findUnique({
      where: { id: customer_id, tenant_id: tenantId },
    });
    if (!customer) {
      throw new HttpError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
    }

    // Bloqueo por deuda (Requirement 3.2, Property 5): un cliente con una
    // penalizacion pendiente de pago no puede agendar una nueva cita. Se coloca
    // DESPUES de validar que el customer existe (para no filtrar la deuda de un
    // cliente inexistente) y ANTES de crear nada, de modo que ninguna cita se
    // persiste cuando hay deuda. Consistente con el mismo bloqueo de
    // waitlist.service (409 CUSTOMER_HAS_DEBT).
    if (await customerCancellationService.hasDebt(tenantId, customer_id)) {
      throw new HttpError(
        'El cliente tiene una penalizacion pendiente de pago',
        409,
        'CUSTOMER_HAS_DEBT'
      );
    }

    // Validate service exists
    const service = await prisma.service.findUnique({
      where: { id: service_id, tenant_id: tenantId },
    });
    if (!service) {
      throw new HttpError('Service not found', 404, 'SERVICE_NOT_FOUND');
    }

    // Anti-duplicado (Requirement 1): el mismo cliente no puede tener otra cita
    // ACTIVA (status != CANCELLED) del mismo servicio el mismo dia calendario
    // (dia UTC de start_time). Scoped por tenant (Property 2: aislamiento).
    // Distinto del aforo/APPOINTMENT_CONFLICT: aqui es por cliente/dia/categoria.
    {
      const { dayStart, dayEnd } = dayRangeUtc(new Date(start_time));
      const duplicate = await prisma.appointment.count({
        where: {
          tenant_id: tenantId,
          service_id,
          customer_id,
          status: { not: 'CANCELLED' },
          start_time: { gte: dayStart, lt: dayEnd },
        },
      });
      if (duplicate > 0) {
        throw new HttpError(
          'Ya existe una cita de esta categoria para este cliente hoy',
          409,
          'DUPLICATE_BOOKING'
        );
      }
    }

    // Validate professional exists
    if (professional_id) {
      // Professional is linked to User, so we need to check through User
      const professionalRecord = await prisma.professional.findUnique({
        where: { id: professional_id },
      });
      if (!professionalRecord) {
        throw new HttpError('Professional not found', 404, 'PROFESSIONAL_NOT_FOUND');
      }
      // Verify professional belongs to tenant
      const user = await prisma.user.findUnique({
        where: { id: professionalRecord.user_id },
      });
      if (!user || user.tenant_id !== tenantId) {
        throw new HttpError('Professional not found', 404, 'PROFESSIONAL_NOT_FOUND');
      }
    }

    // Validate appointment doesn't conflict
    const endTime = new Date(start_time);
    endTime.setMinutes(endTime.getMinutes() + service.duration_mins);

    const conflictWhere: any = {
      tenant_id: tenantId,
      professional_id: professional_id || { not: null },
      start_time: { lt: endTime },
      end_time: { gt: start_time },
      status: { not: 'CANCELLED' },
    };
    // Scope the overlap check to the same branch when one is provided.
    if (branch_id) {
      conflictWhere.branch_id = branch_id;
    }

    const conflicting = await prisma.appointment.findFirst({
      where: conflictWhere,
    });

    if (conflicting) {
      throw new HttpError(
        'Appointment conflicts with existing appointment',
        409,
        'APPOINTMENT_CONFLICT'
      );
    }

    const created = await prisma.appointment.create({
      data: {
        tenant_id: tenantId,
        branch_id: branch_id ?? null,
        customer_id,
        service_id,
        professional_id,
        start_time,
        end_time: endTime,
        status: 'PENDING',
        notes,
        modality: normalizeModality(data.modality),
        // Persist the manual video-call URL only when the field is present in
        // the payload; when absent, leave the column default untouched
        // (Requirement 2.2). Validation (400) happens inside normalizeVideoUrl.
        ...(data.video_call_url !== undefined
          ? { video_call_url: normalizeVideoUrl(data.video_call_url) }
          : {}),
      },
    });

    // AFTER the appointment is persisted, fire the Google hook (best-effort;
    // never blocks or rolls back the creation). Resolves the tenant/admin Google
    // account regardless of who booked (Requirement 6.2).
    await runGoogleAppointmentHook('created', tenantId, created.id);

    // In-app notification for the entrepreneur (Requirement 6.1, Property 8).
    // notify is already best-effort (never throws), but wrap it in a defensive
    // try/catch anyway so nothing here can ever break a successful creation.
    try {
      const when = new Date(created.start_time).toISOString();
      await notificationService.notify(tenantId, {
        event_type: 'appointment_created',
        title: 'Nueva cita',
        body: `Nueva cita de ${customer.name ?? 'cliente'} para ${when}`,
        appointment_id: created.id,
        customer_id,
      });
    } catch (error) {
      logger.error(
        { err: error, appointmentId: created.id },
        'appointment_created notification failed (best-effort)'
      );
    }

    return created;
  },

  /**
   * Reschedules / edits an appointment (Requirement 5). When the schedule-
   * relevant fields change (start_time or service_id), the new slot is
   * revalidated against the SERVICE CAPACITY (aforo, Requirement 1) — NOT the
   * old "first overlap wins" rule — so this stays consistent with the booking
   * flow: overlaps are counted for the SAME service within the same scope and
   * the update is rejected only when the count reaches capacity, with 409
   * SLOT_TAKEN (Requirement 5.2, 5.3; Property 7).
   *
   * The capacity check and the write happen in the SAME transaction so two
   * concurrent reschedules cannot overflow the slot (Requirement 7.2/7.3).
   *
   * Tenant isolation (Property 6): the appointment is loaded through
   * getAppointment (scoped by tenant_id -> 404 APPOINTMENT_NOT_FOUND for a
   * foreign appointment) and every write is scoped by tenant_id.
   *
   * Payment/notes safety (Requirement 5.5): only the fields passed in `data`
   * (plus a recomputed end_time when the schedule changes) are persisted, so
   * payment fields, notes and attachments are never reset by an update.
   */
  async updateAppointment(tenantId: string, appointmentId: string, data: any) {
    // Always fetch scoped by tenant; a foreign appointment throws 404
    // (Property 6: aislamiento por tenant).
    const existing = await this.getAppointment(tenantId, appointmentId);

    // Validate the branch belongs to this tenant when it is being changed.
    if (data.branch_id) {
      await branchService.get(tenantId, data.branch_id);
    }

    // Only schedule-relevant changes (start_time or service_id) trigger the
    // capacity revalidation. A notes-only (or other non-schedule) update must
    // NOT run any capacity check (Requirement 5.2 trigger).
    const startChanged = data.start_time !== undefined;
    const serviceChanged =
      data.service_id !== undefined && data.service_id !== existing.service_id;

    if (!startChanged && !serviceChanged) {
      // No schedule change: persist only the provided fields as-is. When a
      // modality is supplied, replace it in-place with its normalized value so
      // an invalid modality never reaches the DB (the rest of `data` is left
      // untouched). No Google reschedule needed (times/service did not change).
      return prisma.appointment.update({
        where: { id: appointmentId, tenant_id: tenantId },
        data: {
          ...data,
          ...(data.modality !== undefined
            ? { modality: normalizeModality(data.modality) }
            : {}),
          // Persist the normalized manual video-call URL when it is provided
          // (Requirement 2.2/2.4). normalizeVideoUrl throws 400 for an invalid
          // URL before any write happens.
          ...(data.video_call_url !== undefined
            ? { video_call_url: normalizeVideoUrl(data.video_call_url) }
            : {}),
        },
      });
    }

    // Effective service = incoming service_id or the existing one; load it
    // scoped by tenant so a foreign/unknown service yields 404.
    const serviceId = data.service_id ?? existing.service_id;
    const service = await prisma.service.findUnique({
      where: { id: serviceId, tenant_id: tenantId },
    });
    if (!service) {
      throw new HttpError('Service not found', 404, 'SERVICE_NOT_FOUND');
    }

    const startTime =
      data.start_time !== undefined ? new Date(data.start_time) : existing.start_time;
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + service.duration_mins);

    const startMs = startTime.getTime();
    const endMs = endTime.getTime();

    // Scope the overlap count to the same branch when the appointment has one.
    const branchId = data.branch_id ?? existing.branch_id;

    // Anti-duplicado (Requirement 1) para reprogramaciones: solo aplica cuando
    // cambia el service_id o el DIA calendario del start_time (un cambio de
    // hora dentro del mismo dia y mismo servicio no puede generar duplicado con
    // OTRA cita que no existiera ya). Se compara el dia UTC nuevo vs el actual.
    const dayChanged =
      startChanged &&
      midnightUtcOf(startTime).getTime() !==
        midnightUtcOf(new Date(existing.start_time)).getTime();
    const runDuplicateCheck = serviceChanged || dayChanged;

    // Capacity (aforo) is per service; default to 1 for any invalid value so
    // the historic strict behavior is preserved.
    const capacity =
      Number.isInteger((service as any).capacity) && (service as any).capacity >= 1
        ? (service as any).capacity
        : 1;

    // Normalize (and validate) the manual video-call URL BEFORE opening the
    // transaction so an invalid URL rejects with 400 without leaving the
    // reschedule work half-done (Requirement 2.2/2.4). Only when the field is
    // present in the payload.
    const videoUrlProvided = data.video_call_url !== undefined;
    const videoUrl = videoUrlProvided ? normalizeVideoUrl(data.video_call_url) : undefined;

    // Check capacity + persist the update in the SAME transaction so concurrent
    // reschedules cannot overflow the slot (Requirement 7.2/7.3, Property 7).
    const updated = await prisma.$transaction(async (tx) => {
      // Anti-duplicado (Requirement 1) dentro de la MISMA transaccion, ANTES
      // del chequeo de aforo. Solo cuando cambia servicio o el dia del
      // start_time (runDuplicateCheck). Cuenta OTRA cita activa del MISMO
      // cliente (existing.customer_id) + servicio efectivo, el dia efectivo,
      // EXCLUYENDO la propia cita (id != appointmentId). Scoped por tenant.
      if (runDuplicateCheck) {
        const { dayStart, dayEnd } = dayRangeUtc(startTime);
        const duplicate = await tx.appointment.count({
          where: {
            tenant_id: tenantId,
            service_id: serviceId,
            customer_id: existing.customer_id,
            id: { not: appointmentId },
            status: { not: 'CANCELLED' },
            start_time: { gte: dayStart, lt: dayEnd },
          },
        });
        if (duplicate > 0) {
          throw new HttpError(
            'Ya existe una cita de esta categoria para este cliente hoy',
            409,
            'DUPLICATE_BOOKING'
          );
        }
      }

      // Same overlap helper approach as booking.service.ts: fetch non-cancelled
      // candidates of the SAME service within scope (start_time < endTime),
      // EXCLUDING the appointment being updated, then count real overlaps in
      // memory and compare against capacity.
      const candidateWhere: any = {
        tenant_id: tenantId,
        service_id: serviceId,
        id: { not: appointmentId },
        status: { not: 'CANCELLED' },
        start_time: { lt: endTime },
      };
      if (branchId) {
        candidateWhere.branch_id = branchId;
      }

      const candidates = await tx.appointment.findMany({
        where: candidateWhere,
        select: { start_time: true, end_time: true },
      });

      const overlapCount = candidates.reduce(
        (acc: number, c: { start_time: Date; end_time: Date }) =>
          acc +
          (startMs < new Date(c.end_time).getTime() &&
          new Date(c.start_time).getTime() < endMs
            ? 1
            : 0),
        0
      );

      if (overlapCount >= capacity) {
        // Overflow -> reject WITHOUT modifying the appointment (Requirement 5.3).
        throw new HttpError('El horario ya no esta disponible', 409, 'SLOT_TAKEN');
      }

      // Persist ONLY the provided fields plus a recomputed end_time; payment
      // fields, notes and attachments are never touched (Requirement 5.5).
      return tx.appointment.update({
        where: { id: appointmentId, tenant_id: tenantId },
        data: {
          ...data,
          end_time: endTime,
          ...(data.modality !== undefined
            ? { modality: normalizeModality(data.modality) }
            : {}),
          // Persist the pre-validated manual video-call URL when provided.
          ...(videoUrlProvided ? { video_call_url: videoUrl } : {}),
        },
      });
    });

    // AFTER the reschedule is persisted, patch the Google event to reflect the
    // new times/service (best-effort; never blocks or rolls back the update).
    await runGoogleAppointmentHook('rescheduled', tenantId, appointmentId);

    return updated;
  },

  /**
   * Registers a manual payment on an appointment (Requirement 3). No real
   * charge or payment gateway is involved — the business simply records the
   * total and paid amounts and the system derives the payment_status.
   *
   * Tenant isolation (Property 6): the appointment is loaded through
   * getAppointment, which is scoped by tenant_id and throws 404
   * APPOINTMENT_NOT_FOUND for a foreign appointment, so a caller can never
   * touch another tenant's payment.
   *
   * Validation (Requirement 3.6): amount_total and amount_paid must be finite,
   * non-negative numbers, and amount_paid must not exceed amount_total; any
   * violation throws 400 VALIDATION_ERROR before any write.
   *
   * Derivation (Requirements 3.3-3.5):
   *  - amount_paid === 0                                  -> unpaid
   *  - 0 < amount_paid < amount_total                     -> partial
   *  - amount_paid >= amount_total && amount_total > 0    -> paid
   *  - amount_total === 0 && amount_paid === 0 (edge)     -> unpaid
   */
  async updatePayment(
    tenantId: string,
    appointmentId: string,
    data: { amount_total: number; amount_paid: number; currency?: string }
  ): Promise<any> {
    // Load scoped by tenant; a foreign appointment throws 404 (Property 6).
    const existing = await this.getAppointment(tenantId, appointmentId);

    const amountTotal = Number(data.amount_total);
    const amountPaid = Number(data.amount_paid);

    if (
      !Number.isFinite(amountTotal) ||
      !Number.isFinite(amountPaid) ||
      amountTotal < 0 ||
      amountPaid < 0
    ) {
      throw new HttpError(
        'amount_total and amount_paid must be non-negative numbers',
        400,
        'VALIDATION_ERROR'
      );
    }

    if (amountPaid > amountTotal) {
      throw new HttpError(
        'amount_paid cannot exceed amount_total',
        400,
        'VALIDATION_ERROR'
      );
    }

    // Currency is optional; keep the existing value (or "MXN") when omitted.
    const currency =
      data.currency !== undefined && data.currency !== null && data.currency !== ''
        ? String(data.currency)
        : existing.currency ?? 'MXN';

    // Derive payment_status (Requirements 3.3-3.5).
    let paymentStatus: 'unpaid' | 'partial' | 'paid';
    if (amountPaid === 0) {
      paymentStatus = 'unpaid';
    } else if (amountPaid < amountTotal) {
      paymentStatus = 'partial';
    } else {
      // amountPaid >= amountTotal && amountTotal > 0 (amountPaid > 0 here)
      paymentStatus = 'paid';
    }

    return prisma.appointment.update({
      where: { id: appointmentId, tenant_id: tenantId },
      data: {
        amount_total: amountTotal,
        amount_paid: amountPaid,
        currency,
        payment_status: paymentStatus as any,
      },
    });
  },

  /**
   * Edits the phone of the customer attached to an appointment (Requirement
   * 6.1-6.4). Used so the business can capture/fix a client's phone (public
   * bookings store 'sin-telefono') before building a WhatsApp reminder link.
   *
   * Tenant isolation (Property 6): the appointment is loaded through
   * getAppointment (scoped by tenant_id -> 404 APPOINTMENT_NOT_FOUND for a
   * foreign appointment), and the customer update is additionally scoped to the
   * same tenant, so a caller can never touch another tenant's customer.
   *
   * Validation (Requirement 6.3): the phone must be non-empty and match an
   * optional leading `+` followed by 8-15 digits (after stripping spaces,
   * dashes and parentheses); otherwise 400 VALIDATION_ERROR.
   */
  async updateCustomerPhone(
    tenantId: string,
    appointmentId: string,
    phone: string
  ): Promise<any> {
    // Load scoped by tenant; a foreign appointment throws 404 (Property 6).
    const appointment = await this.getAppointment(tenantId, appointmentId);

    const raw = typeof phone === 'string' ? phone.trim() : '';
    if (raw.length === 0) {
      throw new HttpError('phone is required', 400, 'VALIDATION_ERROR');
    }

    // Strip separators, then validate: optional +, 8-15 digits.
    const cleaned = raw.replace(/[\s\-().]/g, '');
    if (!/^\+?\d{8,15}$/.test(cleaned)) {
      throw new HttpError(
        'phone must be a valid phone number (optional +, 8-15 digits)',
        400,
        'VALIDATION_ERROR'
      );
    }

    // Update the customer of THIS appointment, scoped to the same tenant so a
    // foreign customer is never touched.
    const result = await prisma.customer.updateMany({
      where: { id: appointment.customer_id, tenant_id: tenantId },
      data: { phone: cleaned },
    });

    if (result.count === 0) {
      throw new HttpError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
    }

    return prisma.customer.findFirst({
      where: { id: appointment.customer_id, tenant_id: tenantId },
    });
  },

  async updateStatus(tenantId: string, appointmentId: string, status: string): Promise<any> {
    // Validate status exists and capture the PREVIOUS status so we can detect
    // the COMPLETED transition after the change is persisted.
    const existing = await this.getAppointment(tenantId, appointmentId);
    const previousStatus = existing.status;

    // Validate status
    const validStatuses = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];
    if (!validStatuses.includes(status)) {
      throw new HttpError('Invalid status', 400, 'INVALID_STATUS');
    }

    const updated = await prisma.appointment.update({
      where: { id: appointmentId, tenant_id: tenantId },
      data: { status: status as any },
    });

    // AFTER the status change is persisted, fire the loyalty hook (best-effort;
    // never blocks or rolls back the status change — Requirement 8.1).
    await runLoyaltyHook(
      { id: updated.id, tenant_id: updated.tenant_id, customer_id: updated.customer_id },
      previousStatus,
      status
    );

    // Google hook (best-effort): on CONFIRMED ensure the event and generate the
    // Meet link for online appointments; on CANCELLED delete the event.
    if (status === 'CONFIRMED') {
      await runGoogleAppointmentHook('confirmed', tenantId, updated.id);
    } else if (status === 'CANCELLED') {
      await runGoogleAppointmentHook('cancelled', tenantId, updated.id);
    }

    return updated;
  },

  async cancelAppointment(tenantId: string, appointmentId: string): Promise<any> {
    // Validate appointment exists and capture the PREVIOUS status. Cancelling a
    // COMPLETED appointment is a transition OUT of COMPLETED and must reverse
    // any accumulated loyalty progress.
    const existing = await this.getAppointment(tenantId, appointmentId);
    const previousStatus = existing.status;

    const updated = await prisma.appointment.update({
      where: { id: appointmentId, tenant_id: tenantId },
      data: { status: 'CANCELLED' },
    });

    // Registro de la cancelacion del cliente (Requirement 2.4, Property 4):
    // aplica la politica (incrementa el contador y, al superar el limite, agrega
    // la penalizacion/deuda). Se ejecuta tras marcar CANCELLED y ANTES de los
    // hooks best-effort. Un fallo aqui SI debe propagarse (la deuda es parte del
    // efecto de cancelar), por eso no va envuelto en try/catch.
    await customerCancellationService.registerCancellation(tenantId, existing.customer_id);

    await runLoyaltyHook(
      { id: updated.id, tenant_id: updated.tenant_id, customer_id: updated.customer_id },
      previousStatus,
      'CANCELLED'
    );

    // Google hook (best-effort): delete the Calendar event for the cancelled
    // appointment.
    await runGoogleAppointmentHook('cancelled', tenantId, updated.id);

    // In-app notification for the entrepreneur (Requirement 6.1, Property 8).
    // Best-effort: notify never throws, but the try/catch guards against any
    // unexpected failure so the cancellation is never rolled back.
    try {
      const when = new Date(existing.start_time).toISOString();
      await notificationService.notify(tenantId, {
        event_type: 'appointment_cancelled',
        title: 'Cita cancelada',
        body: `Se cancelo la cita del ${when}`,
        appointment_id: updated.id,
        customer_id: existing.customer_id,
      });
    } catch (error) {
      logger.error(
        { err: error, appointmentId: updated.id },
        'appointment_cancelled notification failed (best-effort)'
      );
    }

    // Sugerencia de reasignacion (Requirement 5.1, Property 7): tras liberar el
    // espacio, se consulta la primera entrada WAITING (FIFO) compatible con el
    // servicio/dia de la cita cancelada. Esto SOLO SUGIERE: no ofrece ni
    // confirma nada automaticamente (la reasignacion nunca es automatica). El
    // resultado (la entrada o null) se adjunta al retorno como
    // `waitlist_suggestion` para que el controlador/UI lo muestre. Best-effort:
    // un fallo aqui no debe romper la cancelacion ya persistida.
    let waitlistSuggestion: unknown = null;
    try {
      waitlistSuggestion = await waitlistService.firstWaiting(
        tenantId,
        existing.service_id,
        new Date(existing.start_time)
      );
    } catch (error) {
      logger.error(
        { err: error, appointmentId: updated.id },
        'waitlist suggestion lookup failed (best-effort)'
      );
      waitlistSuggestion = null;
    }

    return { ...updated, waitlist_suggestion: waitlistSuggestion };
  },

  /**
   * Espacios en riesgo (Requirement 5.1): citas PENDING (aun NO confirmadas)
   * cuyo `start_time` cae dentro de la ventana de las proximas 12 horas
   * (>= ahora y <= ahora + 12h), del tenant, no archivadas. Se usa para que el
   * emprendedor vea que citas siguen sin confirmar y son candidatas a
   * reasignacion. Es un filtro de SOLO LECTURA: no muta nada (Property 7).
   *
   * Ordenadas por start_time asc e incluye datos utiles (customer, service).
   * Scoped por tenant_id (Property 1: aislamiento por tenant).
   */
  async listOpenAtRisk(tenantId: string) {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + 12 * 60 * 60 * 1000);

    return prisma.appointment.findMany({
      where: {
        tenant_id: tenantId,
        archived: false,
        status: 'PENDING',
        start_time: { gte: now, lte: windowEnd },
      },
      orderBy: { start_time: 'asc' },
      include: {
        customer: true,
        service: true,
      },
    });
  },

  /**
   * Archives an appointment (Requirement 1.2-1.5). Archiving is non-destructive:
   * it only flips `archived` to true, leaving status and every other field
   * untouched, and the record stays in the DB (Property 1). Archived
   * appointments are excluded from listAppointments by default (Property 2).
   *
   * Tenant isolation (Property 5): the appointment is loaded through
   * getAppointment, which is scoped by tenant_id and throws 404
   * APPOINTMENT_NOT_FOUND for a foreign appointment, and the update is
   * additionally scoped by tenant_id, so a caller can never archive another
   * tenant's appointment.
   *
   * Archiving does NOT touch Google: it intentionally does NOT fire
   * runGoogleAppointmentHook (or the loyalty hook) — it is a local
   * visibility flag only.
   */
  async archiveAppointment(tenantId: string, appointmentId: string): Promise<any> {
    // Load scoped by tenant; a foreign appointment throws 404 (Property 5).
    await this.getAppointment(tenantId, appointmentId);

    return prisma.appointment.update({
      where: { id: appointmentId, tenant_id: tenantId },
      data: { archived: true },
    });
  },

  /**
   * Internal notes (bitacora) — Requirement 4.
   *
   * Notes are INTERNAL to the business: they are created, listed and deleted
   * only through these staff-scoped service methods and are NEVER exposed on
   * the client portal or any public endpoint (there is no public accessor for
   * appointment_notes). Each note records its author (author_id = userId) and a
   * timestamp (created_at, defaulted by the schema).
   *
   * Tenant isolation (Property 6): every method loads the appointment through
   * getAppointment, which is scoped by tenant_id and throws 404
   * APPOINTMENT_NOT_FOUND for a foreign appointment, so a caller can never add,
   * list or delete notes on another tenant's appointment.
   */
  async addNote(
    tenantId: string,
    appointmentId: string,
    body: string,
    authorId: string | null
  ): Promise<any> {
    // Load scoped by tenant; a foreign appointment throws 404 (Property 6).
    await this.getAppointment(tenantId, appointmentId);

    // Body must be a non-empty string once trimmed (Requirement 4.1).
    const trimmed = typeof body === 'string' ? body.trim() : '';
    if (trimmed.length === 0) {
      throw new HttpError('Note body is required', 400, 'VALIDATION_ERROR');
    }

    return prisma.appointmentNote.create({
      data: {
        tenant_id: tenantId,
        appointment_id: appointmentId,
        author_id: authorId,
        body: trimmed,
      },
    });
  },

  async listNotes(tenantId: string, appointmentId: string): Promise<any> {
    // Load scoped by tenant; a foreign appointment throws 404 (Property 6).
    await this.getAppointment(tenantId, appointmentId);

    return prisma.appointmentNote.findMany({
      where: { tenant_id: tenantId, appointment_id: appointmentId },
      orderBy: { created_at: 'desc' },
    });
  },

  async deleteNote(
    tenantId: string,
    appointmentId: string,
    noteId: string
  ): Promise<{ id: string }> {
    // Load scoped by tenant; a foreign appointment throws 404 (Property 6).
    await this.getAppointment(tenantId, appointmentId);

    // The note must exist AND belong to the same tenant + appointment; a note
    // from another tenant/appointment resolves to null and yields 404
    // NOTE_NOT_FOUND without deleting anything (Requirement 4.5).
    const note = await prisma.appointmentNote.findFirst({
      where: { id: noteId, tenant_id: tenantId, appointment_id: appointmentId },
    });
    if (!note) {
      throw new HttpError('Note not found', 404, 'NOTE_NOT_FOUND');
    }

    await prisma.appointmentNote.delete({ where: { id: noteId } });

    return { id: noteId };
  },

  async checkAvailability(tenantId: string, professionalId: string, startTime: Date, duration: number) {
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + duration);

    // Check if professional belongs to tenant
    const professional = await prisma.professional.findUnique({
      where: { id: professionalId },
    });
    if (!professional) {
      throw new HttpError('Professional not found', 404, 'PROFESSIONAL_NOT_FOUND');
    }
    const user = await prisma.user.findUnique({
      where: { id: professional.user_id },
    });
    if (!user || user.tenant_id !== tenantId) {
      throw new HttpError('Professional not found', 404, 'PROFESSIONAL_NOT_FOUND');
    }

    const existing = await prisma.appointment.findFirst({
      where: {
        professional_id: professionalId,
        start_time: { lt: endTime },
        end_time: { gt: startTime },
        status: { not: 'CANCELLED' },
      },
    });

    return !existing;
  },
};
