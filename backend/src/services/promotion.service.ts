import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';

/**
 * Servicio de promociones informativas por sucursal (Requirements 1.x, 3.x).
 *
 * Sigue el patron de branding.service: CRUD scoped por tenant, HttpError y un
 * mapper `toPromotionView`. Cada promocion pertenece a una sucursal
 * (branch_id) de un tenant (tenant_id) y toda operacion esta acotada a ambos
 * (Property 4: aislamiento por tenant/sucursal).
 *
 * IMPORTANTE: la validacion de pertenencia de la sucursal se hace con una
 * consulta directa (`assertBranchOwned`) y NO via branchService.get, para
 * evitar su gating premium de sucursal en negocios free (que lanzaria 403
 * sobre sucursales que no son la principal). El gating premium del MODULO de
 * promociones se aplica en la ruta (requirePremium), no aqui.
 */

export interface PromotionView {
  id: string;
  branch_id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  starts_at: Date | string | null;
  ends_at: Date | string | null;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface CreatePromotionInput {
  title: string;
  description?: string | null;
  image_url?: string | null;
  starts_at?: Date | string | null;
  ends_at?: Date | string | null;
  is_active?: boolean;
}

export interface UpdatePromotionInput {
  title?: string;
  description?: string | null;
  image_url?: string | null;
  starts_at?: Date | string | null;
  ends_at?: Date | string | null;
  is_active?: boolean;
}

/**
 * Mapea un registro Promotion de Prisma a la vista publica del servicio. Las
 * fechas se dejan tal cual del registro (Date); el controlador se encarga de
 * la serializacion (ISO).
 */
function toPromotionView(promo: {
  id: string;
  branch_id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  starts_at: Date | string | null;
  ends_at: Date | string | null;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}): PromotionView {
  return {
    id: promo.id,
    branch_id: promo.branch_id,
    title: promo.title,
    description: promo.description ?? null,
    image_url: promo.image_url ?? null,
    starts_at: promo.starts_at ?? null,
    ends_at: promo.ends_at ?? null,
    is_active: promo.is_active,
    created_at: promo.created_at,
    updated_at: promo.updated_at,
  };
}

/**
 * Verifica que la sucursal `branchId` pertenece al tenant `tenantId`. Consulta
 * directa (sin gating premium) para no chocar con branchService.get. Si la
 * sucursal no existe o es de otro tenant -> 404 BRANCH_NOT_FOUND (Property 4).
 */
async function assertBranchOwned(tenantId: string, branchId: string): Promise<void> {
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, tenant_id: tenantId },
    select: { id: true },
  });
  if (!branch) {
    throw new HttpError('Branch not found', 404, 'BRANCH_NOT_FOUND');
  }
}

/**
 * Normaliza un valor de fecha entrante a Date | null. `undefined` se mantiene
 * (el llamador decide si toca el campo). Cadenas/Date se convierten a Date.
 */
function normalizeDate(
  raw: Date | string | null | undefined
): Date | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  return raw instanceof Date ? raw : new Date(raw);
}

/**
 * Valida el rango de fechas: si ambos limites estan presentes (no null) y
 * ends_at < starts_at, lanza 400 VALIDATION_ERROR (Property 3). Limites nulos
 * no restringen ese lado.
 */
function assertDateRange(
  startsAt: Date | null | undefined,
  endsAt: Date | null | undefined
): void {
  if (startsAt != null && endsAt != null) {
    if (endsAt.getTime() < startsAt.getTime()) {
      throw new HttpError(
        'La fecha de fin no puede ser anterior a la de inicio',
        400,
        'VALIDATION_ERROR'
      );
    }
  }
}

// Filtro de vigencia compartido: is_active true y ahora dentro de
// [starts_at, ends_at] (limites nulos no restringen). Property 1.
function vigenciaWhere(now: Date) {
  return {
    is_active: true,
    AND: [
      { OR: [{ starts_at: null }, { starts_at: { lte: now } }] },
      { OR: [{ ends_at: null }, { ends_at: { gte: now } }] },
    ],
  };
}

