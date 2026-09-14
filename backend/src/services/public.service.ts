import { Branch, Tenant } from '@prisma/client';
import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';
import { normalizeBookingCode } from '../utils/bookingCode';
import { getPrimaryBranchId, isTenantPremium } from './branch.service';
import { isPremiumEffective } from './subscription.service';

/**
 * Resultado de busqueda de sucursales para el panel publico del cliente.
 * Solo expone datos NO sensibles: nunca incluye clientes ni citas.
 */
export interface BranchSearchResult {
  code: string;
  branch_name: string;
  business_name: string;
}

/** Numero minimo de caracteres para ejecutar una busqueda (evita listar todo). */
const MIN_SEARCH_LENGTH = 2;

/** Limite de resultados de busqueda de sucursales. */
const SEARCH_LIMIT = 20;

/**
 * Servicio para la resolucion publica de negocios por su codigo de reserva.
 *
 * La resolucion es case-insensitive: el codigo se normaliza a mayusculas
 * (ver `normalizeBookingCode`) antes de consultar `Tenant.booking_code`,
 * que se almacena siempre en mayusculas.
 */
export const publicService = {
  /**
   * Resuelve un tenant a partir de su codigo de reserva.
   *
   * - Normaliza el codigo (trim + mayusculas) para busqueda case-insensitive.
   * - Busca `prisma.tenant.findUnique({ where: { booking_code } })`.
   * - Si el codigo no corresponde a ningun tenant, o el negocio tiene
   *   `booking_enabled === false`, lanza `HttpError` 404 `INVALID_CODE`.
   *
   * @param code Codigo de reserva ingresado por el cliente (cualquier caja).
   * @returns El tenant duenio del codigo.
   * @throws HttpError 404 INVALID_CODE cuando el codigo es invalido o el negocio esta deshabilitado.
   */
  async resolveTenantByCode(code: string): Promise<Tenant> {
    const normalized = code ? normalizeBookingCode(code) : '';

    if (!normalized) {
      throw new HttpError('Codigo de negocio invalido', 404, 'INVALID_CODE');
    }

    const tenant = await prisma.tenant.findUnique({
      where: { booking_code: normalized },
    });

    if (!tenant || tenant.booking_enabled === false) {
      throw new HttpError('Codigo de negocio invalido', 404, 'INVALID_CODE');
    }

    return tenant;
  },

  /**
   * Resuelve una sucursal (Branch) a partir de su codigo de acceso.
   *
   * - Normaliza el codigo (trim + mayusculas) para busqueda case-insensitive.
   * - Busca `prisma.branch.findUnique({ where: { booking_code } })`.
   * - Si el codigo no corresponde a ninguna sucursal, o la sucursal no esta
   *   activa (`status !== 'active'`), lanza `HttpError` 404 `INVALID_CODE`.
   * - Un codigo vacio/invalido lanza 404 sin consultar la base.
   * - Gating premium (Requirements 3.1, 3.2, 3.3): si el tenant es FREE y la
   *   sucursal NO es su PRINCIPAL (extra oculta), lanza el MISMO 404
   *   `INVALID_CODE` que un codigo invalido, para NO revelar que la sucursal
   *   existe. La principal de un free y cualquier sucursal de un premium
   *   resuelven normal.
   *
   * @param code Codigo de sucursal ingresado por el cliente (cualquier caja).
   * @returns La sucursal activa duenia del codigo.
   * @throws HttpError 404 INVALID_CODE cuando el codigo es invalido, la sucursal esta inactiva o es una extra oculta de un free.
   */
  async resolveBranchByCode(code: string): Promise<Branch> {
    const normalized = code ? normalizeBookingCode(code) : '';

    if (!normalized) {
      throw new HttpError('Codigo de sucursal invalido', 404, 'INVALID_CODE');
    }

    const branch = await prisma.branch.findUnique({
      where: { booking_code: normalized },
    });

    if (!branch || branch.status !== 'active') {
      throw new HttpError('Codigo de sucursal invalido', 404, 'INVALID_CODE');
    }

    // Gating premium: en un tenant FREE solo se expone la sucursal principal.
    // Una sucursal extra se oculta con el mismo 404 que un codigo invalido
    // (no se revela su existencia). El premium resuelve todas sus sucursales.
    const premium = await isTenantPremium(branch.tenant_id);
    if (!premium) {
      const primaryId = await getPrimaryBranchId(branch.tenant_id);
      if (branch.id !== primaryId) {
        throw new HttpError('Codigo de sucursal invalido', 404, 'INVALID_CODE');
      }
    }

    return branch;
  },

  /**
   * Busqueda basica de sucursales activas para el panel publico del cliente.
   *
   * - Busca sucursales ACTIVAS cuyo `name` contenga `q` O cuyo negocio
   *   (`tenant.name`) contenga `q` (case-insensitive, contains).
   * - Si `q` esta vacio o es demasiado corto (< 2 chars), devuelve `[]`
   *   para evitar listar todo el catalogo.
   * - Limita a `SEARCH_LIMIT` (~20) resultados.
   * - Devuelve SOLO datos no sensibles: `{ code, branch_name, business_name }`.
   *   Nunca expone clientes ni citas.
   * - Gating premium (Requirement 3.4): excluye las sucursales EXTRA de tenants
   *   FREE. Solo se listan todas las de premium mas la PRINCIPAL de cada free.
   *   Para no consultar por fila: el premium se deriva de los campos del tenant
   *   ya traidos (`isPremiumEffective`) y las principales de los free presentes
   *   se resuelven en un unico findMany en lote.
   *
   * @param q Texto de busqueda (nombre de sucursal o de negocio).
   * @returns Lista de resultados no sensibles (posiblemente vacia).
   */
  async searchBranches(q: string): Promise<BranchSearchResult[]> {
    const term = (q ?? '').trim();

    if (term.length < MIN_SEARCH_LENGTH) {
      return [];
    }

    const branches = await prisma.branch.findMany({
      where: {
        status: 'active',
        OR: [
          { name: { contains: term } },
          { tenant: { is: { name: { contains: term } } } },
        ],
      },
      select: {
        id: true,
        booking_code: true,
        name: true,
        tenant_id: true,
        tenant: {
          select: {
            name: true,
            subscription_status: true,
            subscription_expires_at: true,
          },
        },
      },
      take: SEARCH_LIMIT,
      orderBy: { name: 'asc' },
    });

    // Deriva el premium efectivo de cada tenant sin query extra por fila,
    // reutilizando los campos de suscripcion ya incluidos en el select.
    const isRowPremium = (b: (typeof branches)[number]): boolean =>
      isPremiumEffective({
        subscription_status: b.tenant.subscription_status,
        subscription_expires_at: b.tenant.subscription_expires_at,
      });

    // Tenants FREE presentes en los resultados: solo para ellos hay que saber
    // cual es su sucursal principal (para conservarla y excluir las extra).
    const freeTenantIds = Array.from(
      new Set(branches.filter((b) => !isRowPremium(b)).map((b) => b.tenant_id))
    );

    // Resuelve la principal (menor created_at) de cada free en un solo lote.
    const primaryByTenant = new Map<string, string>();
    if (freeTenantIds.length > 0) {
      const candidates = await prisma.branch.findMany({
        where: { tenant_id: { in: freeTenantIds } },
        orderBy: { created_at: 'asc' },
        select: { id: true, tenant_id: true },
      });
      // Como vienen ordenadas por created_at asc, la PRIMERA de cada tenant es
      // su principal; las siguientes se ignoran.
      for (const c of candidates) {
        if (!primaryByTenant.has(c.tenant_id)) {
          primaryByTenant.set(c.tenant_id, c.id);
        }
      }
    }

    return branches
      .filter((b) => !!b.booking_code)
      // Incluye la sucursal si su tenant es premium, o si es free y ES la
      // principal. Las extra de un free quedan ocultas (Requirement 3.4).
      .filter(
        (b) => isRowPremium(b) || b.id === primaryByTenant.get(b.tenant_id)
      )
      .map((b) => ({
        code: b.booking_code as string,
        branch_name: b.name,
        business_name: b.tenant.name,
      }));
  },
};
