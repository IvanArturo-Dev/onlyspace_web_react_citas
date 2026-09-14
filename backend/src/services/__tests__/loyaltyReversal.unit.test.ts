import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Transaction (tx) mock: exposes only the delegates the reversal path touches:
// loyaltyCountedAppointment.delete and loyaltyProgress.findUnique/update.
// $transaction runs the callback with this tx (interactive-callback form).
// A loyaltyReward mock is included purely to ASSERT it is never used: reversal
// must not revoke already-earned/redeemed rewards.
// ---------------------------------------------------------------------------
const tx = {
  loyaltyCountedAppointment: {
    delete: jest.fn(),
  },
  loyaltyProgress: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  loyaltyReward: {
    update: jest.fn(),
    delete: jest.fn(),
  },
};

const mockPrisma = {
  loyaltyCountedAppointment: {
    findMany: jest.fn(),
  },
  loyaltyReward: {
    update: jest.fn(),
    delete: jest.fn(),
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

/** Builds a fake LoyaltyCountedAppointment row. */
function countedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ca-1',
    program_id: 'prog-1',
    appointment_id: 'appt-1',
    customer_id: 'cust-1',
    counted_at: new Date('2024-06-01T00:00:00.000Z'),
    ...overrides,
  } as never;
}

const EVENT = {
  id: 'appt-1',
  tenant_id: 'tenant-a',
  customer_id: 'cust-1',
};

describe('loyaltyService.onAppointmentUncompleted (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Sensible defaults: one counted row, progress above zero.
    mockPrisma.loyaltyCountedAppointment.findMany.mockResolvedValue([countedRow()] as never);
    tx.loyaltyCountedAppointment.delete.mockResolvedValue({ id: 'ca-1' } as never);
    tx.loyaltyProgress.findUnique.mockResolvedValue({ count: 3 } as never);
    tx.loyaltyProgress.update.mockResolvedValue({ count: 2 } as never);
  });

  // -------------------------------------------------------------------------
  // Property 5: reversal is consistent — COMPLETED -> other status decrements
  // the count and leaves no orphan counted rows.
  //
  // Validates: Requirements 2.4, 8.3
  // -------------------------------------------------------------------------
  describe('Property 5: consistent reversal', () => {
    it('deletes each counted row and decrements its progress by 1', async () => {
      await loyaltyService.onAppointmentUncompleted(EVENT);

      // The counted row is looked up scoped to appointment + customer.
      expect(mockPrisma.loyaltyCountedAppointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            appointment_id: 'appt-1',
            customer_id: 'cust-1',
          }),
        })
      );

      // The counted row is deleted (no orphan count remains).
      expect(tx.loyaltyCountedAppointment.delete).toHaveBeenCalledTimes(1);
      expect(tx.loyaltyCountedAppointment.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ca-1' } })
      );

      // Progress is decremented by exactly 1 for that program/customer.
      expect(tx.loyaltyProgress.update).toHaveBeenCalledTimes(1);
      expect(tx.loyaltyProgress.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            program_id_customer_id: { program_id: 'prog-1', customer_id: 'cust-1' },
          },
          data: { count: { decrement: 1 } },
        })
      );
    });

    it('deletes every counted row and decrements once per row across programs', async () => {
      mockPrisma.loyaltyCountedAppointment.findMany.mockResolvedValue([
        countedRow({ id: 'ca-1', program_id: 'prog-1' }),
        countedRow({ id: 'ca-2', program_id: 'prog-2' }),
      ] as never);
      tx.loyaltyProgress.findUnique.mockResolvedValue({ count: 5 } as never);

      await loyaltyService.onAppointmentUncompleted(EVENT);

      // One delete + one decrement per counted row.
      expect(tx.loyaltyCountedAppointment.delete).toHaveBeenCalledTimes(2);
      expect(tx.loyaltyProgress.update).toHaveBeenCalledTimes(2);

      const deletedIds = tx.loyaltyCountedAppointment.delete.mock.calls.map(
        (c: any) => c[0].where.id
      );
      expect(deletedIds).toEqual(['ca-1', 'ca-2']);
    });

    it('does not decrement below zero when progress.count is 0', async () => {
      tx.loyaltyProgress.findUnique.mockResolvedValue({ count: 0 } as never);

      await loyaltyService.onAppointmentUncompleted(EVENT);

      // Row still deleted, but no negative decrement applied.
      expect(tx.loyaltyCountedAppointment.delete).toHaveBeenCalledTimes(1);
      expect(tx.loyaltyProgress.update).not.toHaveBeenCalled();
    });

    it('does not decrement when the progress row is missing', async () => {
      tx.loyaltyProgress.findUnique.mockResolvedValue(null as never);

      await loyaltyService.onAppointmentUncompleted(EVENT);

      expect(tx.loyaltyCountedAppointment.delete).toHaveBeenCalledTimes(1);
      expect(tx.loyaltyProgress.update).not.toHaveBeenCalled();
    });

    it('does nothing when there are no counted rows (no orphan work)', async () => {
      mockPrisma.loyaltyCountedAppointment.findMany.mockResolvedValue([] as never);

      await loyaltyService.onAppointmentUncompleted(EVENT);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(tx.loyaltyCountedAppointment.delete).not.toHaveBeenCalled();
      expect(tx.loyaltyProgress.update).not.toHaveBeenCalled();
    });

    it('does nothing when customer_id is null', async () => {
      await loyaltyService.onAppointmentUncompleted({ ...EVENT, customer_id: null });

      expect(mockPrisma.loyaltyCountedAppointment.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('does nothing when customer_id is undefined', async () => {
      await loyaltyService.onAppointmentUncompleted({ ...EVENT, customer_id: undefined });

      expect(mockPrisma.loyaltyCountedAppointment.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('never revokes rewards (no loyaltyReward update/delete calls)', async () => {
      mockPrisma.loyaltyCountedAppointment.findMany.mockResolvedValue([
        countedRow({ id: 'ca-1', program_id: 'prog-1' }),
        countedRow({ id: 'ca-2', program_id: 'prog-2' }),
      ] as never);

      await loyaltyService.onAppointmentUncompleted(EVENT);

      // Rewards (EARNED or REDEEMED) must be left untouched.
      expect(tx.loyaltyReward.update).not.toHaveBeenCalled();
      expect(tx.loyaltyReward.delete).not.toHaveBeenCalled();
      expect(mockPrisma.loyaltyReward.update).not.toHaveBeenCalled();
      expect(mockPrisma.loyaltyReward.delete).not.toHaveBeenCalled();
      expect(mockWriteAudit).not.toHaveBeenCalled();
    });
  });
});
