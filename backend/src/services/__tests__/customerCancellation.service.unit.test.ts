import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Prisma mock (patron de branding.service.unit.test.ts)
// ---------------------------------------------------------------------------
const mockPrisma = {
  cancellationPolicy: {
    findUnique: jest.fn(),
  },
  customerCancellationState: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

import { customerCancellationService } from '../customerCancellation.service';

const TENANT = 't1';
const CUSTOMER = 'c1';
const KEY = { tenant_id_customer_id: { tenant_id: TENANT, customer_id: CUSTOMER } };

/** Politica con defaults sobreescribibles. */
function policy(overrides: Partial<{
  grace_hours: number;
  allowed_cancellations: number;
  penalty_amount: number;
  reset_days: number;
}> = {}) {
  return {
    id: 'pol1',
    tenant_id: TENANT,
    grace_hours: 24,
    allowed_cancellations: 1,
    penalty_amount: 0,
    reset_days: 30,
    ...overrides,
  };
}

/** Registro de estado con defaults sobreescribibles. */
function stateRecord(overrides: Partial<{
  count: number;
  period_started_at: Date;
  debt_amount: number;
  debt_reason: string | null;
}> = {}) {
  return {
    id: 'st1',
    tenant_id: TENANT,
    customer_id: CUSTOMER,
    count: 0,
    period_started_at: new Date(),
    debt_amount: 0,
    debt_reason: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // upsert/update devuelven exactamente lo que reciben en data por defecto.
  mockPrisma.customerCancellationState.upsert.mockImplementation((args: any) => ({
    id: 'st1',
    tenant_id: args.where.tenant_id_customer_id.tenant_id,
    customer_id: args.where.tenant_id_customer_id.customer_id,
    ...args.create,
  }));
  mockPrisma.customerCancellationState.update.mockImplementation((args: any) => ({
    ...stateRecord(),
    ...args.data,
  }));
});

// ---------------------------------------------------------------------------
// registerCancellation — incremento y penalizacion (Property 4)
// ---------------------------------------------------------------------------
describe('registerCancellation', () => {
  it('incrementa count; la 1a cancelacion con allowed=1 NO genera deuda', async () => {
    mockPrisma.cancellationPolicy.findUnique.mockResolvedValue(
      policy({ allowed_cancellations: 1, penalty_amount: 50 })
    );
    // Sin registro previo.
    mockPrisma.customerCancellationState.findUnique.mockResolvedValue(null);

    const view = await customerCancellationService.registerCancellation(TENANT, CUSTOMER);

    expect(view.count).toBe(1);
    expect(view.debt_amount).toBe(0);
    expect(view.debt_reason).toBeNull();

    const upsertArgs = mockPrisma.customerCancellationState.upsert.mock.calls[0][0] as any;
    expect(upsertArgs.where).toEqual(KEY);
    expect(upsertArgs.create.count).toBe(1);
    expect(upsertArgs.create.debt_amount).toBe(0);
  });

  it('la cancelacion que supera allowed_cancellations agrega penalty y fija razon', async () => {
    mockPrisma.cancellationPolicy.findUnique.mockResolvedValue(
      policy({ allowed_cancellations: 1, penalty_amount: 75 })
    );
    // Ya existe una cancelacion en el periodo vigente (count=1).
    mockPrisma.customerCancellationState.findUnique.mockResolvedValue(
      stateRecord({ count: 1, debt_amount: 0, period_started_at: new Date() })
    );

    const view = await customerCancellationService.registerCancellation(TENANT, CUSTOMER);

    // 2a cancelacion -> count 2 > allowed 1 -> deuda += 75.
    expect(view.count).toBe(2);
    expect(view.debt_amount).toBe(75);
    expect(view.debt_reason).toBe('Penalizacion por cancelaciones');
  });

  it('reinicia el count antes de incrementar cuando el periodo expiro (reset_days)', async () => {
    mockPrisma.cancellationPolicy.findUnique.mockResolvedValue(
      policy({ allowed_cancellations: 1, penalty_amount: 50, reset_days: 30 })
    );
    // period_started_at hace 40 dias -> supera reset_days=30 -> reinicio.
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    mockPrisma.customerCancellationState.findUnique.mockResolvedValue(
      stateRecord({ count: 5, debt_amount: 0, period_started_at: oldDate })
    );

    const view = await customerCancellationService.registerCancellation(TENANT, CUSTOMER);

    // Reinicio -> baseCount 0 -> +1 = 1; 1 no supera allowed=1 -> sin deuda.
    expect(view.count).toBe(1);
    expect(view.debt_amount).toBe(0);
    expect(view.debt_reason).toBeNull();

    const upsertArgs = mockPrisma.customerCancellationState.upsert.mock.calls[0][0] as any;
    expect(upsertArgs.create.count).toBe(1);
  });

  it('usa defaults cuando no existe politica (allowed=1)', async () => {
    mockPrisma.cancellationPolicy.findUnique.mockResolvedValue(null);
    mockPrisma.customerCancellationState.findUnique.mockResolvedValue(
      stateRecord({ count: 1, period_started_at: new Date() })
    );

    const view = await customerCancellationService.registerCancellation(TENANT, CUSTOMER);

    // Default penalty_amount=0 -> aunque supere el limite, la deuda sigue 0.
    expect(view.count).toBe(2);
    expect(view.debt_amount).toBe(0);
    expect(view.debt_reason).toBe('Penalizacion por cancelaciones');
  });
});

// ---------------------------------------------------------------------------
// hasDebt (Property 5)
// ---------------------------------------------------------------------------
describe('hasDebt', () => {
  it('devuelve true cuando debt_amount > 0', async () => {
    mockPrisma.cancellationPolicy.findUnique.mockResolvedValue(policy());
    mockPrisma.customerCancellationState.findUnique.mockResolvedValue(
      stateRecord({ debt_amount: 30, period_started_at: new Date() })
    );

    await expect(customerCancellationService.hasDebt(TENANT, CUSTOMER)).resolves.toBe(true);
  });

  it('devuelve false cuando debt_amount es 0', async () => {
    mockPrisma.cancellationPolicy.findUnique.mockResolvedValue(policy());
    mockPrisma.customerCancellationState.findUnique.mockResolvedValue(
      stateRecord({ debt_amount: 0, period_started_at: new Date() })
    );

    await expect(customerCancellationService.hasDebt(TENANT, CUSTOMER)).resolves.toBe(false);
  });

  it('devuelve false cuando no existe registro', async () => {
    mockPrisma.customerCancellationState.findUnique.mockResolvedValue(null);
    await expect(customerCancellationService.hasDebt(TENANT, CUSTOMER)).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// confirmPayment
// ---------------------------------------------------------------------------
describe('confirmPayment', () => {
  it('pone la deuda en 0 y limpia la razon', async () => {
    mockPrisma.customerCancellationState.findUnique.mockResolvedValue(
      stateRecord({ count: 3, debt_amount: 120, debt_reason: 'Penalizacion por cancelaciones' })
    );

    const view = await customerCancellationService.confirmPayment(TENANT, CUSTOMER);

    expect(view.debt_amount).toBe(0);
    expect(view.debt_reason).toBeNull();

    const updateArgs = mockPrisma.customerCancellationState.update.mock.calls[0][0] as any;
    expect(updateArgs.where).toEqual(KEY);
    expect(updateArgs.data).toEqual({ debt_amount: 0, debt_reason: null });
  });

  it('no persiste si no existe registro y devuelve estado logico sin deuda', async () => {
    mockPrisma.customerCancellationState.findUnique.mockResolvedValue(null);

    const view = await customerCancellationService.confirmPayment(TENANT, CUSTOMER);

    expect(view.debt_amount).toBe(0);
    expect(view.debt_reason).toBeNull();
    expect(mockPrisma.customerCancellationState.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getState — reset logico y estado implicito
// ---------------------------------------------------------------------------
describe('getState', () => {
  it('devuelve estado implicito count 0 cuando no existe registro', async () => {
    mockPrisma.customerCancellationState.findUnique.mockResolvedValue(null);

    const view = await customerCancellationService.getState(TENANT, CUSTOMER);

    expect(view.count).toBe(0);
    expect(view.debt_amount).toBe(0);
    expect(view.debt_reason).toBeNull();
  });

  it('refleja count 0 cuando el periodo expiro (reset logico)', async () => {
    mockPrisma.cancellationPolicy.findUnique.mockResolvedValue(policy({ reset_days: 30 }));
    const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    mockPrisma.customerCancellationState.findUnique.mockResolvedValue(
      stateRecord({ count: 4, debt_amount: 10, period_started_at: oldDate })
    );

    const view = await customerCancellationService.getState(TENANT, CUSTOMER);

    // count reiniciado logicamente; la deuda se mantiene.
    expect(view.count).toBe(0);
    expect(view.debt_amount).toBe(10);
  });
});
