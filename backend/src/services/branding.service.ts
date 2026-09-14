import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';

/**
 * Branding + ads service for the entrepreneur (Requirements 3.1–3.5, 5.x, 6.2).
 *
 * Holds the tenant-level PREMIUM personalization: branding fields on the Tenant
 * (logo, brand color, promotional banner) and the entrepreneur's own
 * advertisements (Advertisement model, table `ads`). Everything here is scoped
 * to a single tenant_id — a caller can only read/update THEIR OWN tenant's
 * branding and ads (Property 4: aislamiento por tenant + solo ADMIN).
 *
 * NOTE: this service stores/reads the data unconditionally. Whether the data
 * actually surfaces in the public portal is gated by premium status at the
 * public endpoint (see isPremiumEffective + public.controller.info()).
 */

export interface BrandingView {
  logo_url: string | null;
  brand_color: string | null;
  banner_title: string | null;
  banner_text: string | null;
  banner_link: string | null;
}

export interface UpdateBrandingInput {
  logo_url?: string | null;
  brand_color?: string | null;
  banner_title?: string | null;
  banner_text?: string | null;
  banner_link?: string | null;
}

export interface AdView {
  id: string;
  title: string;
  body: string | null;
  image_url: string | null;
  link_url: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateAdInput {
  title: string;
  body?: string | null;
  image_url?: string | null;
  link_url?: string | null;
  is_active?: boolean;
}

export interface UpdateAdInput {
  title?: string;
  body?: string | null;
  image_url?: string | null;
  link_url?: string | null;
  is_active?: boolean;
}

// Accepts #RGB or #RRGGBB (case-insensitive hex).
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Validates an optional brand color. Returns the cleaned value to persist:
 *  - `null` when clearing (null / empty string).
 *  - otherwise the trimmed hex string.
 * An invalid non-empty color throws 400 VALIDATION_ERROR (Requirement 3.1).
 */
export function validateBrandColor(
  raw: string | null | undefined
): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;

  const trimmed = String(raw).trim();
  if (trimmed.length === 0) return null;

  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    throw new HttpError(
      'brand_color must be a valid hex color (#RGB or #RRGGBB)',
      400,
      'VALIDATION_ERROR'
    );
  }

  return trimmed;
}

/** Normalizes an optional url/text field: empty string clears to null. */
function normalizeOptional(
  raw: string | null | undefined
): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toBrandingView(tenant: {
  logo_url: string | null;
  brand_color: string | null;
  banner_title: string | null;
  banner_text: string | null;
  banner_link: string | null;
}): BrandingView {
  return {
    logo_url: tenant.logo_url ?? null,
    brand_color: tenant.brand_color ?? null,
    banner_title: tenant.banner_title ?? null,
    banner_text: tenant.banner_text ?? null,
    banner_link: tenant.banner_link ?? null,
  };
}

function toAdView(ad: {
  id: string;
  title: string;
  body: string | null;
  image_url: string | null;
  link_url: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}): AdView {
  return {
    id: ad.id,
    title: ad.title,
    body: ad.body ?? null,
    image_url: ad.image_url ?? null,
    link_url: ad.link_url ?? null,
    is_active: ad.is_active,
    created_at: ad.created_at,
    updated_at: ad.updated_at,
  };
}

const BRANDING_SELECT = {
  logo_url: true,
  brand_color: true,
  banner_title: true,
  banner_text: true,
  banner_link: true,
} as const;

