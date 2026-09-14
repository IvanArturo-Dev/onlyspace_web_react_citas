import { AppointmentStatus } from '@prisma/client';
import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';
import { scheduleService } from './schedule.service';

/**
 * Un slot disponible para reservar. `start` y `end` son ISO strings (UTC).
 */
export interface AvailabilitySlot {
  start: string;
  end: string;
}

// ---------------------------------------------------------------------------
// Convencion de zona horaria
// ---------------------------------------------------------------------------
// Para mantener consistencia y determinismo con el resto del proyecto (que
// persiste `DateTime` sin offset local), TODO el calculo de disponibilidad se
// hace en UTC:
//   - `dateISO` (YYYY-MM-DD) se interpreta como un dia en UTC.
//   - El dia de la semana se obtiene con `Date.getUTCDay()`
//     (0 = domingo, 1 = lunes, ... 6 = sabado), coincidiendo con la convencion
//     de `ScheduleDay.day_of_week` usada en el resto del sistema.
//   - `open_time`/`close_time` ("HH:MM") se aplican como hora UTC sobre esa
//     fecha (p.ej. date=2025-01-06, open=09:00 -> 2025-01-06T09:00:00.000Z).
// Las pruebas reflejan esta convencion usando fechas/horas en UTC.
// ---------------------------------------------------------------------------

/** Convierte "HH:MM" a minutos desde medianoche. */
function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Construye un Date en UTC para la fecha dada (YYYY-MM-DD) y una cantidad de
 * minutos desde la medianoche UTC.
 */
function buildUtcDate(dateISO: string, minutesFromMidnight: number): Date {
  const [year, month, day] = dateISO.split('-').map(Number);
  return new Date(
    Date.UTC(year, month - 1, day, 0, 0, 0, 0) + minutesFromMidnight * 60_000
  );
}

/** Rango [start, end) del dia completo en UTC para la fecha dada. */
function dayBoundsUtc(dateISO: string): { dayStart: Date; dayEnd: Date } {
  const [year, month, day] = dateISO.split('-').map(Number);
  const dayStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const dayEnd = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));
  return { dayStart, dayEnd };
}

