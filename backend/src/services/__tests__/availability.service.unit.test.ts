import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { AppointmentStatus } from '@prisma/client';
import { HttpError } from '../../utils/errors';

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------
const mockPrisma = {
  service: { findFirst: jest.fn(), findMany: jest.fn() },
  appointment: { findMany: jest.fn() },
  tenant: { findUnique: jest.fn() },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// ---------------------------------------------------------------------------
// scheduleService mock (module '../schedule.service')
// ---------------------------------------------------------------------------
const mockGetSchedule = jest.fn();
jest.mock('../schedule.service', () => ({
  scheduleService: {
    getSchedule: (...args: any[]) => mockGetSchedule(...args),
  },
}));

import { availabilityService } from '../availability.service';
import { publicService } from '../public.service';

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

// Un "ahora" fijo muy en el pasado para que los slots del 2025 sean futuros.
const NOW_PAST = Date.UTC(2020, 0, 1, 0, 0, 0, 0);

describe('availabilityService.getPublicAvailability (unit)', () => {
  let nowSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    jest.clearAllMocks();
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW_PAST);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  function mockService(duration: number) {
    mockPrisma.service.findFirst.mockResolvedValue({
      id: 'svc-1',
      tenant_id: 'tenant-a',
      is_active: true,
      duration_mins: duration,
    } as any);
  }

  it('Property 5: slots dentro del horario, longitud = D y excluye citas no canceladas', async () => {
    const D = 30;
    mockService(D);
    // Horario lunes 09:00 - 11:00 (UTC). Rango de 120 min => 4 slots de 30.
    mockGetSchedule.mockResolvedValue({
      id: 's1',
      timezone: 'UTC',
      days: [
        { day_of_week: 1, open_time: '09:00', close_time: '11:00', is_active: true },
      ],
    });
    // Cita existente CONFIRMED de 09:30 a 10:00 -> debe excluir el slot 09:30.
    mockPrisma.appointment.findMany.mockResolvedValue([
      {
        start_time: new Date(utc(MONDAY, '09:30')),
        end_time: new Date(utc(MONDAY, '10:00')),
        status: AppointmentStatus.CONFIRMED,
      },
    ] as any);

    const slots = await availabilityService.getPublicAvailability(
      'tenant-a',
      'svc-1',
      MONDAY
    );

    const openMin = 9 * 60;
    const closeMin = 11 * 60;

    // Cada slot dura exactamente D y esta dentro del rango.
    for (const slot of slots) {
      const startMin = timeToMinutes(slot.start);
      const endMin = timeToMinutes(slot.end);
      expect(endMin - startMin).toBe(D);
      expect(startMin).toBeGreaterThanOrEqual(openMin);
      expect(endMin).toBeLessThanOrEqual(closeMin);
    }

    // El slot 09:30 (solapa con la cita) esta excluido.
    const starts = slots.map((s) => s.start);
    expect(starts).not.toContain(new Date(utc(MONDAY, '09:30')).toISOString());
    // Slots esperados: 09:00, 10:00, 10:30 (09:30 excluido).
    expect(starts).toEqual([
      new Date(utc(MONDAY, '09:00')).toISOString(),
      new Date(utc(MONDAY, '10:00')).toISOString(),
      new Date(utc(MONDAY, '10:30')).toISOString(),
    ]);
  });

  it('Property 5: ninguna cita no cancelada se solapa con los slots ofrecidos', async () => {
    const D = 60;
    mockService(D);
    mockGetSchedule.mockResolvedValue({
      id: 's1',
      timezone: 'UTC',
      days: [
        { day_of_week: 1, open_time: '08:00', close_time: '12:00', is_active: true },
      ],
    });
    const busy = [
      {
        start_time: new Date(utc(MONDAY, '09:00')),
        end_time: new Date(utc(MONDAY, '10:00')),
        status: AppointmentStatus.PENDING,
      },
      {
        start_time: new Date(utc(MONDAY, '11:00')),
        end_time: new Date(utc(MONDAY, '12:00')),
        status: AppointmentStatus.COMPLETED,
      },
    ];
    mockPrisma.appointment.findMany.mockResolvedValue(busy as any);

    const slots = await availabilityService.getPublicAvailability(
      'tenant-a',
      'svc-1',
      MONDAY
    );

    for (const slot of slots) {
      const s = new Date(slot.start).getTime();
      const e = new Date(slot.end).getTime();
      for (const b of busy) {
        const bs = b.start_time.getTime();
        const be = b.end_time.getTime();
        // No overlap: !(s < be && bs < e)
        expect(s < be && bs < e).toBe(false);
      }
    }
    // Solo 08:00 y 10:00 quedan libres.
    expect(slots.map((s) => s.start)).toEqual([
      new Date(utc(MONDAY, '08:00')).toISOString(),
      new Date(utc(MONDAY, '10:00')).toISOString(),
    ]);
  });

  it('Property 5: no ofrece slots en el pasado', async () => {
    const D = 60;
    mockService(D);
    mockGetSchedule.mockResolvedValue({
      id: 's1',
      timezone: 'UTC',
      days: [
        { day_of_week: 1, open_time: '09:00', close_time: '13:00', is_active: true },
      ],
    });
    mockPrisma.appointment.findMany.mockResolvedValue([] as any);

    // "ahora" = 2025-01-06 10:30 UTC -> slots 09:00 y 10:00 quedan en el pasado.
    nowSpy.mockReturnValue(utc(MONDAY, '10:30'));

    const slots = await availabilityService.getPublicAvailability(
      'tenant-a',
      'svc-1',
      MONDAY
    );

    for (const slot of slots) {
      expect(new Date(slot.start).getTime()).toBeGreaterThan(utc(MONDAY, '10:30'));
    }
    // Solo 11:00 y 12:00 (13:00 no cabe porque 12:00+60 = 13:00 <= close, si cabe).
    expect(slots.map((s) => s.start)).toEqual([
      new Date(utc(MONDAY, '11:00')).toISOString(),
      new Date(utc(MONDAY, '12:00')).toISOString(),
    ]);
  });

  it('dia cerrado (sin days para ese day_of_week) -> []', async () => {
    mockService(30);
    // El horario define lunes, pero pedimos domingo (day_of_week 0).
    mockGetSchedule.mockResolvedValue({
      id: 's1',
      timezone: 'UTC',
      days: [
        { day_of_week: 1, open_time: '09:00', close_time: '17:00', is_active: true },
      ],
    });
    mockPrisma.appointment.findMany.mockResolvedValue([] as any);

    const slots = await availabilityService.getPublicAvailability(
      'tenant-a',
      'svc-1',
      SUNDAY
    );

    expect(slots).toEqual([]);
  });

  it('dia con rango inactivo (is_active false) -> []', async () => {
    mockService(30);
    mockGetSchedule.mockResolvedValue({
      id: 's1',
      timezone: 'UTC',
      days: [
        { day_of_week: 1, open_time: '09:00', close_time: '17:00', is_active: false },
      ],
    });
    mockPrisma.appointment.findMany.mockResolvedValue([] as any);

    const slots = await availabilityService.getPublicAvailability(
      'tenant-a',
      'svc-1',
      MONDAY
    );

    expect(slots).toEqual([]);
  });

  it('servicio inexistente/inactivo -> HttpError 404 SERVICE_NOT_FOUND', async () => {
    mockPrisma.service.findFirst.mockResolvedValue(null as any);

    await expect(
      availabilityService.getPublicAvailability('tenant-a', 'nope', MONDAY)
    ).rejects.toMatchObject({ statusCode: 404, code: 'SERVICE_NOT_FOUND' });
  });
});

