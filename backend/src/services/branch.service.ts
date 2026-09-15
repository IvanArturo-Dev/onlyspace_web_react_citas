import { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';
import { assignUniqueBranchCode } from '../utils/bookingCode';
import { isPremiumEffective } from './subscription.service';

/**
 * Public-facing view of a branch returned by the branch service.
 * `portal_path` is derived from the branch's booking_code, or null when the
 * branch has no code yet.
 *
 * Los campos de ubicacion (address/city/latitude/longitude) son opcionales
 * (discovery-landing, Req 7). latitude/longitude se exponen como number para
 * el consumidor (Prisma los devuelve como Decimal); null cuando no hay dato.
 */
export interface BranchView {
  id: string;
  name: string;
  status: string;
  booking_code: string | null;
  timezone: string;
  portal_path: string | null;
  address: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  // Enlace de Google Maps de la sucursal ("Como llegar"). null cuando no hay
  // dato (Requirement 7.1-7.4).
  maps_url: string | null;
}

export interface CreateBranchInput {
  name: string;
  timezone?: string;
  maps_url?: string | null;
}

export interface UpdateBranchInput {
  name?: string;
  status?: string;
  address?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  maps_url?: string | null;
}

/**
 * Normaliza/valida un maps_url para persistencia. Solo se invoca cuando el
 * campo viene en el payload. Trim: un string vacio limpia el enlace (null). Un
 * valor no vacio DEBE ser una URL http/https; si no, 400 VALIDATION_ERROR para
 * que una URL invalida nunca llegue a la BD (Requirement 7.4).
 */
function normalizeMapsUrl(u?: string | null): string | null {
  if (u === null) return null;
  const s = typeof u === 'string' ? u.trim() : '';
  if (s === '') return null;
  if (!/^https?:\/\//i.test(s)) {
    throw new HttpError('maps_url no es una URL valida', 400, 'VALIDATION_ERROR');
  }
  return s;
}

const VALID_STATUSES = ['active', 'inactive'] as const;

/**
 * Maps a Prisma Branch record into the public BranchView shape, deriving the
 * portal path from the branch booking code.
 */
function toBranchView(branch: {
  id: string;
  name: string;
  status: string;
  booking_code: string | null;
  timezone: string;
  address?: string | null;
  city?: string | null;
  latitude?: Prisma.Decimal | number | null;
  longitude?: Prisma.Decimal | number | null;
  maps_url?: string | null;
}): BranchView {
  return {
    id: branch.id,
    name: branch.name,
    status: branch.status,
    booking_code: branch.booking_code,
    timezone: branch.timezone,
    portal_path: branch.booking_code ? `/reservar/${branch.booking_code}` : null,
    address: branch.address ?? null,
    city: branch.city ?? null,
    // Prisma devuelve Decimal para lat/lng; se normaliza a number (Decimal
    // serializa de forma inesperada). null se conserva como null.
    latitude: branch.latitude != null ? Number(branch.latitude) : null,
    longitude: branch.longitude != null ? Number(branch.longitude) : null,
    maps_url: branch.maps_url ?? null,
  };
}

/**
 * Devuelve el id de la sucursal PRINCIPAL del tenant: la mas antigua (menor
 * created_at). La determinacion es estable y se comparte entre gestion y
 * reserva publica (Requirements 1.1, 1.2, 1.3). Retorna null si el tenant no
 * tiene ninguna sucursal.
 */
export async function getPrimaryBranchId(tenantId: string): Promise<string | null> {
  const branch = await prisma.branch.findFirst({
    where: { tenant_id: tenantId },
    orderBy: { created_at: 'asc' },
    select: { id: true },
  });
  return branch?.id ?? null;
}

/**
 * Indica si un tenant es PREMIUM EFECTIVO. Reutiliza la logica pura
 * `isPremiumEffective` de subscription.service (no se duplica). Si el tenant no
 * existe, retorna false.
 */
export async function isTenantPremium(tenantId: string): Promise<boolean> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { subscription_status: true, subscription_expires_at: true },
  });
  if (!tenant) return false;
  return isPremiumEffective(tenant);
}

