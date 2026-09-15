import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Prisma + audit mocks
// ---------------------------------------------------------------------------
const mockPrisma = {
  tenant: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  advertisement: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  service: {
    findMany: jest.fn(),
  },
  googleAccount: {
    findUnique: jest.fn(),
  },
  promotion: {
    findMany: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

const mockWriteAudit = jest.fn();
jest.mock('../../utils/audit', () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
}));

// public.service.resolveBranchByCode is mocked for the public-info test.
const mockResolveBranch = jest.fn();
jest.mock('../../services/public.service', () => ({
  publicService: {
    resolveBranchByCode: (...args: unknown[]) => mockResolveBranch(...args),
  },
}));

import {
  brandingService,
  isPremiumEffective,
  validateBrandColor,
} from '../branding.service';
import { HttpError } from '../../utils/errors';

/** Minimal Express response double capturing status + json payload. */
function makeRes() {
  const res: any = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((payload: any) => {
    res.body = payload;
    return res;
  });
  return res;
}

const premiumTenant = {
  id: 't1',
  name: 'Barberia Premium',
  subscription_status: 'active',
  subscription_expires_at: null,
  logo_url: 'https://cdn/logo.png',
  brand_color: '#ff0000',
  banner_title: 'Promo',
  banner_text: 'Texto',
  banner_link: 'https://x',
};

beforeEach(() => {
  jest.clearAllMocks();
  // Default: no GoogleAccount for the tenant -> online_sessions_enabled false.
  mockPrisma.googleAccount.findUnique.mockResolvedValue(null as any);
});

