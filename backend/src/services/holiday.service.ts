import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';
import { branchService } from './branch.service';

/** Matches a date in strict YYYY-MM-DD format. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Public-facing view of a holiday. `date` is returned as YYYY-MM-DD. */
export interface HolidayView {
  id: string;
  date: string;
  label: string | null;
}

export interface AddHolidayInput {
  date: string;
  label?: string;
}

/**
 * Parses a strict YYYY-MM-DD string into a Date at midnight UTC of that day.
 * Throws HttpError 400 INVALID_DATE if the format is wrong or the calendar
 * date is invalid (e.g. 2024-02-31).
 */
function parseHolidayDate(date: unknown): Date {
  if (typeof date !== 'string' || !DATE_PATTERN.test(date)) {
    throw new HttpError('date must be in YYYY-MM-DD format', 400, 'INVALID_DATE');
  }

  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  // Guard against overflow like 2024-02-31 rolling into March.
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new HttpError('date is not a valid calendar date', 400, 'INVALID_DATE');
  }

  return parsed;
}

/** Formats a Date into a YYYY-MM-DD string using its UTC parts. */
function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Holiday service (dias de asueto) scoped per branch. Every operation first
 * validates that the branch belongs to the tenant (via branchService.get,
 * which throws 404 for a branch of another tenant), so a tenant can never read
 * or mutate holidays of another branch (Property 5: aislamiento).
 */
export const holidayService = {
  /**
   * Lists the holidays of a branch, ordered by date ascending. Validates that
   * the branch belongs to the tenant first.
   */
  async list(tenantId: string, branchId: string): Promise<HolidayView[]> {
    await branchService.get(tenantId, branchId);

    const holidays = await prisma.holiday.findMany({
      where: { branch_id: branchId },
      orderBy: { date: 'asc' },
    });

    return holidays.map((h) => ({
      id: h.id,
      date: toDateString(h.date),
      label: h.label ?? null,
    }));
  },

  /**
   * Adds a holiday to a branch at midnight UTC of the given day. Validates the
   * branch ownership and the date format (400 INVALID_DATE). The pair
   * [branch_id, date] is unique: a duplicate results in 409 DUPLICATE_HOLIDAY.
   */
  async add(
    tenantId: string,
    branchId: string,
    input: AddHolidayInput
  ): Promise<HolidayView> {
    await branchService.get(tenantId, branchId);

    const date = parseHolidayDate(input?.date);
    const label = typeof input?.label === 'string' ? input.label.trim() : undefined;

    const existing = await prisma.holiday.findUnique({
      where: { branch_id_date: { branch_id: branchId, date } },
    });
    if (existing) {
      throw new HttpError('Holiday already exists', 409, 'DUPLICATE_HOLIDAY');
    }

    const holiday = await prisma.holiday.create({
      data: {
        branch_id: branchId,
        date,
        ...(label ? { label } : {}),
      },
    });

    return {
      id: holiday.id,
      date: toDateString(holiday.date),
      label: holiday.label ?? null,
    };
  },

  /**
   * Removes a holiday of a branch. Validates the branch ownership first, then
   * ensures the holiday belongs to that branch (404 HOLIDAY_NOT_FOUND if it
   * does not exist or belongs to another branch).
   */
  async remove(
    tenantId: string,
    branchId: string,
    holidayId: string
  ): Promise<{ id: string }> {
    await branchService.get(tenantId, branchId);

    const existing = await prisma.holiday.findFirst({
      where: { id: holidayId, branch_id: branchId },
    });
    if (!existing) {
      throw new HttpError('Holiday not found', 404, 'HOLIDAY_NOT_FOUND');
    }

    await prisma.holiday.delete({ where: { id: holidayId } });

    return { id: holidayId };
  },
};
