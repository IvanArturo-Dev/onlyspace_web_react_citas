import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Prisma mock — only the delegates the tested methods touch.
//  - customer.findUnique  -> customer-exists validation in createAppointment
//  - service.findUnique   -> service-exists validation
//  - appointment.count    -> anti-duplicado + capacity helpers
//  - appointment.findFirst-> conflict check in createAppointment
//  - appointment.findUnique-> getAppointment (tenant-scoped load) in cancel
//  - appointment.create   -> persist a new appointment
//  - appointment.update   -> persist status change (cancel)
//  - appointment.findMany -> listOpenAtRisk
// ---------------------------------------------------------------------------
const mockPrisma = {
  customer: {
    findUnique: jest.fn(),
  },
  service: {
    findUnique: jest.fn(),
  },
  tenant: {
    findUnique: jest.fn(),
  },
  appointment: {
    count: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// branchService is imported by appointment.service; mock it so the module
// loads cleanly. createAppointment only calls it when branch_id is provided
// (the tests below never pass a branch_id).
jest.mock('../branch.service', () => ({
  branchService: { get: jest.fn() },
  getPrimaryBranchId: jest.fn(),
  isTenantPremium: jest.fn(async () => true),
}));

// Loyalty + Google hooks are best-effort side effects; mock them so the unit
// test never touches them and they can never throw.
jest.mock('../loyalty.service', () => ({
  loyaltyService: {
    onAppointmentCompleted: jest.fn(async () => undefined),
    onAppointmentUncompleted: jest.fn(async () => undefined),
  },
}));
jest.mock('../google-appointment-hook', () => ({
  runGoogleAppointmentHook: jest.fn(async () => undefined),
}));

// The three services under integration (Task 7).
const mockHasDebt = jest.fn<(...args: any[]) => Promise<boolean>>();
const mockRegisterCancellation = jest.fn<(...args: any[]) => Promise<unknown>>();
jest.mock('../customerCancellation.service', () => ({
  customerCancellationService: {
    hasDebt: (...args: any[]) => mockHasDebt(...args),
    registerCancellation: (...args: any[]) => mockRegisterCancellation(...args),
  },
}));

const mockFirstWaiting = jest.fn<(...args: any[]) => Promise<unknown>>();
jest.mock('../waitlist.service', () => ({
  waitlistService: {
    firstWaiting: (...args: any[]) => mockFirstWaiting(...args),
  },
}));

const mockNotify = jest.fn<(...args: any[]) => Promise<unknown>>();
jest.mock('../notification.service', () => ({
  notificationService: {
    notify: (...args: any[]) => mockNotify(...args),
  },
}));

import { appointmentService } from '../appointment.service';

const TENANT = 'tenant-a';
const APPT = 'appt-1';
const CUSTOMER = 'cust-1';
const SERVICE = 'svc-1';

function appointment(overrides: Record<string, unknown> = {}) {
  return {
    id: APPT,
    tenant_id: TENANT,
    customer_id: CUSTOMER,
    service_id: SERVICE,
    branch_id: null,
    professional_id: null,
    start_time: new Date('2024-06-01T10:00:00.000Z'),
    end_time: new Date('2024-06-01T10:30:00.000Z'),
    status: 'PENDING',
    ...overrides,
  } as never;
}

beforeEach(() => {
  jest.clearAllMocks();

  // createAppointment happy-path defaults.
  mockPrisma.customer.findUnique.mockResolvedValue({
    id: CUSTOMER,
    tenant_id: TENANT,
    name: 'Ana',
    status: 'active',
  } as never);
  mockPrisma.service.findUnique.mockResolvedValue({
    id: SERVICE,
    tenant_id: TENANT,
    duration_mins: 30,
    capacity: 1,
  } as never);
  mockPrisma.appointment.count.mockResolvedValue(0 as never);
  mockPrisma.appointment.findFirst.mockResolvedValue(null as never);
  // Tenant lookup: modalidad ambas (Requirements 2.2, 2.4) + auto-asignacion
  // OFF por defecto, para no alterar el comportamiento historico.
  mockPrisma.tenant.findUnique.mockResolvedValue({
    offered_modality: 'both',
    waitlist_auto_assign: false,
  } as never);
  mockPrisma.appointment.create.mockImplementation(async (args: any) => ({
    ...appointment(),
    ...args.data,
    id: APPT,
  }));

  // cancelAppointment defaults: getAppointment resolves to our appointment,
  // update echoes the status change.
  mockPrisma.appointment.findUnique.mockResolvedValue(appointment());
  mockPrisma.appointment.update.mockImplementation(async (args: any) => ({
    ...appointment(),
    ...args.data,
  }));
  mockPrisma.appointment.findMany.mockResolvedValue([] as never);

  // Service defaults: no debt, no waiting entry, notify succeeds.
  mockHasDebt.mockResolvedValue(false);
  mockRegisterCancellation.mockResolvedValue(undefined);
  mockFirstWaiting.mockResolvedValue(null);
  mockNotify.mockResolvedValue({ id: 'notif-1' });
});

// ---------------------------------------------------------------------------
// createAppointment — bloqueo por deuda (Property 5) + notificacion (Property 8)
// Validates: Requirements 3.2, 6.1
// ---------------------------------------------------------------------------
describe('appointmentService.createAppointment — deuda y notificacion', () => {
  it('rechaza con 409 CUSTOMER_HAS_DEBT cuando el cliente tiene deuda y NO crea', async () => {
    mockHasDebt.mockResolvedValue(true);

    await expect(
      appointmentService.createAppointment(TENANT, {
        customer_id: CUSTOMER,
        service_id: SERVICE,
        start_time: '2024-06-01T10:00:00.000Z',
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'CUSTOMER_HAS_DEBT' } as any);

    expect(mockHasDebt).toHaveBeenCalledWith(TENANT, CUSTOMER);
    expect(mockPrisma.appointment.create).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('valida la existencia del cliente ANTES de consultar la deuda', async () => {
    mockPrisma.customer.findUnique.mockResolvedValue(null as never);

    await expect(
      appointmentService.createAppointment(TENANT, {
        customer_id: CUSTOMER,
        service_id: SERVICE,
        start_time: '2024-06-01T10:00:00.000Z',
      })
    ).rejects.toMatchObject({ statusCode: 404, code: 'CUSTOMER_NOT_FOUND' } as any);

    // hasDebt no debe consultarse para un cliente inexistente (no filtra deuda).
    expect(mockHasDebt).not.toHaveBeenCalled();
  });

  it('en creacion exitosa notifica appointment_created (best-effort)', async () => {
    const created: any = await appointmentService.createAppointment(TENANT, {
      customer_id: CUSTOMER,
      service_id: SERVICE,
      start_time: '2024-06-01T10:00:00.000Z',
      contact_phone: '5551234567',
    });

    expect(created.id).toBe(APPT);
    expect(mockPrisma.appointment.create).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    const [tenantArg, payload] = mockNotify.mock.calls[0] as any[];
    expect(tenantArg).toBe(TENANT);
    expect(payload.event_type).toBe('appointment_created');
    expect(payload.appointment_id).toBe(APPT);
    expect(payload.customer_id).toBe(CUSTOMER);
  });

  it('no rompe la creacion si notify falla (best-effort)', async () => {
    mockNotify.mockRejectedValue(new Error('notify boom'));

    const created: any = await appointmentService.createAppointment(TENANT, {
      customer_id: CUSTOMER,
      service_id: SERVICE,
      start_time: '2024-06-01T10:00:00.000Z',
      contact_phone: '5551234567',
    });

    expect(created.id).toBe(APPT);
  });
});

// ---------------------------------------------------------------------------
// cancelAppointment — registro + notificacion + sugerencia (Property 4,7,8)
// Validates: Requirements 2.4, 5.1, 6.1
// ---------------------------------------------------------------------------
describe('appointmentService.cancelAppointment — cancelacion registrada', () => {
  it('registra la cancelacion, notifica appointment_cancelled y adjunta waitlist_suggestion', async () => {
    const waiting = { id: 'wait-1', customer_id: 'cust-2', service_id: SERVICE };
    mockFirstWaiting.mockResolvedValue(waiting);

    const result: any = await appointmentService.cancelAppointment(TENANT, APPT);

    expect(mockPrisma.appointment.update).toHaveBeenCalledTimes(1);
    const updateArgs = mockPrisma.appointment.update.mock.calls[0][0] as any;
    expect(updateArgs.data.status).toBe('CANCELLED');

    expect(mockRegisterCancellation).toHaveBeenCalledWith(TENANT, CUSTOMER);

    expect(mockNotify).toHaveBeenCalledTimes(1);
    const [, payload] = mockNotify.mock.calls[0] as any[];
    expect(payload.event_type).toBe('appointment_cancelled');
    expect(payload.appointment_id).toBe(APPT);
    expect(payload.customer_id).toBe(CUSTOMER);

    // firstWaiting es solo sugerencia (Property 7): no muta nada.
    expect(mockFirstWaiting).toHaveBeenCalledWith(
      TENANT,
      SERVICE,
      new Date('2024-06-01T10:00:00.000Z')
    );
    expect(result.status).toBe('CANCELLED');
    expect(result.waitlist_suggestion).toEqual(waiting);
  });

  it('waitlist_suggestion es null cuando no hay nadie en espera', async () => {
    const result: any = await appointmentService.cancelAppointment(TENANT, APPT);
    expect(result.waitlist_suggestion).toBeNull();
  });

  it('no rompe la cancelacion si notify o firstWaiting fallan (best-effort)', async () => {
    mockNotify.mockRejectedValue(new Error('notify boom'));
    mockFirstWaiting.mockRejectedValue(new Error('waitlist boom'));

    const result: any = await appointmentService.cancelAppointment(TENANT, APPT);

    expect(result.status).toBe('CANCELLED');
    expect(result.waitlist_suggestion).toBeNull();
    // La cancelacion se persistio pese a los fallos best-effort.
    expect(mockPrisma.appointment.update).toHaveBeenCalledTimes(1);
    expect(mockRegisterCancellation).toHaveBeenCalledWith(TENANT, CUSTOMER);
  });
});

// ---------------------------------------------------------------------------
// listOpenAtRisk — ventana de 12h (Requirement 5.1, Property 1 y 7)
// ---------------------------------------------------------------------------
describe('appointmentService.listOpenAtRisk — ventana de 12h', () => {
  it('consulta citas PENDING no archivadas con start_time en las proximas 12h, scoped por tenant', async () => {
    const before = Date.now();
    await appointmentService.listOpenAtRisk(TENANT);
    const after = Date.now();

    expect(mockPrisma.appointment.findMany).toHaveBeenCalledTimes(1);
    const args = mockPrisma.appointment.findMany.mock.calls[0][0] as any;

    expect(args.where.tenant_id).toBe(TENANT);
    expect(args.where.archived).toBe(false);
    expect(args.where.status).toBe('PENDING');
    expect(args.orderBy).toEqual({ start_time: 'asc' });

    const gte = new Date(args.where.start_time.gte).getTime();
    const lte = new Date(args.where.start_time.lte).getTime();
    // gte ~= now
    expect(gte).toBeGreaterThanOrEqual(before);
    expect(gte).toBeLessThanOrEqual(after);
    // lte ~= now + 12h
    const twelveHours = 12 * 60 * 60 * 1000;
    expect(lte - gte).toBe(twelveHours);
  });
});
