import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Prisma mock (mismo estilo que branding.service.unit.test.ts)
// ---------------------------------------------------------------------------
const mockPrisma = {
  cancellationPolicy: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

import { cancellationPolicyService } from '../cancellationPolicy.service';
import { HttpError } from '../../utils/errors';

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getOrDefault — Requirement 1.1 / 1.4
// ---------------------------------------------------------------------------
describe('cancellationPolicyService.getOrDefault', () => {
  it('returns the defaults (without persisting) when no policy exists', async () => {
    mockPrisma.cancellationPolicy.findUnique.mockResolvedValue(null as any);

    const view = await cancellationPolicyService.getOrDefault('t1');

    expect(view).toEqual({
      tenant_id: 't1',
      grace_hours: 24,
      allowed_cancellations: 1,
      penalty_amount: 0,
      reset_days: 30,
    });
    // getOrDefault nunca persiste.
    expect(mockPrisma.cancellationPolicy.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.cancellationPolicy.update).not.toHaveBeenCalled();
    const call = mockPrisma.cancellationPolicy.findUnique.mock.calls[0][0] as any;
    expect(call.where).toEqual({ tenant_id: 't1' });
  });

  it('returns the existing policy with Decimal penalty_amount converted to number', async () => {
    // penalty_amount llega como Decimal-like (objeto con toString / Number()).
    mockPrisma.cancellationPolicy.findUnique.mockResolvedValue({
      id: 'p1',
      tenant_id: 't1',
      grace_hours: 12,
      allowed_cancellations: 2,
      penalty_amount: { toString: () => '150.50', valueOf: () => 150.5 },
      reset_days: 60,
    } as any);

    const view = await cancellationPolicyService.getOrDefault('t1');

    expect(view).toEqual({
      tenant_id: 't1',
      grace_hours: 12,
      allowed_cancellations: 2,
      penalty_amount: 150.5,
      reset_days: 60,
    });
    expect(typeof view.penalty_amount).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// update — Requirement 1.1 / 1.3
// ---------------------------------------------------------------------------
describe('cancellationPolicyService.update', () => {
  it('persists valid values via upsert and returns the updated view', async () => {
    mockPrisma.cancellationPolicy.upsert.mockResolvedValue({
      id: 'p1',
      tenant_id: 't1',
      grace_hours: 48,
      allowed_cancellations: 3,
      penalty_amount: { valueOf: () => 200 },
      reset_days: 15,
    } as any);

    const view = await cancellationPolicyService.update('t1', {
      grace_hours: 48,
      allowed_cancellations: 3,
      penalty_amount: 200,
      reset_days: 15,
    });

    expect(mockPrisma.cancellationPolicy.upsert).toHaveBeenCalledTimes(1);
    const call = mockPrisma.cancellationPolicy.upsert.mock.calls[0][0] as any;
    expect(call.where).toEqual({ tenant_id: 't1' });
    expect(call.update).toEqual({
      grace_hours: 48,
      allowed_cancellations: 3,
      penalty_amount: 200,
      reset_days: 15,
    });
    expect(call.create).toMatchObject({
      tenant_id: 't1',
      grace_hours: 48,
      allowed_cancellations: 3,
      penalty_amount: 200,
      reset_days: 15,
    });

    expect(view).toEqual({
      tenant_id: 't1',
      grace_hours: 48,
      allowed_cancellations: 3,
      penalty_amount: 200,
      reset_days: 15,
    });
  });

  it('only touches the provided fields in the update patch', async () => {
    mockPrisma.cancellationPolicy.upsert.mockResolvedValue({
      id: 'p1',
      tenant_id: 't1',
      grace_hours: 24,
      allowed_cancellations: 1,
      penalty_amount: 0,
      reset_days: 30,
    } as any);

    await cancellationPolicyService.update('t1', { grace_hours: 10 });

    const call = mockPrisma.cancellationPolicy.upsert.mock.calls[0][0] as any;
    expect(call.update).toEqual({ grace_hours: 10 });
    // create rellena el resto con defaults.
    expect(call.create).toEqual({
      tenant_id: 't1',
      grace_hours: 10,
      allowed_cancellations: 1,
      penalty_amount: 0,
      reset_days: 30,
    });
  });

  it('rejects a negative value with 400 VALIDATION_ERROR and never persists', async () => {
    await expect(
      cancellationPolicyService.update('t1', { grace_hours: -1 })
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });

    expect(mockPrisma.cancellationPolicy.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.cancellationPolicy.update).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric value with 400 VALIDATION_ERROR and never persists', async () => {
    await expect(
      cancellationPolicyService.update('t1', {
        penalty_amount: 'x' as unknown as number,
      })
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });

    expect(mockPrisma.cancellationPolicy.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.cancellationPolicy.update).not.toHaveBeenCalled();
  });

  it('rejects a non-integer integer-field with 400 VALIDATION_ERROR', async () => {
    await expect(
      cancellationPolicyService.update('t1', { allowed_cancellations: 1.5 })
    ).rejects.toBeInstanceOf(HttpError);

    expect(mockPrisma.cancellationPolicy.upsert).not.toHaveBeenCalled();
  });
});
