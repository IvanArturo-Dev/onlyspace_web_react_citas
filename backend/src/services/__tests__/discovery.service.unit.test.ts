import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mock de Prisma: solo branch.findMany y category.findMany son usados por el
// servicio de descubrimiento.
// ---------------------------------------------------------------------------
const mockPrisma = {
  branch: {
    findMany: jest.fn(),
  },
  category: {
    findMany: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// ---------------------------------------------------------------------------
// Mock de reviewService: discover consume ratingsForTenants para adjuntar
// rating_avg/rating_count. Se mockea para no depender de prisma.review.
// Por defecto devuelve un Map vacio (ningun negocio con resenas).
// ---------------------------------------------------------------------------
const mockReviewService = {
  ratingsForTenants: jest.fn(),
};

jest.mock('../review.service', () => ({
  reviewService: mockReviewService,
}));

// ---------------------------------------------------------------------------
// Mock de promotionService: discover consume activeForBranches para adjuntar
// las promociones vigentes por negocio premium. Por defecto devuelve un Map
// vacio (ningun negocio con promos) para no romper los tests existentes.
// ---------------------------------------------------------------------------
const mockPromotionService = {
  activeForBranches: jest.fn(),
};

jest.mock('../promotion.service', () => ({
  promotionService: mockPromotionService,
}));

import { discoveryService, haversineKm } from '../discovery.service';

// ---------------------------------------------------------------------------
// Helpers para construir filas de branch y category mockeadas.
// ---------------------------------------------------------------------------

/** Estado de suscripcion activo sin expiracion => premium efectivo. */
const ACTIVE = { subscription_status: 'active', subscription_expires_at: null };
/** Estado inactivo => free. */
const INACTIVE = { subscription_status: 'inactive', subscription_expires_at: null };

interface BranchRowInput {
  id: string;
  tenant_id: string;
  name: string;
  booking_code: string | null;
  city?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  tenantName: string;
  premium?: boolean;
  logo_url?: string | null;
  brand_color?: string | null;
  banner_title?: string | null;
  banner_text?: string | null;
  banner_link?: string | null;
}

function branchRow(input: BranchRowInput) {
  const sub = input.premium ? ACTIVE : INACTIVE;
  return {
    id: input.id,
    tenant_id: input.tenant_id,
    name: input.name,
    booking_code: input.booking_code,
    city: input.city ?? null,
    address: input.address ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    tenant: {
      name: input.tenantName,
      subscription_status: sub.subscription_status,
      subscription_expires_at: sub.subscription_expires_at,
      logo_url: input.logo_url ?? null,
      brand_color: input.brand_color ?? null,
      banner_title: input.banner_title ?? null,
      banner_text: input.banner_text ?? null,
      banner_link: input.banner_link ?? null,
    },
  };
}

function categoryRow(tenant_id: string, name: string) {
  return { tenant_id, name };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Por defecto sin categorias; cada test que las necesite las mockea.
  mockPrisma.category.findMany.mockResolvedValue([]);
  // Por defecto ningun negocio tiene resenas: Map vacio -> null/0 por item.
  mockReviewService.ratingsForTenants.mockResolvedValue(new Map());
  // Por defecto ningun negocio tiene promos vigentes: Map vacio -> [] por item.
  mockPromotionService.activeForBranches.mockResolvedValue(new Map());
});

// ===========================================================================
// haversineKm (Property 8)
// ===========================================================================
describe('haversineKm (Property 8: Haversine correcta)', () => {
  it('devuelve 0 para el mismo punto', () => {
    expect(haversineKm(19.4326, -99.1332, 19.4326, -99.1332)).toBeCloseTo(0, 6);
  });

  it('es simetrica: (a,b) == (b,a)', () => {
    const cdmx = [19.4326, -99.1332] as const;
    const gdl = [20.6597, -103.3496] as const;
    const ab = haversineKm(cdmx[0], cdmx[1], gdl[0], gdl[1]);
    const ba = haversineKm(gdl[0], gdl[1], cdmx[0], cdmx[1]);
    expect(ab).toBeCloseTo(ba, 9);
  });

  it('crece de forma monotona con la separacion geografica', () => {
    const origin = [19.4326, -99.1332] as const;
    const cerca = haversineKm(origin[0], origin[1], 19.5, -99.1332);
    const lejos = haversineKm(origin[0], origin[1], 21.0, -99.1332);
    expect(lejos).toBeGreaterThan(cerca);
  });

  it('valor de referencia CDMX<->Guadalajara ~460-480 km', () => {
    const km = haversineKm(19.4326, -99.1332, 20.6597, -103.3496);
    expect(km).toBeGreaterThan(440);
    expect(km).toBeLessThan(500);
  });
});

// ===========================================================================
// discover: orden sin lat/lng (Property 1)
// ===========================================================================
describe('discover sin lat/lng (Property 1: premium primero, nombre asc)', () => {
  it('coloca premium antes que free y ordena por nombre dentro de cada grupo', async () => {
    mockPrisma.branch.findMany.mockResolvedValue([
      branchRow({ id: 'b1', tenant_id: 't1', name: 'Suc Beta', booking_code: 'AAA', tenantName: 'Beta Free', premium: false }),
      branchRow({ id: 'b2', tenant_id: 't2', name: 'Suc Alfa', booking_code: 'BBB', tenantName: 'Alfa Premium', premium: true }),
      branchRow({ id: 'b3', tenant_id: 't3', name: 'Suc Zeta', booking_code: 'CCC', tenantName: 'Zeta Premium', premium: true }),
      branchRow({ id: 'b4', tenant_id: 't4', name: 'Suc Ana', booking_code: 'DDD', tenantName: 'Ana Free', premium: false }),
    ]);

    const items = await discoveryService.discover();

    expect(items.map((i) => i.business_name)).toEqual([
      'Alfa Premium', // premium, A
      'Zeta Premium', // premium, Z
      'Ana Free', // free, A
      'Beta Free', // free, B
    ]);
    expect(items.slice(0, 2).every((i) => i.is_premium)).toBe(true);
    expect(items.slice(2).every((i) => !i.is_premium)).toBe(true);
  });
});

// ===========================================================================
// discover: branding solo premium (Property 2)
// ===========================================================================
describe('discover branding (Property 2: banner solo premium)', () => {
  it('incluye branding en premium y lo omite en free', async () => {
    mockPrisma.branch.findMany.mockResolvedValue([
      branchRow({
        id: 'b1', tenant_id: 't1', name: 'Suc Prem', booking_code: 'AAA',
        tenantName: 'Prem', premium: true,
        logo_url: 'logo.png', brand_color: '#fff', banner_title: 'Hola',
        banner_text: 'Texto', banner_link: 'https://x',
      }),
      branchRow({
        id: 'b2', tenant_id: 't2', name: 'Suc Free', booking_code: 'BBB',
        tenantName: 'Free', premium: false,
        banner_title: 'NO DEBE APARECER',
      }),
    ]);

    const items = await discoveryService.discover();
    const prem = items.find((i) => i.business_name === 'Prem')!;
    const free = items.find((i) => i.business_name === 'Free')!;

    expect(prem.branding).toBeDefined();
    expect(prem.branding).toEqual({
      logo_url: 'logo.png',
      brand_color: '#fff',
      banner_title: 'Hola',
      banner_text: 'Texto',
      banner_link: 'https://x',
    });
    expect(free.branding).toBeUndefined();
  });
});

// ===========================================================================
// discover: free solo su sucursal principal (Property 3)
// ===========================================================================
describe('discover sucursal principal (Property 3: solo la mas antigua)', () => {
  it('cada tenant aparece una vez con su principal (primera por created_at asc)', async () => {
    // Dos sucursales del mismo tenant, ya ordenadas por created_at asc.
    mockPrisma.branch.findMany.mockResolvedValue([
      branchRow({ id: 'b1', tenant_id: 't1', name: 'Principal', booking_code: 'AAA', tenantName: 'Uno', premium: false }),
      branchRow({ id: 'b2', tenant_id: 't1', name: 'Extra', booking_code: 'BBB', tenantName: 'Uno', premium: false }),
    ]);

    const items = await discoveryService.discover();

    expect(items).toHaveLength(1);
    expect(items[0].branch_name).toBe('Principal');
    expect(items[0].code).toBe('AAA');
  });

  it('ignora sucursales sin booking_code (no reservables)', async () => {
    mockPrisma.branch.findMany.mockResolvedValue([
      branchRow({ id: 'b1', tenant_id: 't1', name: 'Sin code', booking_code: null, tenantName: 'Uno', premium: false }),
      branchRow({ id: 'b2', tenant_id: 't1', name: 'Con code', booking_code: 'AAA', tenantName: 'Uno', premium: false }),
    ]);

    const items = await discoveryService.discover();
    expect(items).toHaveLength(1);
    expect(items[0].branch_name).toBe('Con code');
  });
});

// ===========================================================================
// discover: filtro q (Property 4)
// ===========================================================================
describe('discover con q (Property 4: filtros consistentes)', () => {
  beforeEach(() => {
    mockPrisma.branch.findMany.mockResolvedValue([
      branchRow({ id: 'b1', tenant_id: 't1', name: 'Barberia Centro', booking_code: 'AAA', tenantName: 'Cortes Premium', premium: true }),
      branchRow({ id: 'b2', tenant_id: 't2', name: 'Spa Norte', booking_code: 'BBB', tenantName: 'Relax Free', premium: false }),
      branchRow({ id: 'b3', tenant_id: 't3', name: 'Estetica Sur', booking_code: 'CCC', tenantName: 'Belleza Premium', premium: true }),
    ]);
    mockPrisma.category.findMany.mockResolvedValue([
      categoryRow('t1', 'Cortes'),
      categoryRow('t2', 'Masajes'),
      categoryRow('t3', 'Cortes'),
    ]);
  });

  it('matchea por nombre de negocio', async () => {
    const items = await discoveryService.discover({ q: 'relax' });
    expect(items.map((i) => i.business_name)).toEqual(['Relax Free']);
  });

  it('matchea por nombre de sucursal', async () => {
    const items = await discoveryService.discover({ q: 'norte' });
    expect(items.map((i) => i.branch_name)).toEqual(['Spa Norte']);
  });

  it('matchea por categoria y mantiene premium primero', async () => {
    const items = await discoveryService.discover({ q: 'cortes' });
    // t1 (premium) y t3 (premium) tienen categoria Cortes; ordenados por nombre.
    expect(items.map((i) => i.business_name)).toEqual(['Belleza Premium', 'Cortes Premium']);
    expect(items.every((i) => i.is_premium)).toBe(true);
  });
});

// ===========================================================================
// discover: filtro category
// ===========================================================================
describe('discover con category (Property 4)', () => {
  it('incluye solo items con esa categoria (case-insensitive)', async () => {
    mockPrisma.branch.findMany.mockResolvedValue([
      branchRow({ id: 'b1', tenant_id: 't1', name: 'S1', booking_code: 'AAA', tenantName: 'A', premium: false }),
      branchRow({ id: 'b2', tenant_id: 't2', name: 'S2', booking_code: 'BBB', tenantName: 'B', premium: false }),
    ]);
    mockPrisma.category.findMany.mockResolvedValue([
      categoryRow('t1', 'Masajes'),
      categoryRow('t2', 'Cortes'),
    ]);

    const items = await discoveryService.discover({ category: 'masajes' });
    expect(items.map((i) => i.business_name)).toEqual(['A']);
  });
});

// ===========================================================================
// discover: cercania (Property 5)
// ===========================================================================
describe('discover con lat/lng (Property 5: cercania con premium)', () => {
  it('ordena con-coords por (premium, distancia) y deja sin-coords al final', async () => {
    // Origen CDMX. b_cerca free cerca, b_lejos premium lejos, b_premCerca premium mas cerca.
    mockPrisma.branch.findMany.mockResolvedValue([
      branchRow({ id: 'b1', tenant_id: 't1', name: 'FreeCerca', booking_code: 'AAA', tenantName: 'FreeCerca', premium: false, latitude: 19.44, longitude: -99.14 }),
      branchRow({ id: 'b2', tenant_id: 't2', name: 'PremLejos', booking_code: 'BBB', tenantName: 'PremLejos', premium: true, latitude: 20.66, longitude: -103.35 }),
      branchRow({ id: 'b3', tenant_id: 't3', name: 'PremCerca', booking_code: 'CCC', tenantName: 'PremCerca', premium: true, latitude: 19.45, longitude: -99.13 }),
      branchRow({ id: 'b4', tenant_id: 't4', name: 'SinCoords', booking_code: 'DDD', tenantName: 'SinCoords', premium: true, latitude: null, longitude: null }),
    ]);

    const items = await discoveryService.discover({ lat: 19.4326, lng: -99.1332 });

    // Con-coords primero. Entre con-coords: premium primero (por distancia),
    // luego free. PremCerca y PremLejos premium (PremCerca mas cerca), luego
    // FreeCerca (free). SinCoords al final.
    expect(items.map((i) => i.business_name)).toEqual([
      'PremCerca',
      'PremLejos',
      'FreeCerca',
      'SinCoords',
    ]);
    expect(items[3].distance_km).toBeNull();
    expect(items[0].distance_km).not.toBeNull();
  });

  it('radius_km filtra con-coords lejanos pero no a los sin-coords', async () => {
    mockPrisma.branch.findMany.mockResolvedValue([
      branchRow({ id: 'b1', tenant_id: 't1', name: 'Cerca', booking_code: 'AAA', tenantName: 'Cerca', premium: false, latitude: 19.45, longitude: -99.13 }),
      branchRow({ id: 'b2', tenant_id: 't2', name: 'Lejos', booking_code: 'BBB', tenantName: 'Lejos', premium: false, latitude: 20.66, longitude: -103.35 }),
      branchRow({ id: 'b3', tenant_id: 't3', name: 'SinCoords', booking_code: 'CCC', tenantName: 'SinCoords', premium: false, latitude: null, longitude: null }),
    ]);

    const items = await discoveryService.discover({ lat: 19.4326, lng: -99.1332, radius_km: 50 });
    const names = items.map((i) => i.business_name);
    expect(names).toContain('Cerca');
    expect(names).toContain('SinCoords'); // sin-coords no se filtra por radio
    expect(names).not.toContain('Lejos'); // ~460 km > 50
  });
});

// ===========================================================================
// discover: lat/lng invalidos (Property 6)
// ===========================================================================
describe('discover con lat/lng invalidos (Property 6: degradacion)', () => {
  it('trata NaN como ausente y aplica orden normal', async () => {
    mockPrisma.branch.findMany.mockResolvedValue([
      branchRow({ id: 'b1', tenant_id: 't1', name: 'S1', booking_code: 'AAA', tenantName: 'Free', premium: false, latitude: 19.44, longitude: -99.14 }),
      branchRow({ id: 'b2', tenant_id: 't2', name: 'S2', booking_code: 'BBB', tenantName: 'Prem', premium: true, latitude: 20.66, longitude: -103.35 }),
    ]);

    const items = await discoveryService.discover({ lat: NaN, lng: NaN });
    // Orden normal: premium primero, distance_km null.
    expect(items.map((i) => i.business_name)).toEqual(['Prem', 'Free']);
    expect(items.every((i) => i.distance_km === null)).toBe(true);
  });

  it('trata valores no numericos (strings) como ausentes', async () => {
    mockPrisma.branch.findMany.mockResolvedValue([
      branchRow({ id: 'b1', tenant_id: 't1', name: 'S1', booking_code: 'AAA', tenantName: 'Free', premium: false }),
      branchRow({ id: 'b2', tenant_id: 't2', name: 'S2', booking_code: 'BBB', tenantName: 'Prem', premium: true }),
    ]);

    // Simula parametros crudos de query (strings) via cast.
    const items = await discoveryService.discover({
      lat: '19.4' as unknown as number,
      lng: '-99.1' as unknown as number,
    });
    expect(items.map((i) => i.business_name)).toEqual(['Prem', 'Free']);
    expect(items.every((i) => i.distance_km === null)).toBe(true);
  });
});

// ===========================================================================
// categories
// ===========================================================================
describe('categories (Req 3.4: chips)', () => {
  it('devuelve nombres distintos ordenados asc', async () => {
    mockPrisma.category.findMany.mockResolvedValue([
      { name: 'Cortes' },
      { name: 'Masajes' },
      { name: 'cortes' }, // duplicado case-insensitive
      { name: 'Barba' },
    ]);

    const result = await discoveryService.categories();
    expect(result).toEqual(['Barba', 'Cortes', 'Masajes']);
  });
});

// ===========================================================================
// Aislamiento por tenant (Property 9)
// ===========================================================================
describe('discover aislamiento por tenant (Property 9)', () => {
  it('cada item lleva las categorias y branding de su propio tenant', async () => {
    mockPrisma.branch.findMany.mockResolvedValue([
      branchRow({
        id: 'b1', tenant_id: 't1', name: 'S1', booking_code: 'AAA',
        tenantName: 'Uno', premium: true, logo_url: 'uno.png',
      }),
      branchRow({
        id: 'b2', tenant_id: 't2', name: 'S2', booking_code: 'BBB',
        tenantName: 'Dos', premium: false,
      }),
    ]);
    mockPrisma.category.findMany.mockResolvedValue([
      categoryRow('t1', 'Cortes'),
      categoryRow('t2', 'Masajes'),
      categoryRow('t2', 'Depilacion'),
    ]);

    const items = await discoveryService.discover();
    const uno = items.find((i) => i.business_name === 'Uno')!;
    const dos = items.find((i) => i.business_name === 'Dos')!;

    // Categorias no se mezclan entre tenants.
    expect(uno.categories).toEqual(['Cortes']);
    expect(dos.categories.sort()).toEqual(['Depilacion', 'Masajes']);
    // Branding solo del propio tenant premium; el free no tiene.
    expect(uno.branding?.logo_url).toBe('uno.png');
    expect(dos.branding).toBeUndefined();
  });
});

// ===========================================================================
// discover: rating por negocio (Requirement 3.5)
// ===========================================================================
describe('discover con rating (Requirement 3.5: promedio y conteo por negocio)', () => {
  it('asigna rating_avg/rating_count desde ratingsForTenants a cada item', async () => {
    mockPrisma.branch.findMany.mockResolvedValue([
      branchRow({ id: 'b1', tenant_id: 't1', name: 'S1', booking_code: 'AAA', tenantName: 'ConResenas', premium: false }),
      branchRow({ id: 'b2', tenant_id: 't2', name: 'S2', booking_code: 'BBB', tenantName: 'Otra', premium: false }),
    ]);
    mockReviewService.ratingsForTenants.mockResolvedValue(
      new Map([
        ['t1', { avg: 4.5, count: 12 }],
        ['t2', { avg: 3.0, count: 4 }],
      ])
    );

    const items = await discoveryService.discover();

    // Se consulta el rating con los tenant_ids de los negocios en resultados.
    const calledWith = mockReviewService.ratingsForTenants.mock.calls[0][0] as string[];
    expect(calledWith.sort()).toEqual(['t1', 't2']);

    const conResenas = items.find((i) => i.business_name === 'ConResenas')!;
    const otra = items.find((i) => i.business_name === 'Otra')!;

    expect(conResenas.rating_avg).toBe(4.5);
    expect(conResenas.rating_count).toBe(12);
    expect(otra.rating_avg).toBe(3.0);
    expect(otra.rating_count).toBe(4);
  });

  it('un negocio sin resenas queda con rating_avg null y rating_count 0', async () => {
    mockPrisma.branch.findMany.mockResolvedValue([
      branchRow({ id: 'b1', tenant_id: 't1', name: 'S1', booking_code: 'AAA', tenantName: 'ConResenas', premium: false }),
      branchRow({ id: 'b2', tenant_id: 't2', name: 'S2', booking_code: 'BBB', tenantName: 'SinResenas', premium: false }),
    ]);
    // Solo t1 tiene resenas; t2 no aparece en el map.
    mockReviewService.ratingsForTenants.mockResolvedValue(
      new Map([['t1', { avg: 5.0, count: 2 }]])
    );

    const items = await discoveryService.discover();
    const con = items.find((i) => i.business_name === 'ConResenas')!;
    const sin = items.find((i) => i.business_name === 'SinResenas')!;

    expect(con.rating_avg).toBe(5.0);
    expect(con.rating_count).toBe(2);
    // Sin resenas: valores por defecto.
    expect(sin.rating_avg).toBeNull();
    expect(sin.rating_count).toBe(0);
  });

  it('todos con rating_avg null y count 0 cuando ningun negocio tiene resenas', async () => {
    mockPrisma.branch.findMany.mockResolvedValue([
      branchRow({ id: 'b1', tenant_id: 't1', name: 'S1', booking_code: 'AAA', tenantName: 'Uno', premium: true }),
      branchRow({ id: 'b2', tenant_id: 't2', name: 'S2', booking_code: 'BBB', tenantName: 'Dos', premium: false }),
    ]);
    // ratingsForTenants por defecto devuelve Map vacio (beforeEach).

    const items = await discoveryService.discover();
    expect(items.every((i) => i.rating_avg === null && i.rating_count === 0)).toBe(true);
  });
});

// ===========================================================================
// discover: promociones por negocio premium (Requirements 3.2, 3.4, Property 5)
// ===========================================================================
describe('discover con promociones (Property 5: solo premium y vigente)', () => {
  it('un negocio premium con promos vigentes recibe sus promos (id/title/image_url)', async () => {
    mockPrisma.branch.findMany.mockResolvedValue([
      branchRow({ id: 'b1', tenant_id: 't1', name: 'S1', booking_code: 'AAA', tenantName: 'Prem', premium: true }),
    ]);
    // El mock devuelve promos vigentes para la sucursal principal b1.
    mockPromotionService.activeForBranches.mockResolvedValue(
      new Map([
        [
          'b1',
          [
            { id: 'p1', branch_id: 'b1', title: '2x1 cortes', image_url: 'promo.png' },
            { id: 'p2', branch_id: 'b1', title: 'Descuento martes', image_url: null },
          ],
        ],
      ])
    );

    const items = await discoveryService.discover();
    const prem = items.find((i) => i.business_name === 'Prem')!;

    // Solo se consulta activeForBranches con las sucursales de items premium.
    const calledWith = mockPromotionService.activeForBranches.mock.calls[0][0] as string[];
    expect(calledWith).toEqual(['b1']);

    expect(prem.promotions).toEqual([
      { id: 'p1', title: '2x1 cortes', image_url: 'promo.png' },
      { id: 'p2', title: 'Descuento martes', image_url: null },
    ]);
  });

  it('un negocio free queda con promotions [] aunque el map tuviera su branch', async () => {
    mockPrisma.branch.findMany.mockResolvedValue([
      branchRow({ id: 'b1', tenant_id: 't1', name: 'S1', booking_code: 'AAA', tenantName: 'Free', premium: false }),
    ]);
    // Aunque el map incluya la sucursal del free, no debe exponerse (Property 5).
    mockPromotionService.activeForBranches.mockResolvedValue(
      new Map([['b1', [{ id: 'p1', branch_id: 'b1', title: 'NO DEBE APARECER', image_url: null }]]])
    );

    const items = await discoveryService.discover();
    const free = items.find((i) => i.business_name === 'Free')!;

    expect(free.promotions).toEqual([]);
    // Al no haber items premium, no se consultan promos en lote.
    expect(mockPromotionService.activeForBranches).not.toHaveBeenCalled();
  });

  it('ningun premium con promos vigentes -> todos con promotions []', async () => {
    mockPrisma.branch.findMany.mockResolvedValue([
      branchRow({ id: 'b1', tenant_id: 't1', name: 'S1', booking_code: 'AAA', tenantName: 'Prem', premium: true }),
      branchRow({ id: 'b2', tenant_id: 't2', name: 'S2', booking_code: 'BBB', tenantName: 'Free', premium: false }),
    ]);
    // activeForBranches por defecto devuelve Map vacio (beforeEach).

    const items = await discoveryService.discover();
    expect(items.every((i) => Array.isArray(i.promotions) && i.promotions.length === 0)).toBe(true);
  });
});
