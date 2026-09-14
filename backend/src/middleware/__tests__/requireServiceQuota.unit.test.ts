import { Response, NextFunction } from 'express';
import { HttpError } from '../../utils/errors';
import { AuthRequest } from '../../types/express';

const mockPrisma = {
  tenant: {
    findUnique: jest.fn(),
  },
  service: {
    count: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  __esModule: true,
  prisma: mockPrisma,
}));

// Import after the mock is registered.
import { requireServiceQuota } from '../requireServiceQuota';

/**
 * Unit tests for the requireServiceQuota guard.
 *
 * Property 4 (Limite de 5 servicios): un tenant premium crea servicios sin
 *   bloqueo; un tenant free con <5 servicios puede crear; con >=5 recibe 403
 *   PREMIUM_REQUIRED. Sin tenant autenticado -> 403 FORBIDDEN.
 *
 * **Validates: Requirements 4.1, 4.2, 4.3**
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
    await requireServiceQuota(req as AuthRequest, res, next);
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

describe('requireServiceQuota', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls next() for a premium tenant without counting services', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      subscription_status: 'active',
      subscription_expires_at: null,
    });

    const { error, next } = await run(authedReq());

    expect(mockPrisma.service.count).not.toHaveBeenCalled();
    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('calls next() for a free tenant with 4 services (below the limit)', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      subscription_status: 'inactive',
      subscription_expires_at: null,
    });
    mockPrisma.service.count.mockResolvedValue(4);

    const { error, next } = await run(authedReq());

    expect(mockPrisma.service.count).toHaveBeenCalledWith({
      where: { tenant_id: 't1' },
    });
    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects with 403 PREMIUM_REQUIRED for a free tenant with >=5 services', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      subscription_status: 'inactive',
      subscription_expires_at: null,
    });
    mockPrisma.service.count.mockResolvedValue(5);

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

  it('salta la cuota bajo impersonacion: next() aunque el tenant free tenga >=5 servicios', async () => {
    // Tenant free en el limite: sin impersonacion daria 403. Con impersonated_by
    // el guard hace next() sin consultar tenant ni contar servicios.
    mockPrisma.tenant.findUnique.mockResolvedValue({
      subscription_status: 'inactive',
      subscription_expires_at: null,
    });
    mockPrisma.service.count.mockResolvedValue(10);

    const { error, next } = await run(impersonatedReq());

    expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.service.count).not.toHaveBeenCalled();
    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
