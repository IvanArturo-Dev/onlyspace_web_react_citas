import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { AppointmentStatus } from '@prisma/client';

// ---------------------------------------------------------------------------
// Pruebas de aforo por servicio (Task 2.1).
//   - Property 1 (aforo): reserva -> permite hasta N solapes y rechaza el N+1.
//   - Property 2 (disponibilidad): un slot es visible mientras los solapes del
//     servicio < capacity, y desaparece al alcanzar capacity.
//   - Aislamiento: los solapes solo se cuentan dentro del mismo
//     tenant/branch/service.
//
// Con capacity=1 el comportamiento es identico al historico (un solo solape
// bloquea) — cubierto explicitamente para verificar que no hay regresion.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Prisma mock. `service.findFirst` para cargar el servicio (con capacity),
// `appointment.findMany` para los solapes, y un `$transaction` que ejecuta el
// callback con un `tx` que reusa el mismo mock de prisma.
// ---------------------------------------------------------------------------
const mockPrisma = {
  service: { findFirst: jest.fn() },
  branch: { findUnique: jest.fn() },
  holiday: { findFirst: jest.fn() },
  customer: { findFirst: jest.fn(), create: jest.fn() },
  appointment: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
  // getBranchAvailability lee el horizonte del tenant (booking_horizon_days).
  tenant: { findUnique: jest.fn() },
  $transaction: jest.fn(async (cb: any) => cb(mockTx)),
};

const mockTx = {
  appointment: { findMany: jest.fn(), create: jest.fn(), count: jest.fn() },
  customer: { findFirst: jest.fn(), create: jest.fn() },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// scheduleService mock (para availability).
const mockGetSchedule = jest.fn();
const mockGetBranchSchedule = jest.fn();
jest.mock('../schedule.service', () => ({
  scheduleService: {
    getSchedule: (...args: any[]) => mockGetSchedule(...args),
    getBranchSchedule: (...args: any[]) => mockGetBranchSchedule(...args),
  },
}));

// publicService mock (para booking publico).
const TENANT = { id: 'tenant-a', name: 'Negocio A', booking_enabled: true } as any;
const mockResolveTenantByCode = jest.fn(async (_code: string) => TENANT);
jest.mock('../public.service', () => ({
  publicService: {
    resolveTenantByCode: (code: string) => mockResolveTenantByCode(code),
  },
}));

// audit no-op.
jest.mock('../../utils/audit', () => ({
  writeAudit: jest.fn(async () => undefined),
}));

// hook de Google no-op (best-effort).
jest.mock('../google-appointment-hook', () => ({
  runGoogleAppointmentHook: jest.fn(async () => undefined),
}));

import { availabilityService } from '../availability.service';
import { bookingService } from '../booking.service';

// Helpers ------------------------------------------------------------------

/** date=YYYY-MM-DD, "HH:MM" aplicado como hora UTC. */
function utc(dateISO: string, time: string): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, h, min, 0, 0);
}

// 2025-01-06 es LUNES (day_of_week = 1) en UTC.
const MONDAY = '2025-01-06';
const NOW_PAST = Date.UTC(2020, 0, 1, 0, 0, 0, 0);

const USER = { id: 'user-1', email: 'cliente@example.com', name: 'Cliente Uno' };

