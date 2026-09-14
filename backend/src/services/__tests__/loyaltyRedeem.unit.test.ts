import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Prisma mock: only the delegates the redeem/expire/list/progress methods use.
// ---------------------------------------------------------------------------
const mockPrisma = {
  loyaltyReward: {
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    findMany: jest.fn(),
  },
  loyaltyProgram: {
    findMany: jest.fn(),
  },
  loyaltyProgress: {
    findMany: jest.fn(),
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
import { HttpError } from '../../utils/errors';

const TENANT = 'tenant-a';
const USER = 'user-1';
const NOW = Date.now();
const PAST = new Date(NOW - 1000 * 60 * 60 * 24); // 1 day ago
const FUTURE = new Date(NOW + 1000 * 60 * 60 * 24); // 1 day ahead

/** Builds a fake LoyaltyReward record. */
function reward(overrides: Record<string, unknown> = {}) {
  return {
    id: 'reward-1',
    tenant_id: TENANT,
    program_id: 'prog-1',
    customer_id: 'cust-1',
    status: 'EARNED',
    reward_text: 'Cafe gratis',
    earned_at: new Date('2024-06-01T00:00:00.000Z'),
    expires_at: null,
    redeemed_at: null,
    redeemed_by: null,
    created_at: new Date('2024-06-01T00:00:00.000Z'),
    updated_at: new Date('2024-06-01T00:00:00.000Z'),
    ...overrides,
  } as never;
}

/** Builds a fake LoyaltyProgram record. */
function program(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prog-1',
    tenant_id: TENANT,
    name: 'Sellos',
    type: 'ACCUMULATION',
    goal: 3,
    window_days: null,
    reward_text: 'Cafe gratis',
    validity_days: null,
    is_active: true,
    created_at: new Date('2024-06-01T00:00:00.000Z'),
    updated_at: new Date('2024-06-01T00:00:00.000Z'),
    ...overrides,
  } as never;
}

/**
 * Property 6 (canje unico): an EARNED reward can be redeemed exactly once; a
 * second redeem fails with 409; expired rewards cannot be redeemed; missing or
 * cross-tenant rewards return 404.
 *
 * **Validates: Requirements 4.2, 4.3**
 */
describe('loyaltyService redeem/expire (unit) - Property 6', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.loyaltyReward.update.mockImplementation(
      async (args: any) => reward({ ...args.data }) as never
    );
    mockPrisma.loyaltyReward.updateMany.mockResolvedValue({ count: 0 } as never);
    mockPrisma.loyaltyReward.findMany.mockResolvedValue([] as never);
    mockPrisma.loyaltyProgram.findMany.mockResolvedValue([] as never);
    mockPrisma.loyaltyProgress.findMany.mockResolvedValue([] as never);
  });

  // -------------------------------------------------------------------------
  // redeem: happy path (EARNED -> REDEEMED exactly once)
  // -------------------------------------------------------------------------
  describe('redeem', () => {
    it('EARNED reward -> REDEEMED with redeemed_at/redeemed_by and audit', async () => {
      mockPrisma.loyaltyReward.findFirst.mockResolvedValue(reward() as never);

      const view = await loyaltyService.redeem(TENANT, 'reward-1', USER);

      // Loaded scoped by tenant.
      expect(mockPrisma.loyaltyReward.findFirst).toHaveBeenCalledWith({
        where: { id: 'reward-1', tenant_id: TENANT },
      });

      // Updated to REDEEMED with actor + timestamp.
      const updateArgs = mockPrisma.loyaltyReward.update.mock.calls[0][0] as any;
      expect(updateArgs.where).toEqual({ id: 'reward-1' });
      expect(updateArgs.data.status).toBe('REDEEMED');
      expect(updateArgs.data.redeemed_by).toBe(USER);
      expect(updateArgs.data.redeemed_at).toBeInstanceOf(Date);

      expect(view.status).toBe('REDEEMED');
      expect(view.redeemed_by).toBe(USER);

      // Redemption audited.
      expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    });

    it('second redeem of an already REDEEMED reward -> 409 REWARD_ALREADY_REDEEMED', async () => {
      mockPrisma.loyaltyReward.findFirst.mockResolvedValue(
        reward({ status: 'REDEEMED', redeemed_by: 'someone', redeemed_at: PAST }) as never
      );

      await expect(loyaltyService.redeem(TENANT, 'reward-1', USER)).rejects.toMatchObject({
        statusCode: 409,
        code: 'REWARD_ALREADY_REDEEMED',
      });
      expect(mockPrisma.loyaltyReward.update).not.toHaveBeenCalled();
      expect(mockWriteAudit).not.toHaveBeenCalled();
    });

    it('exactly once: after redeem, a repeat is rejected (simulated store)', async () => {
      // First call: EARNED.
      mockPrisma.loyaltyReward.findFirst.mockResolvedValueOnce(reward() as never);
      await loyaltyService.redeem(TENANT, 'reward-1', USER);

      // Second call: the store now returns REDEEMED.
      mockPrisma.loyaltyReward.findFirst.mockResolvedValueOnce(
        reward({ status: 'REDEEMED', redeemed_by: USER, redeemed_at: new Date() }) as never
      );
      await expect(loyaltyService.redeem(TENANT, 'reward-1', USER)).rejects.toBeInstanceOf(
        HttpError
      );

      // Only the first call performed an update.
      expect(mockPrisma.loyaltyReward.update).toHaveBeenCalledTimes(1);
    });

    it('EXPIRED reward -> 400 REWARD_EXPIRED', async () => {
      mockPrisma.loyaltyReward.findFirst.mockResolvedValue(
        reward({ status: 'EXPIRED', expires_at: PAST }) as never
      );

      await expect(loyaltyService.redeem(TENANT, 'reward-1', USER)).rejects.toMatchObject({
        statusCode: 400,
        code: 'REWARD_EXPIRED',
      });
      expect(mockPrisma.loyaltyReward.update).not.toHaveBeenCalled();
    });

    it('EARNED but past due -> 400 REWARD_EXPIRED and flips reward to EXPIRED', async () => {
      mockPrisma.loyaltyReward.findFirst.mockResolvedValue(
        reward({ status: 'EARNED', expires_at: PAST }) as never
      );

      await expect(loyaltyService.redeem(TENANT, 'reward-1', USER)).rejects.toMatchObject({
        statusCode: 400,
        code: 'REWARD_EXPIRED',
      });

      // Lazily flipped to EXPIRED as a side effect, never REDEEMED.
      expect(mockPrisma.loyaltyReward.update).toHaveBeenCalledTimes(1);
      const updateArgs = mockPrisma.loyaltyReward.update.mock.calls[0][0] as any;
      expect(updateArgs.data.status).toBe('EXPIRED');
      expect(updateArgs.data.redeemed_by).toBeUndefined();
    });

    it('EARNED not yet due (future expiry) -> redeemable', async () => {
      mockPrisma.loyaltyReward.findFirst.mockResolvedValue(
        reward({ status: 'EARNED', expires_at: FUTURE }) as never
      );

      const view = await loyaltyService.redeem(TENANT, 'reward-1', USER);
      expect(view.status).toBe('REDEEMED');
    });

    it('not found -> 404 REWARD_NOT_FOUND', async () => {
      mockPrisma.loyaltyReward.findFirst.mockResolvedValue(null as never);

      await expect(loyaltyService.redeem(TENANT, 'missing', USER)).rejects.toMatchObject({
        statusCode: 404,
        code: 'REWARD_NOT_FOUND',
      });
    });

    it('tenant isolation: reward of another tenant -> 404 (scoped query returns null)', async () => {
      // findFirst is scoped by tenant_id, so a cross-tenant reward is not found.
      mockPrisma.loyaltyReward.findFirst.mockResolvedValue(null as never);

      await expect(
        loyaltyService.redeem('tenant-b', 'reward-1', USER)
      ).rejects.toMatchObject({ statusCode: 404, code: 'REWARD_NOT_FOUND' });

      expect(mockPrisma.loyaltyReward.findFirst).toHaveBeenCalledWith({
        where: { id: 'reward-1', tenant_id: 'tenant-b' },
      });
      expect(mockPrisma.loyaltyReward.update).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // expireDue: marks EARNED past-due as EXPIRED, leaves others untouched
  // -------------------------------------------------------------------------
  describe('expireDue', () => {
    it('marks EARNED past-due rewards as EXPIRED and returns the count (tenant scoped)', async () => {
      mockPrisma.loyaltyReward.updateMany.mockResolvedValue({ count: 2 } as never);

      const count = await loyaltyService.expireDue(TENANT);

      expect(count).toBe(2);
      const args = mockPrisma.loyaltyReward.updateMany.mock.calls[0][0] as any;
      // Only EARNED + non-null past-due rewards are targeted.
      expect(args.where.status).toBe('EARNED');
      expect(args.where.expires_at.not).toBeNull();
      expect(args.where.expires_at.lt).toBeInstanceOf(Date);
      expect(args.where.tenant_id).toBe(TENANT);
      // Never touches REDEEMED or not-yet-due (status filter excludes them).
      expect(args.data).toEqual({ status: 'EXPIRED' });
    });

    it('runs globally when tenantId is omitted (no tenant_id filter)', async () => {
      mockPrisma.loyaltyReward.updateMany.mockResolvedValue({ count: 5 } as never);

      const count = await loyaltyService.expireDue();

      expect(count).toBe(5);
      const args = mockPrisma.loyaltyReward.updateMany.mock.calls[0][0] as any;
      expect(args.where.tenant_id).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // listRewards: applies lazy expiration before returning
  // -------------------------------------------------------------------------
  describe('listRewards', () => {
    it('applies lazy expiration (calls updateMany) then returns the view list', async () => {
      mockPrisma.loyaltyReward.updateMany.mockResolvedValue({ count: 1 } as never);
      mockPrisma.loyaltyReward.findMany.mockResolvedValue([
        reward({ id: 'r1', status: 'EXPIRED', expires_at: PAST }),
        reward({ id: 'r2', status: 'EARNED' }),
      ] as never);

      const list = await loyaltyService.listRewards(TENANT);

      // Lazy sweep ran (scoped to the tenant) before the read.
      expect(mockPrisma.loyaltyReward.updateMany).toHaveBeenCalledTimes(1);
      const sweepArgs = mockPrisma.loyaltyReward.updateMany.mock.calls[0][0] as any;
      expect(sweepArgs.where.tenant_id).toBe(TENANT);

      // Read is scoped + ordered by earned_at desc.
      const findArgs = mockPrisma.loyaltyReward.findMany.mock.calls[0][0] as any;
      expect(findArgs.where.tenant_id).toBe(TENANT);
      expect(findArgs.orderBy).toEqual({ earned_at: 'desc' });

      expect(list).toHaveLength(2);
      expect(list[0]).toMatchObject({ id: 'r1', status: 'EXPIRED' });
    });

    it('filters by status and customerId when provided', async () => {
      mockPrisma.loyaltyReward.findMany.mockResolvedValue([] as never);

      await loyaltyService.listRewards(TENANT, { status: 'REDEEMED', customerId: 'cust-9' });

      const findArgs = mockPrisma.loyaltyReward.findMany.mock.calls[0][0] as any;
      expect(findArgs.where).toMatchObject({
        tenant_id: TENANT,
        status: 'REDEEMED',
        customer_id: 'cust-9',
      });
    });

    it('never throws when the lazy sweep fails; still returns the list', async () => {
      mockPrisma.loyaltyReward.updateMany.mockRejectedValue(new Error('db down') as never);
      mockPrisma.loyaltyReward.findMany.mockResolvedValue([reward({ id: 'r1' })] as never);

      const list = await loyaltyService.listRewards(TENANT);

      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('r1');
    });
  });

  // -------------------------------------------------------------------------
  // progressForCustomer: one entry per active program, 0 when none
  // -------------------------------------------------------------------------
  describe('progressForCustomer', () => {
    it('returns a count per active program, defaulting to 0 when no progress row', async () => {
      mockPrisma.loyaltyProgram.findMany.mockResolvedValue([
        program({ id: 'prog-1', goal: 10 }),
        program({ id: 'prog-2', goal: 5 }),
      ] as never);
      mockPrisma.loyaltyProgress.findMany.mockResolvedValue([
        { program_id: 'prog-1', count: 7 },
      ] as never);

      const result = await loyaltyService.progressForCustomer(TENANT, 'cust-1');

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ program: { id: 'prog-1', goal: 10 }, count: 7 });
      expect(result[1]).toMatchObject({ program: { id: 'prog-2', goal: 5 }, count: 0 });
    });

    it('returns an empty array when the tenant has no active programs', async () => {
      mockPrisma.loyaltyProgram.findMany.mockResolvedValue([] as never);

      const result = await loyaltyService.progressForCustomer(TENANT, 'cust-1');

      expect(result).toEqual([]);
      // No progress lookup when there are no programs.
      expect(mockPrisma.loyaltyProgress.findMany).not.toHaveBeenCalled();
    });
  });
});
