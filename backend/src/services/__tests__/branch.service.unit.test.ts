import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Prisma mock. `assignUniqueBranchCode` uses `prisma.branch.findUnique` under
// the hood; returning null there lets the real generator produce a fresh code
// so we can assert its format (Property 1).
//
// El gating premium (Tarea 2) hace que get/update consulten `tenant.findUnique`
// (via isTenantPremium) y `branch.findFirst` con select:{id:true} (via
// getPrimaryBranchId). Por eso se mockea `tenant` y se distingue la llamada de
// primary por su `select` en el helper de abajo.
// ---------------------------------------------------------------------------
const mockPrisma = {
  branch: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  tenant: {
    findUnique: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  __esModule: true,
  prisma: mockPrisma,
}));

import { branchService } from '../branch.service';
import {
  BOOKING_CODE_ALPHABET,
  BOOKING_CODE_LENGTH,
} from '../../utils/bookingCode';

const ALLOWED = new Set(BOOKING_CODE_ALPHABET.split(''));

/** Reference implementation of the branch code check used across the suite. */
function isValidBranchCode(code: string): boolean {
  if (code.length !== BOOKING_CODE_LENGTH) return false;
  for (const ch of code) {
    if (!ALLOWED.has(ch)) return false;
  }
  return true;
}

/**
 * Configura los mocks de prisma para simular premium (subscription active con
 * expiracion nula). Con esto isTenantPremium devuelve true y el gating no
 * bloquea nada.
 */
function makePremium(): void {
  mockPrisma.tenant.findUnique.mockResolvedValue({
    subscription_status: 'active',
    subscription_expires_at: null,
  } as any);
}

/**
 * Configura los mocks para simular FREE (subscription inactive). Recibe el id
 * de la sucursal principal que devolvera getPrimaryBranchId. El `branch.findFirst`
 * distingue la llamada del helper primary (usa `select: { id: true }`) de la
 * de pertenencia (get/update) y devuelve `{ id: primaryId }` para la primera.
 */
