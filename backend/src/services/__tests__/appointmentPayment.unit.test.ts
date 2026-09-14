import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Prisma mock — only the delegates appointmentService.updatePayment touches.
// findUnique backs getAppointment (tenant-scoped load); update persists.
// ---------------------------------------------------------------------------
const mockPrisma = {
  appointment: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// writeAudit is mocked so the unit test never touches the audit log. The
// service itself does not call it (the controller does), but we mock it to
// keep the module graph isolated and align with the other service unit tests.
const mockWriteAudit = jest.fn(async () => undefined);
jest.mock('../../utils/audit', () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
}));

// branchService is imported by appointment.service; mock it so the module
// loads cleanly (updatePayment never calls it).
jest.mock('../branch.service', () => ({
  branchService: {
    get: jest.fn(),
  },
}));

import { appointmentService } from '../appointment.service';
import { HttpError } from '../../utils/errors';

const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';
const APPT = 'appt-1';

/** Builds a fake Appointment record as getAppointment would return it. */
function appointment(overrides: Record<string, unknown> = {}) {
  return {
    id: APPT,
    tenant_id: TENANT,
    customer_id: 'cust-1',
    service_id: 'svc-1',
    branch_id: null,
    professional_id: null,
    start_time: new Date('2024-06-01T10:00:00.000Z'),
    end_time: new Date('2024-06-01T10:30:00.000Z'),
    status: 'PENDING',
    payment_status: 'unpaid',
    amount_total: 0,
    amount_paid: 0,
    currency: 'MXN',
    ...overrides,
  } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: appointment belongs to the caller tenant and update echoes input.
  mockPrisma.appointment.findUnique.mockResolvedValue(appointment());
  mockPrisma.appointment.update.mockImplementation(async (args: any) => ({
    ...appointment(),
    ...args.data,
  }));
});

// ---------------------------------------------------------------------------
// Property 5: payment_status derivation + amount validation
// Validates: Requirements 3.3, 3.4, 3.5, 3.6
// ---------------------------------------------------------------------------
describe('appointmentService.updatePayment — Property 5 (estado de pago)', () => {
  it('amount_paid = 0 derives unpaid', async () => {
    const result: any = await appointmentService.updatePayment(TENANT, APPT, {
      amount_total: 100,
      amount_paid: 0,
    });

    const updateArgs = mockPrisma.appointment.update.mock.calls[0][0] as any;
    expect(updateArgs.data.payment_status).toBe('unpaid');
    expect(result.payment_status).toBe('unpaid');
  });

  it('0 < amount_paid < amount_total derives partial', async () => {
    await appointmentService.updatePayment(TENANT, APPT, {
      amount_total: 100,
      amount_paid: 40,
    });

    const updateArgs = mockPrisma.appointment.update.mock.calls[0][0] as any;
    expect(updateArgs.data.payment_status).toBe('partial');
    expect(updateArgs.data.amount_total).toBe(100);
    expect(updateArgs.data.amount_paid).toBe(40);
  });

  it('amount_paid == amount_total (> 0) derives paid', async () => {
    await appointmentService.updatePayment(TENANT, APPT, {
      amount_total: 100,
      amount_paid: 100,
    });

    const updateArgs = mockPrisma.appointment.update.mock.calls[0][0] as any;
    expect(updateArgs.data.payment_status).toBe('paid');
  });

  it('amount_total == 0 && amount_paid == 0 derives unpaid (edge case)', async () => {
    await appointmentService.updatePayment(TENANT, APPT, {
      amount_total: 0,
      amount_paid: 0,
    });

    const updateArgs = mockPrisma.appointment.update.mock.calls[0][0] as any;
    expect(updateArgs.data.payment_status).toBe('unpaid');
  });

  it('rejects amount_paid > amount_total with 400 VALIDATION_ERROR and does not update', async () => {
    await expect(
      appointmentService.updatePayment(TENANT, APPT, {
        amount_total: 100,
        amount_paid: 150,
      })
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' } as any);

    expect(mockPrisma.appointment.update).not.toHaveBeenCalled();
  });

  it('rejects negative amount_paid with 400 VALIDATION_ERROR and does not update', async () => {
    await expect(
      appointmentService.updatePayment(TENANT, APPT, {
        amount_total: 100,
        amount_paid: -10,
      })
    ).rejects.toBeInstanceOf(HttpError);

    expect(mockPrisma.appointment.update).not.toHaveBeenCalled();
  });

  it('rejects negative amount_total with 400 VALIDATION_ERROR and does not update', async () => {
    await expect(
      appointmentService.updatePayment(TENANT, APPT, {
        amount_total: -5,
        amount_paid: 0,
      })
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' } as any);

    expect(mockPrisma.appointment.update).not.toHaveBeenCalled();
  });

  it('rejects non-finite amounts (NaN) with 400 VALIDATION_ERROR', async () => {
    await expect(
      appointmentService.updatePayment(TENANT, APPT, {
        amount_total: Number.NaN,
        amount_paid: 0,
      })
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' } as any);

    expect(mockPrisma.appointment.update).not.toHaveBeenCalled();
  });

  it('keeps the existing currency when currency is omitted, and applies it when provided', async () => {
    mockPrisma.appointment.findUnique.mockResolvedValue(
      appointment({ currency: 'USD' })
    );

    await appointmentService.updatePayment(TENANT, APPT, {
      amount_total: 50,
      amount_paid: 25,
    });
    const omitArgs = mockPrisma.appointment.update.mock.calls[0][0] as any;
    expect(omitArgs.data.currency).toBe('USD');

    await appointmentService.updatePayment(TENANT, APPT, {
      amount_total: 50,
      amount_paid: 25,
      currency: 'EUR',
    });
    const providedArgs = mockPrisma.appointment.update.mock.calls[1][0] as any;
    expect(providedArgs.data.currency).toBe('EUR');
  });
});

// ---------------------------------------------------------------------------
// Property 6: tenant isolation
// Validates: Requirements 3.7 (aislamiento por tenant)
// ---------------------------------------------------------------------------
describe('appointmentService.updatePayment — Property 6 (aislamiento por tenant)', () => {
  it('throws APPOINTMENT_NOT_FOUND for a foreign appointment and never updates', async () => {
    // getAppointment loads scoped by tenant_id; a foreign appointment resolves
    // to null and yields 404.
    mockPrisma.appointment.findUnique.mockResolvedValue(null as never);

    await expect(
      appointmentService.updatePayment(OTHER_TENANT, APPT, {
        amount_total: 100,
        amount_paid: 100,
      })
    ).rejects.toMatchObject({ statusCode: 404, code: 'APPOINTMENT_NOT_FOUND' } as any);

    expect(mockPrisma.appointment.update).not.toHaveBeenCalled();
  });

  it('loads the appointment scoped by tenant_id before updating', async () => {
    await appointmentService.updatePayment(TENANT, APPT, {
      amount_total: 100,
      amount_paid: 100,
    });

    const findArgs = mockPrisma.appointment.findUnique.mock.calls[0][0] as any;
    expect(findArgs.where.tenant_id).toBe(TENANT);
    expect(findArgs.where.id).toBe(APPT);

    const updateArgs = mockPrisma.appointment.update.mock.calls[0][0] as any;
    expect(updateArgs.where.tenant_id).toBe(TENANT);
    expect(updateArgs.where.id).toBe(APPT);
  });
});
