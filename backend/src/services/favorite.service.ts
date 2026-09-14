import { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';

/** Codigo de error de Prisma para violacion de restriccion unica. */
const PRISMA_UNIQUE_VIOLATION = 'P2002';

/**
 * Indica si el error es una violacion de restriccion unica de Prisma (P2002).
 * Se usa para tratar una carrera en `toggle` (dos creates simultaneos sobre el
 * mismo par usuario-tenant) como "ya favorito" en lugar de romper.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === PRISMA_UNIQUE_VIOLATION
  );
}

/**
 * Vista publica de un negocio favorito para el cliente. `code` es el
 * booking_code de la sucursal PRINCIPAL del negocio (la mas antigua con code),
 * necesario para poder reservar; null si la principal aun no tiene code.
 */
export interface FavoriteView {
  tenant_id: string;
  business_name: string;
  code: string | null;
}

/**
 * Servicio de favoritos del CLIENTE. Todas las operaciones estan estrictamente
 * acotadas por `userId`: un usuario nunca lee ni muta favoritos de otro
 * (Property 8: aislamiento por cliente). El par (user_id, tenant_id) es unico,
 * por lo que `toggle` alterna una unica fila sin duplicar (Property 7).
 */
export const favoriteService = {
  /**
   * Marca/desmarca un negocio como favorito para el usuario. Idempotente por
   * par (Property 7): si ya existe la fila la borra ({ favorited: false }); si
   * no existe la crea ({ favorited: true }).
   *
   * Valida primero que el tenant exista (404 TENANT_NOT_FOUND) para no crear
   * favoritos hacia negocios inexistentes (Req 4.4). Ante una carrera en el
   * create (P2002), se trata como ya favorito y se devuelve { favorited: true }.
   */
  async toggle(userId: string, tenantId: string): Promise<{ favorited: boolean }> {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) {
      throw new HttpError('Negocio no encontrado', 404, 'TENANT_NOT_FOUND');
    }

    const existing = await prisma.favorite.findUnique({
      where: { user_id_tenant_id: { user_id: userId, tenant_id: tenantId } },
    });

    if (existing) {
      await prisma.favorite.delete({ where: { id: existing.id } });
      return { favorited: false };
    }

    try {
      await prisma.favorite.create({
        data: { user_id: userId, tenant_id: tenantId },
      });
      return { favorited: true };
    } catch (error) {
      // Carrera: otra peticion creo el favorito entre el findUnique y el create.
      // Es idempotente por par, asi que se trata como ya favorito.
      if (isUniqueViolation(error)) {
        return { favorited: true };
      }
      throw error;
    }
  },

  /**
   * Lista los negocios favoritos del usuario (solo los suyos, Property 8),
   * ordenados por created_at desc. Para cada favorito resuelve el nombre del
   * negocio y el booking_code de su sucursal PRINCIPAL (la mas antigua por
   * created_at con code), necesario para reservar.
   *
   * Resuelve en lote para evitar N+1: una query de tenants y una de sucursales.
   */
  async list(userId: string): Promise<FavoriteView[]> {
    const favorites = await prisma.favorite.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
    });

    if (favorites.length === 0) {
      return [];
    }

    const tenantIds = favorites.map((f) => f.tenant_id);

    // Nombres de los negocios en lote.
    const tenants = await prisma.tenant.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true, name: true },
    });
    const nameByTenant = new Map<string, string>();
    for (const t of tenants) {
      nameByTenant.set(t.id, t.name);
    }

    // Sucursales de los negocios, ordenadas por created_at asc: la PRIMERA con
    // booking_code por tenant es la principal reservable. Se recorren en orden
    // y se guarda solo la primera aparicion por tenant.
    const branches = await prisma.branch.findMany({
      where: { tenant_id: { in: tenantIds } },
      orderBy: { created_at: 'asc' },
      select: { tenant_id: true, booking_code: true },
    });
    const codeByTenant = new Map<string, string | null>();
    for (const b of branches) {
      if (codeByTenant.has(b.tenant_id)) continue;
      if (b.booking_code) {
        codeByTenant.set(b.tenant_id, b.booking_code);
      }
    }

    return favorites.map((f) => ({
      tenant_id: f.tenant_id,
      business_name: nameByTenant.get(f.tenant_id) ?? '',
      code: codeByTenant.get(f.tenant_id) ?? null,
    }));
  },
};
