import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { AppointmentStatus } from '@prisma/client';

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------
const mockPrisma = {
  branch: { findUnique: jest.fn() },
  service: { findFirst: jest.fn() },
  holiday: { findFirst: jest.fn() },
  appointment: { findMany: jest.fn() },
  // getBranchAvailability lee el horizonte de agendado del tenant. Por defecto
  // devolvemos un horizonte amplio (365) para no afectar estas pruebas de
  // Property 3, que usan fechas cercanas a NOW_PAST.
  tenant: { findUnique: jest.fn() },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// ---------------------------------------------------------------------------
// scheduleService mock (module '../schedule.service')
// ---------------------------------------------------------------------------
const mockGetBranchSchedule = jest.fn();
jest.mock('../schedule.service', () => ({
  scheduleService: {
    getBranchSchedule: (...args: any[]) => mockGetBranchSchedule(...args),
  },
}));

import { availabilityService } from '../availability.service';

// Helpers ------------------------------------------------------------------

/** Convencion UTC: date=YYYY-MM-DD, "HH:MM" aplicado como hora UTC. */
function utc(dateISO: string, time: string): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, h, min, 0, 0);
}

function timeToMinutes(iso: string): number {
  const dt = new Date(iso);
  return dt.getUTCHours() * 60 + dt.getUTCMinutes();
}

// 2025-01-06 es un LUNES (day_of_week = 1) en UTC.
const MONDAY = '2025-01-06';
// 2025-01-05 es un DOMINGO (day_of_week = 0) en UTC.
const SUNDAY = '2025-01-05';

const NOW_PAST = Date.UTC(2020, 0, 1, 0, 0, 0, 0);

const BRANCH = { id: 'branch-1', tenant_id: 'tenant-a', status: 'active' };

