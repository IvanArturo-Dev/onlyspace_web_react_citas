import { Response, NextFunction } from 'express';
import { HttpError } from '../../utils/errors';
import { AuthRequest } from '../../types/express';

const mockPrisma = {
  tenant: {
    findUnique: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  __esModule: true,
  prisma: mockPrisma,
}));

// Import after the mock is registered.
import { requirePremium } from '../requirePremium';

/**
 * Unit tests for the requirePremium guard.
 *
 * Property 2 (Free no crea recursos premium): un tenant free recibe 403
 *   PREMIUM_REQUIRED al intentar una accion premium.
 * Property 3 (Premium sin limite): un tenant premium pasa el guard.
 * Property 6 (Aislamiento por tenant): el guard evalua el tenant del JWT.
 *
 * **Validates: Requirements 1.1, 6.3**
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
    await requirePremium(req as AuthRequest, res, next);
  } catch (e) {
    error = e;
  }

  return { error, next };
};

const expectHttpError = (error: unknown, code: string) => {
  expect(error).toBeInstanceOf(HttpError);
  const httpError = error as HttpError;
  expect(httpError.statusCode).toBe(403);
  expect(httpError.code).toBe(code);
};

const authedReq = (): Partial<AuthRequest> => ({
  user: { id: 'u1', tenant_id: 't1', role: 'ADMIN', permissions: [] },
});

// Request bajo impersonacion del super admin: lleva el claim impersonated_by.
const impersonatedReq = (): Partial<AuthRequest> => ({
  user: {
    id: 'super-1',
    tenant_id: 't1',
    role: 'ADMIN',
    permissions: [],
    impersonated_by: 'super-1',
  },
});

describe('requirePremium', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls next() without error for a premium tenant (active, no expiry)', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      subscription_status: 'active',
      subscription_expires_at: null,
    });

    const { error, next } = await run(authedReq());

    expect(mockPrisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: 't1' },
      select: { subscription_status: true, subscription_expires_at: true },
    });
    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects with 403 PREMIUM_REQUIRED for a non-premium tenant (inactive)', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      subscription_status: 'inactive',
      subscription_expires_at: null,
    });

    const { error, next } = await run(authedReq());

    expectHttpError(error, 'PREMIUM_REQUIRED');
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects with 403 FORBIDDEN when req.user is absent (skips DB lookup)', async () => {
    const { error, next } = await run({});

    expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();
    expectHttpError(error, 'FORBIDDEN');
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects with 403 PREMIUM_REQUIRED when the tenant does not exist', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null);

    const { error, next } = await run(authedReq());

    expectHttpError(error, 'PREMIUM_REQUIRED');
    expect(next).not.toHaveBeenCalled();
  });

  it('salta el gating bajo impersonacion: next() aunque el tenant sea free', async () => {
    // Tenant free (inactive): sin impersonacion daria 403. Con impersonated_by
    // el guard hace next() sin siquiera consultar la base.
    mockPrisma.tenant.findUnique.mockResolvedValue({
      subscription_status: 'inactive',
      subscription_expires_at: null,
    });

    const { error, next } = await run(impersonatedReq());

    expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();
    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
