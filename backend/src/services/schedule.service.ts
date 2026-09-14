import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';
import { branchService } from './branch.service';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface ScheduleDayInput {
  day_of_week: number;
  open_time: string;
  close_time: string;
  is_active?: boolean;
}

export interface UpdateSchedulePayload {
  timezone?: string;
  days: ScheduleDayInput[];
}

interface NormalizedDay {
  day_of_week: number;
  open_time: string;
  close_time: string;
  is_active: boolean;
}

/**
 * Converts an "HH:MM" string into minutes since midnight.
 * Assumes the string already matched TIME_PATTERN.
 */
function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Validates and normalizes the incoming days. Throws HttpError 400 when
 * a day_of_week is out of the 0-6 range, a time is not "HH:MM", or the
 * open time is not strictly before the close time.
 */
function normalizeDays(days: ScheduleDayInput[]): NormalizedDay[] {
  if (!Array.isArray(days)) {
    throw new HttpError('days must be an array', 400, 'INVALID_SCHEDULE');
  }

  return days.map((day) => {
    const { day_of_week, open_time, close_time } = day;

    if (
      typeof day_of_week !== 'number' ||
      !Number.isInteger(day_of_week) ||
      day_of_week < 0 ||
      day_of_week > 6
    ) {
      throw new HttpError(
        'day_of_week must be an integer between 0 and 6',
        400,
        'INVALID_SCHEDULE'
      );
    }

    if (
      typeof open_time !== 'string' ||
      typeof close_time !== 'string' ||
      !TIME_PATTERN.test(open_time) ||
      !TIME_PATTERN.test(close_time)
    ) {
      throw new HttpError(
        'open_time and close_time must be in HH:MM format',
        400,
        'INVALID_SCHEDULE'
      );
    }

    if (toMinutes(open_time) >= toMinutes(close_time)) {
      throw new HttpError(
        'open_time must be earlier than close_time',
        400,
        'INVALID_SCHEDULE'
      );
    }

    return {
      day_of_week,
      open_time,
      close_time,
      is_active: day.is_active ?? true,
    };
  });
}

