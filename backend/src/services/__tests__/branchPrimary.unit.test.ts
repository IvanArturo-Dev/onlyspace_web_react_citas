const mockPrisma = {
  branch: {
    findFirst: jest.fn(),
  },
  tenant: {
    findUnique: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  __esModule: true,
  prisma: mockPrisma,
}));

// Importar despues de registrar el mock de prisma.
import { getPrimaryBranchId, isTenantPremium } from '../branch.service';

/**
 * Pruebas unitarias de los helpers de sucursal principal y premium efectivo.
 *
 * Property 1 (Principal estable): getPrimaryBranchId devuelve siempre la
 *   sucursal de menor created_at, consultando con orderBy created_at asc.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3**
 */
describe('getPrimaryBranchId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('devuelve el id de la sucursal mas antigua (findFirst con orderBy asc)', async () => {
    // findFirst con orderBy created_at asc simula devolver la mas antigua.
    mockPrisma.branch.findFirst.mockResolvedValue({ id: 'branch-antigua' });

    const result = await getPrimaryBranchId('t1');

    expect(result).toBe('branch-antigua');
    expect(mockPrisma.branch.findFirst).toHaveBeenCalledWith({
      where: { tenant_id: 't1' },
      orderBy: { created_at: 'asc' },
      select: { id: true },
    });
  });

  it('devuelve null cuando el tenant no tiene sucursales', async () => {
    mockPrisma.branch.findFirst.mockResolvedValue(null);

    const result = await getPrimaryBranchId('t1');

    expect(result).toBeNull();
  });
});

/**
 * isTenantPremium reutiliza isPremiumEffective: active + expires_at futuro/null
 * => premium; active vencido, inactive o tenant inexistente => no premium.
 *
 * **Validates: Requirements 1.3**
 */
describe('isTenantPremium', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('active con expires_at nulo => true', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      subscription_status: 'active',
      subscription_expires_at: null,
    });

    await expect(isTenantPremium('t1')).resolves.toBe(true);
    expect(mockPrisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: 't1' },
      select: { subscription_status: true, subscription_expires_at: true },
    });
  });

  it('active con expires_at futuro => true', async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    mockPrisma.tenant.findUnique.mockResolvedValue({
      subscription_status: 'active',
      subscription_expires_at: future,
    });

    await expect(isTenantPremium('t1')).resolves.toBe(true);
  });

  it('active con expires_at pasado => false', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    mockPrisma.tenant.findUnique.mockResolvedValue({
      subscription_status: 'active',
      subscription_expires_at: past,
    });

    await expect(isTenantPremium('t1')).resolves.toBe(false);
  });

  it('subscription_status inactive => false', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      subscription_status: 'inactive',
      subscription_expires_at: null,
    });

    await expect(isTenantPremium('t1')).resolves.toBe(false);
  });

  it('tenant inexistente => false', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null);

    await expect(isTenantPremium('desconocido')).resolves.toBe(false);
  });
});
