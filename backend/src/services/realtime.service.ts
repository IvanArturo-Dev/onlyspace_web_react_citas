import { AppointmentStatus } from '@prisma/client';
import { prisma } from '../database/prisma.service';

/**
 * Active session window, in milliseconds. A user is considered to have an
 * "active session" when their `last_seen` is within this window relative to
 * `now`. Configurable via the `ACTIVE_SESSION_WINDOW_MS` env var; defaults to
 * 10 minutes.
 */
const ACTIVE_WINDOW_MS = Number(process.env.ACTIVE_SESSION_WINDOW_MS) || 10 * 60 * 1000;

/**
 * How far back the "recent" activity counters look, in milliseconds (24h).
 * These counters are kept for backwards compatibility regardless of `range`.
 */
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Maximum number of active-session users returned in a snapshot. The count is
 * always exact; only the listed users are capped.
 */
const ACTIVE_USERS_LIMIT = 50;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Supported chart ranges for the realtime snapshot. */
export type RealtimeRange = '24h' | '7d' | '30d';

const VALID_RANGES: RealtimeRange[] = ['24h', '7d', '30d'];

/**
 * Normalizes a raw `range` value into a supported RealtimeRange. Any invalid or
 * missing value falls back to the default '24h'.
 */
export function normalizeRange(raw: unknown): RealtimeRange {
  return VALID_RANGES.includes(raw as RealtimeRange) ? (raw as RealtimeRange) : '24h';
}

/**
 * Range configuration: total window length and per-bucket size. 24h uses
 * hourly buckets; 7d and 30d use daily buckets.
 */
function rangeConfig(range: RealtimeRange): { windowMs: number; bucketMs: number } {
  switch (range) {
    case '7d':
      return { windowMs: 7 * DAY_MS, bucketMs: DAY_MS };
    case '30d':
      return { windowMs: 30 * DAY_MS, bucketMs: DAY_MS };
    case '24h':
    default:
      return { windowMs: 24 * HOUR_MS, bucketMs: HOUR_MS };
  }
}

export interface ActiveSessionUser {
  id: string;
  name: string;
  email: string;
  /** Role name (from UserRole.name); 'CLIENT' when the user has no role. */
  role: string;
  last_seen: string;
}

/** A single timeseries point: the bucket start (ISO) and its count. */
export interface TimeseriesPoint {
  bucket: string;
  count: number;
}

export interface RealtimeSnapshot {
  active_sessions: {
    count: number;
    users: ActiveSessionUser[];
  };
  totals: {
    entrepreneurs: number;
    branches: number;
    customers: number;
    services: number;
    appointments: number;
    users: number;
  };
  appointments_by_status: Record<AppointmentStatus, number>;
  recent: {
    /** Appointments created in the last 24h (created_at >= now - 24h). */
    bookings_24h: number;
    /** Appointments cancelled in the last 24h (status CANCELLED, updated_at >= now - 24h). */
    cancellations_24h: number;
  };
  /** The range used to build the timeseries. */
  range: RealtimeRange;
  /** Chart-friendly timeseries over the selected range. */
  timeseries: {
    /** Appointments created per bucket. */
    bookings: TimeseriesPoint[];
    /** Appointments cancelled per bucket (by updated_at, status CANCELLED). */
    cancellations: TimeseriesPoint[];
  };
  /** ISO timestamp of when the snapshot was produced. */
  timestamp: string;
}

/**
 * Builds a Record<AppointmentStatus, number> initialized to 0 for every status
 * in the AppointmentStatus enum.
 */
function emptyStatusRecord(): Record<AppointmentStatus, number> {
  const record = {} as Record<AppointmentStatus, number>;
  for (const status of Object.values(AppointmentStatus)) {
    record[status] = 0;
  }
  return record;
}

/**
 * Aligns a timestamp down to the start of its bucket. For hourly buckets it
 * truncates to the top of the hour; for daily buckets to UTC midnight. This
 * keeps bucket boundaries stable regardless of `now`'s sub-bucket offset.
 */
function bucketStart(ms: number, bucketMs: number): number {
  return Math.floor(ms / bucketMs) * bucketMs;
}

/**
 * Buckets a list of event timestamps into a fixed set of evenly spaced buckets
 * covering [firstBucketStart, now]. Every bucket is present (count 0 when
 * empty), so charts render a continuous axis.
 */
function buildTimeseries(
  events: Date[],
  now: number,
  windowMs: number,
  bucketMs: number
): TimeseriesPoint[] {
  const lastBucket = bucketStart(now, bucketMs);
  const firstBucket = bucketStart(now - windowMs, bucketMs);
  const bucketCount = Math.floor((lastBucket - firstBucket) / bucketMs) + 1;

  const counts = new Array<number>(bucketCount).fill(0);
  for (const event of events) {
    const t = event instanceof Date ? event.getTime() : new Date(event).getTime();
    const idx = Math.floor((bucketStart(t, bucketMs) - firstBucket) / bucketMs);
    if (idx >= 0 && idx < bucketCount) {
      counts[idx] += 1;
    }
  }

  const points: TimeseriesPoint[] = [];
  for (let i = 0; i < bucketCount; i++) {
    points.push({
      bucket: new Date(firstBucket + i * bucketMs).toISOString(),
      count: counts[i],
    });
  }
  return points;
}

