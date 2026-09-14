import { describe, it, expect, beforeEach, jest } from '@jest/globals';

/**
 * Unit tests for the premium subscription service and the super-admin routing.
 *
 * - Property 1 (premium efectivo): `isPremiumEffective` returns true only for an
 *   'active' subscription whose expiry is null or in the future; an 'active'
 *   subscription with a past expiry is NOT premium; 'inactive' is never premium.
 * - Property 3 (solo super admin): the tenant-subscription routes are wired with
 *   `requireSuperAdmin`, and the guard denies non-superadmin callers with 403.
 *
 * prisma.tenant.findUnique/update and writeAudit are mocked so the tests run
 * against the service logic without a database.
 *
 * **Validates: Requirements 2.1, 2.3, 2.5**
 * **Properties: Property 1, Property 3**
 */

const mockPrisma = {
  tenant: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

const mockWriteAudit = jest.fn(async () => undefined);

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

jest.mock('../../utils/audit', () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
}));

// Import after mocks are registered.
import {
  subscriptionService,
  isPremiumEffective,
} from '../subscription.service';
import { requireSuperAdmin } from '../../middleware/requireSuperAdmin';
import { HttpError } from '../../utils/errors';
import { AuthRequest } from '../../types/express';
import type { Response, NextFunction } from 'express';

const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  jest.clearAllMocks();
  (mockPrisma.tenant.findUnique as jest.Mock).mockReset();
  (mockPrisma.tenant.update as jest.Mock).mockReset();
});

describe('isPremiumEffective (Property 1)', () => {
  it('active + null expiry -> premium', () => {
    expect(
      isPremiumEffective({
        subscription_status: 'active',
        subscription_expires_at: null,
      })
    ).toBe(true);
  });

  it('active + future expiry -> premium', () => {
    expect(
      isPremiumEffective({
        subscription_status: 'active',
        subscription_expires_at: new Date(Date.now() + HOUR),
      })
    ).toBe(true);
  });

  it('active + past expiry -> NOT premium (expired counts as inactive)', () => {
    expect(
      isPremiumEffective({
        subscription_status: 'active',
        subscription_expires_at: new Date(Date.now() - HOUR),
      })
    ).toBe(false);
  });

  it('inactive with any expiry -> NOT premium', () => {
    expect(
      isPremiumEffective({
        subscription_status: 'inactive',
        subscription_expires_at: null,
      })
    ).toBe(false);
    expect(
      isPremiumEffective({
        subscription_status: 'inactive',
        subscription_expires_at: new Date(Date.now() + HOUR),
      })
    ).toBe(false);
    expect(
      isPremiumEffective({
        subscription_status: 'inactive',
        subscription_expires_at: new Date(Date.now() - HOUR),
      })
    ).toBe(false);
  });

  it('exposes isPremiumEffective on the service too', () => {
    expect(subscriptionService.isPremiumEffective).toBe(isPremiumEffective);
  });
});

describe('subscriptionService.getForTenant', () => {
  it('derives is_premium correctly for an active, non-expired tenant', async () => {
    const expires = new Date(Date.now() + HOUR);
    (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      subscription_status: 'active',
      subscription_expires_at: expires,
    });

    const view = await subscriptionService.getForTenant('t1');

    expect(view).toEqual({
      status: 'active',
      expires_at: expires,
      is_premium: true,
    });
  });

  it('derives is_premium=false for an active but expired tenant', async () => {
    (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      subscription_status: 'active',
      subscription_expires_at: new Date(Date.now() - HOUR),
    });

    const view = await subscriptionService.getForTenant('t1');
    expect(view.is_premium).toBe(false);
  });

  it('throws 404 TENANT_NOT_FOUND when the tenant is missing', async () => {
    (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(subscriptionService.getForTenant('missing')).rejects.toMatchObject({
      statusCode: 404,
      code: 'TENANT_NOT_FOUND',
    });
  });
});