function futureISO(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

// =========================================================================
// Property 2: disponibilidad refleja el aforo del servicio
// =========================================================================
describe('availabilityService — Property 2: disponibilidad refleja la capacidad', () => {
  let nowSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    jest.clearAllMocks();
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW_PAST);
    mockGetSchedule.mockResolvedValue({
      id: 's1',
      timezone: 'UTC',
      days: [{ day_of_week: 1, open_time: '09:00', close_time: '10:00', is_active: true }],
    });
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  function mockService(capacity: number, duration = 60) {
    mockPrisma.service.findFirst.mockResolvedValue({
      id: 'svc-1',
      tenant_id: TENANT.id,
      is_active: true,
      duration_mins: duration,
      capacity,
    } as any);
  }

  it('capacity=1: un solo solape oculta el slot (identico al comportamiento historico)', async () => {
    mockService(1);
    mockPrisma.appointment.findMany.mockResolvedValue([
      { start_time: new Date(utc(MONDAY, '09:00')), end_time: new Date(utc(MONDAY, '10:00')) },
    ] as any);

    const slots = await availabilityService.getPublicAvailability(TENANT.id, 'svc-1', MONDAY);

    // El unico slot 09:00 esta ocupado -> sin disponibilidad.
    expect(slots).toEqual([]);
  });

  it('capacity=2: el slot sigue disponible con 1 solape y desaparece con 2', async () => {
    mockService(2);

    // 1 solape < capacity=2 -> disponible.
    mockPrisma.appointment.findMany.mockResolvedValueOnce([
      { start_time: new Date(utc(MONDAY, '09:00')), end_time: new Date(utc(MONDAY, '10:00')) },
    ] as any);
    let slots = await availabilityService.getPublicAvailability(TENANT.id, 'svc-1', MONDAY);
    expect(slots.map((s) => s.start)).toEqual([new Date(utc(MONDAY, '09:00')).toISOString()]);

    // 2 solapes == capacity=2 -> se oculta.
    mockPrisma.appointment.findMany.mockResolvedValueOnce([
      { start_time: new Date(utc(MONDAY, '09:00')), end_time: new Date(utc(MONDAY, '10:00')) },
      { start_time: new Date(utc(MONDAY, '09:00')), end_time: new Date(utc(MONDAY, '10:00')) },
    ] as any);
    slots = await availabilityService.getPublicAvailability(TENANT.id, 'svc-1', MONDAY);
    expect(slots).toEqual([]);
  });

  it('cuenta solapes solo del MISMO servicio (aislamiento por service_id en la query)', async () => {
    mockService(2);
    mockPrisma.appointment.findMany.mockResolvedValue([] as any);

    await availabilityService.getPublicAvailability(TENANT.id, 'svc-1', MONDAY);

    const where = (mockPrisma.appointment.findMany.mock.calls[0] as any[])[0].where;
    expect(where.service_id).toBe('svc-1');
    expect(where.tenant_id).toBe(TENANT.id);
  });

  it('getBranchAvailability tambien aplica la capacidad y filtra por branch+service', async () => {
    mockPrisma.branch.findUnique.mockResolvedValue({
      id: 'branch-1',
      tenant_id: TENANT.id,
      status: 'active',
    } as any);
    mockPrisma.holiday.findFirst.mockResolvedValue(null as any);
    // Horizonte sin limite (<=0) para no afectar esta prueba de aforo, que usa
    // una fecha (MONDAY) potencialmente fuera de un horizonte finito respecto a
    // "ahora".
    mockPrisma.tenant.findUnique.mockResolvedValue({ booking_horizon_days: 0 } as any);
    mockGetBranchSchedule.mockResolvedValue({
      id: 's1',
      timezone: 'UTC',
      days: [{ day_of_week: 1, open_time: '09:00', close_time: '10:00', is_active: true }],
    });
    mockPrisma.service.findFirst.mockResolvedValue({
      id: 'svc-1',
      branch_id: 'branch-1',
      is_active: true,
      duration_mins: 60,
      capacity: 2,
    } as any);
    // 1 solape < 2 -> disponible.
    mockPrisma.appointment.findMany.mockResolvedValue([
      { start_time: new Date(utc(MONDAY, '09:00')), end_time: new Date(utc(MONDAY, '10:00')) },
    ] as any);

    const slots = await availabilityService.getBranchAvailability('branch-1', 'svc-1', MONDAY);
    expect(slots.map((s) => s.start)).toEqual([new Date(utc(MONDAY, '09:00')).toISOString()]);

    const where = (mockPrisma.appointment.findMany.mock.calls[0] as any[])[0].where;
    expect(where.branch_id).toBe('branch-1');
    expect(where.service_id).toBe('svc-1');
  });
});

