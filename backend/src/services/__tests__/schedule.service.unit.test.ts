import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { HttpError } from '../../utils/errors';

/**
 * Unit tests for scheduleService.
 *
 * Property 7 (Aislamiento por tenant): ninguna consulta de un administrador
 *   devuelve u opera sobre horarios de otro tenant. Todas las queries deben
 *   filtrar por tenant_id / schedule_id correctos.
 *
 * Ademas se cubre la validacion de entrada (day_of_week 0-6 y open_time <
 * close_time en formato HH:MM -> HttpError 400).
 *
 * **Validates: Requirements 4.5, 10.1, 10.3**
 */

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------
const mockPrisma = {
  schedule: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  scheduleDay: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

describe('scheduleService (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getSchedule - Property 7: tenant isolation', () => {
    it('queries only the active schedule of the given tenant', async () => {
      mockPrisma.schedule.findFirst.mockResolvedValue({
        id: 'sched-a',
        timezone: 'America/New_York',
        days: [
          { day_of_week: 1, open_time: '09:00', close_time: '17:00', is_active: true },
        ],
      } as any);

      const { scheduleService } = await import('../schedule.service');
      const result = await scheduleService.getSchedule('tenant-a');

      // The lookup is scoped by tenant_id and is_active.
      expect(mockPrisma.schedule.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: 'tenant-a', is_active: true },
        })
      );
      expect(result.id).toBe('sched-a');
      expect(result.days).toHaveLength(1);
      expect(result.days[0].day_of_week).toBe(1);
    });

    it('returns an empty structure (no other tenant days) when the tenant has no schedule', async () => {
      mockPrisma.schedule.findFirst.mockResolvedValue(null as any);

      const { scheduleService } = await import('../schedule.service');
      const result = await scheduleService.getSchedule('tenant-without-schedule');

      expect(mockPrisma.schedule.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: 'tenant-without-schedule', is_active: true },
        })
      );
      expect(result.id).toBeNull();
      expect(result.days).toEqual([]);
    });
  });

  describe('updateSchedule - Property 7: tenant isolation', () => {
    it('creates a Default schedule for the tenant when none exists and replaces its days', async () => {
      mockPrisma.schedule.findFirst
        // first call: no existing schedule
        .mockResolvedValueOnce(null as any)
        // second call (inside getSchedule at the end): the created schedule
        .mockResolvedValueOnce({
          id: 'sched-new',
          timezone: 'America/New_York',
          days: [
            { day_of_week: 1, open_time: '09:00', close_time: '17:00', is_active: true },
          ],
        } as any);
      mockPrisma.schedule.create.mockResolvedValue({ id: 'sched-new' } as any);
      mockPrisma.scheduleDay.deleteMany.mockResolvedValue({ count: 0 } as any);
      mockPrisma.scheduleDay.createMany.mockResolvedValue({ count: 1 } as any);

      const { scheduleService } = await import('../schedule.service');
      await scheduleService.updateSchedule('tenant-a', {
        days: [{ day_of_week: 1, open_time: '09:00', close_time: '17:00' }],
      });

      // Schedule created scoped to the tenant with name Default.
      expect(mockPrisma.schedule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenant_id: 'tenant-a', name: 'Default' }),
        })
      );
      // Days replaced only for the schedule of this tenant.
      expect(mockPrisma.scheduleDay.deleteMany).toHaveBeenCalledWith({
        where: { schedule_id: 'sched-new' },
      });
      expect(mockPrisma.scheduleDay.createMany).toHaveBeenCalledWith({
        data: [
          {
            schedule_id: 'sched-new',
            day_of_week: 1,
            open_time: '09:00',
            close_time: '17:00',
            is_active: true,
          },
        ],
      });
      // Never creates a schedule for another tenant.
      expect(mockPrisma.schedule.create).toHaveBeenCalledTimes(1);
    });

    it('updates the existing schedule of the tenant and replaces its days (scoped by schedule_id)', async () => {
      mockPrisma.schedule.findFirst
        .mockResolvedValueOnce({ id: 'sched-existing' } as any)
        .mockResolvedValueOnce({
          id: 'sched-existing',
          timezone: 'Europe/Madrid',
          days: [],
        } as any);
      mockPrisma.schedule.update.mockResolvedValue({ id: 'sched-existing' } as any);
      mockPrisma.scheduleDay.deleteMany.mockResolvedValue({ count: 2 } as any);
      mockPrisma.scheduleDay.createMany.mockResolvedValue({ count: 1 } as any);

      const { scheduleService } = await import('../schedule.service');
      await scheduleService.updateSchedule('tenant-b', {
        timezone: 'Europe/Madrid',
        days: [{ day_of_week: 3, open_time: '10:00', close_time: '14:00', is_active: false }],
      });

      // No new schedule created; the timezone update is scoped by tenant_id.
      expect(mockPrisma.schedule.create).not.toHaveBeenCalled();
      expect(mockPrisma.schedule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sched-existing', tenant_id: 'tenant-b' },
          data: { timezone: 'Europe/Madrid' },
        })
      );
      // Days replaced only for this tenant's schedule.
      expect(mockPrisma.scheduleDay.deleteMany).toHaveBeenCalledWith({
        where: { schedule_id: 'sched-existing' },
      });
      expect(mockPrisma.scheduleDay.createMany).toHaveBeenCalledWith({
        data: [
          {
            schedule_id: 'sched-existing',
            day_of_week: 3,
            open_time: '10:00',
            close_time: '14:00',
            is_active: false,
          },
        ],
      });
    });

    it('handles an empty days array by clearing days without creating any', async () => {
      mockPrisma.schedule.findFirst
        .mockResolvedValueOnce({ id: 'sched-existing' } as any)
        .mockResolvedValueOnce({ id: 'sched-existing', timezone: 'x', days: [] } as any);
      mockPrisma.scheduleDay.deleteMany.mockResolvedValue({ count: 3 } as any);

      const { scheduleService } = await import('../schedule.service');
      await scheduleService.updateSchedule('tenant-a', { days: [] });

      expect(mockPrisma.scheduleDay.deleteMany).toHaveBeenCalledWith({
        where: { schedule_id: 'sched-existing' },
      });
      expect(mockPrisma.scheduleDay.createMany).not.toHaveBeenCalled();
    });
  });

  describe('updateSchedule - validation (HttpError 400)', () => {
    const expect400 = async (payload: any) => {
      const { scheduleService } = await import('../schedule.service');
      let error: unknown;
      try {
        await scheduleService.updateSchedule('tenant-a', payload);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).statusCode).toBe(400);
      // Validation happens before any persistence.
      expect(mockPrisma.schedule.create).not.toHaveBeenCalled();
      expect(mockPrisma.schedule.update).not.toHaveBeenCalled();
      expect(mockPrisma.scheduleDay.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.scheduleDay.createMany).not.toHaveBeenCalled();
    };

    it('rejects day_of_week below 0', async () => {
      await expect400({ days: [{ day_of_week: -1, open_time: '09:00', close_time: '17:00' }] });
    });

    it('rejects day_of_week above 6', async () => {
      await expect400({ days: [{ day_of_week: 7, open_time: '09:00', close_time: '17:00' }] });
    });

    it('rejects open_time greater than or equal to close_time', async () => {
      await expect400({ days: [{ day_of_week: 2, open_time: '18:00', close_time: '09:00' }] });
      await expect400({ days: [{ day_of_week: 2, open_time: '10:00', close_time: '10:00' }] });
    });

    it('rejects malformed time strings', async () => {
      await expect400({ days: [{ day_of_week: 2, open_time: '9:00', close_time: '17:00' }] });
      await expect400({ days: [{ day_of_week: 2, open_time: '25:00', close_time: '26:00' }] });
    });
  });
});