// ---------------------------------------------------------------------------
// isPremiumEffective — supports Property 2 gating logic
// ---------------------------------------------------------------------------
describe('isPremiumEffective', () => {
  const now = new Date('2025-06-01T00:00:00Z');

  it('is true when active with no expiry', () => {
    expect(
      isPremiumEffective({ subscription_status: 'active', subscription_expires_at: null }, now)
    ).toBe(true);
  });

  it('is true when active and expiry is in the future', () => {
    expect(
      isPremiumEffective(
        { subscription_status: 'active', subscription_expires_at: new Date('2025-07-01T00:00:00Z') },
        now
      )
    ).toBe(true);
  });

  it('is false when active but expiry is in the past (vencida)', () => {
    expect(
      isPremiumEffective(
        { subscription_status: 'active', subscription_expires_at: new Date('2025-05-01T00:00:00Z') },
        now
      )
    ).toBe(false);
  });

  it('is false when status is inactive', () => {
    expect(
      isPremiumEffective({ subscription_status: 'inactive', subscription_expires_at: null }, now)
    ).toBe(false);
  });

  it('is false for null tenant', () => {
    expect(isPremiumEffective(null, now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Property 2 — public info exposes branding/ads ONLY when premium effective
// (tested via the composition: isPremiumEffective + brandingService, and via
// the actual public controller info() handler with mocked prisma).
// ---------------------------------------------------------------------------
describe('Property 2: public info gates branding/ads by premium', () => {
  it('includes is_premium=true, branding and active ads for a premium tenant', async () => {
    mockResolveBranch.mockResolvedValue({ id: 'b1', name: 'Centro', tenant_id: 't1' });
    mockPrisma.tenant.findUnique.mockResolvedValue(premiumTenant as any);
    mockPrisma.service.findMany.mockResolvedValue([
      { id: 's1', name: 'Corte', duration_mins: 30, price: 100 },
    ] as any);
    mockPrisma.advertisement.findMany.mockResolvedValue([
      {
        id: 'ad1',
        title: 'Promo activa',
        body: 'body',
        image_url: null,
        link_url: null,
      },
    ] as any);
    // info() ahora consulta promociones vigentes (premium). Sin promos -> [].
    mockPrisma.promotion.findMany.mockResolvedValue([] as any);

    const { publicController } = await import('../../controllers/public.controller');
    const req: any = { params: { code: 'ABC123' } };
    const res = makeRes();

    await publicController.info(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.is_premium).toBe(true);
    expect(res.body.data.branding).toEqual({
      logo_url: 'https://cdn/logo.png',
      brand_color: '#ff0000',
      banner_title: 'Promo',
      banner_text: 'Texto',
      banner_link: 'https://x',
    });
    expect(res.body.data.ads).toEqual([
      { id: 'ad1', title: 'Promo activa', body: 'body', image_url: null, link_url: null },
    ]);
    // Only active ads are queried for the public payload.
    const adsCall = mockPrisma.advertisement.findMany.mock.calls[0][0] as any;
    expect(adsCall.where).toEqual({ tenant_id: 't1', is_active: true });
    // Existing shape stays intact.
    expect(res.body.data.business).toEqual({ name: 'Barberia Premium' });
    expect(res.body.data.branch).toEqual({ id: 'b1', name: 'Centro', maps_url: null });
    expect(res.body.data.services).toHaveLength(1);
  });

  it('omits branding and ads (only is_premium=false) for a non-premium tenant', async () => {
    mockResolveBranch.mockResolvedValue({ id: 'b1', name: 'Centro', tenant_id: 't1' });
    mockPrisma.tenant.findUnique.mockResolvedValue({
      ...premiumTenant,
      subscription_status: 'inactive',
    } as any);
    mockPrisma.service.findMany.mockResolvedValue([] as any);

    const { publicController } = await import('../../controllers/public.controller');
    const req: any = { params: { code: 'ABC123' } };
    const res = makeRes();

    await publicController.info(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.is_premium).toBe(false);
    expect(res.body.data.branding).toBeUndefined();
    expect(res.body.data.ads).toBeUndefined();
    // No active-ads query happens when not premium.
    expect(mockPrisma.advertisement.findMany).not.toHaveBeenCalled();
  });

  it('omits branding/ads when active subscription is expired (vencida)', async () => {
    mockResolveBranch.mockResolvedValue({ id: 'b1', name: 'Centro', tenant_id: 't1' });
    mockPrisma.tenant.findUnique.mockResolvedValue({
      ...premiumTenant,
      subscription_status: 'active',
      subscription_expires_at: new Date('2000-01-01T00:00:00Z'),
    } as any);
    mockPrisma.service.findMany.mockResolvedValue([] as any);

    const { publicController } = await import('../../controllers/public.controller');
    const req: any = { params: { code: 'ABC123' } };
    const res = makeRes();

    await publicController.info(req, res);

    expect(res.body.data.is_premium).toBe(false);
    expect(res.body.data.branding).toBeUndefined();
    expect(res.body.data.ads).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Property 1 & 5 — public info exposes online_sessions_enabled derived from the
// tenant GoogleAccount (connected AND online_sessions), and never leaks tokens.
// ---------------------------------------------------------------------------
describe('online_sessions_enabled in public info', () => {
  async function callInfo(googleAccount: any) {
    mockResolveBranch.mockResolvedValue({ id: 'b1', name: 'Centro', tenant_id: 't1' });
    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: 't1',
      name: 'Negocio',
      subscription_status: 'inactive',
      subscription_expires_at: null,
    } as any);
    mockPrisma.service.findMany.mockResolvedValue([] as any);
    mockPrisma.googleAccount.findUnique.mockResolvedValue(googleAccount as any);

    const { publicController } = await import('../../controllers/public.controller');
    const req: any = { params: { code: 'ABC123' } };
    const res = makeRes();
    await publicController.info(req, res);
    return res;
  }

  it('is true when GoogleAccount is connected AND online_sessions is true', async () => {
    const res = await callInfo({
      tenant_id: 't1',
      status: 'connected',
      online_sessions: true,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.online_sessions_enabled).toBe(true);
    // Query is scoped to the branch tenant.
    const call = mockPrisma.googleAccount.findUnique.mock.calls[0][0] as any;
    expect(call.where).toEqual({ tenant_id: 't1' });
  });

  it('is false when there is no GoogleAccount (null)', async () => {
    const res = await callInfo(null);
    expect(res.body.data.online_sessions_enabled).toBe(false);
  });

  it('is false when the GoogleAccount status is revoked', async () => {
    const res = await callInfo({
      tenant_id: 't1',
      status: 'revoked',
      online_sessions: true,
    });
    expect(res.body.data.online_sessions_enabled).toBe(false);
  });

  it('is false when connected but online_sessions is false', async () => {
    const res = await callInfo({
      tenant_id: 't1',
      status: 'connected',
      online_sessions: false,
    });
    expect(res.body.data.online_sessions_enabled).toBe(false);
  });

  it('never leaks tokens or google_email in the public payload', async () => {
    const res = await callInfo({
      tenant_id: 't1',
      status: 'connected',
      online_sessions: true,
      access_token: 'SECRET_ACCESS',
      refresh_token: 'SECRET_REFRESH',
      google_email: 'owner@example.com',
    });
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('access_token');
    expect(json).not.toContain('refresh_token');
    expect(json).not.toContain('google_email');
    expect(json).not.toContain('SECRET_ACCESS');
    expect(json).not.toContain('SECRET_REFRESH');
    expect(json).not.toContain('owner@example.com');
    // Only the derived boolean is present.
    expect(res.body.data.online_sessions_enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Property 4 — branding/ads are tenant-scoped; validation on writes.
// ---------------------------------------------------------------------------
describe('Property 4: branding/ads tenant isolation + validation', () => {
  describe('updateAd / deleteAd on another tenant\'s ad -> 404 AD_NOT_FOUND', () => {
    it('updateAd throws AD_NOT_FOUND when the ad is not in the caller tenant', async () => {
      // findFirst scoped by {id, tenant_id} returns null for a foreign ad.
      mockPrisma.advertisement.findFirst.mockResolvedValue(null as any);

      await expect(
        brandingService.updateAd('t1', 'ad-of-other-tenant', { title: 'x' })
      ).rejects.toMatchObject({ statusCode: 404, code: 'AD_NOT_FOUND' });

      const call = mockPrisma.advertisement.findFirst.mock.calls[0][0] as any;
      expect(call.where).toEqual({ id: 'ad-of-other-tenant', tenant_id: 't1' });
      expect(mockPrisma.advertisement.update).not.toHaveBeenCalled();
    });

    it('deleteAd throws AD_NOT_FOUND when the ad is not in the caller tenant', async () => {
      mockPrisma.advertisement.findFirst.mockResolvedValue(null as any);

      await expect(
        brandingService.deleteAd('t1', 'ad-of-other-tenant')
      ).rejects.toMatchObject({ statusCode: 404, code: 'AD_NOT_FOUND' });

      expect(mockPrisma.advertisement.delete).not.toHaveBeenCalled();
    });
  });

  describe('brand_color validation', () => {
    it('accepts #RGB and #RRGGBB', () => {
      expect(validateBrandColor('#fff')).toBe('#fff');
      expect(validateBrandColor('#00AAff')).toBe('#00AAff');
    });

    it('clears on null/empty', () => {
      expect(validateBrandColor(null)).toBeNull();
      expect(validateBrandColor('')).toBeNull();
    });

    it('leaves undefined untouched', () => {
      expect(validateBrandColor(undefined)).toBeUndefined();
    });

    it('rejects invalid hex with 400 VALIDATION_ERROR', () => {
      expect(() => validateBrandColor('red')).toThrow(HttpError);
      try {
        validateBrandColor('#12g');
      } catch (e) {
        expect((e as HttpError).statusCode).toBe(400);
        expect((e as HttpError).code).toBe('VALIDATION_ERROR');
      }
    });

    it('updateBranding rejects an invalid color and never writes', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 't1' } as any);
      await expect(
        brandingService.updateBranding('t1', { brand_color: 'notacolor' })
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
      expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
    });
  });

  describe('createAd title required', () => {
    it('throws 400 VALIDATION_ERROR when title is missing/blank', async () => {
      await expect(
        brandingService.createAd('t1', { title: '   ' })
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
      expect(mockPrisma.advertisement.create).not.toHaveBeenCalled();
    });

    it('creates a tenant-scoped ad when title is provided', async () => {
      mockPrisma.advertisement.create.mockResolvedValue({
        id: 'ad1',
        title: 'Hola',
        body: null,
        image_url: null,
        link_url: null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      } as any);

      const ad = await brandingService.createAd('t1', { title: 'Hola' });
      expect(ad.title).toBe('Hola');
      const call = mockPrisma.advertisement.create.mock.calls[0][0] as any;
      expect(call.data.tenant_id).toBe('t1');
      expect(call.data.is_active).toBe(true);
    });
  });

  describe('getBranding tenant not found', () => {
    it('throws 404 TENANT_NOT_FOUND', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null as any);
      await expect(brandingService.getBranding('missing')).rejects.toMatchObject({
        statusCode: 404,
        code: 'TENANT_NOT_FOUND',
      });
    });
  });

  describe('listAds is tenant-scoped', () => {
    it('queries advertisements filtered by tenant_id', async () => {
      mockPrisma.advertisement.findMany.mockResolvedValue([] as any);
      await brandingService.listAds('t1');
      const call = mockPrisma.advertisement.findMany.mock.calls[0][0] as any;
      expect(call.where).toEqual({ tenant_id: 't1' });
    });
  });
});

// ---------------------------------------------------------------------------
// Property 4 (route wiring) — every me branding/ads route is ADMIN-only.
// ---------------------------------------------------------------------------
describe('Property 4: me branding/ads routes are guarded by requireAdmin', () => {
  it('wires requireAdmin into each branding/ads route middleware stack', async () => {
    const { meRoutes } = await import('../../routes/v1/me.routes');
    const { requireAdmin } = await import('../../middleware/requireAdmin');

    const layers = (
      meRoutes as unknown as {
        stack: Array<{
          route?: {
            path: string;
            stack: Array<{ handle: unknown }>;
          };
        }>;
      }
    ).stack.filter((l) => l.route);

    const brandingAdsPaths = ['/branding', '/ads', '/ads/:id'];
    const guarded = layers.filter((l) => brandingAdsPaths.includes(l.route!.path));

    // GET+PATCH /branding, GET+POST /ads, PATCH+DELETE /ads/:id = 6 routes.
    expect(guarded).toHaveLength(6);
    for (const layer of guarded) {
      const handles = layer.route!.stack.map((s) => s.handle);
      expect(handles).toContain(requireAdmin);
    }
  });
});
