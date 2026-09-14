import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Prisma mock: solo los delegados que usan claim/redeem.
// findUnique se usa para verificar la unicidad del claim_code.
// ---------------------------------------------------------------------------
const mockPrisma = {
  loyaltyReward: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

const mockWriteAudit = jest.fn(async () => undefined);
jest.mock('../../utils/audit', () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
}));

import { loyaltyService } from '../loyalty.service';

const TENANT = 'tenant-a';
const CUSTOMER = 'cust-1';
const USER = 'user-1';
const NOW = Date.now();
const PAST = new Date(NOW - 1000 * 60 * 60 * 24); // hace 1 dia
const FUTURE = new Date(NOW + 1000 * 60 * 60 * 24); // en 1 dia

/** Construye una recompensa LoyaltyReward de prueba. */
function reward(overrides: Record<string, unknown> = {}) {
  return {
    id: 'reward-1',
    tenant_id: TENANT,
    program_id: 'prog-1',
    customer_id: CUSTOMER,
    status: 'EARNED',
    reward_text: 'Cafe gratis',
    earned_at: new Date('2024-06-01T00:00:00.000Z'),
    expires_at: null,
    redeemed_at: null,
    redeemed_by: null,
    claim_code: null,
    claimed_at: null,
    created_at: new Date('2024-06-01T00:00:00.000Z'),
    updated_at: new Date('2024-06-01T00:00:00.000Z'),
    ...overrides,
  } as never;
}

/**
 * Property 1 (reclamo valido): claim() solo transiciona EARNED -> CLAIMED y
 * genera un claim_code unico; EXPIRED/REDEEMED se rechazan y una recompensa ya
 * CLAIMED es idempotente (no regenera codigo). Aislamiento por cliente/tenant.
 *
 * **Validates: Requirements 2.1, 2.4**
 */
