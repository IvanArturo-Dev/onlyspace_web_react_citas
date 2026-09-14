import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------
const mockPrisma = {
  loyaltyProgram: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// writeAudit is best-effort side-effect; mock it so tests never touch the DB.
const mockWriteAudit = jest.fn(async () => undefined);
jest.mock('../../utils/audit', () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
}));

import { loyaltyProgramService } from '../loyaltyProgram.service';
import type { CreateLoyaltyProgramInput } from '../loyaltyProgram.service';

/** Builds a fake persisted LoyaltyProgram record for the given tenant. */
function fakeProgram(overrides: Record<string, unknown> = {}) {
  const now = new Date('2024-06-01T12:00:00.000Z');
  return {
    id: 'prog-1',
    tenant_id: 'tenant-a',
    name: 'Sellos',
    type: 'ACCUMULATION',
    goal: 10,
    window_days: null,
    reward_text: 'Cafe gratis',
    validity_days: null,
    is_active: true,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

/** A minimal valid ACCUMULATION create input. */
function validAccumulationInput(
  overrides: Partial<CreateLoyaltyProgramInput> = {}
): CreateLoyaltyProgramInput {
  return {
    name: 'Sellos',
    type: 'ACCUMULATION',
    goal: 10,
    reward_text: 'Cafe gratis',
    ...overrides,
  };
}

/** A minimal valid PERIODIC create input. */
function validPeriodicInput(
  overrides: Partial<CreateLoyaltyProgramInput> = {}
): CreateLoyaltyProgramInput {
  return {
    name: 'Mensual',
    type: 'PERIODIC',
    goal: 3,
    window_days: 30,
    reward_text: 'Descuento',
    ...overrides,
  };
}

describe('loyaltyProgramService (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // create/update echo back a persisted record by default.
    mockPrisma.loyaltyProgram.create.mockImplementation(async ({ data }: any) =>
      fakeProgram(data)
    );
    mockPrisma.loyaltyProgram.update.mockImplementation(async ({ where, data }: any) =>
      fakeProgram({ id: where.id, ...data })
    );
  });

  // -------------------------------------------------------------------------
  // Property 4 (part A): goal / window / validity validation
  // -------------------------------------------------------------------------
  describe('validation: goal must be integer >= 1', () => {
    it.each([0, -1, -5, 2.5, 1.1, NaN])(
      'rejects goal=%p with VALIDATION_ERROR',
      async (goal) => {
        await expect(
          loyaltyProgramService.create(
            'tenant-a',
            validAccumulationInput({ goal: goal as number })
          )
        ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
        expect(mockPrisma.loyaltyProgram.create).not.toHaveBeenCalled();
      }
    );

    it('accepts goal=1 (boundary)', async () => {
      const view = await loyaltyProgramService.create(
        'tenant-a',
        validAccumulationInput({ goal: 1 })
      );
      expect(view.goal).toBe(1);
      expect(mockPrisma.loyaltyProgram.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('validation: PERIODIC requires window_days >= 1', () => {
    it.each([undefined, null, 0, -3, 2.5])(
      'rejects PERIODIC with window_days=%p',
      async (windowDays) => {
        await expect(
          loyaltyProgramService.create(
            'tenant-a',
            validPeriodicInput({ window_days: windowDays as number | null })
          )
        ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
        expect(mockPrisma.loyaltyProgram.create).not.toHaveBeenCalled();
      }
    );

    it('accepts PERIODIC with window_days=1 (boundary) and persists it', async () => {
      const view = await loyaltyProgramService.create(
        'tenant-a',
        validPeriodicInput({ window_days: 1 })
      );
      expect(view.window_days).toBe(1);
      expect(mockPrisma.loyaltyProgram.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'PERIODIC', window_days: 1 }),
        })
      );
    });
  });

  describe('validation: ACCUMULATION does not require a window', () => {
    it('creates without window_days and persists window_days=null', async () => {
      const view = await loyaltyProgramService.create(
        'tenant-a',
        validAccumulationInput()
      );
      expect(view.window_days).toBeNull();
      expect(mockPrisma.loyaltyProgram.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'ACCUMULATION', window_days: null }),
        })
      );
    });

    it('forces window_days to null even when a value is supplied', async () => {
      await loyaltyProgramService.create(
        'tenant-a',
        validAccumulationInput({ window_days: 15 })
      );
      expect(mockPrisma.loyaltyProgram.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ window_days: null }),
        })
      );
    });
  });

  describe('validation: validity_days null OK, otherwise >= 1', () => {
    it('accepts null validity_days (no expiration)', async () => {
      const view = await loyaltyProgramService.create(
        'tenant-a',
        validAccumulationInput({ validity_days: null })
      );
      expect(view.validity_days).toBeNull();
    });

    it('accepts a positive validity_days', async () => {
      const view = await loyaltyProgramService.create(
        'tenant-a',
        validAccumulationInput({ validity_days: 30 })
      );
      expect(view.validity_days).toBe(30);
    });

    it.each([0, -1, 4.5])(
      'rejects invalid validity_days=%p with VALIDATION_ERROR',
      async (validity) => {
        await expect(
          loyaltyProgramService.create(
            'tenant-a',
            validAccumulationInput({ validity_days: validity as number })
          )
        ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
        expect(mockPrisma.loyaltyProgram.create).not.toHaveBeenCalled();
      }
    );
  });

  // -------------------------------------------------------------------------
  // Property 4 (part B): tenant isolation
  // -------------------------------------------------------------------------
  describe('Property 4: tenant isolation', () => {
    it('list only queries programs of the caller tenant', async () => {
      mockPrisma.loyaltyProgram.findMany.mockResolvedValue([
        fakeProgram({ tenant_id: 'tenant-a' }),
      ] as never);

      const result = await loyaltyProgramService.list('tenant-a');

      expect(result).toHaveLength(1);
      expect(mockPrisma.loyaltyProgram.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: 'tenant-a' },
        })
      );
    });

    it('get on another tenant program -> 404 PROGRAM_NOT_FOUND', async () => {
      // findFirst is scoped by tenant_id; a foreign id resolves to null.
      mockPrisma.loyaltyProgram.findFirst.mockResolvedValue(null as never);

      await expect(
        loyaltyProgramService.get('tenant-a', 'prog-of-tenant-b')
      ).rejects.toMatchObject({ statusCode: 404, code: 'PROGRAM_NOT_FOUND' });

      expect(mockPrisma.loyaltyProgram.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'prog-of-tenant-b', tenant_id: 'tenant-a' },
        })
      );
    });

    it('update on another tenant program -> 404 and no write', async () => {
      mockPrisma.loyaltyProgram.findFirst.mockResolvedValue(null as never);

      await expect(
        loyaltyProgramService.update('tenant-a', 'prog-of-tenant-b', { name: 'x' })
      ).rejects.toMatchObject({ statusCode: 404, code: 'PROGRAM_NOT_FOUND' });

      expect(mockPrisma.loyaltyProgram.update).not.toHaveBeenCalled();
    });

    it('setActive on another tenant program -> 404 and no write', async () => {
      mockPrisma.loyaltyProgram.findFirst.mockResolvedValue(null as never);

      await expect(
        loyaltyProgramService.setActive('tenant-a', 'prog-of-tenant-b', false)
      ).rejects.toMatchObject({ statusCode: 404, code: 'PROGRAM_NOT_FOUND' });

      expect(mockPrisma.loyaltyProgram.update).not.toHaveBeenCalled();
    });

    it('get on an owned program returns the view', async () => {
      mockPrisma.loyaltyProgram.findFirst.mockResolvedValue(
        fakeProgram({ id: 'prog-1', tenant_id: 'tenant-a' }) as never
      );

      const view = await loyaltyProgramService.get('tenant-a', 'prog-1');
      expect(view.id).toBe('prog-1');
      expect(view.tenant_id).toBe('tenant-a');
    });
  });

  // -------------------------------------------------------------------------
  // update: revalidates provided fields, still tenant-scoped
  // -------------------------------------------------------------------------
  describe('update: revalidation on owned program', () => {
    beforeEach(() => {
      mockPrisma.loyaltyProgram.findFirst.mockResolvedValue(
        fakeProgram({ id: 'prog-1', tenant_id: 'tenant-a', type: 'ACCUMULATION' }) as never
      );
    });

    it('rejects goal < 1 with VALIDATION_ERROR', async () => {
      await expect(
        loyaltyProgramService.update('tenant-a', 'prog-1', { goal: 0 })
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
      expect(mockPrisma.loyaltyProgram.update).not.toHaveBeenCalled();
    });

    it('switching to PERIODIC without a window_days rejects', async () => {
      // Existing window is null (ACCUMULATION); changing type to PERIODIC with
      // no window fails validation.
      await expect(
        loyaltyProgramService.update('tenant-a', 'prog-1', { type: 'PERIODIC' })
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    });

    it('applies a valid name change', async () => {
      const view = await loyaltyProgramService.update('tenant-a', 'prog-1', {
        name: 'Nuevo nombre',
      });
      expect(view.name).toBe('Nuevo nombre');
      expect(mockPrisma.loyaltyProgram.update).toHaveBeenCalledTimes(1);
    });
  });
});