export const brandingService = {
  /**
   * Returns the branding fields for the given tenant. Tenant-scoped.
   * Missing tenant -> 404 TENANT_NOT_FOUND.
   */
  async getBranding(tenantId: string): Promise<BrandingView> {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: BRANDING_SELECT,
    });

    if (!tenant) {
      throw new HttpError('Tenant not found', 404, 'TENANT_NOT_FOUND');
    }

    return toBrandingView(tenant);
  },

  /**
   * Updates the provided branding fields on the tenant. Only supplied fields
   * are touched. brand_color is validated (hex); urls/text are normalized
   * (empty -> null). Tenant-scoped. Missing tenant -> 404 TENANT_NOT_FOUND.
   */
  async updateBranding(
    tenantId: string,
    data: UpdateBrandingInput
  ): Promise<BrandingView> {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) {
      throw new HttpError('Tenant not found', 404, 'TENANT_NOT_FOUND');
    }

    const updateData: UpdateBrandingInput = {};

    if (data.brand_color !== undefined) {
      updateData.brand_color = validateBrandColor(data.brand_color);
    }
    if (data.logo_url !== undefined) {
      updateData.logo_url = normalizeOptional(data.logo_url);
    }
    if (data.banner_title !== undefined) {
      updateData.banner_title = normalizeOptional(data.banner_title);
    }
    if (data.banner_text !== undefined) {
      updateData.banner_text = normalizeOptional(data.banner_text);
    }
    if (data.banner_link !== undefined) {
      updateData.banner_link = normalizeOptional(data.banner_link);
    }

    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: updateData,
      select: BRANDING_SELECT,
    });

    return toBrandingView(updated);
  },

  /**
   * Lists the ads owned by the given tenant, newest first. Tenant-scoped.
   */
  async listAds(tenantId: string): Promise<AdView[]> {
    const ads = await prisma.advertisement.findMany({
      where: { tenant_id: tenantId },
      orderBy: { created_at: 'desc' },
    });
    return ads.map(toAdView);
  },

  /**
   * Creates an ad for the given tenant. `title` is required (400
   * VALIDATION_ERROR otherwise). Tenant-scoped.
   */
  async createAd(tenantId: string, data: CreateAdInput): Promise<AdView> {
    const title = data.title === undefined || data.title === null
      ? ''
      : String(data.title).trim();

    if (title.length === 0) {
      throw new HttpError('title is required', 400, 'VALIDATION_ERROR');
    }

    const ad = await prisma.advertisement.create({
      data: {
        tenant_id: tenantId,
        title,
        body: normalizeOptional(data.body) ?? null,
        image_url: normalizeOptional(data.image_url) ?? null,
        link_url: normalizeOptional(data.link_url) ?? null,
        is_active: data.is_active === undefined ? true : Boolean(data.is_active),
      },
    });

    return toAdView(ad);
  },

  /**
   * Updates an ad, scoped to the tenant. The ad must belong to the tenant
   * (findFirst scoped) else 404 AD_NOT_FOUND (Property 4: aislamiento). Only
   * supplied fields are touched; a supplied empty title is rejected (400).
   */
  async updateAd(
    tenantId: string,
    id: string,
    data: UpdateAdInput
  ): Promise<AdView> {
    const existing = await prisma.advertisement.findFirst({
      where: { id, tenant_id: tenantId },
      select: { id: true },
    });
    if (!existing) {
      throw new HttpError('Ad not found', 404, 'AD_NOT_FOUND');
    }

    const updateData: {
      title?: string;
      body?: string | null;
      image_url?: string | null;
      link_url?: string | null;
      is_active?: boolean;
    } = {};

    if (data.title !== undefined) {
      const title = data.title === null ? '' : String(data.title).trim();
      if (title.length === 0) {
        throw new HttpError('title is required', 400, 'VALIDATION_ERROR');
      }
      updateData.title = title;
    }
    if (data.body !== undefined) {
      updateData.body = normalizeOptional(data.body) ?? null;
    }
    if (data.image_url !== undefined) {
      updateData.image_url = normalizeOptional(data.image_url) ?? null;
    }
    if (data.link_url !== undefined) {
      updateData.link_url = normalizeOptional(data.link_url) ?? null;
    }
    if (data.is_active !== undefined) {
      updateData.is_active = Boolean(data.is_active);
    }

    const updated = await prisma.advertisement.update({
      where: { id },
      data: updateData,
    });

    return toAdView(updated);
  },

  /**
   * Deletes an ad, scoped to the tenant. The ad must belong to the tenant
   * else 404 AD_NOT_FOUND (Property 4).
   */
  async deleteAd(tenantId: string, id: string): Promise<void> {
    const existing = await prisma.advertisement.findFirst({
      where: { id, tenant_id: tenantId },
      select: { id: true },
    });
    if (!existing) {
      throw new HttpError('Ad not found', 404, 'AD_NOT_FOUND');
    }

    await prisma.advertisement.delete({ where: { id } });
  },

  /**
   * Lists only the ACTIVE ads for a tenant, shaped for the public portal
   * (no timestamps / is_active). Used by the public info endpoint when the
   * tenant is premium effective.
   */
  async listActiveAdsPublic(
    tenantId: string
  ): Promise<Array<{ id: string; title: string; body: string | null; image_url: string | null; link_url: string | null }>> {
    const ads = await prisma.advertisement.findMany({
      where: { tenant_id: tenantId, is_active: true },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        title: true,
        body: true,
        image_url: true,
        link_url: true,
      },
    });
    return ads.map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body ?? null,
      image_url: a.image_url ?? null,
      link_url: a.link_url ?? null,
    }));
  },
};

/**
 * Local, dependency-free premium helper (matches subscription.service's
 * isPremiumEffective). A tenant is premium effective when its subscription is
 * active AND not expired (no expiry OR expiry in the future). An `active` state
 * with a past expiry is NOT premium (Requirement 2.3).
 *
 * Defined here to avoid a hard cross-module dependency with the parallel
 * subscription task; the logic is intentionally identical.
 */
export function isPremiumEffective(
  tenant: {
    subscription_status?: string | null;
    subscription_expires_at?: Date | string | null;
  } | null | undefined,
  now: Date = new Date()
): boolean {
  if (!tenant) return false;
  if (tenant.subscription_status !== 'active') return false;

  const expires = tenant.subscription_expires_at;
  if (expires === null || expires === undefined) return true;

  const expiresAt = expires instanceof Date ? expires : new Date(expires);
  if (Number.isNaN(expiresAt.getTime())) return false;

  return expiresAt.getTime() > now.getTime();
}