/**
 * Guard de gating premium sobre una sucursal ya validada como propia del
 * tenant. Si el tenant NO es premium y `branchId` no es la sucursal PRINCIPAL,
 * lanza 403 PREMIUM_REQUIRED: en free solo se puede gestionar la principal
 * (Requirements 2.2). El premium no tiene restriccion. Reutiliza los helpers
 * `isTenantPremium` y `getPrimaryBranchId` del mismo modulo (Tarea 1).
 *
 * Debe invocarse SIEMPRE despues de confirmar que la sucursal pertenece al
 * tenant (404 primero), y ANTES de cualquier mutacion.
 *
 * `bypassPremium` SOLO lo activa la impersonacion del super admin (soporte):
 * cuando es true se trata al tenant como premium y no se aplica el guard, para
 * poder gestionar cualquier sucursal aunque el negocio sea free. Por defecto es
 * false, manteniendo el gating intacto.
 */
async function assertBranchManageable(
  tenantId: string,
  branchId: string,
  bypassPremium = false
): Promise<void> {
  if (bypassPremium) return;

  const premium = await isTenantPremium(tenantId);
  if (premium) return;

  const primaryId = await getPrimaryBranchId(tenantId);
  if (branchId !== primaryId) {
    throw new HttpError(
      'Gestionar mas de una sucursal es solo para premium',
      403,
      'PREMIUM_REQUIRED'
    );
  }
}

/**
 * Branch service for the business owner (emprendedor). Every operation is
 * strictly scoped by `tenantId` so a tenant can never read or mutate another
 * tenant's branches (Property 7: aislamiento por tenant).
 *
 * Gating premium (Requirements 2.1-2.4): un tenant FREE solo puede ver y
 * gestionar su sucursal PRINCIPAL (la mas antigua por created_at). Las
 * sucursales extra quedan ocultas en `list` y bloqueadas (403 PREMIUM_REQUIRED)
 * en `get`/`update`. Los subrecursos por sucursal (schedule, holidays,
 * services) heredan este guard automaticamente porque scheduleService,
 * holidayService y serviceService resuelven la sucursal via `branchService.get`
 * antes de operar; no se duplica el guard en el controlador.
 */