export const promotionService = {
  /**
   * Lista las promociones de una sucursal propia, mas recientes primero.
   * Valida pertenencia (404 si ajena). Requirement 1.1.
   */
  async list(tenantId: string, branchId: string): Promise<PromotionView[]> {
    await assertBranchOwned(tenantId, branchId);

    const promos = await prisma.promotion.findMany({
      where: { tenant_id: tenantId, branch_id: branchId },
      orderBy: { created_at: 'desc' },
    });

    return promos.map(toPromotionView);
  },

  /**
   * Crea una promocion en una sucursal propia. Valida pertenencia (404),
   * title requerido (400) y rango de fechas (400). Requirements 1.2, 1.3, 1.4.
   */
  async create(
    tenantId: string,
    branchId: string,
    input: CreatePromotionInput
  ): Promise<PromotionView> {
    await assertBranchOwned(tenantId, branchId);

    const title =
      input.title === undefined || input.title === null
        ? ''
        : String(input.title).trim();
    if (title.length === 0) {
      throw new HttpError('El titulo es obligatorio', 400, 'VALIDATION_ERROR');
    }

    const startsAt = normalizeDate(input.starts_at) ?? null;
    const endsAt = normalizeDate(input.ends_at) ?? null;
    assertDateRange(startsAt, endsAt);

    const promo = await prisma.promotion.create({
      data: {
        tenant_id: tenantId,
        branch_id: branchId,
        title,
        description: input.description ?? null,
        image_url: input.image_url ?? null,
        starts_at: startsAt,
        ends_at: endsAt,
        is_active: input.is_active === undefined ? true : Boolean(input.is_active),
      },
    });

    return toPromotionView(promo);
  },

  /**
   * Actualiza una promocion propia. Valida pertenencia de la sucursal (404
   * BRANCH_NOT_FOUND) y de la promo (404 PROMOTION_NOT_FOUND). Solo toca los
   * campos provistos (undefined no toca; null limpia description/image/fechas).
   * El rango de fechas se valida con los valores EFECTIVOS (entrante o
   * existente). Requirements 1.3, 1.4, 1.5.
   */
  async update(
    tenantId: string,
    branchId: string,
    promoId: string,
    input: UpdatePromotionInput
  ): Promise<PromotionView> {
    await assertBranchOwned(tenantId, branchId);

    const existing = await prisma.promotion.findFirst({
      where: { id: promoId, tenant_id: tenantId, branch_id: branchId },
    });
    if (!existing) {
      throw new HttpError('Promotion not found', 404, 'PROMOTION_NOT_FOUND');
    }

    const data: {
      title?: string;
      description?: string | null;
      image_url?: string | null;
      starts_at?: Date | null;
      ends_at?: Date | null;
      is_active?: boolean;
    } = {};

    if (input.title !== undefined) {
      const title = input.title === null ? '' : String(input.title).trim();
      if (title.length === 0) {
        throw new HttpError('El titulo es obligatorio', 400, 'VALIDATION_ERROR');
      }
      data.title = title;
    }
    if (input.description !== undefined) {
      data.description = input.description ?? null;
    }
    if (input.image_url !== undefined) {
      data.image_url = input.image_url ?? null;
    }

    const startsProvided = input.starts_at !== undefined;
    const endsProvided = input.ends_at !== undefined;
    const effectiveStarts = startsProvided
      ? normalizeDate(input.starts_at) ?? null
      : normalizeDate(existing.starts_at) ?? null;
    const effectiveEnds = endsProvided
      ? normalizeDate(input.ends_at) ?? null
      : normalizeDate(existing.ends_at) ?? null;

    // Valida el rango con los valores efectivos (entrante o existente).
    assertDateRange(effectiveStarts, effectiveEnds);

    if (startsProvided) {
      data.starts_at = normalizeDate(input.starts_at) ?? null;
    }
    if (endsProvided) {
      data.ends_at = normalizeDate(input.ends_at) ?? null;
    }
    if (input.is_active !== undefined) {
      data.is_active = Boolean(input.is_active);
    }

    const updated = await prisma.promotion.update({
      where: { id: promoId },
      data,
    });

    return toPromotionView(updated);
  },

  /**
   * Elimina una promocion propia. Valida pertenencia de la sucursal y de la
   * promo (404 si ajena/inexistente). Devuelve el id borrado. Requirement 1.5.
   */
  async remove(
    tenantId: string,
    branchId: string,
    promoId: string
  ): Promise<{ id: string }> {
    await assertBranchOwned(tenantId, branchId);

    const existing = await prisma.promotion.findFirst({
      where: { id: promoId, tenant_id: tenantId, branch_id: branchId },
      select: { id: true },
    });
    if (!existing) {
      throw new HttpError('Promotion not found', 404, 'PROMOTION_NOT_FOUND');
    }

    await prisma.promotion.delete({ where: { id: promoId } });

    return { id: promoId };
  },

  /**
   * Lista las promociones VIGENTES de una sucursal para el cliente (portal
   * publico): is_active true y ahora dentro de [starts_at, ends_at] (limites
   * nulos no restringen). Mas recientes primero. El filtro es en query (no se
   * re-filtra en memoria). Requirements 3.1, 3.3, Property 1.
   */
  async listActivePublic(
    branchId: string,
    now: Date = new Date()
  ): Promise<PromotionView[]> {
    const promos = await prisma.promotion.findMany({
      where: { branch_id: branchId, ...vigenciaWhere(now) },
      orderBy: { created_at: 'desc' },
    });

    return promos.map(toPromotionView);
  },

  /**
   * Devuelve las promociones vigentes de varias sucursales en lote (para
   * discover), agrupadas por branch_id. Si `branchIds` esta vacio, devuelve un
   * Map vacio sin consultar. Mismo filtro de vigencia que listActivePublic.
   */
  async activeForBranches(
    branchIds: string[],
    now: Date = new Date()
  ): Promise<Map<string, PromotionView[]>> {
    const result = new Map<string, PromotionView[]>();
    if (branchIds.length === 0) {
      return result;
    }

    const promos = await prisma.promotion.findMany({
      where: { branch_id: { in: branchIds }, ...vigenciaWhere(now) },
      orderBy: { created_at: 'desc' },
    });

    for (const promo of promos) {
      const view = toPromotionView(promo);
      const bucket = result.get(view.branch_id);
      if (bucket) {
        bucket.push(view);
      } else {
        result.set(view.branch_id, [view]);
      }
    }

    return result;
  },
};