// =========================================================================
// Property 1: aforo en la reserva (createPublicBooking / createBranchBooking)
// =========================================================================
describe('bookingService — Property 1: aforo respeta la capacidad', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveTenantByCode.mockResolvedValue(TENANT as any);
    mockTx.appointment.count.mockResolvedValue(0 as any);
    mockTx.customer.findFirst.mockResolvedValue(null as any);
    mockTx.customer.create.mockImplementation(async (args: any) => ({ id: 'cust-new', ...args.data }));
    mockTx.appointment.create.mockImplementation(async (args: any) => ({ id: 'appt-new', ...args.data }));
    mockPrisma.branch.findUnique.mockResolvedValue({
      id: 'branch-1',
      tenant_id: TENANT.id,
      status: 'active',
    } as any);
    mockPrisma.holiday.findFirst.mockResolvedValue(null as any);
    mockPrisma.appointment.findUnique.mockResolvedValue({
      id: 'appt-new',
      modality: 'in_person',
      video_call_url: null,
    } as any);
  });

  function serviceWithCapacity(capacity: number) {
    return { id: 'svc-1', tenant_id: TENANT.id, is_active: true, duration_mins: 30, capacity } as any;
  }

  /** Genera `n` citas que solapan [start, start+30min). */
  function overlappingAppointments(startISO: string, n: number) {
    const startMs = new Date(startISO).getTime();
    return Array.from({ length: n }, () => ({
      start_time: new Date(startMs + 10 * 60_000),
      end_time: new Date(startMs + 40 * 60_000),
    }));
  }

  it('capacity=1: un solo solape lanza 409 SLOT_TAKEN (identico al comportamiento historico)', async () => {
    mockPrisma.service.findFirst.mockResolvedValue(serviceWithCapacity(1));
    const start = futureISO();
    mockTx.appointment.findMany.mockResolvedValue(overlappingAppointments(start, 1) as any);

    await expect(
      bookingService.createPublicBooking('abc123', { service_id: 'svc-1', start_time: start, contact_phone: '5551234567' }, USER)
    ).rejects.toMatchObject({ statusCode: 409, code: 'SLOT_TAKEN' });

    expect(mockTx.appointment.create).not.toHaveBeenCalled();
  });

  it('capacity=1: sin solapes crea la cita', async () => {
    mockPrisma.service.findFirst.mockResolvedValue(serviceWithCapacity(1));
    mockTx.appointment.findMany.mockResolvedValue([] as any);

    const result = await bookingService.createPublicBooking(
      'abc123',
      { service_id: 'svc-1', start_time: futureISO(), contact_phone: '5551234567' },
      USER
    );

    expect(mockTx.appointment.create).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(AppointmentStatus.PENDING);
  });

  it('capacity=3: permite reservar mientras solapes < capacity (0,1,2 solapes -> OK)', async () => {
    mockPrisma.service.findFirst.mockResolvedValue(serviceWithCapacity(3));
    const start = futureISO();

    for (const existing of [0, 1, 2]) {
      jest.clearAllMocks();
      mockResolveTenantByCode.mockResolvedValue(TENANT as any);
      mockTx.appointment.count.mockResolvedValue(0 as any);
      mockTx.customer.findFirst.mockResolvedValue(null as any);
      mockTx.customer.create.mockImplementation(async (args: any) => ({ id: 'cust-new', ...args.data }));
      mockTx.appointment.create.mockImplementation(async (args: any) => ({ id: 'appt-new', ...args.data }));
      mockPrisma.service.findFirst.mockResolvedValue(serviceWithCapacity(3));
      mockTx.appointment.findMany.mockResolvedValue(overlappingAppointments(start, existing) as any);

      const result = await bookingService.createPublicBooking(
        'abc123',
        { service_id: 'svc-1', start_time: start, contact_phone: '5551234567' },
        USER
      );
      expect(result.status).toBe(AppointmentStatus.PENDING);
      expect(mockTx.appointment.create).toHaveBeenCalledTimes(1);
    }
  });

  it('capacity=3: el (N+1)=cuarto solape lanza 409 SLOT_TAKEN', async () => {
    mockPrisma.service.findFirst.mockResolvedValue(serviceWithCapacity(3));
    const start = futureISO();
    mockTx.appointment.findMany.mockResolvedValue(overlappingAppointments(start, 3) as any);

    await expect(
      bookingService.createPublicBooking('abc123', { service_id: 'svc-1', start_time: start, contact_phone: '5551234567' }, USER)
    ).rejects.toMatchObject({ statusCode: 409, code: 'SLOT_TAKEN' });

    expect(mockTx.appointment.create).not.toHaveBeenCalled();
  });

  it('el conteo de solapes se scopea por service_id (aislamiento por servicio)', async () => {
    mockPrisma.service.findFirst.mockResolvedValue(serviceWithCapacity(2));
    mockTx.appointment.findMany.mockResolvedValue([] as any);

    await bookingService.createPublicBooking(
      'abc123',
      { service_id: 'svc-1', start_time: futureISO(), contact_phone: '5551234567' },
      USER
    );

    const where = (mockTx.appointment.findMany.mock.calls[0] as any[])[0].where;
    expect(where.service_id).toBe('svc-1');
    expect(where.tenant_id).toBe(TENANT.id);
  });

  it('createBranchBooking: capacity=2 permite el segundo solape y rechaza el tercero (scoped a branch+service)', async () => {
    mockPrisma.service.findFirst.mockResolvedValue({
      id: 'svc-1',
      branch_id: 'branch-1',
      is_active: true,
      duration_mins: 30,
      capacity: 2,
    } as any);
    const start = futureISO();

    // 1 solape < 2 -> OK.
    mockTx.appointment.findMany.mockResolvedValueOnce(overlappingAppointments(start, 1) as any);
    const ok = await bookingService.createBranchBooking(
      'branch-1',
      { service_id: 'svc-1', start_time: start, contact_phone: '5551234567' },
      USER
    );
    expect(ok.status).toBe(AppointmentStatus.PENDING);
    const where = (mockTx.appointment.findMany.mock.calls[0] as any[])[0].where;
    expect(where.branch_id).toBe('branch-1');
    expect(where.service_id).toBe('svc-1');

    // 2 solapes == 2 -> 409.
    mockTx.appointment.findMany.mockResolvedValueOnce(overlappingAppointments(start, 2) as any);
    await expect(
      bookingService.createBranchBooking('branch-1', { service_id: 'svc-1', start_time: start, contact_phone: '5551234567' }, USER)
    ).rejects.toMatchObject({ statusCode: 409, code: 'SLOT_TAKEN' });
  });
});