describe('loyaltyService.claim (unit) - Property 1', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Por defecto no hay colision de claim_code.
    mockPrisma.loyaltyReward.findUnique.mockResolvedValue(null as never);
    mockPrisma.loyaltyReward.update.mockImplementation(
      async (args: any) => reward({ ...args.data }) as never
    );
  });

  it('EARNED no vencida -> CLAIMED con claim_code no vacio y claimed_at', async () => {
    mockPrisma.loyaltyReward.findFirst.mockResolvedValue(reward() as never);

    const view = await loyaltyService.claim(TENANT, 'reward-1', CUSTOMER);

    // Carga acotada por tenant + cliente.
    expect(mockPrisma.loyaltyReward.findFirst).toHaveBeenCalledWith({
      where: { id: 'reward-1', tenant_id: TENANT, customer_id: CUSTOMER },
    });

    // Update a CLAIMED con claim_code + claimed_at.
    const updateArgs = mockPrisma.loyaltyReward.update.mock.calls[0][0] as any;
    expect(updateArgs.where).toEqual({ id: 'reward-1' });
    expect(updateArgs.data.status).toBe('CLAIMED');
    expect(typeof updateArgs.data.claim_code).toBe('string');
    expect(updateArgs.data.claim_code.length).toBeGreaterThan(0);
    expect(updateArgs.data.claimed_at).toBeInstanceOf(Date);

    expect(view.status).toBe('CLAIMED');
    expect(view.claim_code).toBe(updateArgs.data.claim_code);
    expect(view.claimed_at).toBeInstanceOf(Date);

    // Reclamo auditado.
    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
  });

  it('reintenta el claim_code ante colision hasta encontrar uno libre', async () => {
    mockPrisma.loyaltyReward.findFirst.mockResolvedValue(reward() as never);
    // Primera verificacion: colision; segunda: libre.
    mockPrisma.loyaltyReward.findUnique
      .mockResolvedValueOnce(reward({ id: 'otra' }) as never)
      .mockResolvedValueOnce(null as never);

    const view = await loyaltyService.claim(TENANT, 'reward-1', CUSTOMER);

    expect(mockPrisma.loyaltyReward.findUnique).toHaveBeenCalledTimes(2);
    expect(view.status).toBe('CLAIMED');
    expect(view.claim_code).not.toBeNull();
  });

  it('EXPIRED -> 400 REWARD_EXPIRED, sin update', async () => {
    mockPrisma.loyaltyReward.findFirst.mockResolvedValue(
      reward({ status: 'EXPIRED', expires_at: PAST }) as never
    );

    await expect(loyaltyService.claim(TENANT, 'reward-1', CUSTOMER)).rejects.toMatchObject({
      statusCode: 400,
      code: 'REWARD_EXPIRED',
    });
    expect(mockPrisma.loyaltyReward.update).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it('REDEEMED -> 409 REWARD_ALREADY_REDEEMED, sin update', async () => {
    mockPrisma.loyaltyReward.findFirst.mockResolvedValue(
      reward({ status: 'REDEEMED', redeemed_by: USER, redeemed_at: PAST }) as never
    );

    await expect(loyaltyService.claim(TENANT, 'reward-1', CUSTOMER)).rejects.toMatchObject({
      statusCode: 409,
      code: 'REWARD_ALREADY_REDEEMED',
    });
    expect(mockPrisma.loyaltyReward.update).not.toHaveBeenCalled();
  });

  it('EARNED pero vencida -> 400 REWARD_EXPIRED y flip perezoso a EXPIRED', async () => {
    mockPrisma.loyaltyReward.findFirst.mockResolvedValue(
      reward({ status: 'EARNED', expires_at: PAST }) as never
    );

    await expect(loyaltyService.claim(TENANT, 'reward-1', CUSTOMER)).rejects.toMatchObject({
      statusCode: 400,
      code: 'REWARD_EXPIRED',
    });

    // Flip perezoso a EXPIRED, nunca a CLAIMED.
    expect(mockPrisma.loyaltyReward.update).toHaveBeenCalledTimes(1);
    const updateArgs = mockPrisma.loyaltyReward.update.mock.calls[0][0] as any;
    expect(updateArgs.data.status).toBe('EXPIRED');
    expect(updateArgs.data.claim_code).toBeUndefined();
  });

  it('EARNED con expiracion futura -> reclamable', async () => {
    mockPrisma.loyaltyReward.findFirst.mockResolvedValue(
      reward({ status: 'EARNED', expires_at: FUTURE }) as never
    );

    const view = await loyaltyService.claim(TENANT, 'reward-1', CUSTOMER);
    expect(view.status).toBe('CLAIMED');
  });

  it('CLAIMED previa -> idempotente: devuelve el mismo claim_code sin regenerar', async () => {
    mockPrisma.loyaltyReward.findFirst.mockResolvedValue(
      reward({ status: 'CLAIMED', claim_code: 'ABCD2345', claimed_at: PAST }) as never
    );

    const view = await loyaltyService.claim(TENANT, 'reward-1', CUSTOMER);

    expect(view.status).toBe('CLAIMED');
    expect(view.claim_code).toBe('ABCD2345');
    // No regenera codigo ni escribe: no update, no findUnique, no audit.
    expect(mockPrisma.loyaltyReward.update).not.toHaveBeenCalled();
    expect(mockPrisma.loyaltyReward.findUnique).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it('recompensa de otro cliente/tenant (findFirst null) -> 404 REWARD_NOT_FOUND', async () => {
    // findFirst esta acotada por customer_id + tenant_id -> null para ajenas.
    mockPrisma.loyaltyReward.findFirst.mockResolvedValue(null as never);

    await expect(
      loyaltyService.claim(TENANT, 'reward-1', 'otro-cliente')
    ).rejects.toMatchObject({ statusCode: 404, code: 'REWARD_NOT_FOUND' });

    expect(mockPrisma.loyaltyReward.findFirst).toHaveBeenCalledWith({
      where: { id: 'reward-1', tenant_id: TENANT, customer_id: 'otro-cliente' },
    });
    expect(mockPrisma.loyaltyReward.update).not.toHaveBeenCalled();
  });
});

/**
 * Property 2 (canje confirmado por el negocio): redeem() marca REDEEMED desde
 * EARNED o CLAIMED; REDEEMED/EXPIRED no vuelven a REDEEMED. Valida claim_code
 * cuando se envia.
 *
 * **Validates: Requirements 2.3, 2.4**
 */
describe('loyaltyService.redeem (unit) - Property 2 (CLAIMED + claimCode)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.loyaltyReward.update.mockImplementation(
      async (args: any) => reward({ ...args.data }) as never
    );
  });

  it('desde CLAIMED -> REDEEMED ok', async () => {
    mockPrisma.loyaltyReward.findFirst.mockResolvedValue(
      reward({ status: 'CLAIMED', claim_code: 'ABCD2345', claimed_at: PAST }) as never
    );

    const view = await loyaltyService.redeem(TENANT, 'reward-1', USER);

    const updateArgs = mockPrisma.loyaltyReward.update.mock.calls[0][0] as any;
    expect(updateArgs.data.status).toBe('REDEEMED');
    expect(updateArgs.data.redeemed_by).toBe(USER);
    expect(view.status).toBe('REDEEMED');
    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
  });

  it('desde EARNED -> REDEEMED ok (regresion)', async () => {
    mockPrisma.loyaltyReward.findFirst.mockResolvedValue(reward() as never);

    const view = await loyaltyService.redeem(TENANT, 'reward-1', USER);
    expect(view.status).toBe('REDEEMED');
  });

  it('REDEEMED -> 409 REWARD_ALREADY_REDEEMED', async () => {
    mockPrisma.loyaltyReward.findFirst.mockResolvedValue(
      reward({ status: 'REDEEMED', redeemed_by: 'alguien', redeemed_at: PAST }) as never
    );

    await expect(loyaltyService.redeem(TENANT, 'reward-1', USER)).rejects.toMatchObject({
      statusCode: 409,
      code: 'REWARD_ALREADY_REDEEMED',
    });
    expect(mockPrisma.loyaltyReward.update).not.toHaveBeenCalled();
  });

  it('EXPIRED -> 400 REWARD_EXPIRED', async () => {
    mockPrisma.loyaltyReward.findFirst.mockResolvedValue(
      reward({ status: 'EXPIRED', expires_at: PAST }) as never
    );

    await expect(loyaltyService.redeem(TENANT, 'reward-1', USER)).rejects.toMatchObject({
      statusCode: 400,
      code: 'REWARD_EXPIRED',
    });
    expect(mockPrisma.loyaltyReward.update).not.toHaveBeenCalled();
  });

  it('claimCode incorrecto -> 400 INVALID_CLAIM_CODE', async () => {
    mockPrisma.loyaltyReward.findFirst.mockResolvedValue(
      reward({ status: 'CLAIMED', claim_code: 'ABCD2345', claimed_at: PAST }) as never
    );

    await expect(
      loyaltyService.redeem(TENANT, 'reward-1', USER, 'XXXXXXXX')
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_CLAIM_CODE' });
    expect(mockPrisma.loyaltyReward.update).not.toHaveBeenCalled();
  });

  it('claimCode correcto -> REDEEMED ok', async () => {
    mockPrisma.loyaltyReward.findFirst.mockResolvedValue(
      reward({ status: 'CLAIMED', claim_code: 'ABCD2345', claimed_at: PAST }) as never
    );

    const view = await loyaltyService.redeem(TENANT, 'reward-1', USER, 'ABCD2345');
    expect(view.status).toBe('REDEEMED');
  });
});
