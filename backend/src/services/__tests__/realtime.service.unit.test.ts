import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { AppointmentStatus } from '@prisma/client';

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------
const mockPrisma = {
  user: { findMany: jest.fn(), count: jest.fn() },
  branch: { count: jest.fn() },
  customer: { count: jest.fn() },
  service: { count: jest.fn() },
  appointment: { count: jest.fn(), groupBy: jest.fn(), findMany: jest.fn() },
  authorizedAdmin: { count: jest.fn() },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// Fixed "now" so we can assert on the time windows deterministically.
const FIXED_NOW = new Date('2024-06-01T12:00:00.000Z').getTime();
const TEN_MIN_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Wires all count/groupBy mocks with the given totals. Only `user.findMany`
 * and `appointment.groupBy` need per-test customization, so those default to
 * empty here and are overridden where relevant.
 */
function wireTotals(overrides: {
  entrepreneurs?: number;
  branches?: number;
  customers?: number;
  services?: number;
  appointments?: number;
  users?: number;
  bookings24h?: number;
  cancellations24h?: number;
} = {}) {
  const {
    entrepreneurs = 0,
    branches = 0,
    customers = 0,
    services = 0,
    appointments = 0,
    users = 0,
    bookings24h = 0,
    cancellations24h = 0,
  } = overrides;

  mockPrisma.authorizedAdmin.count.mockResolvedValue(entrepreneurs as any);
  mockPrisma.branch.count.mockResolvedValue(branches as any);
  mockPrisma.customer.count.mockResolvedValue(customers as any);
  mockPrisma.service.count.mockResolvedValue(services as any);
  mockPrisma.user.count.mockResolvedValue(users as any);

  // appointment.count is called 3 times: total, bookings_24h, cancellations_24h
  // (in that order, via Promise.all). Resolve based on the passed `where`.
  mockPrisma.appointment.count.mockImplementation((args: any) => {
    const where = args?.where ?? {};
    if (where.status === AppointmentStatus.CANCELLED) {
      return Promise.resolve(cancellations24h);
    }
    if (where.created_at) {
      return Promise.resolve(bookings24h);
    }
    return Promise.resolve(appointments);
  });
}

describe('realtimeService.getSnapshot (unit)', () => {
  let nowSpy: any;

  beforeEach(() => {
    jest.clearAllMocks();
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    // Sensible defaults; individual tests override as needed.
    mockPrisma.user.findMany.mockResolvedValue([] as any);
    mockPrisma.appointment.groupBy.mockResolvedValue([] as any);
    // Timeseries source events default to empty; overridden per test.
    mockPrisma.appointment.findMany.mockResolvedValue([] as any);
    wireTotals();
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  describe('Property 8: active sessions = recent activity', () => {
    it('queries users with last_seen >= now - window and reports them as active sessions', async () => {
      const activeUsers = [
        {
          id: 'u1',
          name: 'Alice',
          email: 'alice@example.com',
          last_seen: new Date(FIXED_NOW - 60 * 1000),
          role: { name: 'ADMIN' },
        },
        {
          id: 'u2',
          name: 'Bob',
          email: 'bob@example.com',
          last_seen: new Date(FIXED_NOW - 5 * 60 * 1000),
          role: null,
        },
      ];
      mockPrisma.user.findMany.mockResolvedValue(activeUsers as any);

      const { realtimeService } = await import('../realtime.service');
      const snapshot = await realtimeService.getSnapshot();

      // findMany must be called filtering last_seen >= (now - window).
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            last_seen: { gte: new Date(FIXED_NOW - TEN_MIN_MS) },
          },
          orderBy: { last_seen: 'desc' },
        })
      );

      // count coincides with the returned users.
      expect(snapshot.active_sessions.count).toBe(activeUsers.length);
      expect(snapshot.active_sessions.users).toHaveLength(activeUsers.length);

      // role null -> 'CLIENT'; role.name preserved otherwise.
      expect(snapshot.active_sessions.users[0].role).toBe('ADMIN');
      expect(snapshot.active_sessions.users[1].role).toBe('CLIENT');

      // last_seen serialized to ISO.
      expect(snapshot.active_sessions.users[0].last_seen).toBe(
        new Date(FIXED_NOW - 60 * 1000).toISOString()
      );
    });
  });

  it('computes totals from the mocked counts', async () => {
    wireTotals({
      entrepreneurs: 3,
      branches: 7,
      customers: 42,
      services: 12,
      appointments: 100,
      users: 50,
    });

    const { realtimeService } = await import('../realtime.service');
    const snapshot = await realtimeService.getSnapshot();

    expect(snapshot.totals).toEqual({
      entrepreneurs: 3,
      branches: 7,
      customers: 42,
      services: 12,
      appointments: 100,
      users: 50,
    });

    // entrepreneurs must come from active AuthorizedAdmin records.
    expect(mockPrisma.authorizedAdmin.count).toHaveBeenCalledWith({
      where: { status: 'active' },
    });
  });

  it('initializes appointments_by_status to 0 for statuses without rows', async () => {
    mockPrisma.appointment.groupBy.mockResolvedValue([
      { status: AppointmentStatus.PENDING, _count: { _all: 4 } },
      { status: AppointmentStatus.COMPLETED, _count: { _all: 2 } },
    ] as any);

    const { realtimeService } = await import('../realtime.service');
    const snapshot = await realtimeService.getSnapshot();

    expect(snapshot.appointments_by_status[AppointmentStatus.PENDING]).toBe(4);
    expect(snapshot.appointments_by_status[AppointmentStatus.COMPLETED]).toBe(2);
    expect(snapshot.appointments_by_status[AppointmentStatus.CONFIRMED]).toBe(0);
    expect(snapshot.appointments_by_status[AppointmentStatus.CANCELLED]).toBe(0);
    expect(snapshot.appointments_by_status[AppointmentStatus.NO_SHOW]).toBe(0);
  });

  it('recent counters use the 24h window (created_at for bookings, updated_at + CANCELLED for cancellations)', async () => {
    wireTotals({ bookings24h: 9, cancellations24h: 3 });

    const { realtimeService } = await import('../realtime.service');
    const snapshot = await realtimeService.getSnapshot();

    expect(snapshot.recent.bookings_24h).toBe(9);
    expect(snapshot.recent.cancellations_24h).toBe(3);

    const since = new Date(FIXED_NOW - DAY_MS);

    // bookings_24h: created_at >= now - 24h
    expect(mockPrisma.appointment.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          created_at: { gte: since },
        }),
      })
    );

    // cancellations_24h: status CANCELLED AND updated_at >= now - 24h
    expect(mockPrisma.appointment.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: AppointmentStatus.CANCELLED,
          updated_at: { gte: since },
        }),
      })
    );
  });

  it('includes an ISO timestamp of the snapshot time', async () => {
    const { realtimeService } = await import('../realtime.service');
    const snapshot = await realtimeService.getSnapshot();
    expect(snapshot.timestamp).toBe(new Date(FIXED_NOW).toISOString());
  });

  describe('range + timeseries', () => {
    /**
     * Wires appointment.findMany to return `created_at` events for the first
     * call (bookings series) and `updated_at` events for the second call
     * (cancellations series), matching the Promise.all order in the service.
     */
    function wireSeries(bookings: Date[], cancellations: Date[]) {
      mockPrisma.appointment.findMany
        .mockResolvedValueOnce(bookings.map((d) => ({ created_at: d })) as any)
        .mockResolvedValueOnce(cancellations.map((d) => ({ updated_at: d })) as any);
    }

    it('defaults to 24h with hourly buckets (24 buckets)', async () => {
      const { realtimeService } = await import('../realtime.service');
      const snapshot = await realtimeService.getSnapshot();

      expect(snapshot.range).toBe('24h');
      // Buckets are aligned to the hour; window is 24h -> 24 or 25 boundaries.
      expect(snapshot.timeseries.bookings.length).toBeGreaterThanOrEqual(24);
      expect(snapshot.timeseries.bookings.length).toBeLessThanOrEqual(25);
      // FIXED_NOW is exactly on the hour, so exactly 25 boundaries (inclusive).
      expect(snapshot.timeseries.bookings.length).toBe(25);
      expect(snapshot.timeseries.cancellations.length).toBe(25);
      // Every bucket is a { bucket: ISO, count } shape.
      for (const p of snapshot.timeseries.bookings) {
        expect(typeof p.bucket).toBe('string');
        expect(typeof p.count).toBe('number');
      }
    });

    it('7d range uses daily buckets', async () => {
      const { realtimeService } = await import('../realtime.service');
      const snapshot = await realtimeService.getSnapshot('7d');

      expect(snapshot.range).toBe('7d');
      // 7 days of daily buckets, inclusive boundary -> 8 points when aligned.
      expect(snapshot.timeseries.bookings.length).toBe(8);
    });

    it('invalid range falls back to 24h', async () => {
      const { realtimeService } = await import('../realtime.service');
      // @ts-expect-error intentionally passing an invalid range
      const snapshot = await realtimeService.getSnapshot('bogus');
      expect(snapshot.range).toBe('24h');
    });

    it('buckets booking/cancellation events into the correct hourly buckets', async () => {
      // One booking 30 min ago, one 90 min ago; one cancellation 2h ago.
      const booking1 = new Date(FIXED_NOW - 30 * 60 * 1000);
      const booking2 = new Date(FIXED_NOW - 90 * 60 * 1000);
      const cancel1 = new Date(FIXED_NOW - 2 * 60 * 60 * 1000);
      wireSeries([booking1, booking2], [cancel1]);

      const { realtimeService } = await import('../realtime.service');
      const snapshot = await realtimeService.getSnapshot('24h');

      const totalBookings = snapshot.timeseries.bookings.reduce(
        (sum, p) => sum + p.count,
        0
      );
      const totalCancellations = snapshot.timeseries.cancellations.reduce(
        (sum, p) => sum + p.count,
        0
      );
      expect(totalBookings).toBe(2);
      expect(totalCancellations).toBe(1);
    });

    it('queries timeseries cancellations only for CANCELLED status', async () => {
      const { realtimeService } = await import('../realtime.service');
      await realtimeService.getSnapshot('24h');

      // findMany called twice: bookings (created_at) and cancellations
      // (status CANCELLED + updated_at).
      expect(mockPrisma.appointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: AppointmentStatus.CANCELLED,
          }),
        })
      );
    });
  });
});
