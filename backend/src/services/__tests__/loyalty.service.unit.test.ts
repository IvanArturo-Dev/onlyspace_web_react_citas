import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Transaction (tx) mock: exposes the loyalty* delegates the engine touches.
// $transaction just runs the callback with this tx (the engine only uses the
// interactive-callback form).
// ---------------------------------------------------------------------------
const tx = {
  loyaltyCountedAppointment: {
    create: jest.fn(),
    count: jest.fn(),
    delete: jest.fn(),
  },
  loyaltyProgress: {
    upsert: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
  loyaltyReward: {
    create: jest.fn(),
    findFirst: jest.fn(),
  },
};

const mockPrisma = {
  loyaltyProgram: {
    findMany: jest.fn(),
  },
  loyaltyCountedAppointment: {
    findMany: jest.fn(),
  },
  notification: {
    create: jest.fn(),
  },
  $transaction: jest.fn(async (cb: any) => cb(tx)),
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

const mockWriteAudit = jest.fn(async () => undefined);
jest.mock('../../utils/audit', () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
}));

import { loyaltyService } from '../loyalty.service';

/** Builds a fake LoyaltyProgram record. */
function program(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prog-1',
    tenant_id: 'tenant-a',
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

/** A P2002 (unique constraint) Prisma error, as the engine expects. */
function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.0.0',
  });
}

const EVENT = {
  id: 'appt-1',
  tenant_id: 'tenant-a',
  customer_id: 'cust-1',
};

