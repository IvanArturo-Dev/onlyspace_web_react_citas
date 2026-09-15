import { AppointmentStatus, Prisma, WaitlistStatus } from '@prisma/client';
import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';
import { customerCancellationService } from './customerCancellation.service';
import { notificationService } from './notification.service';

/**
 * Servicio de lista de espera (waitlist) FIFO por servicio/dia.
 *
 * Gestiona el encolamiento de clientes cuando un horario esta lleno, la oferta
 * semiautomatica de un espacio liberado (que crea una cita PENDING re-verificando
 * el solape como booking.service) y las transiciones de estado de la entrada
 * (WAITING -> OFFERED -> CONFIRMED, o EXPIRED/CANCELLED).
 *
 * Reglas clave:
 *  - Bloqueo por deuda: un cliente con deuda pendiente no puede encolarse
 *    (409 CUSTOMER_HAS_DEBT), igual que en la reserva.
 *  - Idempotencia: un mismo cliente no puede tener dos entradas activas
 *    (WAITING/OFFERED) para el mismo servicio/dia.
 *  - FIFO estable: firstWaiting/listQueue ordenan por created_at asc.
 *  - Aislamiento por tenant: toda entrada se scopea por tenant_id; cruces -> 404.
 */

/**
 * Rango [inicio, fin) del dia calendario (UTC) al que pertenece `date`.
 * Se usa el mismo convenio de dia (medianoche UTC) que booking/availability para
 * comparar `desired_date` contra un dia concreto.
 */
function dayRange(date: Date): { start: Date; end: Date } {
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0)
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** Devuelve true si [aStart, aEnd) se solapa con [bStart, bEnd). */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Estados de una entrada considerada "activa" para la regla de idempotencia. */
const ACTIVE_STATUSES: WaitlistStatus[] = [WaitlistStatus.WAITING, WaitlistStatus.OFFERED];

/** Datos de entrada para encolar un cliente. */
export interface JoinWaitlistInput {
  tenantId: string;
  branchId?: string | null;
  serviceId: string;
  customerId: string;
  desiredDate: Date;
  desiredStart?: Date | null;
}

/** Datos de entrada para ofrecer un espacio liberado a una entrada. */
export interface OfferWaitlistInput {
  start: Date;
  end: Date;
  branchId?: string | null;
}

/**
 * Encola a un cliente en la lista de espera.
 *
 * 1. Si el cliente tiene deuda -> 409 CUSTOMER_HAS_DEBT.
 * 2. Idempotencia: si ya existe una entrada activa (WAITING/OFFERED) del mismo
 *    cliente/servicio cuyo `desired_date` cae el mismo dia, devuelve la existente
 *    sin crear un duplicado.
 * 3. Crea una WaitlistEntry WAITING y la devuelve.
 */
async function join(input: JoinWaitlistInput) {
  const { tenantId, branchId, serviceId, customerId, desiredDate, desiredStart } = input;

  // 1a. Enforcement de bloqueo (Requirement 4.2): un cliente cuyo status !=
  // "active" (p. ej. "blocked") tampoco puede encolarse en la lista de espera,
  // ya que la oferta terminaria creando una cita. Scoped por tenant (404 si el
  // cliente no pertenece al tenant). Se coloca junto al bloqueo por deuda.
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenant_id: tenantId },
    select: { status: true },
  });
  if (!customer) {
    throw new HttpError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
  }
  if (customer.status !== 'active') {
    throw new HttpError(
      'El cliente esta bloqueado por el negocio y no puede reservar',
      409,
      'CUSTOMER_BLOCKED'
    );
  }

  // 1b. Bloqueo por deuda.
  const hasDebt = await customerCancellationService.hasDebt(tenantId, customerId);
  if (hasDebt) {
    throw new HttpError(
      'El cliente tiene una penalizacion pendiente de pago',
      409,
      'CUSTOMER_HAS_DEBT'
    );
  }

  // 2. Idempotencia: entrada activa del mismo cliente/servicio en el mismo dia.
  const { start, end } = dayRange(desiredDate);
  const existing = await prisma.waitlistEntry.findFirst({
    where: {
      tenant_id: tenantId,
      service_id: serviceId,
      customer_id: customerId,
      status: { in: ACTIVE_STATUSES },
      desired_date: { gte: start, lt: end },
    },
    orderBy: { created_at: 'asc' },
  });

  if (existing) {
    return existing;
  }

  // 3. Crear entrada WAITING.
  const entry = await prisma.waitlistEntry.create({
    data: {
      tenant_id: tenantId,
      branch_id: branchId ?? null,
      service_id: serviceId,
      customer_id: customerId,
      desired_date: desiredDate,
      desired_start: desiredStart ?? null,
      status: WaitlistStatus.WAITING,
    },
  });

  // Notificacion in-app al emprendedor (Requirement 6.1, Property 8): "cita
  // encolada". Best-effort — notify nunca lanza, pero el try/catch garantiza
  // que un fallo aqui jamas rompe el encolamiento ya persistido.
  try {
    await notificationService.notify(tenantId, {
      event_type: 'appointment_waitlisted',
      title: 'Cliente en lista de espera',
      body: 'Un cliente se anoto en la lista de espera de un servicio.',
      customer_id: customerId,
    });
  } catch {
    /* best-effort: no rompe el encolamiento */
  }

  return entry;
}

/**
 * Lista la cola FIFO (WAITING) de un servicio para un dia concreto, ordenada por
 * created_at asc. Scoped por tenant.
 */