/** Devuelve true si [aStart, aEnd) se solapa con [bStart, bEnd). */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Medianoche UTC (00:00:00.000Z) de la fecha YYYY-MM-DD dada. */
function midnightUtc(dateISO: string): Date {
  const [year, month, day] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

/**
 * Horario semanal ya normalizado (mismo shape que devuelven
 * scheduleService.getSchedule / getBranchSchedule).
 */
interface WeeklySchedule {
  days: Array<{
    day_of_week: number;
    open_time: string;
    close_time: string;
    is_active: boolean;
  }>;
}

/**
 * Genera los slots disponibles a partir de un horario semanal, la duracion del
 * servicio, las citas ocupadas del dia y el "ahora". Comparte el algoritmo UTC
 * documentado arriba entre la disponibilidad a nivel tenant y a nivel sucursal.
 */
function generateSlots(
  dateISO: string,
  duration: number,
  schedule: WeeklySchedule,
  busy: Array<{ start: number; end: number }>,
  capacity: number = 1
): AvailabilitySlot[] {
  const { dayStart } = dayBoundsUtc(dateISO);
  const dayOfWeek = dayStart.getUTCDay();

  const ranges = schedule.days.filter(
    (d) => d.day_of_week === dayOfWeek && d.is_active
  );

  if (ranges.length === 0) {
    return []; // dia cerrado
  }

  // El aforo (capacity) es el numero maximo de citas activas solapadas que un
  // horario admite para el servicio. Con capacity=1 basta un solape para
  // bloquear el slot (comportamiento historico). Se normaliza a >= 1.
  const cap = Number.isInteger(capacity) && capacity >= 1 ? capacity : 1;

  const now = Date.now();
  const slots: AvailabilitySlot[] = [];

  for (const range of ranges) {
    const openMin = timeToMinutes(range.open_time);
    const closeMin = timeToMinutes(range.close_time);

    for (let startMin = openMin; startMin + duration <= closeMin; startMin += duration) {
      const startDate = buildUtcDate(dateISO, startMin);
      const endDate = buildUtcDate(dateISO, startMin + duration);
      const startMs = startDate.getTime();
      const endMs = endDate.getTime();

      // Descartar pasado.
      if (startMs <= now) {
        continue;
      }

      // Contar cuantas citas activas del servicio se solapan con el candidato.
      // El slot queda disponible mientras el conteo sea MENOR que la capacidad
      // (Requirement 1.4). Con capacity=1 esto equivale a "un solape lo bloquea".
      let overlapCount = 0;
      for (const b of busy) {
        if (overlaps(startMs, endMs, b.start, b.end)) {
          overlapCount += 1;
          if (overlapCount >= cap) {
            break;
          }
        }
      }

      if (overlapCount >= cap) {
        continue;
      }

      slots.push({ start: startDate.toISOString(), end: endDate.toISOString() });
    }
  }

  slots.sort((a, b) => a.start.localeCompare(b.start));

  return slots;
}

export const availabilityService = {
  /**
   * Calcula los slots publicos disponibles de un tenant para un servicio
   * (categoria) en una fecha dada.
   *
   * Algoritmo (todo en UTC, ver convencion arriba):
   *  1. Carga el servicio scoped por tenant e is_active. Si no existe -> 404 SERVICE_NOT_FOUND.
   *  2. Determina el dia de la semana con getUTCDay().
   *  3. Obtiene el horario del tenant; toma los `days` activos con ese day_of_week.
   *     Si no hay -> devuelve [] (dia cerrado).
   *  4. Por cada rango [open, close] genera candidatos start = open, open+D, ...
   *     mientras start + D <= close (paso = duracion D).
   *  5. Excluye candidatos que se solapen con citas no CANCELLED del dia.
   *  6. Excluye candidatos en el pasado (start <= ahora).
   *  7. Devuelve la lista ordenada por hora de inicio.
   *
   * @param tenantId  Tenant duenio de la agenda.
   * @param serviceId Servicio/categoria elegido.
   * @param dateISO   Fecha en formato YYYY-MM-DD (interpretada en UTC).
   */
  async getPublicAvailability(
    tenantId: string,
    serviceId: string,
    dateISO: string
  ): Promise<AvailabilitySlot[]> {
    if (typeof dateISO !== 'string' || !DATE_PATTERN.test(dateISO)) {
      throw new HttpError('date debe tener formato YYYY-MM-DD', 400, 'INVALID_DATE');
    }

    // 1. Servicio scoped por tenant + activo.
    const service = await prisma.service.findFirst({
      where: { id: serviceId, tenant_id: tenantId, is_active: true },
    });

    if (!service) {
      throw new HttpError('Servicio no encontrado', 404, 'SERVICE_NOT_FOUND');
    }

    const duration = service.duration_mins;
    if (!duration || duration <= 0) {
      // Sin duracion valida no es posible generar slots.
      return [];
    }

    // 2/3. Horario del tenant.
    const schedule = await scheduleService.getSchedule(tenantId);

    // 5 (datos). Citas no canceladas del tenant PARA ESTE SERVICIO en el dia.
    // El aforo es por servicio, por lo que solo se cuentan solapes de citas del
    // mismo service_id (Requirement 1.6).
    const { dayStart, dayEnd } = dayBoundsUtc(dateISO);
    const appointments = await prisma.appointment.findMany({
      where: {
        tenant_id: tenantId,
        service_id: serviceId,
        status: { not: AppointmentStatus.CANCELLED },
        start_time: { gte: dayStart, lt: dayEnd },
      },
      select: { start_time: true, end_time: true },
    });

    const busy = appointments.map((a) => ({
      start: new Date(a.start_time).getTime(),
      end: new Date(a.end_time).getTime(),
    }));

    // 4-7. Generar/filtrar/ordenar slots (algoritmo UTC compartido).
    // Un slot es disponible mientras las citas solapadas del servicio < capacity.
    return generateSlots(dateISO, duration, schedule, busy, service.capacity);
  },

  /**
   * Calcula los slots publicos disponibles de una SUCURSAL (branch) para un
   * servicio/categoria en una fecha dada. Mismo algoritmo UTC que
   * `getPublicAvailability`, pero:
   *
   *  1. Carga la Branch (findUnique). Si no existe o su status != 'active'
   *     -> 404 BRANCH_NOT_FOUND.
   *  2. Carga el servicio scoped por `branch_id` + is_active
   *     -> 404 SERVICE_NOT_FOUND si no existe. Duracion D.
   *  3. Usa el horario de la SUCURSAL (scheduleService.getBranchSchedule).
   *  4. Excluye DIAS DE ASUETO: si existe un Holiday de la sucursal en la fecha
   *     (medianoche UTC) -> devuelve [] (sin slots).
   *  5. Genera slots (paso = D dentro de [open, close]), excluye citas no
   *     CANCELLED de ESA sucursal (tenant_id + branch_id) y descarta el pasado.
   *
   * @param branchId  Sucursal donde se calcula la disponibilidad.
   * @param serviceId Servicio/categoria elegido (debe pertenecer a la sucursal).
   * @param dateISO   Fecha en formato YYYY-MM-DD (interpretada en UTC).
   */
  async getBranchAvailability(
    branchId: string,
    serviceId: string,
    dateISO: string
  ): Promise<AvailabilitySlot[]> {
    if (typeof dateISO !== 'string' || !DATE_PATTERN.test(dateISO)) {
      throw new HttpError('date debe tener formato YYYY-MM-DD', 400, 'INVALID_DATE');
    }

    // 1. Branch activa.
    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch || branch.status !== 'active') {
      throw new HttpError('Sucursal no encontrada', 404, 'BRANCH_NOT_FOUND');
    }

    // Horizonte de agendado del tenant (booking_horizon_days). Si el horizonte
    // es > 0 y la fecha pedida (medianoche UTC) esta MAS ALLA de (hoy +
    // horizonte dias), el cliente no puede agendar tan lejos -> sin slots.
    // Un horizonte <= 0 (o null/invalido) significa "sin limite". El dia de hoy
    // y las fechas dentro del horizonte funcionan normal.
    const tenantHorizon = await prisma.tenant.findUnique({
      where: { id: branch.tenant_id },
      select: { booking_horizon_days: true },
    });
    const horizonDays =
      tenantHorizon && typeof tenantHorizon.booking_horizon_days === 'number'
        ? tenantHorizon.booking_horizon_days
        : 30;
    if (horizonDays > 0) {
      const requested = midnightUtc(dateISO).getTime();
      const now = new Date(Date.now());
      const todayMidnightUtc = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        0,
        0,
        0,
        0
      );
      const maxDate = todayMidnightUtc + horizonDays * 24 * 60 * 60 * 1000;
      if (requested > maxDate) {
        return [];
      }
    }

    // 2. Servicio scoped por branch + activo.
    const service = await prisma.service.findFirst({
      where: { id: serviceId, branch_id: branchId, is_active: true },
    });

    if (!service) {
      throw new HttpError('Servicio no encontrado', 404, 'SERVICE_NOT_FOUND');
    }

    const duration = service.duration_mins;
    if (!duration || duration <= 0) {
      return [];
    }

    // 4. Dia de asueto -> sin disponibilidad.
    const holiday = await prisma.holiday.findFirst({
      where: { branch_id: branchId, date: midnightUtc(dateISO) },
    });
    if (holiday) {
      return [];
    }

    // 3. Horario de la sucursal.
    const schedule = await scheduleService.getBranchSchedule(branch.tenant_id, branchId);

    // 5 (datos). Citas no canceladas de la sucursal PARA ESTE SERVICIO en el dia.
    // El aforo es por servicio; solo se cuentan solapes del mismo service_id
    // dentro de la misma sucursal (Requirement 1.6).
    const { dayStart, dayEnd } = dayBoundsUtc(dateISO);
    const appointments = await prisma.appointment.findMany({
      where: {
        tenant_id: branch.tenant_id,
        branch_id: branchId,
        service_id: serviceId,
        status: { not: AppointmentStatus.CANCELLED },
        start_time: { gte: dayStart, lt: dayEnd },
      },
      select: { start_time: true, end_time: true },
    });

    const busy = appointments.map((a) => ({
      start: new Date(a.start_time).getTime(),
      end: new Date(a.end_time).getTime(),
    }));

    // Generar/filtrar/ordenar slots (algoritmo UTC compartido).
    // Un slot es disponible mientras las citas solapadas del servicio < capacity.
    return generateSlots(dateISO, duration, schedule, busy, service.capacity);
  },
};