export const realtimeService = {
  /**
   * Produces a cross-tenant snapshot for the super admin near-real-time
   * monitoring dashboard (consumed via polling).
   *
   * - `active_sessions`: users whose `last_seen` falls within the active
   *   window (`now - ACTIVE_WINDOW_MS`). The `count` is exact; the `users`
   *   list is ordered by `last_seen` descending and capped at
   *   ACTIVE_USERS_LIMIT. A user without a role is reported as 'CLIENT'.
   * - `totals`: global counters. `entrepreneurs` is the number of active
   *   AuthorizedAdmin records (status 'active').
   * - `appointments_by_status`: global count grouped by status, with every
   *   status initialized to 0.
   * - `recent`: bookings are appointments created in the last 24h; cancellations
   *   are appointments with status CANCELLED whose `updated_at` is in the last
   *   24h (i.e. cancelled recently). Kept for backwards compatibility.
   * - `timeseries`: bookings/cancellations bucketed over the selected `range`
   *   (hourly for '24h', daily for '7d'/'30d'), suitable for charts.
   *
   * @param range Chart range: '24h' (default) | '7d' | '30d'. Invalid values
   *   fall back to '24h'.
   */
  async getSnapshot(range: RealtimeRange = '24h'): Promise<RealtimeSnapshot> {
    const effectiveRange = normalizeRange(range);
    const { windowMs, bucketMs } = rangeConfig(effectiveRange);

    const now = Date.now();
    const activeSince = new Date(now - ACTIVE_WINDOW_MS);
    const recentSince = new Date(now - RECENT_WINDOW_MS);
    // Align the timeseries lower bound to the first bucket boundary so we fetch
    // exactly the events that can land in a rendered bucket.
    const seriesSince = new Date(bucketStart(now - windowMs, bucketMs));

    const [
      activeUsers,
      entrepreneurs,
      branches,
      customers,
      services,
      appointments,
      users,
      grouped,
      bookings24h,
      cancellations24h,
      bookingEvents,
      cancellationEvents,
    ] = await Promise.all([
      prisma.user.findMany({
        where: { last_seen: { gte: activeSince } },
        orderBy: { last_seen: 'desc' },
        take: ACTIVE_USERS_LIMIT,
        select: {
          id: true,
          name: true,
          email: true,
          last_seen: true,
          role: { select: { name: true } },
        },
      }),
      prisma.authorizedAdmin.count({ where: { status: 'active' } }),
      prisma.branch.count(),
      prisma.customer.count(),
      prisma.service.count(),
      prisma.appointment.count(),
      prisma.user.count(),
      prisma.appointment.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      prisma.appointment.count({ where: { created_at: { gte: recentSince } } }),
      prisma.appointment.count({
        where: {
          status: AppointmentStatus.CANCELLED,
          updated_at: { gte: recentSince },
        },
      }),
      // Timeseries source events over the selected range.
      prisma.appointment.findMany({
        where: { created_at: { gte: seriesSince } },
        select: { created_at: true },
      }),
      prisma.appointment.findMany({
        where: {
          status: AppointmentStatus.CANCELLED,
          updated_at: { gte: seriesSince },
        },
        select: { updated_at: true },
      }),
    ]);

    const appointmentsByStatus = emptyStatusRecord();
    for (const row of grouped) {
      appointmentsByStatus[row.status as AppointmentStatus] = row._count._all;
    }

    const sessionUsers: ActiveSessionUser[] = activeUsers.map((u: any) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role?.name ?? 'CLIENT',
      last_seen:
        u.last_seen instanceof Date
          ? u.last_seen.toISOString()
          : new Date(u.last_seen).toISOString(),
    }));

    const bookingsSeries = buildTimeseries(
      (bookingEvents as Array<{ created_at: Date }>).map((e) => e.created_at),
      now,
      windowMs,
      bucketMs
    );
    const cancellationsSeries = buildTimeseries(
      (cancellationEvents as Array<{ updated_at: Date }>).map((e) => e.updated_at),
      now,
      windowMs,
      bucketMs
    );

    return {
      active_sessions: {
        count: sessionUsers.length,
        users: sessionUsers,
      },
      totals: {
        entrepreneurs,
        branches,
        customers,
        services,
        appointments,
        users,
      },
      appointments_by_status: appointmentsByStatus,
      recent: {
        bookings_24h: bookings24h,
        cancellations_24h: cancellations24h,
      },
      range: effectiveRange,
      timeseries: {
        bookings: bookingsSeries,
        cancellations: cancellationsSeries,
      },
      timestamp: new Date(now).toISOString(),
    };
  },
};