describe('loyaltyService (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Sensible defaults.
    tx.loyaltyCountedAppointment.create.mockResolvedValue({ id: 'ca-1' } as never);
    tx.loyaltyCountedAppointment.count.mockResolvedValue(0 as never);
    tx.loyaltyProgress.upsert.mockResolvedValue({ count: 1 } as never);
    tx.loyaltyProgress.update.mockResolvedValue({ count: 0 } as never);
    tx.loyaltyReward.findFirst.mockResolvedValue(null as never);
    tx.loyaltyReward.create.mockResolvedValue({ id: 'reward-1' } as never);
    mockPrisma.notification.create.mockResolvedValue({ id: 'notif-1' } as never);
  });

  // -------------------------------------------------------------------------
  // Property 1: idempotency by appointment
  // -------------------------------------------------------------------------
  describe('Property 1: idempotency by appointment', () => {
    it('when the counted-appointment insert throws P2002, no progress and no grant', async () => {
      mockPrisma.loyaltyProgram.findMany.mockResolvedValue([program()] as never);
      tx.loyaltyCountedAppointment.create.mockRejectedValue(uniqueViolation() as never);

      await loyaltyService.onAppointmentCompleted(EVENT);

      // Duplicate detected -> we stop before incrementing progress or granting.
      expect(tx.loyaltyProgress.upsert).not.toHaveBeenCalled();
      expect(tx.loyaltyReward.create).not.toHaveBeenCalled();
      expect(mockWriteAudit).not.toHaveBeenCalled();
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });

    it('re-throws non-P2002 errors from the counted-appointment insert', async () => {
      mockPrisma.loyaltyProgram.findMany.mockResolvedValue([program()] as never);
      const other = new Prisma.PrismaClientKnownRequestError('boom', {
        code: 'P2003',
        clientVersion: '5.0.0',
      });
      tx.loyaltyCountedAppointment.create.mockRejectedValue(other as never);

      await expect(loyaltyService.onAppointmentCompleted(EVENT)).rejects.toBe(other);
    });
  });

  // -------------------------------------------------------------------------
  // Property 2: only completed appointments accumulate
  // -------------------------------------------------------------------------
  describe('Property 2: only completed appointments count', () => {
    it('does nothing when customer_id is null', async () => {
      await loyaltyService.onAppointmentCompleted({ ...EVENT, customer_id: null });

      expect(mockPrisma.loyaltyProgram.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('does nothing when customer_id is undefined', async () => {
      await loyaltyService.onAppointmentCompleted({ ...EVENT, customer_id: undefined });

      expect(mockPrisma.loyaltyProgram.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Property 3: goal crossing + reset (ACCUMULATION)
  // -------------------------------------------------------------------------
  describe('Property 3: ACCUMULATION goal and reset', () => {
    it('below goal -> no reward, no reset', async () => {
      mockPrisma.loyaltyProgram.findMany.mockResolvedValue([
        program({ goal: 3 }),
      ] as never);
      // count reaches 2, still below goal of 3.
      tx.loyaltyProgress.upsert.mockResolvedValue({ count: 2 } as never);

      await loyaltyService.onAppointmentCompleted(EVENT);

      expect(tx.loyaltyReward.create).not.toHaveBeenCalled();
      expect(tx.loyaltyProgress.update).not.toHaveBeenCalled();
    });

    it('at goal -> exactly one EARNED reward created and progress decremented by goal', async () => {
      mockPrisma.loyaltyProgram.findMany.mockResolvedValue([
        program({ goal: 3 }),
      ] as never);
      tx.loyaltyProgress.upsert.mockResolvedValue({ count: 3 } as never);

      await loyaltyService.onAppointmentCompleted(EVENT);

      // Exactly one reward, EARNED.
      expect(tx.loyaltyReward.create).toHaveBeenCalledTimes(1);
      expect(tx.loyaltyReward.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'EARNED', program_id: 'prog-1' }),
        })
      );

      // Progress decremented by goal (reset).
      expect(tx.loyaltyProgress.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { count: { decrement: 3 } },
        })
      );

      // Grant side-effects fire.
      expect(mockWriteAudit).toHaveBeenCalledTimes(1);
      expect(mockPrisma.notification.create).toHaveBeenCalledTimes(1);
    });

    it('no expiration when validity_days is null', async () => {
      mockPrisma.loyaltyProgram.findMany.mockResolvedValue([
        program({ goal: 1, validity_days: null }),
      ] as never);
      tx.loyaltyProgress.upsert.mockResolvedValue({ count: 1 } as never);

      await loyaltyService.onAppointmentCompleted(EVENT);

      expect(tx.loyaltyReward.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ expires_at: null }),
        })
      );
    });

    it('sets expires_at when validity_days is positive', async () => {
      mockPrisma.loyaltyProgram.findMany.mockResolvedValue([
        program({ goal: 1, validity_days: 30 }),
      ] as never);
      tx.loyaltyProgress.upsert.mockResolvedValue({ count: 1 } as never);

      await loyaltyService.onAppointmentCompleted(EVENT);

      const call = tx.loyaltyReward.create.mock.calls[0][0] as any;
      expect(call.data.expires_at).toBeInstanceOf(Date);
    });
  });

  // -------------------------------------------------------------------------
  // Property 7: PERIODIC window
  // -------------------------------------------------------------------------
  describe('Property 7: PERIODIC window', () => {
    it('windowed count below goal -> no reward', async () => {
      mockPrisma.loyaltyProgram.findMany.mockResolvedValue([
        program({ type: 'PERIODIC', goal: 3, window_days: 30 }),
      ] as never);
      tx.loyaltyProgress.upsert.mockResolvedValue({ count: 5 } as never);
      // Only 2 appointments fall inside the window.
      tx.loyaltyCountedAppointment.count.mockResolvedValue(2 as never);

      await loyaltyService.onAppointmentCompleted(EVENT);

      expect(tx.loyaltyReward.create).not.toHaveBeenCalled();
    });

    it('windowed count reaches goal -> one reward, counting only within window', async () => {
      mockPrisma.loyaltyProgram.findMany.mockResolvedValue([
        program({ type: 'PERIODIC', goal: 3, window_days: 30 }),
      ] as never);
      tx.loyaltyProgress.upsert.mockResolvedValue({ count: 3 } as never);
      tx.loyaltyCountedAppointment.count.mockResolvedValue(3 as never);
      tx.loyaltyReward.findFirst.mockResolvedValue(null as never);

      await loyaltyService.onAppointmentCompleted(EVENT);

      expect(tx.loyaltyReward.create).toHaveBeenCalledTimes(1);
      expect(tx.loyaltyReward.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'EARNED' }),
        })
      );

      // The windowed count query is bounded by counted_at >= windowStart.
      const countArgs = tx.loyaltyCountedAppointment.count.mock.calls[0][0] as any;
      expect(countArgs.where.program_id).toBe('prog-1');
      expect(countArgs.where.customer_id).toBe('cust-1');
      expect(countArgs.where.counted_at).toHaveProperty('gte');
      expect(countArgs.where.counted_at.gte).toBeInstanceOf(Date);

      // PERIODIC never resets progress by decrement.
      expect(tx.loyaltyProgress.update).not.toHaveBeenCalled();
    });

    it('existing EARNED reward within the window -> no duplicate grant', async () => {
      mockPrisma.loyaltyProgram.findMany.mockResolvedValue([
        program({ type: 'PERIODIC', goal: 3, window_days: 30 }),
      ] as never);
      tx.loyaltyProgress.upsert.mockResolvedValue({ count: 4 } as never);
      tx.loyaltyCountedAppointment.count.mockResolvedValue(4 as never);
      // A still-valid EARNED reward already exists for this cycle.
      tx.loyaltyReward.findFirst.mockResolvedValue({ id: 'existing-reward' } as never);

      await loyaltyService.onAppointmentCompleted(EVENT);

      expect(tx.loyaltyReward.create).not.toHaveBeenCalled();
      expect(mockWriteAudit).not.toHaveBeenCalled();
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });
  });
});
