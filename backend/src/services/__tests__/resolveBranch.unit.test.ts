import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { HttpError } from '../../utils/errors';

// ---------------------------------------------------------------------------
// Prisma mock. Se necesitan branch.findUnique / findMany / findFirst (este
// ultimo lo usa getPrimaryBranchId) y tenant.findUnique (lo usa isTenantPremium).
// No se mockean los helpers de branch.service: se dirige su comportamiento a
// traves del mock de prisma, ya que usan prisma internamente.
// ---------------------------------------------------------------------------
const mockPrisma = {
  branch: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  tenant: { findUnique: jest.fn() },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

import { publicService } from '../public.service';

/** Helper: hace que isTenantPremium(tenantId) resuelva a `premium`. */
function stubTenantPremium(premium: boolean): void {
  mockPrisma.tenant.findUnique.mockResolvedValue(
    premium
      ? { subscription_status: 'active', subscription_expires_at: null }
      : { subscription_status: 'inactive', subscription_expires_at: null }
  );
}

// ---------------------------------------------------------------------------
// Property 4: Free oculta la extra (publico).
// resolveBranchByCode de una extra de un free -> 404 INVALID_CODE; la principal
// de ese free resuelve ok; cualquier sucursal de un premium resuelve ok.
//
// **Validates: Requirements 3.1, 3.2, 3.3**
// ---------------------------------------------------------------------------
describe('publicService.resolveBranchByCode (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const ACTIVE_BRANCH = {
    id: 'branch-1',
    tenant_id: 'tenant-1',
    name: 'Sucursal Centro',
    status: 'active',
    booking_code: 'AB3K9P',
  } as any;

  it('resuelve la principal de un tenant FREE por codigo valido (case-insensitive)', async () => {
    mockPrisma.branch.findUnique.mockResolvedValue(ACTIVE_BRANCH);
    stubTenantPremium(false);
    // La principal del tenant coincide con la branch resuelta.
    mockPrisma.branch.findFirst.mockResolvedValue({ id: 'branch-1' });

    // Codigo en minusculas -> se normaliza a mayusculas antes de consultar.
    const branch = await publicService.resolveBranchByCode('ab3k9p');

    expect(branch).toBe(ACTIVE_BRANCH);
    expect(mockPrisma.branch.findUnique).toHaveBeenCalledWith({
      where: { booking_code: 'AB3K9P' },
    });
  });

  it('resuelve una sucursal EXTRA de un tenant PREMIUM (sin restriccion)', async () => {
    mockPrisma.branch.findUnique.mockResolvedValue({
      ...ACTIVE_BRANCH,
      id: 'branch-extra',
    });
    stubTenantPremium(true);
    // Aunque exista una principal distinta, al ser premium no importa.
    mockPrisma.branch.findFirst.mockResolvedValue({ id: 'branch-1' });

    const branch = await publicService.resolveBranchByCode('AB3K9P');

    expect(branch).toMatchObject({ id: 'branch-extra' });
    // Premium: no se consulta la principal.
    expect(mockPrisma.branch.findFirst).not.toHaveBeenCalled();
  });

  it('lanza 404 INVALID_CODE para una sucursal EXTRA de un tenant FREE (no revela existencia)', async () => {
    mockPrisma.branch.findUnique.mockResolvedValue({
      ...ACTIVE_BRANCH,
      id: 'branch-extra',
    });
    stubTenantPremium(false);
    // La principal es OTRA sucursal, no la resuelta.
    mockPrisma.branch.findFirst.mockResolvedValue({ id: 'branch-1' });

    await expect(publicService.resolveBranchByCode('AB3K9P')).rejects.toMatchObject({
      statusCode: 404,
      code: 'INVALID_CODE',
    });
  });

  it('lanza 404 INVALID_CODE si el codigo no corresponde a ninguna sucursal', async () => {
    mockPrisma.branch.findUnique.mockResolvedValue(null);

    await expect(publicService.resolveBranchByCode('ZZ9999')).rejects.toMatchObject({
      statusCode: 404,
      code: 'INVALID_CODE',
    });
    expect(mockPrisma.branch.findUnique).toHaveBeenCalledTimes(1);
  });

  it('lanza 404 INVALID_CODE si la sucursal esta inactiva', async () => {
    mockPrisma.branch.findUnique.mockResolvedValue({
      ...ACTIVE_BRANCH,
      status: 'inactive',
    });

    await expect(publicService.resolveBranchByCode('AB3K9P')).rejects.toBeInstanceOf(HttpError);
    await expect(publicService.resolveBranchByCode('AB3K9P')).rejects.toMatchObject({
      statusCode: 404,
      code: 'INVALID_CODE',
    });
  });

  it('lanza 404 sin consultar la base cuando el codigo es vacio', async () => {
    await expect(publicService.resolveBranchByCode('')).rejects.toMatchObject({
      statusCode: 404,
      code: 'INVALID_CODE',
    });
    await expect(publicService.resolveBranchByCode('   ')).rejects.toMatchObject({
      statusCode: 404,
      code: 'INVALID_CODE',
    });
    expect(mockPrisma.branch.findUnique).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Property 4 (publico): searchBranches excluye las extra de tenants FREE e
// incluye todas las de premium mas la principal de cada free.
//
// **Validates: Requirements 3.4**
// ---------------------------------------------------------------------------
describe('publicService.searchBranches (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const FREE_TENANT = {
    name: 'Negocio Free',
    subscription_status: 'inactive',
    subscription_expires_at: null,
  };
  const PREMIUM_TENANT = {
    name: 'Negocio Premium',
    subscription_status: 'active',
    subscription_expires_at: null,
  };

  it('devuelve [] con q vacio o demasiado corto (sin consultar)', async () => {
    expect(await publicService.searchBranches('')).toEqual([]);
    expect(await publicService.searchBranches('a')).toEqual([]);
    expect(await publicService.searchBranches('  ')).toEqual([]);
    expect(mockPrisma.branch.findMany).not.toHaveBeenCalled();
  });

  it('incluye la principal de un free y excluye sus extras', async () => {
    mockPrisma.branch.findMany.mockResolvedValueOnce([
      {
        id: 'free-principal',
        booking_code: 'AB3K9P',
        name: 'Sucursal Principal',
        tenant_id: 'free-1',
        tenant: FREE_TENANT,
      },
      {
        id: 'free-extra',
        booking_code: 'CD7L2Q',
        name: 'Sucursal Extra',
        tenant_id: 'free-1',
        tenant: FREE_TENANT,
      },
    ]);
    // Lote de principales de los tenants free: la primera por created_at asc.
    mockPrisma.branch.findMany.mockResolvedValueOnce([
      { id: 'free-principal', tenant_id: 'free-1' },
      { id: 'free-extra', tenant_id: 'free-1' },
    ]);

    const results = await publicService.searchBranches('sucursal');

    expect(results).toEqual([
      { code: 'AB3K9P', branch_name: 'Sucursal Principal', business_name: 'Negocio Free' },
    ]);
  });

  it('incluye todas las sucursales de un tenant premium (aun las extra)', async () => {
    mockPrisma.branch.findMany.mockResolvedValueOnce([
      {
        id: 'prem-1',
        booking_code: 'AB3K9P',
        name: 'Sucursal Centro',
        tenant_id: 'prem-1',
        tenant: PREMIUM_TENANT,
      },
      {
        id: 'prem-2',
        booking_code: 'CD7L2Q',
        name: 'Sucursal Norte',
        tenant_id: 'prem-1',
        tenant: PREMIUM_TENANT,
      },
    ]);

    const results = await publicService.searchBranches('sucursal');

    expect(results).toEqual([
      { code: 'AB3K9P', branch_name: 'Sucursal Centro', business_name: 'Negocio Premium' },
      { code: 'CD7L2Q', branch_name: 'Sucursal Norte', business_name: 'Negocio Premium' },
    ]);
    // No hay tenants free -> no se consulta el lote de principales.
    expect(mockPrisma.branch.findMany).toHaveBeenCalledTimes(1);
  });

  it('devuelve solo datos no sensibles { code, branch_name, business_name }', async () => {
    mockPrisma.branch.findMany.mockResolvedValueOnce([
      {
        id: 'prem-1',
        booking_code: 'AB3K9P',
        name: 'Sucursal Centro',
        tenant_id: 'prem-1',
        tenant: PREMIUM_TENANT,
      },
    ]);

    const results = await publicService.searchBranches('centro');

    for (const r of results) {
      expect(Object.keys(r).sort()).toEqual(['branch_name', 'business_name', 'code']);
    }
  });

  it('solo consulta sucursales activas', async () => {
    mockPrisma.branch.findMany.mockResolvedValueOnce([]);

    await publicService.searchBranches('negocio');

    const arg = mockPrisma.branch.findMany.mock.calls[0][0] as any;
    expect(arg.where.status).toBe('active');
    expect(arg.take).toBeLessThanOrEqual(20);
  });

  it('omite sucursales sin booking_code', async () => {
    mockPrisma.branch.findMany.mockResolvedValueOnce([
      {
        id: 'prem-nocode',
        booking_code: null,
        name: 'Sin codigo',
        tenant_id: 'prem-1',
        tenant: PREMIUM_TENANT,
      },
      {
        id: 'prem-code',
        booking_code: 'AB3K9P',
        name: 'Con codigo',
        tenant_id: 'prem-1',
        tenant: PREMIUM_TENANT,
      },
    ]);

    const results = await publicService.searchBranches('negocio');

    expect(results).toEqual([
      { code: 'AB3K9P', branch_name: 'Con codigo', business_name: 'Negocio Premium' },
    ]);
  });
});