describe('availabilityService.getBranchAvailability (unit) - Property 3', () => {
  let nowSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    jest.clearAllMocks();
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW_PAST);
    mockPrisma.branch.findUnique.mockResolvedValue(BRANCH as any);
    // Por defecto la fecha NO es asueto.
    mockPrisma.holiday.findFirst.mockResolvedValue(null as any);
    // Horizonte sin limite (<=0) por defecto: estas pruebas usan un "ahora"
    // fijo en 2020 con fechas de 2025, muy fuera de cualquier horizonte finito.
    mockPrisma.tenant.findUnique.mockResolvedValue({ booking_horizon_days: 0 } as any);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  function mockService(duration: number) {
    mockPrisma.service.findFirst.mockResolvedValue({
      id: 'svc-1',
      branch_id: BRANCH.id,
      is_active: true,
      duration_mins: duration,
    } as any);
  }

  it('slots dentro del horario de la sucursal, longitud = D y excluye ocupados', async () => {
    const D = 30;
    mockService(D);
    mockGetBranchSchedule.mockResolvedValue({
      id: 's1',
      timezone: 'UTC',
      days: [
        { day_of_week: 1, open_time: '09:00', close_time: '11:00', is_active: true },
      ],
    });
    // Cita CONFIRMED 09:30-10:00 -> excluye slot 09:30.
    mockPrisma.appointment.findMany.mockResolvedValue([
      {
        start_time: new Date(utc(MONDAY, '09:30')),
        end_time: new Date(utc(MONDAY, '10:00')),
        status: AppointmentStatus.CONFIRMED,
      },
    ] as any);

    const slots = await availabilityService.getBranchAvailability(
      BRANCH.id,
      'svc-1',
      MONDAY
    );

    const openMin = 9 * 60;
    const closeMin = 11 * 60;
    for (const slot of slots) {
      const startMin = timeToMinutes(slot.start);
      const endMin = timeToMinutes(slot.end);
      expect(endMin - startMin).toBe(D);
      expect(startMin).toBeGreaterThanOrEqual(openMin);
      expect(endMin).toBeLessThanOrEqual(closeMin);
    }

    expect(slots.map((s) => s.start)).toEqual([
      new Date(utc(MONDAY, '09:00')).toISOString(),
      new Date(utc(MONDAY, '10:00')).toISOString(),
      new Date(utc(MONDAY, '10:30')).toISOString(),
    ]);

    // Se usa el horario de la sucursal (tenant de la branch + branchId).
    expect(mockGetBranchSchedule).toHaveBeenCalledWith(BRANCH.tenant_id, BRANCH.id);
    // Las citas consultadas estan scoped por tenant + branch.
    const findManyArgs = (mockPrisma.appointment.findMany.mock.calls[0] as any[])[0];
    expect(findManyArgs.where.tenant_id).toBe(BRANCH.tenant_id);
    expect(findManyArgs.where.branch_id).toBe(BRANCH.id);
  });

  it('no ofrece slots en el pasado', async () => {
    const D = 60;
    mockService(D);
    mockGetBranchSchedule.mockResolvedValue({
      id: 's1',
      timezone: 'UTC',
      days: [
        { day_of_week: 1, open_time: '09:00', close_time: '13:00', is_active: true },
      ],
    });
    mockPrisma.appointment.findMany.mockResolvedValue([] as any);

    nowSpy.mockReturnValue(utc(MONDAY, '10:30'));

    const slots = await availabilityService.getBranchAvailability(
      BRANCH.id,
      'svc-1',
      MONDAY
    );

    for (const slot of slots) {
      expect(new Date(slot.start).getTime()).toBeGreaterThan(utc(MONDAY, '10:30'));
    }
    expect(slots.map((s) => s.start)).toEqual([
      new Date(utc(MONDAY, '11:00')).toISOString(),
      new Date(utc(MONDAY, '12:00')).toISOString(),
    ]);
  });

  it('dia de asueto (holiday.findFirst devuelve holiday) -> [] sin slots', async () => {
    mockService(30);
    mockGetBranchSchedule.mockResolvedValue({
      id: 's1',
      timezone: 'UTC',
      days: [
        { day_of_week: 1, open_time: '09:00', close_time: '17:00', is_active: true },
      ],
    });
    mockPrisma.appointment.findMany.mockResolvedValue([] as any);
    // La fecha ES asueto.
    mockPrisma.holiday.findFirst.mockResolvedValue({
      id: 'hol-1',
      branch_id: BRANCH.id,
      date: new Date(utc(MONDAY, '00:00')),
    } as any);

    const slots = await availabilityService.getBranchAvailability(
      BRANCH.id,
      'svc-1',
      MONDAY
    );

    expect(slots).toEqual([]);
    // El asueto se consulta a medianoche UTC de la fecha.
    const holidayArgs = (mockPrisma.holiday.findFirst.mock.calls[0] as any[])[0];
    expect(holidayArgs.where.branch_id).toBe(BRANCH.id);
    expect((holidayArgs.where.date as Date).toISOString()).toBe(
      new Date(utc(MONDAY, '00:00')).toISOString()
    );
  });

  it('dia sin horario para ese day_of_week -> []', async () => {
    mockService(30);
    mockGetBranchSchedule.mockResolvedValue({
      id: 's1',
      timezone: 'UTC',
      days: [
        { day_of_week: 1, open_time: '09:00', close_time: '17:00', is_active: true },
      ],
    });
    mockPrisma.appointment.findMany.mockResolvedValue([] as any);

    // Pedimos domingo (day_of_week 0), el horario solo define lunes.
    const slots = await availabilityService.getBranchAvailability(
      BRANCH.id,
      'svc-1',
      SUNDAY
    );

    expect(slots).toEqual([]);
  });

  it('branch inexistente -> 404 BRANCH_NOT_FOUND', async () => {
    mockPrisma.branch.findUnique.mockResolvedValue(null as any);

    await expect(
      availabilityService.getBranchAvailability('nope', 'svc-1', MONDAY)
    ).rejects.toMatchObject({ statusCode: 404, code: 'BRANCH_NOT_FOUND' });
  });

  it('branch inactiva -> 404 BRANCH_NOT_FOUND', async () => {
    mockPrisma.branch.findUnique.mockResolvedValue({
      ...BRANCH,
      status: 'inactive',
    } as any);

    await expect(
      availabilityService.getBranchAvailability(BRANCH.id, 'svc-1', MONDAY)
    ).rejects.toMatchObject({ statusCode: 404, code: 'BRANCH_NOT_FOUND' });
  });

  it('servicio inexistente/inactivo en la sucursal -> 404 SERVICE_NOT_FOUND', async () => {
    mockPrisma.service.findFirst.mockResolvedValue(null as any);

    await expect(
      availabilityService.getBranchAvailability(BRANCH.id, 'nope', MONDAY)
    ).rejects.toMatchObject({ statusCode: 404, code: 'SERVICE_NOT_FOUND' });
  });
});