describe('subscriptionService.setSubscription', () => {
  it('rejects an invalid status with 400 VALIDATION_ERROR (and does not persist)', async () => {
    await expect(
      subscriptionService.setSubscription('t1', { status: 'premium' })
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });

    expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it('throws 404 when the tenant does not exist', async () => {
    (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      subscriptionService.setSubscription('missing', { status: 'active' })
    ).rejects.toMatchObject({ statusCode: 404, code: 'TENANT_NOT_FOUND' });

    expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
  });

  it('persists the subscription and writes an audit record', async () => {
    const expires = new Date(Date.now() + 24 * HOUR);
    (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({ id: 't1' });
    (mockPrisma.tenant.update as jest.Mock).mockResolvedValue({
      subscription_status: 'active',
      subscription_expires_at: expires,
    });

    const view = await subscriptionService.setSubscription(
      't1',
      { status: 'active', expires_at: expires.toISOString() },
      'super-1'
    );

    expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: {
        subscription_status: 'active',
        subscription_expires_at: expires,
      },
      select: { subscription_status: true, subscription_expires_at: true },
    });

    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 't1',
        user_id: 'super-1',
        action: 'UPDATE',
        resource_type: 'tenant',
        resource_id: 't1',
      })
    );

    expect(view).toEqual({
      status: 'active',
      expires_at: expires,
      is_premium: true,
    });
  });

  it('allows clearing the expiry (null) when deactivating', async () => {
    (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({ id: 't1' });
    (mockPrisma.tenant.update as jest.Mock).mockResolvedValue({
      subscription_status: 'inactive',
      subscription_expires_at: null,
    });

    const view = await subscriptionService.setSubscription('t1', {
      status: 'inactive',
      expires_at: null,
    });

    expect(mockPrisma.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { subscription_status: 'inactive', subscription_expires_at: null },
      })
    );
    expect(view.is_premium).toBe(false);
  });
});

describe('requireSuperAdmin guard (Property 3)', () => {
  const createRes = (): Response => {
    const res = {} as Response;
    res.status = jest.fn().mockReturnValue(res) as any;
    res.json = jest.fn().mockReturnValue(res) as any;
    return res;
  };

  const run = (req: Partial<AuthRequest>): { error: unknown; next: jest.Mock } => {
    const next = jest.fn() as NextFunction & jest.Mock;
    const res = createRes();
    let error: unknown;
    try {
      requireSuperAdmin(req as AuthRequest, res, next);
    } catch (e) {
      error = e;
    }
    return { error, next };
  };

  it('allows a SUPERADMIN to change the subscription', () => {
    const { error, next } = run({
      user: { id: 's1', tenant_id: 'default', role: 'SUPERADMIN', permissions: [] },
    });
    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each(['ADMIN', 'ASSISTANT', 'CLIENT'])(
    'denies non-superadmin role "%s" with 403 FORBIDDEN',
    (role) => {
      const { error, next } = run({
        user: { id: 'u1', tenant_id: 't1', role, permissions: [] },
      });
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).statusCode).toBe(403);
      expect((error as HttpError).code).toBe('FORBIDDEN');
      expect(next).not.toHaveBeenCalled();
    }
  );
});

describe('admin routes wiring (Property 3)', () => {
  it('guards the tenant-subscription routes with requireSuperAdmin', () => {
    // Importing here (not at top) keeps the module graph light; the route module
    // only needs the mocked prisma/audit already registered above.
    const { adminRoutes } = require('../../routes/v1/admin.routes');

    const layers = (
      adminRoutes as unknown as {
        stack: Array<{
          route?: {
            path: string;
            methods: Record<string, boolean>;
            stack: Array<{ handle: unknown }>;
          };
        }>;
      }
    ).stack.filter((l) => l.route);

    const subRoutes = layers.filter(
      (l) => l.route!.path === '/tenants/:id/subscription'
    );

    // GET + PATCH both registered.
    expect(subRoutes.length).toBe(2);

    for (const layer of subRoutes) {
      const handles = layer.route!.stack.map((s) => s.handle);
      expect(handles).toContain(requireSuperAdmin);
    }
  });
});
