import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../types/express';

const mockPrisma = {
  user: {
    update: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  __esModule: true,
  prisma: mockPrisma,
}));

// Import after the mock is registered.
import { touchLastSeen } from '../touchLastSeen';

/**
 * Unit tests for the touchLastSeen middleware.
 *
 * Property 8 (Sesiones activas): las escrituras de last_seen alimentan el
 *   calculo de sesiones activas. El middleware es best-effort/throttled: nunca
 *   bloquea el request ni lo hace fallar, y no escribe en cada peticion.
 *
 * **Validates: Requirements 8.1, 10.2**
 *
 * The middleware keeps an in-memory per-user throttle map, so each test uses a
 * distinct user id to avoid leaking throttle state across tests.
 */

const createRes = (): Response => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const runFor = (userId?: string): jest.Mock => {
  const next = jest.fn() as NextFunction & jest.Mock;
  const res = createRes();
  const req = (
    userId
      ? { user: { id: userId, tenant_id: 't1', role: 'CLIENT', permissions: [] } }
      : {}
  ) as Partial<AuthRequest>;

  touchLastSeen(req as AuthRequest, res, next);
  return next;
};

describe('touchLastSeen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.user.update.mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('always calls next() even without an authenticated user', () => {
    const next = runFor(undefined);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('fires an update the first time it sees an authenticated user', () => {
    const next = runFor('user-first');

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-first' },
      data: { last_seen: expect.any(Date) },
    });
  });

  it('does not fire again within the throttle window', () => {
    jest.useFakeTimers();

    const first = runFor('user-throttle');
    const second = runFor('user-throttle');

    // Advance less than the throttle window (60s) and try again.
    jest.advanceTimersByTime(30_000);
    const third = runFor('user-throttle');

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(third).toHaveBeenCalledTimes(1);
    // Only the first request within the window triggers the write.
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
  });

  it('fires again once the throttle window has elapsed', () => {
    jest.useFakeTimers();

    runFor('user-window');
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);

    // Advance beyond the throttle window (> 60s).
    jest.advanceTimersByTime(61_000);
    runFor('user-window');

    expect(mockPrisma.user.update).toHaveBeenCalledTimes(2);
  });

  it('does not break the request when the update rejects', async () => {
    // Simulate a DB failure; the fire-and-forget write must not throw.
    mockPrisma.user.update.mockRejectedValue(new Error('db down'));

    let thrown: unknown;
    let next: jest.Mock;
    try {
      next = runFor('user-reject');
    } catch (e) {
      thrown = e;
    }

    // Let the rejected promise settle so its .catch runs.
    await Promise.resolve();

    expect(thrown).toBeUndefined();
    expect(next!).toHaveBeenCalledTimes(1);
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
  });
});