export const branchService = {
  /**
   * Lista las sucursales del tenant, ordenadas por created_at asc. En free
   * (isTenantPremium=false) devuelve SOLO la sucursal PRINCIPAL, que por el
   * orden asc es la primera del arreglo; en premium devuelve todas
   * (Requirements 2.1, 2.4). Property 2: free ve exactamente 1 (la principal).
   *
   * `bypassPremium` SOLO lo activa la impersonacion del super admin (soporte):
   * cuando es true se tratan como premium y se devuelven TODAS las sucursales
   * aunque el negocio sea free. Por defecto false (comportamiento intacto).
   */
  async list(tenantId: string, bypassPremium = false): Promise<BranchView[]> {
    const branches = await prisma.branch.findMany({
      where: { tenant_id: tenantId },
      orderBy: { created_at: 'asc' },
    });

    const premium = bypassPremium || (await isTenantPremium(tenantId));
    // En free solo la principal (primera por created_at asc). Evita una segunda
    // query: reutiliza el arreglo ya ordenado. Si no hay sucursales, [] queda [].
    const visible = premium ? branches : branches.slice(0, 1);

    return visible.map(toBranchView);
  },

  /**
   * Returns a single branch belonging to the tenant. Throws 404
   * BRANCH_NOT_FOUND if it does not exist or belongs to another tenant. Tras
   * validar la pertenencia, aplica el gating premium: en free, una sucursal
   * que no es la principal lanza 403 PREMIUM_REQUIRED (Requirements 2.2). La
   * principal en free sigue accesible.
   *
   * `bypassPremium` SOLO lo activa la impersonacion del super admin (soporte):
   * cuando es true no se aplica assertBranchManageable, permitiendo acceder a
   * cualquier sucursal del tenant aunque sea free. El 404 de pertenencia se
   * conserva siempre. Por defecto false (comportamiento intacto).
   */
  async get(
    tenantId: string,
    branchId: string,
    bypassPremium = false
  ): Promise<BranchView> {
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, tenant_id: tenantId },
    });
    if (!branch) {
      throw new HttpError('Branch not found', 404, 'BRANCH_NOT_FOUND');
    }

    await assertBranchManageable(tenantId, branchId, bypassPremium);

    return toBranchView(branch);
  },

  /**
   * Creates an active branch with a unique branch booking_code. `name` is
   * required (400 if empty/blank).
   */
  async create(tenantId: string, input: CreateBranchInput): Promise<BranchView> {
    const name = input.name?.trim();
    if (!name) {
      throw new HttpError('Branch name is required', 400, 'VALIDATION_ERROR');
    }

    const bookingCode = await assignUniqueBranchCode();

    // maps_url opcional (Requirement 7.1/7.4): se valida solo cuando viene en el
    // payload; una URL invalida lanza 400 antes de crear nada. Las coordenadas
    // NO son obligatorias.
    const mapsUrlProvided = input.maps_url !== undefined;
    const mapsUrl = mapsUrlProvided ? normalizeMapsUrl(input.maps_url) : undefined;

    const branch = await prisma.branch.create({
      data: {
        tenant_id: tenantId,
        name,
        status: 'active',
        booking_code: bookingCode,
        ...(input.timezone ? { timezone: input.timezone } : {}),
        ...(mapsUrlProvided ? { maps_url: mapsUrl } : {}),
      },
    });

    return toBranchView(branch);
  },

  /**
   * Updates a branch's name and/or status. Validates que `status`, cuando se
   * provee, sea valido (400), que la sucursal pertenezca al tenant (404
   * BRANCH_NOT_FOUND) y aplica el gating premium (403 PREMIUM_REQUIRED en free
   * para una sucursal que no es la principal) ANTES de escribir. El orden es:
   * validar status -> 404 pertenencia -> guard premium -> validar name -> update.
   *
   * `bypassPremium` SOLO lo activa la impersonacion del super admin (soporte):
   * cuando es true se salta el guard premium (permite editar cualquier sucursal
   * aunque el negocio sea free), pero se conservan las validaciones de
   * status/name y el 404 de pertenencia. Por defecto false (intacto).
   */
  async update(
    tenantId: string,
    branchId: string,
    input: UpdateBranchInput,
    bypassPremium = false
  ): Promise<BranchView> {
    if (
      input.status !== undefined &&
      !VALID_STATUSES.includes(input.status as (typeof VALID_STATUSES)[number])
    ) {
      throw new HttpError('Invalid branch status', 400, 'VALIDATION_ERROR');
    }

    const existing = await prisma.branch.findFirst({
      where: { id: branchId, tenant_id: tenantId },
    });
    if (!existing) {
      throw new HttpError('Branch not found', 404, 'BRANCH_NOT_FOUND');
    }

    // Mismo guard que get, ANTES de mutar: en free, una sucursal que no es la
    // principal lanza 403 PREMIUM_REQUIRED sin escribir nada (Requirements 2.2).
    // Bajo impersonacion (bypassPremium) el guard se salta.
    await assertBranchManageable(tenantId, branchId, bypassPremium);

    // Validacion de coordenadas (Req 7.3): cuando se envian y no son null, deben
    // ser numeros finitos dentro de rango. null se permite (limpia el valor).
    if (input.latitude != null) {
      if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90) {
        throw new HttpError('latitude fuera de rango', 400, 'VALIDATION_ERROR');
      }
    }
    if (input.longitude != null) {
      if (
        !Number.isFinite(input.longitude) ||
        input.longitude < -180 ||
        input.longitude > 180
      ) {
        throw new HttpError('longitude fuera de rango', 400, 'VALIDATION_ERROR');
      }
    }

    // Validacion de maps_url (Requirement 7.4): solo cuando viene en el input.
    // Un valor no vacio debe ser URL http/https; string vacio o null limpian el
    // valor. Se valida ANTES de escribir para que una URL invalida no mute nada.
    const mapsUrlProvided = input.maps_url !== undefined;
    const mapsUrl = mapsUrlProvided ? normalizeMapsUrl(input.maps_url) : undefined;

    const data: Prisma.BranchUpdateInput = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) {
        throw new HttpError('Branch name is required', 400, 'VALIDATION_ERROR');
      }
      data.name = name;
    }
    if (input.status !== undefined) {
      data.status = input.status;
    }
    // Los campos de ubicacion se incluyen SOLO cuando vienen definidos en el
    // input (undefined => no se toca). null se persiste como null (limpiar).
    if (input.address !== undefined) {
      data.address = input.address;
    }
    if (input.city !== undefined) {
      data.city = input.city;
    }
    if (input.latitude !== undefined) {
      data.latitude = input.latitude;
    }
    if (input.longitude !== undefined) {
      data.longitude = input.longitude;
    }
    // maps_url se incluye SOLO cuando viene en el input (undefined => no se
    // toca). null/'' se persisten como null (limpiar el enlace).
    if (mapsUrlProvided) {
      data.maps_url = mapsUrl;
    }

    const branch = await prisma.branch.update({
      where: { id: branchId },
      data,
    });

    return toBranchView(branch);
  },
};
