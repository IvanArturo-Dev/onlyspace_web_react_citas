import { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma.service';
import { isPremiumEffective } from './subscription.service';
import { reviewService } from './review.service';
import { promotionService } from './promotion.service';

/**
 * Servicio de DESCUBRIMIENTO publico (discovery-landing). Lista negocios
 * reservables (booking_enabled=true) via su sucursal PRINCIPAL, con
 * priorizacion premium, filtros por texto/categoria y orden opcional por
 * cercania (Haversine). Solo expone datos NO sensibles: nunca clientes, citas
 * ni tokens (Req 1.2, Property 9).
 */

/** Branding expuesto SOLO para negocios premium (Req 2.2 / Property 2). */
export interface DiscoverBranding {
  logo_url: string | null;
  brand_color: string | null;
  banner_title: string | null;
  banner_text: string | null;
  banner_link: string | null;
}

/** Item de descubrimiento: representa el negocio via su sucursal principal. */
export interface DiscoverItem {
  business_name: string;
  code: string;
  branch_name: string;
  city: string | null;
  address: string | null;
  is_premium: boolean;
  categories: string[];
  distance_km: number | null;
  /**
   * Promedio de calificacion del negocio (redondeado a 1 decimal) o `null` si
   * aun no tiene resenas (Requirement 3.5). Dato publico agregado, sin exponer
   * resenas individuales.
   */
  rating_avg: number | null;
  /** Numero de resenas del negocio; 0 si no tiene ninguna (Requirement 3.5). */
  rating_count: number;
  /**
   * Promociones vigentes de la sucursal principal, SOLO para negocios premium
   * (Requirements 3.2, 3.4, Property 5). Ligero: id/titulo/imagen para el
   * indicador de la tarjeta. Los negocios free quedan siempre en `[]`.
   */
  promotions: Array<{ id: string; title: string; image_url: string | null }>;
  branding?: DiscoverBranding;
}

/** Parametros opcionales de descubrimiento (todos combinables). */
export interface DiscoverParams {
  q?: string;
  category?: string;
  lat?: number;
  lng?: number;
  radius_km?: number;
}

/** Radio medio de la Tierra en km, usado por la formula de Haversine. */
const EARTH_RADIUS_KM = 6371;

/** Convierte grados a radianes. */
function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Distancia geografica en kilometros entre dos puntos (formula de Haversine,
 * radio 6371 km). Funcion PURA: devuelve 0 para el mismo punto, es simetrica
 * (a,b)=(b,a) y crece de forma monotona con la separacion (Property 8).
 */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRadians(bLat - aLat);
  const dLng = toRadians(bLng - aLng);
  const lat1 = toRadians(aLat);
  const lat2 = toRadians(bLat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_KM * c;
}

/** Sanitiza un posible numero: devuelve null si no es un numero finito. */
function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Normaliza un Decimal|number|null de Prisma a number|null. */
function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Comparador base para negocios del MISMO grupo de orden: primero premium,
 * luego por nombre de negocio ascendente (estable y predecible; Req 2.3).
 */
function byPremiumThenName(a: DiscoverItem, b: DiscoverItem): number {
  if (a.is_premium !== b.is_premium) return a.is_premium ? -1 : 1;
  return a.business_name.localeCompare(b.business_name);
}

export const discoveryService = {
  haversineKm,

  /**
   * Devuelve los negocios reservables via su sucursal PRINCIPAL, aplicando
   * filtros y orden segun `params`. Ver pipeline en el design (secciones 3-4).
   */
  async discover(params: DiscoverParams = {}): Promise<DiscoverItem[]> {
    // 1. Sucursales ACTIVAS de tenants con booking_enabled=true, ordenadas por
    //    created_at asc: la PRIMERA de cada tenant es su principal.
    const branches = await prisma.branch.findMany({
      where: {
        status: 'active',
        tenant: { is: { booking_enabled: true } },
      },
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        tenant_id: true,
        name: true,
        booking_code: true,
        city: true,
        address: true,
        latitude: true,
        longitude: true,
        tenant: {
          select: {
            name: true,
            subscription_status: true,
            subscription_expires_at: true,
            logo_url: true,
            brand_color: true,
            banner_title: true,
            banner_text: true,
            banner_link: true,
          },
        },
      },
    });

    // Sucursal PRINCIPAL por tenant: la primera vista (created_at asc). Se
    // ignoran las sucursales sin booking_code (no reservables) y las extra:
    // asi un negocio aparece con exactamente su principal (Property 3).
    const primaryByTenant = new Map<string, (typeof branches)[number]>();
    for (const b of branches) {
      if (!b.booking_code) continue;
      if (!primaryByTenant.has(b.tenant_id)) {
        primaryByTenant.set(b.tenant_id, b);
      }
    }

    const tenantIds = Array.from(primaryByTenant.keys());

    // 3. Categorias activas por tenant, en un solo lote. Cada item recibe SOLO
    //    las categorias de su propio tenant (aislamiento; Property 9).
    const categoriesByTenant = new Map<string, string[]>();
    if (tenantIds.length > 0) {
      const cats = await prisma.category.findMany({
        where: { is_active: true, tenant_id: { in: tenantIds } },
        select: { tenant_id: true, name: true },
      });
      for (const c of cats) {
        const list = categoriesByTenant.get(c.tenant_id) ?? [];
        list.push(c.name);
        categoriesByTenant.set(c.tenant_id, list);
      }
    }

    // 2 + 4. Arma los items: is_premium por tenant y branding SOLO si premium.
    // `branchByCode` guarda la sucursal principal de cada item por su code
    // (unico) para poder leer sus coordenadas al ordenar por cercania.
    let items: DiscoverItem[] = [];
    const branchByCode = new Map<string, (typeof branches)[number]>();
    // Mapa interno code -> tenant_id para poder asignar el rating por negocio
    // sin exponer el tenant_id en la respuesta publica.
    const tenantByCode = new Map<string, string>();
    for (const [tenantId, b] of primaryByTenant) {
      const t = b.tenant;
      const isPremium = isPremiumEffective({
        subscription_status: t.subscription_status,
        subscription_expires_at: t.subscription_expires_at,
      });

      const item: DiscoverItem = {
        business_name: t.name,
        code: b.booking_code as string,
        branch_name: b.name,
        city: b.city ?? null,
        address: b.address ?? null,
        is_premium: isPremium,
        categories: categoriesByTenant.get(tenantId) ?? [],
        distance_km: null,
        // Valores por defecto: negocios sin resenas quedan en null/0. Se
        // sobrescriben mas abajo con el agregado real de reviewService.
        rating_avg: null,
        rating_count: 0,
        // Por defecto vacio; los negocios premium se sobrescriben mas abajo
        // con sus promos vigentes. Los free quedan en [] (Property 5).
        promotions: [],
      };

      // Branding/banner NUNCA en free (Req 2.2 / Property 2): solo se adjunta
      // en premium; en free queda undefined (omitido).
      if (isPremium) {
        item.branding = {
          logo_url: t.logo_url ?? null,
          brand_color: t.brand_color ?? null,
          banner_title: t.banner_title ?? null,
          banner_text: t.banner_text ?? null,
          banner_link: t.banner_link ?? null,
        };
      }

      items.push(item);
      branchByCode.set(item.code, b);
      tenantByCode.set(item.code, tenantId);
    }

    // Rating por negocio (Requirement 3.5): agrega promedio y conteo por tenant
    // en un solo lote. Un tenant sin resenas NO aparece en el map, por lo que
    // el item conserva su valor por defecto (rating_avg null, rating_count 0).
    if (items.length > 0) {
      const ratings = await reviewService.ratingsForTenants(tenantIds);
      for (const item of items) {
        const tenantId = tenantByCode.get(item.code);
        const rating = tenantId ? ratings.get(tenantId) : undefined;
        if (rating) {
          item.rating_avg = rating.avg;
          item.rating_count = rating.count;
        }
      }
    }

    // Promociones vigentes por negocio PREMIUM (Requirements 3.2, 3.4). Se
    // resuelven en lote solo para las sucursales principales de items premium
    // (los free NUNCA se consultan; conservan promotions [] — Property 5).
    const premiumItems = items.filter((it) => it.is_premium);
    if (premiumItems.length > 0) {
      const premiumBranchIds: string[] = [];
      for (const it of premiumItems) {
        const b = branchByCode.get(it.code);
        if (b) premiumBranchIds.push(b.id);
      }
      const promosByBranch = await promotionService.activeForBranches(
        premiumBranchIds
      );
      for (const it of premiumItems) {
        const b = branchByCode.get(it.code);
        const promos = b ? promosByBranch.get(b.id) ?? [] : [];
        it.promotions = promos.map((p) => ({
          id: p.id,
          title: p.title,
          image_url: p.image_url ?? null,
        }));
      }
    }

    // 5. Filtro por texto libre `q` (nombre negocio/sucursal/categoria,
    //    contains case-insensitive). Se aplica en memoria: el volumen es bajo.
    const q = (params.q ?? '').trim().toLowerCase();
    if (q.length >= 1) {
      items = items.filter((it) => {
        if (it.business_name.toLowerCase().includes(q)) return true;
        if (it.branch_name.toLowerCase().includes(q)) return true;
        return it.categories.some((c) => c.toLowerCase().includes(q));
      });
    }

    // 5. Filtro por categoria: igualdad por nombre case-insensitive.
    const category = (params.category ?? '').trim().toLowerCase();
    if (category.length >= 1) {
      items = items.filter((it) =>
        it.categories.some((c) => c.toLowerCase() === category)
      );
    }

    // 6. Cercania / orden. Sanitiza lat/lng: si no son finitos, se ignoran
    //    (se tratan como ausentes; Property 6).
    const lat = finiteOrNull(params.lat);
    const lng = finiteOrNull(params.lng);
    const hasOrigin = lat != null && lng != null;

    if (hasOrigin) {
      // Distancia por item: null si la sucursal no tiene coordenadas.
      for (const it of items) {
        const b = branchByCode.get(it.code);
        const bLat = decimalToNumber(b?.latitude);
        const bLng = decimalToNumber(b?.longitude);
        it.distance_km =
          bLat != null && bLng != null ? haversineKm(lat, lng, bLat, bLng) : null;
      }

      // radius_km (finito > 0): excluye items CON coordenadas cuya distancia
      // supere el radio. Los items SIN coordenadas NO se filtran por radio.
      const radius = finiteOrNull(params.radius_km);
      if (radius != null && radius > 0) {
        items = items.filter(
          (it) => it.distance_km == null || it.distance_km <= radius
        );
      }

      // Orden: con-coords antes que sin-coords. Entre con-coords: premium
      // primero, luego distancia asc. Entre sin-coords: premium, luego nombre.
      items.sort((a, b) => {
        const aHas = a.distance_km != null;
        const bHas = b.distance_km != null;
        if (aHas !== bHas) return aHas ? -1 : 1;
        if (aHas && bHas) {
          if (a.is_premium !== b.is_premium) return a.is_premium ? -1 : 1;
          if (a.distance_km !== b.distance_km) {
            return (a.distance_km as number) - (b.distance_km as number);
          }
          return a.business_name.localeCompare(b.business_name);
        }
        // Ambos sin coordenadas.
        return byPremiumThenName(a, b);
      });
    } else {
      // Sin origen valido: distancia null en todos y orden premium + nombre.
      for (const it of items) it.distance_km = null;
      items.sort(byPremiumThenName);
    }

    return items;
  },

  /**
   * Nombres distintos de categorias activas de negocios reservables
   * (booking_enabled=true), ordenados ascendente. Alimenta los chips del
   * landing (Req 3.4). Dedup case-insensitive conservando el primer nombre.
   */
  async categories(): Promise<string[]> {
    const cats = await prisma.category.findMany({
      where: {
        is_active: true,
        tenant: { is: { booking_enabled: true } },
      },
      select: { name: true },
      orderBy: { name: 'asc' },
    });

    const seen = new Set<string>();
    const result: string[] = [];
    for (const c of cats) {
      const key = c.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(c.name);
    }
    result.sort((a, b) => a.localeCompare(b));
    return result;
  },
};
