import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { AppointmentStatus } from '@prisma/client';

// ---------------------------------------------------------------------------
// Prisma mock (shared by bookingSettings + availability tests)
// ---------------------------------------------------------------------------
const mockPrisma = {
  tenant: { findUnique: jest.fn(), update: jest.fn() },
  branch: { findUnique: jest.fn() },
  service: { findFirst: jest.fn() },
  holiday: { findFirst: jest.fn() },
  appointment: { findMany: jest.fn() },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

const mockGetBranchSchedule = jest.fn();
jest.mock('../schedule.service', () => ({
  scheduleService: {
    getBranchSchedule: (...args: any[]) => mockGetBranchSchedule(...args),
  },
}));

import { bookingSettingsService } from '../bookingSettings.service';
import { availabilityService } from '../availability.service';

function utc(dateISO: string, time: string): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, h, min, 0, 0);
}

// ---------------------------------------------------------------------------
// bookingSettingsService.updateHorizon — validacion
// ---------------------------------------------------------------------------
describe('bookingSettingsService.updateHorizon', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 't1' } as any);
    mockPrisma.tenant.update.mockResolvedValue({ booking_horizon_days: 15 } as any);
  });

  it('valor negativo -> 400 VALIDATION_ERROR sin persistir', async () => {
    await expect(
      bookingSettingsService.updateHorizon('t1', -1)
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
  });

  it('no numerico -> 400 VALIDATION_ERROR sin persistir', async () => {
    await expect(
      bookingSettingsService.updateHorizon('t1', 'abc' as any)
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
  });

  it('no entero -> 400 VALIDATION_ERROR sin persistir', async () => {
    await expect(
      bookingSettingsService.updateHorizon('t1', 3.5)
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
  });

  it('entero >= 0 persiste y devuelve el valor', async () => {
    mockPrisma.tenant.update.mockResolvedValue({ booking_horizon_days: 0 } as any);
    const result = await bookingSettingsService.updateHorizon('t1', 0);
    expect(result).toEqual({ booking_horizon_days: 0 });
    expect(mockPrisma.tenant.update).toHaveBeenCalled();
  });
});

describe('bookingSettingsService.getHorizon', () => {
  beforeEach(() => jest.clearAllMocks());

  it('devuelve el valor persistido', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ booking_horizon_days: 45 } as any);
    expect(await bookingSettingsService.getHorizon('t1')).toBe(45);
  });

  it('tenant inexistente -> 404 TENANT_NOT_FOUND', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null as any);
    await expect(bookingSettingsService.getHorizon('nope')).rejects.toMatchObject({
      statusCode: 404,
      code: 'TENANT_NOT_FOUND',
    });
  });
});

// ---------------------------------------------------------------------------
// getBranchAvailability — respeta el horizonte de agendado del tenant
// ---------------------------------------------------------------------------
describe('getBranchAvailability booking horizon', () => {
  let nowSpy: ReturnType<typeof jest.spyOn>;
  // "hoy" = 2025-01-06 (lunes). Con horizonte 7 dias, la fecha maxima es
  // 2025-01-13.
  const TODAY = Date.UTC(2025, 0, 6, 8, 0, 0, 0);
  const BRANCH = { id: 'branch-1', tenant_id: 'tenant-a', status: 'active' };

  beforeEach(() => {
    jest.clearAllMocks();
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(TODAY);
    mockPrisma.branch.findUnique.mockResolvedValue(BRANCH as any);
    mockPrisma.holiday.findFirst.mockResolvedValue(null as any);
    mockPrisma.appointment.findMany.mockResolvedValue([] as any);
    mockPrisma.service.findFirst.mockResolvedValue({
      id: 'svc-1',
      branch_id: BRANCH.id,
      is_active: true,
      duration_mins: 60,
    } as any);
    // Horario: lunes 09:00-13:00 (los dias pedidos caen en lunes/martes).
    mockGetBranchSchedule.mockResolvedValue({
      id: 's1',
      timezone: 'UTC',
      days: [
        { day_of_week: 1, open_time: '09:00', close_time: '13:00', is_active: true },
        { day_of_week: 6, open_time: '09:00', close_time: '13:00', is_active: true },
      ],
    });
  });

  afterEach(() => nowSpy.mockRestore());

  it('fecha MAS ALLA del horizonte -> [] (sin slots)', async () => {
    // horizonte 7 dias -> max 2025-01-13. Pedimos 2025-01-18 (mas alla).
    mockPrisma.tenant.findUnique.mockResolvedValue({ booking_horizon_days: 7 } as any);

    const slots = await availabilityService.getBranchAvailability(
      BRANCH.id,
      'svc-1',
      '2025-01-18'
    );
    expect(slots).toEqual([]);
    // No llega a consultar el horario/citas: se corta antes.
    expect(mockGetBranchSchedule).not.toHaveBeenCalled();
  });

  it('fecha DENTRO del horizonte -> slots normales', async () => {
    // horizonte 7 dias. Pedimos 2025-01-11 (sabado, dentro del horizonte).
    mockPrisma.tenant.findUnique.mockResolvedValue({ booking_horizon_days: 7 } as any);

    const slots = await availabilityService.getBranchAvailability(
      BRANCH.id,
      'svc-1',
      '2025-01-11'
    );
    expect(slots.length).toBeGreaterThan(0);
    // Todos los slots del sabado 2025-01-11.
    expect(slots.map((s) => s.start)).toEqual([
      new Date(utc('2025-01-11', '09:00')).toISOString(),
      new Date(utc('2025-01-11', '10:00')).toISOString(),
      new Date(utc('2025-01-11', '11:00')).toISOString(),
      new Date(utc('2025-01-11', '12:00')).toISOString(),
    ]);
  });

  it('horizonte <= 0 -> sin limite (fecha lejana devuelve slots)', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ booking_horizon_days: 0 } as any);

    const slots = await availabilityService.getBranchAvailability(
      BRANCH.id,
      'svc-1',
      '2025-01-11'
    );
    expect(slots.length).toBeGreaterThan(0);
  });
});
