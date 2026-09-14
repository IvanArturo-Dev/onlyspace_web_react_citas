import { Response, NextFunction } from 'express';
import { HttpError } from '../../utils/errors';
import { AuthRequest } from '../../types/express';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  __esModule: true,
  prisma: mockPrisma,
}));

// Import after the mock is registered.
import { ensureNotBlocked } from '../ensureNotBlocked';

/**
 * Unit tests for the ensureNotBlocked guard.
 *
 * Property 6 (Bloqueo efectivo): un usuario con is_active=false es rechazado en
 *   requests posteriores con 403 USER_BLOCKED, aunque su JWT siga siendo valido.
 *
 * **Validates: Requirements 10.2, 10.7**
 */

const createRes = (): Response => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const run = async (
  req: Partial<AuthRequest>
): Promise<{ error: unknown; next: jest.Mock }> => {
  const next = jest.fn() as NextFunction & jest.Mock;
  const res = createRes();
  let error: unknown;

  try {
    await ensureNotBlocked(req as AuthRequest, res, next);
  } catch (e) {
    error = e;
  }

  return { error, next };
};

const expectBlocked = (error: unknown) => {
  expect(error).toBeInstanceOf(HttpError);
  const httpError = error as HttpError;
  expect(httpError.statusCode).toBe(403);
  expect(httpError.code).toBe('USER_BLOCKED');
};

const authedReq = (): Partial<AuthRequest> => ({
  user: { id: 'u1', tenant_id: 't1', role: 'ADMIN', permissions: [] },
});

describe('ensureNotBlocked', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls next() without error when the user is active', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ is_active: true });

    const { error, next } = await run(authedReq());

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { is_active: true },
    });
    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects with 403 USER_BLOCKED when the user is inactive', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ is_active: false });

    const { error, next } = await run(authedReq());

    expectBlocked(error);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects with 403 USER_BLOCKED when the user does not exist', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const { error, next } = await run(authedReq());

    expectBlocked(error);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() and skips the DB lookup when req.user is absent', async () => {
    const { error, next } = await run({});

    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