describe('publicService.resolveTenantByCode (unit) - Property 4', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('codigo valido -> devuelve el tenant', async () => {
    const tenant = {
      id: 'tenant-a',
      name: 'Barberia',
      booking_code: 'AB3K9P',
      booking_enabled: true,
    };
    mockPrisma.tenant.findUnique.mockResolvedValue(tenant as any);

    const result = await publicService.resolveTenantByCode('ab3k9p'); // case-insensitive

    expect(result).toBe(tenant);
    expect(mockPrisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { booking_code: 'AB3K9P' },
    });
  });

  it('codigo inexistente -> HttpError 404 INVALID_CODE', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null as any);

    await expect(publicService.resolveTenantByCode('ZZZZZZ')).rejects.toMatchObject({
      statusCode: 404,
      code: 'INVALID_CODE',
    });
  });

  it('negocio deshabilitado (booking_enabled false) -> HttpError 404 INVALID_CODE', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-a',
      name: 'Cerrado',
      booking_code: 'AB3K9P',
      booking_enabled: false,
    } as any);

    await expect(publicService.resolveTenantByCode('AB3K9P')).rejects.toMatchObject({
      statusCode: 404,
      code: 'INVALID_CODE',
    });
  });

  it('codigo vacio -> HttpError 404 INVALID_CODE (no consulta prisma)', async () => {
    await expect(publicService.resolveTenantByCode('   ')).rejects.toBeInstanceOf(HttpError);
    expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();
  });
});