function makeFree(primaryId: string | null, ownedBranch: any): void {
  mockPrisma.tenant.findUnique.mockResolvedValue({
    subscription_status: 'inactive',
    subscription_expires_at: null,
  } as any);
  mockPrisma.branch.findFirst.mockImplementation(async (args: any) => {
    // getPrimaryBranchId pide solo el id.
    if (args?.select?.id) {
      return primaryId === null ? null : ({ id: primaryId } as any);
    }
    // Lookup de pertenencia (get/update): devuelve la branch propia o null.
    return ownedBranch as any;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Property 1: Unicidad y formato del codigo de sucursal
// Validates: Requirements 2.2, 2.6
// ---------------------------------------------------------------------------
describe('branchService.create - Property 1: branch code format', () => {
  it('genera un booking_code valido (6 chars del alfabeto), status active y persiste el nombre', async () => {
    // No collision: the generator returns its first candidate.
    mockPrisma.branch.findUnique.mockResolvedValue(null as any);
    // Echo back the data the service passes to create, adding an id.
    mockPrisma.branch.create.mockImplementation(async (args: any) => ({
      id: 'branch-1',
      ...args.data,
    }));

    const view = await branchService.create('tenant-a', { name: '  Centro  ' });

    // create was called scoped to the tenant, with an active status and a code.
    const createArg = mockPrisma.branch.create.mock.calls[0][0] as any;
    expect(createArg.data.tenant_id).toBe('tenant-a');
    expect(createArg.data.status).toBe('active');
    expect(createArg.data.name).toBe('Centro'); // trimmed
    expect(isValidBranchCode(createArg.data.booking_code)).toBe(true);

    // The returned view exposes the code, active status and derived portal path.
    expect(view.status).toBe('active');
    expect(view.name).toBe('Centro');
    expect(view.booking_code).not.toBeNull();
    expect(isValidBranchCode(view.booking_code as string)).toBe(true);
    expect(view.portal_path).toBe(`/reservar/${view.booking_code}`);
  });

  it('rechaza nombre vacio con 400', async () => {
    await expect(
      branchService.create('tenant-a', { name: '   ' })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockPrisma.branch.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Property 7: Aislamiento por tenant/sucursal
// Validates: Requirements 6.1
// ---------------------------------------------------------------------------
describe('branchService - Property 7: tenant isolation', () => {
  it('list SIEMPRE filtra por tenant_id', async () => {
    mockPrisma.branch.findMany.mockResolvedValue([] as any);
    makePremium();

    await branchService.list('tenant-a');

    const arg = mockPrisma.branch.findMany.mock.calls[0][0] as any;
    expect(arg.where).toEqual({ tenant_id: 'tenant-a' });
    expect(arg.orderBy).toEqual({ created_at: 'asc' });
  });

  it('get filtra por tenant_id; sucursal de OTRO tenant -> 404 BRANCH_NOT_FOUND', async () => {
    // findFirst scoped by both id AND tenant_id returns null when the branch
    // belongs to another tenant. El 404 se lanza ANTES del gating premium.
    mockPrisma.branch.findFirst.mockResolvedValue(null as any);

    await expect(
      branchService.get('tenant-a', 'branch-of-tenant-b')
    ).rejects.toMatchObject({ statusCode: 404, code: 'BRANCH_NOT_FOUND' });

    const arg = mockPrisma.branch.findFirst.mock.calls[0][0] as any;
    expect(arg.where).toEqual({ id: 'branch-of-tenant-b', tenant_id: 'tenant-a' });
  });

  it('get de una sucursal propia (premium) devuelve la vista scoped', async () => {
    makePremium();
    mockPrisma.branch.findFirst.mockResolvedValue({
      id: 'branch-1',
      name: 'Centro',
      status: 'active',
      booking_code: 'ABC234',
      timezone: 'America/Mexico_City',
    } as any);

    const view = await branchService.get('tenant-a', 'branch-1');

    expect(view).toEqual({
      id: 'branch-1',
      name: 'Centro',
      status: 'active',
      booking_code: 'ABC234',
      timezone: 'America/Mexico_City',
      portal_path: '/reservar/ABC234',
      address: null,
      city: null,
      latitude: null,
      longitude: null,
      maps_url: null,
    });
  });

  it('update filtra por tenant_id; sucursal de OTRO tenant -> 404 BRANCH_NOT_FOUND', async () => {
    mockPrisma.branch.findFirst.mockResolvedValue(null as any);

    await expect(
      branchService.update('tenant-a', 'branch-of-tenant-b', { name: 'Hack' })
    ).rejects.toMatchObject({ statusCode: 404, code: 'BRANCH_NOT_FOUND' });

    const arg = mockPrisma.branch.findFirst.mock.calls[0][0] as any;
    expect(arg.where).toEqual({ id: 'branch-of-tenant-b', tenant_id: 'tenant-a' });
    // No mutation happened on another tenant's branch.
    expect(mockPrisma.branch.update).not.toHaveBeenCalled();
  });

  it('update de una sucursal propia (premium) aplica los cambios', async () => {
    makePremium();
    mockPrisma.branch.findFirst.mockResolvedValue({
      id: 'branch-1',
      tenant_id: 'tenant-a',
      name: 'Centro',
      status: 'active',
      booking_code: 'ABC234',
      timezone: 'America/Mexico_City',
    } as any);
    mockPrisma.branch.update.mockImplementation(async (args: any) => ({
      id: 'branch-1',
      name: 'Sur',
      status: 'inactive',
      booking_code: 'ABC234',
      timezone: 'America/Mexico_City',
      ...args.data,
    }));

    const view = await branchService.update('tenant-a', 'branch-1', {
      name: 'Sur',
      status: 'inactive',
    });

    expect(view.name).toBe('Sur');
    expect(view.status).toBe('inactive');
    expect(view.portal_path).toBe('/reservar/ABC234');
  });
});

// ---------------------------------------------------------------------------
// Status validation on update
// Validates: Requirements 2.3
// ---------------------------------------------------------------------------
describe('branchService.update - status validation', () => {
  it('status invalido -> 400 sin tocar la base', async () => {
    await expect(
      branchService.update('tenant-a', 'branch-1', { status: 'archived' })
    ).rejects.toMatchObject({ statusCode: 400 });

    // Validation happens before any DB lookup/mutation.
    expect(mockPrisma.branch.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.branch.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Property 2: Free ve solo la principal (gestion)
// Validates: Requirements 2.1, 2.4
// ---------------------------------------------------------------------------
describe('branchService.list - Property 2: free ve solo la principal', () => {
  const branches = [
    {
      id: 'branch-principal',
      name: 'Centro',
      status: 'active',
      booking_code: 'AAA111',
      timezone: 'America/Mexico_City',
    },
    {
      id: 'branch-extra-1',
      name: 'Norte',
      status: 'active',
      booking_code: 'BBB222',
      timezone: 'America/Mexico_City',
    },
    {
      id: 'branch-extra-2',
      name: 'Sur',
      status: 'active',
      booking_code: 'CCC333',
      timezone: 'America/Mexico_City',
    },
  ];

  it('FREE: devuelve exactamente 1 (la primera por created_at asc = principal)', async () => {
    mockPrisma.branch.findMany.mockResolvedValue(branches as any);
    // inactive => no premium.
    mockPrisma.tenant.findUnique.mockResolvedValue({
      subscription_status: 'inactive',
      subscription_expires_at: null,
    } as any);

    const result = await branchService.list('tenant-a');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('branch-principal');
    // Se mantiene el orden asc en la query.
    expect((mockPrisma.branch.findMany.mock.calls[0][0] as any).orderBy).toEqual({
      created_at: 'asc',
    });
  });

  it('FREE sin sucursales: devuelve []', async () => {
    mockPrisma.branch.findMany.mockResolvedValue([] as any);
    mockPrisma.tenant.findUnique.mockResolvedValue({
      subscription_status: 'inactive',
      subscription_expires_at: null,
    } as any);

    const result = await branchService.list('tenant-a');
    expect(result).toHaveLength(0);
  });

  it('PREMIUM (active + expires futuro): devuelve todas', async () => {
    mockPrisma.branch.findMany.mockResolvedValue(branches as any);
    mockPrisma.tenant.findUnique.mockResolvedValue({
      subscription_status: 'active',
      subscription_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    } as any);

    const result = await branchService.list('tenant-a');

    expect(result).toHaveLength(3);
    expect(result.map((b) => b.id)).toEqual([
      'branch-principal',
      'branch-extra-1',
      'branch-extra-2',
    ]);
  });

  it('PREMIUM (active + expires null): devuelve todas', async () => {
    mockPrisma.branch.findMany.mockResolvedValue(branches as any);
    makePremium();

    const result = await branchService.list('tenant-a');
    expect(result).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Property 3: Free bloquea la extra (gestion)
// Validates: Requirements 2.2
// ---------------------------------------------------------------------------
describe('branchService.get/update - Property 3: free bloquea la extra', () => {
  const ownedExtra = {
    id: 'branch-extra',
    tenant_id: 'tenant-a',
    name: 'Norte',
    status: 'active',
    booking_code: 'BBB222',
    timezone: 'America/Mexico_City',
  };
  const ownedPrimary = {
    id: 'branch-principal',
    tenant_id: 'tenant-a',
    name: 'Centro',
    status: 'active',
    booking_code: 'AAA111',
    timezone: 'America/Mexico_City',
  };

  it('FREE + get de sucursal extra (id != principal) -> 403 PREMIUM_REQUIRED', async () => {
    makeFree('branch-principal', ownedExtra);

    await expect(
      branchService.get('tenant-a', 'branch-extra')
    ).rejects.toMatchObject({ statusCode: 403, code: 'PREMIUM_REQUIRED' });
  });

  it('FREE + get de la principal -> ok (devuelve BranchView)', async () => {
    makeFree('branch-principal', ownedPrimary);

    const view = await branchService.get('tenant-a', 'branch-principal');

    expect(view.id).toBe('branch-principal');
    expect(view.portal_path).toBe('/reservar/AAA111');
  });

  it('FREE + update de sucursal extra -> 403 y NO llama prisma.branch.update', async () => {
    makeFree('branch-principal', ownedExtra);

    await expect(
      branchService.update('tenant-a', 'branch-extra', { name: 'Hack' })
    ).rejects.toMatchObject({ statusCode: 403, code: 'PREMIUM_REQUIRED' });

    expect(mockPrisma.branch.update).not.toHaveBeenCalled();
  });

  it('FREE + update de la principal -> ok', async () => {
    makeFree('branch-principal', ownedPrimary);
    mockPrisma.branch.update.mockImplementation(async (args: any) => ({
      ...ownedPrimary,
      ...args.data,
    }));

    const view = await branchService.update('tenant-a', 'branch-principal', {
      name: 'Centro 2',
    });

    expect(view.name).toBe('Centro 2');
    expect(mockPrisma.branch.update).toHaveBeenCalledTimes(1);
  });

  it('PREMIUM + get de cualquier sucursal (incluso extra) -> ok', async () => {
    makePremium();
    mockPrisma.branch.findFirst.mockResolvedValue(ownedExtra as any);

    const view = await branchService.get('tenant-a', 'branch-extra');
    expect(view.id).toBe('branch-extra');
  });

  it('PREMIUM + update de cualquier sucursal (incluso extra) -> ok', async () => {
    makePremium();
    mockPrisma.branch.findFirst.mockResolvedValue(ownedExtra as any);
    mockPrisma.branch.update.mockImplementation(async (args: any) => ({
      ...ownedExtra,
      ...args.data,
    }));

    const view = await branchService.update('tenant-a', 'branch-extra', {
      name: 'Norte 2',
    });

    expect(view.name).toBe('Norte 2');
    expect(mockPrisma.branch.update).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Property 7 (discovery-landing): direccion y coordenadas por sucursal
// Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5
// ---------------------------------------------------------------------------
import { Prisma } from '@prisma/client';

describe('branchService.update - ubicacion (address/city/lat/lng)', () => {
  const ownedPrimary = {
    id: 'branch-principal',
    tenant_id: 'tenant-a',
    name: 'Centro',
    status: 'active',
    booking_code: 'AAA111',
    timezone: 'America/Mexico_City',
    address: null,
    city: null,
    latitude: null,
    longitude: null,
  };

  it('PREMIUM: guarda address/city/latitude/longitude validos (los pasa a branch.update)', async () => {
    makePremium();
    mockPrisma.branch.findFirst.mockResolvedValue(ownedPrimary as any);
    mockPrisma.branch.update.mockImplementation(async (args: any) => ({
      ...ownedPrimary,
      ...args.data,
    }));

    const view = await branchService.update('tenant-a', 'branch-principal', {
      address: 'Av. Reforma 100',
      city: 'CDMX',
      latitude: 19.4326,
      longitude: -99.1332,
    });

    // branch.update recibe exactamente esos campos.
    const updateArg = mockPrisma.branch.update.mock.calls[0][0] as any;
    expect(updateArg.data).toMatchObject({
      address: 'Av. Reforma 100',
      city: 'CDMX',
      latitude: 19.4326,
      longitude: -99.1332,
    });

    // La vista los expone como number/string.
    expect(view.address).toBe('Av. Reforma 100');
    expect(view.city).toBe('CDMX');
    expect(view.latitude).toBe(19.4326);
    expect(view.longitude).toBe(-99.1332);
  });

  it('latitude = 91 -> 400 VALIDATION_ERROR y NO llama branch.update', async () => {
    makePremium();
    mockPrisma.branch.findFirst.mockResolvedValue(ownedPrimary as any);

    await expect(
      branchService.update('tenant-a', 'branch-principal', { latitude: 91 })
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });

    expect(mockPrisma.branch.update).not.toHaveBeenCalled();
  });

  it('longitude = -181 -> 400 VALIDATION_ERROR y NO llama branch.update', async () => {
    makePremium();
    mockPrisma.branch.findFirst.mockResolvedValue(ownedPrimary as any);

    await expect(
      branchService.update('tenant-a', 'branch-principal', { longitude: -181 })
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });

    expect(mockPrisma.branch.update).not.toHaveBeenCalled();
  });

  it('latitude = null limpia el valor (pasa null a branch.update)', async () => {
    makePremium();
    mockPrisma.branch.findFirst.mockResolvedValue({
      ...ownedPrimary,
      latitude: new Prisma.Decimal(19.4326),
    } as any);
    mockPrisma.branch.update.mockImplementation(async (args: any) => ({
      ...ownedPrimary,
      ...args.data,
    }));

    const view = await branchService.update('tenant-a', 'branch-principal', {
      latitude: null,
    });

    const updateArg = mockPrisma.branch.update.mock.calls[0][0] as any;
    expect('latitude' in updateArg.data).toBe(true);
    expect(updateArg.data.latitude).toBeNull();
    expect(view.latitude).toBeNull();
  });

  it('toBranchView expone latitude/longitude como number (no Decimal/string)', async () => {
    makePremium();
    // findFirst devuelve Decimal (como Prisma real). update hace echo sin tocar coords.
    mockPrisma.branch.findFirst.mockResolvedValue({
      ...ownedPrimary,
      latitude: new Prisma.Decimal('19.4326000'),
      longitude: new Prisma.Decimal('-99.1332000'),
    } as any);
    mockPrisma.branch.update.mockImplementation(async (args: any) => ({
      ...ownedPrimary,
      latitude: new Prisma.Decimal('19.4326000'),
      longitude: new Prisma.Decimal('-99.1332000'),
      ...args.data,
    }));

    const view = await branchService.update('tenant-a', 'branch-principal', {
      name: 'Centro 2',
    });

    expect(typeof view.latitude).toBe('number');
    expect(typeof view.longitude).toBe('number');
    expect(view.latitude).toBeCloseTo(19.4326, 4);
    expect(view.longitude).toBeCloseTo(-99.1332, 4);
  });

  it('sin campos de ubicacion en el input: no se incluyen en data (no sobrescribe)', async () => {
    makePremium();
    mockPrisma.branch.findFirst.mockResolvedValue(ownedPrimary as any);
    mockPrisma.branch.update.mockImplementation(async (args: any) => ({
      ...ownedPrimary,
      ...args.data,
    }));

    await branchService.update('tenant-a', 'branch-principal', { name: 'Solo Nombre' });

    const updateArg = mockPrisma.branch.update.mock.calls[0][0] as any;
    expect('address' in updateArg.data).toBe(false);
    expect('city' in updateArg.data).toBe(false);
    expect('latitude' in updateArg.data).toBe(false);
    expect('longitude' in updateArg.data).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Property 2 (soporte super admin): bypassPremium salta el gating
// El flag SOLO lo activa la impersonacion del super admin. Con bypassPremium=true
// y un tenant free: list devuelve TODAS y get/update de una sucursal extra NO
// lanzan 403. Sin el flag el comportamiento (ya cubierto arriba) queda intacto.
// Validates: Requirements 4.1, 4.2, 4.3
// ---------------------------------------------------------------------------
describe('branchService - bypassPremium (impersonacion super admin)', () => {
  const branches = [
    {
      id: 'branch-principal',
      name: 'Centro',
      status: 'active',
      booking_code: 'AAA111',
      timezone: 'America/Mexico_City',
    },
    {
      id: 'branch-extra-1',
      name: 'Norte',
      status: 'active',
      booking_code: 'BBB222',
      timezone: 'America/Mexico_City',
    },
    {
      id: 'branch-extra-2',
      name: 'Sur',
      status: 'active',
      booking_code: 'CCC333',
      timezone: 'America/Mexico_City',
    },
  ];

  const ownedExtra = {
    id: 'branch-extra-1',
    tenant_id: 'tenant-a',
    name: 'Norte',
    status: 'active',
    booking_code: 'BBB222',
    timezone: 'America/Mexico_City',
  };

  it('list con bypassPremium=true y tenant FREE: devuelve TODAS (sin recortar a la principal)', async () => {
    mockPrisma.branch.findMany.mockResolvedValue(branches as any);
    // Tenant free: sin el flag devolveria solo la principal.
    mockPrisma.tenant.findUnique.mockResolvedValue({
      subscription_status: 'inactive',
      subscription_expires_at: null,
    } as any);

    const result = await branchService.list('tenant-a', true);

    expect(result).toHaveLength(3);
    expect(result.map((b) => b.id)).toEqual([
      'branch-principal',
      'branch-extra-1',
      'branch-extra-2',
    ]);
    // No se consulta el estado premium cuando se salta el gating.
    expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('get con bypassPremium=true de una sucursal extra (tenant FREE): NO lanza 403', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      subscription_status: 'inactive',
      subscription_expires_at: null,
    } as any);
    mockPrisma.branch.findFirst.mockResolvedValue(ownedExtra as any);

    const view = await branchService.get('tenant-a', 'branch-extra-1', true);

    expect(view.id).toBe('branch-extra-1');
    // El guard se salta: no se consulta premium ni la sucursal principal.
    expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('update con bypassPremium=true de una sucursal extra (tenant FREE): NO lanza 403 y muta', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      subscription_status: 'inactive',
      subscription_expires_at: null,
    } as any);
    mockPrisma.branch.findFirst.mockResolvedValue(ownedExtra as any);
    mockPrisma.branch.update.mockImplementation(async (args: any) => ({
      ...ownedExtra,
      ...args.data,
    }));

    const view = await branchService.update(
      'tenant-a',
      'branch-extra-1',
      { name: 'Norte 2' },
      true
    );

    expect(view.name).toBe('Norte 2');
    expect(mockPrisma.branch.update).toHaveBeenCalledTimes(1);
  });

  it('get con bypassPremium=true conserva el 404 de pertenencia (otro tenant)', async () => {
    mockPrisma.branch.findFirst.mockResolvedValue(null as any);

    await expect(
      branchService.get('tenant-a', 'branch-of-tenant-b', true)
    ).rejects.toMatchObject({ statusCode: 404, code: 'BRANCH_NOT_FOUND' });
  });

  it('update con bypassPremium=true conserva validacion de status invalido (400)', async () => {
    await expect(
      branchService.update('tenant-a', 'branch-extra-1', { status: 'archived' }, true)
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });

    expect(mockPrisma.branch.update).not.toHaveBeenCalled();
  });
});
