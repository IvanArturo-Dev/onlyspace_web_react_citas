import { Response, NextFunction } from 'express';
import { HttpError } from '../../utils/errors';
import { AuthRequest } from '../../types/express';

const mockPrisma = {
  tenant: {
    findUnique: jest.fn(),
  },
  branch: {
    count: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  __esModule: true,
  prisma: mockPrisma,
}));

// Import after the mock is registered.
import { requireBranchQuota } from '../requireBranchQuota';

/**
 * Unit tests for the requireBranchQuota guard.
 *
 * Property 3 (Premium sin limite): un tenant premium crea sucursales sin bloqueo.
 * Property 4 (Primera sucursal en free): un tenant free con 0 sucursales puede
 *   crear la primera.
 * Property 2 (Free no crea recursos premium): un tenant free con >=1 sucursal
 *   recibe 403 PREMIUM_REQUIRED al intentar una segunda.
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
    await requireBranchQuota(req as AuthRequest, res, next);
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

describe('requireBranchQuota', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls next() for a premium tenant without counting branches', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      subscription_status: 'active',
      subscription_expires_at: null,
    });

    const { error, next } = await run(authedReq());

    expect(mockPrisma.branch.count).not.toHaveBeenCalled();
    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('calls next() for a free tenant with 0 branches (allows the first)', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      subscription_status: 'inactive',
      subscription_expires_at: null,
    });
    mockPrisma.branch.count.mockResolvedValue(0);

    const { error, next } = await run(authedReq());

    expect(mockPrisma.branch.count).toHaveBeenCalledWith({
      where: { tenant_id: 't1' },
    });
    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects with 403 PREMIUM_REQUIRED for a free tenant with >=1 branch', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      subscription_status: 'inactive',
      subscription_expires_at: null,
    });
    mockPrisma.branch.count.mockResolvedValue(1);

    const { error, next } = await run(authedReq());

    expectHttpError(error, 'PREMIUM_REQUIRED');
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects with 403 FORBIDDEN when req.user is absent', async () => {
    const { error, next } = await run({});

    expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();
    expectHttpError(error, 'FORBIDDEN');
    expect(next).not.toHaveBeenCalled();
  });

  it('salta la cuota bajo impersonacion: next() aunque el tenant free tenga >=1 sucursal', async () => {
    // Tenant free con una sucursal existente: sin impersonacion daria 403. Con
    // impersonated_by el guard hace next() sin consultar tenant ni contar.
    mockPrisma.tenant.findUnique.mockResolvedValue({
      subscription_status: 'inactive',
      subscription_expires_at: null,
    });
    mockPrisma.branch.count.mockResolvedValue(3);

    const { error, next } = await run(impersonatedReq());

    expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.branch.count).not.toHaveBeenCalled();
    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
