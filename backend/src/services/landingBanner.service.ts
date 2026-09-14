import { AuditAction } from '@prisma/client';
import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';
import { writeAudit } from '../utils/audit';

/**
 * Servicio de gestion de BANNERS DEL LANDING (carrusel del portal publico).
 *
 * Los banners son destacados globales de la plataforma que administra SOLO el
 * super admin (SUPERADMIN). No estan asociados a ningun tenant. La autorizacion
 * SUPERADMIN se aplica en el middleware de rutas, no aqui.
 *
 * Sigue el patron de branding.service: validacion de titulo requerido (400
 * VALIDATION_ERROR), normalizacion de opcionales (empty -> null) y 404
 * BANNER_NOT_FOUND cuando el recurso no existe.
 */

export interface LandingBannerView {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  link_url: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface PublicLandingBanner {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  link_url: string | null;
}

export interface CreateLandingBannerInput {
  title: string;
  subtitle?: string | null;
  image_url?: string | null;
  link_url?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export interface UpdateLandingBannerInput {
  title?: string;
  subtitle?: string | null;
  image_url?: string | null;
  link_url?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

/** Normaliza un campo opcional de texto/url: string vacio se limpia a null. */
function normalizeOptional(
  raw: string | null | undefined
): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toView(banner: {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  link_url: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}): LandingBannerView {
  return {
    id: banner.id,
    title: banner.title,
    subtitle: banner.subtitle ?? null,
    image_url: banner.image_url ?? null,
    link_url: banner.link_url ?? null,
    sort_order: banner.sort_order,
    is_active: banner.is_active,
    created_at: banner.created_at,
    updated_at: banner.updated_at,
  };
}

export const landingBannerService = {
  /**
   * Lista TODOS los banners para el super admin, ordenados por sort_order asc
   * y luego created_at asc (orden estable del carrusel).
   */
  async list(): Promise<LandingBannerView[]> {
    const banners = await prisma.landingBanner.findMany({
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
    });
    return banners.map(toView);
  },

  /**
   * Lista solo los banners ACTIVOS para el landing publico, ordenados por
   * sort_order asc y created_at asc. Devuelve un shape publico reducido
   * (sin timestamps, sort_order ni is_active).
   */
  async listActivePublic(): Promise<PublicLandingBanner[]> {
    const banners = await prisma.landingBanner.findMany({
      where: { is_active: true },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
      select: {
        id: true,
        title: true,
        subtitle: true,
        image_url: true,
        link_url: true,
      },
    });
    return banners.map((b) => ({
      id: b.id,
      title: b.title,
      subtitle: b.subtitle ?? null,
      image_url: b.image_url ?? null,
      link_url: b.link_url ?? null,
    }));
  },

  /**
   * Crea un banner. `title` es requerido (400 VALIDATION_ERROR si queda vacio
   * tras trim). Los opcionales se normalizan (empty -> null); sort_order por
   * defecto 0 e is_active por defecto true.
   */
  async create(data: CreateLandingBannerInput): Promise<LandingBannerView> {
    const title =
      data.title === undefined || data.title === null
        ? ''
        : String(data.title).trim();

    if (title.length === 0) {
      throw new HttpError('title is required', 400, 'VALIDATION_ERROR');
    }

    const banner = await prisma.landingBanner.create({
      data: {
        title,
        subtitle: normalizeOptional(data.subtitle) ?? null,
        image_url: normalizeOptional(data.image_url) ?? null,
        link_url: normalizeOptional(data.link_url) ?? null,
        sort_order:
          data.sort_order === undefined ? 0 : Number(data.sort_order),
        is_active: data.is_active === undefined ? true : Boolean(data.is_active),
      },
    });

    // Auditoria best-effort. Los banners son globales -> tenant 'system'.
    await writeAudit({
      tenant_id: 'system',
      action: AuditAction.CREATE,
      resource_type: 'landing_banner',
      resource_id: banner.id,
      details: JSON.stringify({ title: banner.title }),
    });

    return toView(banner);
  },

  /**
   * Actualiza un banner. 404 BANNER_NOT_FOUND si no existe. Solo se tocan los
   * campos provistos; un title provisto pero vacio se rechaza (400).
   */
  async update(
    id: string,
    data: UpdateLandingBannerInput
  ): Promise<LandingBannerView> {
    const existing = await prisma.landingBanner.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new HttpError('Banner not found', 404, 'BANNER_NOT_FOUND');
    }

    const updateData: {
      title?: string;
      subtitle?: string | null;
      image_url?: string | null;
      link_url?: string | null;
      sort_order?: number;
      is_active?: boolean;
    } = {};

    if (data.title !== undefined) {
      const title = data.title === null ? '' : String(data.title).trim();
      if (title.length === 0) {
        throw new HttpError('title is required', 400, 'VALIDATION_ERROR');
      }
      updateData.title = title;
    }
    if (data.subtitle !== undefined) {
      updateData.subtitle = normalizeOptional(data.subtitle) ?? null;
    }
    if (data.image_url !== undefined) {
      updateData.image_url = normalizeOptional(data.image_url) ?? null;
    }
    if (data.link_url !== undefined) {
      updateData.link_url = normalizeOptional(data.link_url) ?? null;
    }
    if (data.sort_order !== undefined) {
      updateData.sort_order = Number(data.sort_order);
    }
    if (data.is_active !== undefined) {
      updateData.is_active = Boolean(data.is_active);
    }

    const updated = await prisma.landingBanner.update({
      where: { id },
      data: updateData,
    });

    // Auditoria best-effort.
    await writeAudit({
      tenant_id: 'system',
      action: AuditAction.UPDATE,
      resource_type: 'landing_banner',
      resource_id: updated.id,
      details: JSON.stringify(updateData),
    });

    return toView(updated);
  },

  /**
   * Elimina un banner. 404 BANNER_NOT_FOUND si no existe.
   */
  async remove(id: string): Promise<void> {
    const existing = await prisma.landingBanner.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new HttpError('Banner not found', 404, 'BANNER_NOT_FOUND');
    }

    await prisma.landingBanner.delete({ where: { id } });

    // Auditoria best-effort.
    await writeAudit({
      tenant_id: 'system',
      action: AuditAction.DELETE,
      resource_type: 'landing_banner',
      resource_id: id,
    });
  },
};