async function listQueue(tenantId: string, params: { serviceId: string; date: Date }) {
  const { start, end } = dayRange(params.date);
  return prisma.waitlistEntry.findMany({
    where: {
      tenant_id: tenantId,
      service_id: params.serviceId,
      status: WaitlistStatus.WAITING,
      desired_date: { gte: start, lt: end },
    },
    orderBy: { created_at: 'asc' },
  });
}

/**
 * Primera entrada WAITING (FIFO, menor created_at) compatible con el servicio/dia,
 * o null si la cola esta vacia. Scoped por tenant.
 */
async function firstWaiting(tenantId: string, serviceId: string, date: Date) {
  const { start, end } = dayRange(date);
  return prisma.waitlistEntry.findFirst({
    where: {
      tenant_id: tenantId,
      service_id: serviceId,
      status: WaitlistStatus.WAITING,
      desired_date: { gte: start, lt: end },
    },
    orderBy: { created_at: 'asc' },
  });
}

/**
 * Carga una entrada scoped por tenant o lanza 404 WAITLIST_ENTRY_NOT_FOUND.
 */
async function loadEntryOrThrow(
  tenantId: string,
  entryId: string,
  db: typeof prisma | Prisma.TransactionClient = prisma
) {
  const entry = await db.waitlistEntry.findFirst({
    where: { id: entryId, tenant_id: tenantId },
  });
  if (!entry) {
    throw new HttpError('Entrada de lista de espera no encontrada', 404, 'WAITLIST_ENTRY_NOT_FOUND');
  }
  return entry;
}

/**
 * Ofrece un espacio liberado a una entrada (ADMIN).
 *
 * Carga la entrada scoped por tenant (404 si ajena/inexistente). Dentro de una
 * transaccion re-verifica el solape (patron booking.service): busca citas del
 * tenant (+branch si aplica) del mismo servicio no CANCELLED que se solapen con
 * [start, end); si hay solape -> 409 SLOT_TAKEN. Si el slot esta libre, crea la
 * cita PENDING para el cliente de la entrada, marca la entrada OFFERED y guarda
 * `offered_appointment_id`. Devuelve { entry, appointment }.
 */
async function offer(tenantId: string, entryId: string, input: OfferWaitlistInput) {
  const entry = await loadEntryOrThrow(tenantId, entryId);

  const { start, end } = input;
  const startMs = start.getTime();
  const endMs = end.getTime();
  const branchId = input.branchId ?? entry.branch_id ?? null;

  return prisma.$transaction(async (tx) => {
    // Re-verificacion de solape (misma tx que la creacion -> sin doble reserva).
    const overlapWhere: Prisma.AppointmentWhereInput = {
      tenant_id: tenantId,
      service_id: entry.service_id,
      status: { not: AppointmentStatus.CANCELLED },
      start_time: { lt: end },
    };
    if (branchId) {
      overlapWhere.branch_id = branchId;
    }

    const candidates = await tx.appointment.findMany({
      where: overlapWhere,
      select: { start_time: true, end_time: true },
    });

    const hasOverlap = candidates.some((c) =>
      overlaps(startMs, endMs, new Date(c.start_time).getTime(), new Date(c.end_time).getTime())
    );

    if (hasOverlap) {
      throw new HttpError('El horario ya no esta disponible', 409, 'SLOT_TAKEN');
    }

    const appointment = await tx.appointment.create({
      data: {
        tenant_id: tenantId,
        branch_id: branchId,
        customer_id: entry.customer_id,
        service_id: entry.service_id,
        start_time: start,
        end_time: end,
        status: AppointmentStatus.PENDING,
      },
    });

    const updatedEntry = await tx.waitlistEntry.update({
      where: { id: entry.id },
      data: {
        status: WaitlistStatus.OFFERED,
        offered_appointment_id: appointment.id,
      },
    });

    return { entry: updatedEntry, appointment };
  });
}

/**
 * Confirma una oferta (ADMIN): marca la entrada CONFIRMED y su cita asociada
 * (offered_appointment_id) como CONFIRMED. Scoped por tenant (404 si ajena).
 */
async function confirmOffer(tenantId: string, entryId: string) {
  const entry = await loadEntryOrThrow(tenantId, entryId);

  return prisma.$transaction(async (tx) => {
    if (entry.offered_appointment_id) {
      await tx.appointment.updateMany({
        where: { id: entry.offered_appointment_id, tenant_id: tenantId },
        data: { status: AppointmentStatus.CONFIRMED },
      });
    }

    return tx.waitlistEntry.update({
      where: { id: entry.id },
      data: { status: WaitlistStatus.CONFIRMED },
    });
  });
}

/**
 * Marca una entrada como EXPIRED (scoped por tenant, 404 si ajena).
 */
async function expire(tenantId: string, entryId: string) {
  const entry = await loadEntryOrThrow(tenantId, entryId);
  return prisma.waitlistEntry.update({
    where: { id: entry.id },
    data: { status: WaitlistStatus.EXPIRED },
  });
}

/**
 * Marca una entrada como CANCELLED (scoped por tenant, 404 si ajena).
 */
async function cancelEntry(tenantId: string, entryId: string) {
  const entry = await loadEntryOrThrow(tenantId, entryId);
  return prisma.waitlistEntry.update({
    where: { id: entry.id },
    data: { status: WaitlistStatus.CANCELLED },
  });
}

export const waitlistService = {
  join,
  listQueue,
  firstWaiting,
  offer,
  confirmOffer,
  expire,
  cancelEntry,
};

export { join, listQueue, firstWaiting, offer, confirmOffer, expire, cancelEntry };