export const scheduleService = {
  /**
   * Returns the active schedule for the tenant along with its days. If the
   * tenant has no active schedule yet, returns an empty structure. Always
   * scoped by tenant_id so it never exposes another tenant's schedule.
   */
  async getSchedule(tenantId: string) {
    const schedule = await prisma.schedule.findFirst({
      where: { tenant_id: tenantId, is_active: true },
      include: {
        days: {
          orderBy: { day_of_week: 'asc' },
        },
      },
    });

    if (!schedule) {
      return { id: null, timezone: null, days: [] as NormalizedDay[] };
    }

    return {
      id: schedule.id,
      timezone: schedule.timezone,
      days: schedule.days.map((d) => ({
        day_of_week: d.day_of_week,
        open_time: d.open_time,
        close_time: d.close_time,
        is_active: d.is_active,
      })),
    };
  },

  /**
   * Upserts the tenant's active schedule and replaces its days. Creates the
   * schedule (name "Default") when the tenant has none. Every query is scoped
   * by tenant_id / schedule_id so it never touches another tenant's data.
   */
  async updateSchedule(tenantId: string, payload: UpdateSchedulePayload) {
    const normalizedDays = normalizeDays(payload?.days ?? []);

    // Find the tenant's existing active schedule (scoped by tenant_id).
    const existing = await prisma.schedule.findFirst({
      where: { tenant_id: tenantId, is_active: true },
    });

    let scheduleId: string;

    if (existing) {
      scheduleId = existing.id;
      if (payload.timezone) {
        await prisma.schedule.update({
          where: { id: scheduleId, tenant_id: tenantId },
          data: { timezone: payload.timezone },
        });
      }
    } else {
      const created = await prisma.schedule.create({
        data: {
          tenant_id: tenantId,
          name: 'Default',
          is_active: true,
          ...(payload.timezone ? { timezone: payload.timezone } : {}),
        },
      });
      scheduleId = created.id;
    }

    // Replace the days of this schedule: remove existing then insert new ones.
    // day_of_week is unique per schedule, so a full replace keeps it consistent.
    await prisma.scheduleDay.deleteMany({ where: { schedule_id: scheduleId } });

    if (normalizedDays.length > 0) {
      await prisma.scheduleDay.createMany({
        data: normalizedDays.map((day) => ({
          schedule_id: scheduleId,
          day_of_week: day.day_of_week,
          open_time: day.open_time,
          close_time: day.close_time,
          is_active: day.is_active,
        })),
      });
    }

    return this.getSchedule(tenantId);
  },

  /**
   * Returns the active schedule for a specific branch of the tenant along with
   * its days. Validates that the branch belongs to the tenant (via
   * branchService.get, which throws 404 for a branch of another tenant) before
   * touching any schedule data. If the branch has no active schedule yet,
   * returns an empty structure. Scoped by branch_id so it never exposes another
   * branch's schedule (Property 5: aislamiento por tenant/sucursal).
   */
  async getBranchSchedule(tenantId: string, branchId: string) {
    // Ensures the branch is owned by this tenant (404 otherwise).
    await branchService.get(tenantId, branchId);

    const schedule = await prisma.schedule.findFirst({
      where: { tenant_id: tenantId, branch_id: branchId, is_active: true },
      include: {
        days: {
          orderBy: { day_of_week: 'asc' },
        },
      },
    });

    if (!schedule) {
      return { id: null, timezone: null, days: [] as NormalizedDay[] };
    }

    return {
      id: schedule.id,
      timezone: schedule.timezone,
      days: schedule.days.map((d) => ({
        day_of_week: d.day_of_week,
        open_time: d.open_time,
        close_time: d.close_time,
        is_active: d.is_active,
      })),
    };
  },

  /**
   * Upserts a branch's active schedule and replaces its days. Validates that
   * the branch belongs to the tenant before touching schedule/scheduleDay.
   * Creates the schedule (name "Default", scoped to tenant_id + branch_id) when
   * the branch has none. Reuses the shared day validation (day_of_week 0-6,
   * HH:MM, open < close -> 400 INVALID_SCHEDULE). Every query is scoped by
   * branch_id / schedule_id so one branch's schedule never affects another.
   */
  async updateBranchSchedule(
    tenantId: string,
    branchId: string,
    payload: UpdateSchedulePayload
  ) {
    // Ensures the branch is owned by this tenant (404 otherwise) BEFORE any
    // validation or persistence, so a foreign branch never mutates schedules.
    await branchService.get(tenantId, branchId);

    const normalizedDays = normalizeDays(payload?.days ?? []);

    const existing = await prisma.schedule.findFirst({
      where: { tenant_id: tenantId, branch_id: branchId, is_active: true },
    });

    let scheduleId: string;

    if (existing) {
      scheduleId = existing.id;
      if (payload.timezone) {
        await prisma.schedule.update({
          where: { id: scheduleId },
          data: { timezone: payload.timezone },
        });
      }
    } else {
      const created = await prisma.schedule.create({
        data: {
          tenant_id: tenantId,
          branch_id: branchId,
          name: 'Default',
          is_active: true,
          ...(payload.timezone ? { timezone: payload.timezone } : {}),
        },
      });
      scheduleId = created.id;
    }

    await prisma.scheduleDay.deleteMany({ where: { schedule_id: scheduleId } });

    if (normalizedDays.length > 0) {
      await prisma.scheduleDay.createMany({
        data: normalizedDays.map((day) => ({
          schedule_id: scheduleId,
          day_of_week: day.day_of_week,
          open_time: day.open_time,
          close_time: day.close_time,
          is_active: day.is_active,
        })),
      });
    }

    return this.getBranchSchedule(tenantId, branchId);
  },
};
