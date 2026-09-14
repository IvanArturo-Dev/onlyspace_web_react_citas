import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------
const mockTx = {
  appointment: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

const mockPrisma = {
  appointment: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  customer: { findUnique: jest.fn() },
  service: { findUnique: jest.fn() },
  professional: { findUnique: jest.fn() },
  user: { findUnique: jest.fn() },
  $transaction: jest.fn(async (cb: any) => cb(mockTx)),
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// ---------------------------------------------------------------------------
// branchService mock. `get` is scoped by tenantId in the real service, so we
// simulate: a branch that belongs to the caller's tenant resolves, a branch
// from another tenant throws 404 BRANCH_NOT_FOUND.
// ---------------------------------------------------------------------------
const mockBranchGet = jest.fn();
// Tarea 4: createAppointment ahora tambien usa isTenantPremium y
// getPrimaryBranchId (salvaguarda explicita de agendado). Se controlan por
// mock para dirigir los escenarios free/premium y principal/extra sin depender
// del flujo real de prisma dentro de branch.service.
const mockIsTenantPremium = jest.fn();
const mockGetPrimaryBranchId = jest.fn();

jest.mock('../branch.service', () => ({
  branchService: {
    get: (tenantId: string, branchId: string) => mockBranchGet(tenantId, branchId),
  },
  isTenantPremium: (tenantId: string) => mockIsTenantPremium(tenantId),
  getPrimaryBranchId: (tenantId: string) => mockGetPrimaryBranchId(tenantId),
}));

// El hook de Google es best-effort y no debe romper ni influir en el test; se
// mockea como no-op resuelto para evitar logs de error y llamadas reales.
jest.mock('../google-appointment-hook', () => ({
  runGoogleAppointmentHook: jest.fn(async () => undefined),
}));

// Servicios integrados en Tarea 7 (waitlist/cancelacion). createAppointment
// consulta hasDebt (por defecto sin deuda) y notifica best-effort; se mockean
// para que estos tests de agendado por sucursal no dependan de su prisma.
jest.mock('../customerCancellation.service', () => ({
  customerCancellationService: {
    hasDebt: jest.fn(async () => false),
    registerCancellation: jest.fn(async () => undefined),
  },
}));
jest.mock('../waitlist.service', () => ({
  waitlistService: { firstWaiting: jest.fn(async () => null) },
}));
jest.mock('../notification.service', () => ({
  notificationService: { notify: jest.fn(async () => null) },
}));

import { appointmentService } from '../appointment.service';
import { HttpError } from '../../utils/errors';

const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.appointment.findMany.mockResolvedValue([]);
  mockPrisma.appointment.count.mockResolvedValue(0);
  mockTx.appointment.findMany.mockResolvedValue([]);
  mockTx.appointment.update.mockImplementation(async (args: any) => ({ id: 'appt-1', ...args.data }));
});

describe('appointmentService.listAppointments — tenant/branch isolation (Property 5)', () => {
  it('always includes tenant_id in the where clause', async () => {
    await appointmentService.listAppointments(TENANT, {});

    const call = mockPrisma.appointment.findMany.mock.calls[0][0] as any;
    expect(call.where.tenant_id).toBe(TENANT);
    // count is also scoped by tenant_id
    const countCall = mockPrisma.appointment.count.mock.calls[0][0] as any;
    expect(countCall.where.tenant_id).toBe(TENANT);
  });

  it('adds a branch_id filter when branch_id is provided, keeping tenant scope', async () => {
    await appointmentService.listAppointments(TENANT, { branch_id: 'branch-1' });

    const call = mockPrisma.appointment.findMany.mock.calls[0][0] as any;
    expect(call.where.tenant_id).toBe(TENANT);
    expect(call.where.branch_id).toBe('branch-1');
  });

  it('does not set a branch_id filter when none is provided', async () => {
    await appointmentService.listAppointments(TENANT, {});

    const call = mockPrisma.appointment.findMany.mock.calls[0][0] as any;
    expect(call.where.branch_id).toBeUndefined();
  });

  it('scopes to the caller tenant even when a different tenant owns data', async () => {
    // Owner of OTHER_TENANT can only ever list with their own tenant_id.
    await appointmentService.listAppointments(OTHER_TENANT, { branch_id: 'branch-x' });

    const call = mockPrisma.appointment.findMany.mock.calls[0][0] as any;
    expect(call.where.tenant_id).toBe(OTHER_TENANT);
    expect(call.where.tenant_id).not.toBe(TENANT);
  });

  it('includes customer and service data in the query', async () => {
    await appointmentService.listAppointments(TENANT, {});

    const call = mockPrisma.appointment.findMany.mock.calls[0][0] as any;
    expect(call.include.customer).toBe(true);
    expect(call.include.service).toBe(true);
  });
});

describe('appointmentService.createAppointment — branch ownership (Property 5)', () => {
  beforeEach(() => {
    mockPrisma.customer.findUnique.mockResolvedValue({ id: 'cust-1', tenant_id: TENANT });
    mockPrisma.service.findUnique.mockResolvedValue({ id: 'svc-1', tenant_id: TENANT, duration_mins: 30 });
    mockPrisma.appointment.findFirst.mockResolvedValue(null);
    mockPrisma.appointment.create.mockImplementation(async (args: any) => ({ id: 'appt-1', ...args.data }));
    // Por defecto: tenant premium (sin restriccion de agendado). Los tests que
    // ejerciten el gating free sobrescriben estos mocks.
    mockIsTenantPremium.mockResolvedValue(true);
    mockGetPrimaryBranchId.mockResolvedValue('branch-primary');
  });

  it('persists branch_id when it belongs to the caller tenant', async () => {
    mockBranchGet.mockResolvedValue({ id: 'branch-1' });

    const result = await appointmentService.createAppointment(TENANT, {
      customer_id: 'cust-1',
      service_id: 'svc-1',
      start_time: new Date('2030-01-01T10:00:00Z'),
      branch_id: 'branch-1',
    });

    expect(mockBranchGet).toHaveBeenCalledWith(TENANT, 'branch-1');
    const createCall = mockPrisma.appointment.create.mock.calls[0][0] as any;
    expect(createCall.data.tenant_id).toBe(TENANT);
    expect(createCall.data.branch_id).toBe('branch-1');
    expect(result.branch_id).toBe('branch-1');
  });

  it('rejects a branch_id owned by another tenant (404)', async () => {
    // branchService.get is tenant-scoped, so a foreign branch throws 404.
    mockBranchGet.mockRejectedValue(new HttpError('Branch not found', 404, 'BRANCH_NOT_FOUND'));

    await expect(
      appointmentService.createAppointment(TENANT, {
        customer_id: 'cust-1',
        service_id: 'svc-1',
        start_time: new Date('2030-01-01T10:00:00Z'),
        branch_id: 'branch-of-other-tenant',
      })
    ).rejects.toMatchObject({ statusCode: 404, code: 'BRANCH_NOT_FOUND' });

    expect(mockBranchGet).toHaveBeenCalledWith(TENANT, 'branch-of-other-tenant');
    // never creates the appointment when the branch is foreign
    expect(mockPrisma.appointment.create).not.toHaveBeenCalled();
  });

  it('allows creating without a branch_id (backwards compatibility)', async () => {
    const result = await appointmentService.createAppointment(TENANT, {
      customer_id: 'cust-1',
      service_id: 'svc-1',
      start_time: new Date('2030-01-01T10:00:00Z'),
    });

    expect(mockBranchGet).not.toHaveBeenCalled();
    const createCall = mockPrisma.appointment.create.mock.calls[0][0] as any;
    expect(createCall.data.branch_id).toBeNull();
    expect(result.branch_id).toBeNull();
  });
});

describe('appointmentService.createAppointment — gating premium de agendado (Property 5, Req 4.3)', () => {
  beforeEach(() => {
    mockPrisma.customer.findUnique.mockResolvedValue({ id: 'cust-1', tenant_id: TENANT });
    mockPrisma.service.findUnique.mockResolvedValue({ id: 'svc-1', tenant_id: TENANT, duration_mins: 30 });
    mockPrisma.appointment.findFirst.mockResolvedValue(null);
    mockPrisma.appointment.create.mockImplementation(async (args: any) => ({ id: 'appt-1', ...args.data }));
    // branchService.get resuelve la pertenencia (rama de aislamiento cubierta
    // por otros tests); aqui nos enfocamos en la salvaguarda explicita de
    // agendado, dirigida por isTenantPremium/getPrimaryBranchId.
    mockBranchGet.mockResolvedValue({ id: 'branch-extra' });
  });

  it('FREE + sucursal EXTRA -> 403 PREMIUM_REQUIRED y NO llega a appointment.create', async () => {
    mockIsTenantPremium.mockResolvedValue(false);
    mockGetPrimaryBranchId.mockResolvedValue('branch-primary');

    await expect(
      appointmentService.createAppointment(TENANT, {
        customer_id: 'cust-1',
        service_id: 'svc-1',
        start_time: new Date('2030-01-01T10:00:00Z'),
        branch_id: 'branch-extra',
      })
    ).rejects.toMatchObject({ statusCode: 403, code: 'PREMIUM_REQUIRED' });

    // No destruccion / no efecto (Property 6): jamas se crea la cita.
    expect(mockPrisma.appointment.create).not.toHaveBeenCalled();
  });

  it('FREE + sucursal PRINCIPAL -> procede y crea la cita', async () => {
    mockIsTenantPremium.mockResolvedValue(false);
    mockGetPrimaryBranchId.mockResolvedValue('branch-primary');
    mockBranchGet.mockResolvedValue({ id: 'branch-primary' });

    const result = await appointmentService.createAppointment(TENANT, {
      customer_id: 'cust-1',
      service_id: 'svc-1',
      start_time: new Date('2030-01-01T10:00:00Z'),
      branch_id: 'branch-primary',
    });

    expect(mockPrisma.appointment.create).toHaveBeenCalledTimes(1);
    const createCall = mockPrisma.appointment.create.mock.calls[0][0] as any;
    expect(createCall.data.branch_id).toBe('branch-primary');
    expect(result.branch_id).toBe('branch-primary');
  });

  it('PREMIUM + sucursal EXTRA -> procede sin restriccion', async () => {
    mockIsTenantPremium.mockResolvedValue(true);
    // En premium ni siquiera se consulta la principal, pero se deja definido.
    mockGetPrimaryBranchId.mockResolvedValue('branch-primary');
    mockBranchGet.mockResolvedValue({ id: 'branch-extra' });

    const result = await appointmentService.createAppointment(TENANT, {
      customer_id: 'cust-1',
      service_id: 'svc-1',
      start_time: new Date('2030-01-01T10:00:00Z'),
      branch_id: 'branch-extra',
    });

    expect(mockPrisma.appointment.create).toHaveBeenCalledTimes(1);
    const createCall = mockPrisma.appointment.create.mock.calls[0][0] as any;
    expect(createCall.data.branch_id).toBe('branch-extra');
    expect(result.branch_id).toBe('branch-extra');
  });
});

describe('appointmentService.listAppointments — seguimiento NO gateado por premium (Property 6, Req 4.2)', () => {
  it('no aplica ningun filtro derivado de premium: solo tenant/archived (y branch_id si es explicito)', async () => {
    // Aunque el tenant fuese free, el listado NO consulta premium ni la
    // sucursal principal: las citas de sucursales extra siguen visibles.
    await appointmentService.listAppointments(TENANT, {});

    // No se invoca la logica de gating durante el listado.
    expect(mockIsTenantPremium).not.toHaveBeenCalled();
    expect(mockGetPrimaryBranchId).not.toHaveBeenCalled();

    const call = mockPrisma.appointment.findMany.mock.calls[0][0] as any;
    expect(call.where.tenant_id).toBe(TENANT);
    expect(call.where.archived).toBe(false);
    // Sin branch_id explicito -> no hay filtro por sucursal (ni por principal).
    expect(call.where.branch_id).toBeUndefined();
  });

  it('devuelve citas de CUALQUIER sucursal (extra incluida) tal como las entrega prisma', async () => {
    const anyBranchAppointments = [
      { id: 'a-1', branch_id: 'branch-primary', tenant_id: TENANT },
      { id: 'a-2', branch_id: 'branch-extra', tenant_id: TENANT },
    ];
    mockPrisma.appointment.findMany.mockResolvedValue(anyBranchAppointments as any);
    mockPrisma.appointment.count.mockResolvedValue(2);

    const result = await appointmentService.listAppointments(TENANT, {});

    // Las citas de la sucursal extra NO se filtran fuera del resultado.
    expect(result.appointments).toHaveLength(2);
    expect(result.appointments.map((a: any) => a.branch_id)).toEqual([
      'branch-primary',
      'branch-extra',
    ]);
    expect(mockIsTenantPremium).not.toHaveBeenCalled();
  });
});

describe('appointmentService.updateAppointment — tenant isolation (Property 5)', () => {
  it('fetches the appointment scoped by tenant_id (foreign appointment -> 404)', async () => {
    // getAppointment uses findUnique with tenant_id in the where; a foreign
    // appointment resolves to null -> 404.
    mockPrisma.appointment.findUnique.mockResolvedValue(null);

    await expect(
      appointmentService.updateAppointment(TENANT, 'appt-foreign', { notes: 'x' })
    ).rejects.toMatchObject({ statusCode: 404, code: 'APPOINTMENT_NOT_FOUND' });

    const findCall = mockPrisma.appointment.findUnique.mock.calls[0][0] as any;
    expect(findCall.where.tenant_id).toBe(TENANT);
  });

  it('rejects updating branch_id to a branch of another tenant (404)', async () => {
    mockPrisma.appointment.findUnique.mockResolvedValue({
      id: 'appt-1',
      tenant_id: TENANT,
      service_id: 'svc-1',
      branch_id: null,
      professional_id: null,
      start_time: new Date('2030-01-01T10:00:00Z'),
    });
    mockBranchGet.mockRejectedValue(new HttpError('Branch not found', 404, 'BRANCH_NOT_FOUND'));

    await expect(
      appointmentService.updateAppointment(TENANT, 'appt-1', { branch_id: 'foreign-branch' })
    ).rejects.toMatchObject({ statusCode: 404, code: 'BRANCH_NOT_FOUND' });

    expect(mockBranchGet).toHaveBeenCalledWith(TENANT, 'foreign-branch');
    expect(mockPrisma.appointment.update).not.toHaveBeenCalled();
  });

  it('updates within the tenant scope and revalidates capacity when start_time changes', async () => {
    mockPrisma.appointment.findUnique.mockResolvedValue({
      id: 'appt-1',
      tenant_id: TENANT,
      service_id: 'svc-1',
      branch_id: 'branch-1',
      professional_id: 'prof-1',
      start_time: new Date('2030-01-01T10:00:00Z'),
    });
    mockPrisma.service.findUnique.mockResolvedValue({
      id: 'svc-1',
      tenant_id: TENANT,
      duration_mins: 30,
      capacity: 1,
    });
    // No overlapping candidates -> there is room.
    mockTx.appointment.findMany.mockResolvedValue([]);
    mockTx.appointment.update.mockImplementation(async (args: any) => ({ id: 'appt-1', ...args.data }));

    await appointmentService.updateAppointment(TENANT, 'appt-1', {
      start_time: new Date('2030-01-01T12:00:00Z'),
    });

    // capacity check is scoped by tenant + branch + service and excludes the current appt
    const candidateCall = mockTx.appointment.findMany.mock.calls[0][0] as any;
    expect(candidateCall.where.tenant_id).toBe(TENANT);
    expect(candidateCall.where.branch_id).toBe('branch-1');
    expect(candidateCall.where.service_id).toBe('svc-1');
    expect(candidateCall.where.id).toEqual({ not: 'appt-1' });

    const updateCall = mockTx.appointment.update.mock.calls[0][0] as any;
    expect(updateCall.where.tenant_id).toBe(TENANT);
  });

  it('returns 409 SLOT_TAKEN when the new slot reaches the service capacity', async () => {
    mockPrisma.appointment.findUnique.mockResolvedValue({
      id: 'appt-1',
      tenant_id: TENANT,
      service_id: 'svc-1',
      branch_id: 'branch-1',
      professional_id: 'prof-1',
      start_time: new Date('2030-01-01T10:00:00Z'),
    });
    mockPrisma.service.findUnique.mockResolvedValue({
      id: 'svc-1',
      tenant_id: TENANT,
      duration_mins: 30,
      capacity: 1,
    });
    // One other overlapping appointment == capacity 1 -> slot is full.
    mockTx.appointment.findMany.mockResolvedValue([
      {
        start_time: new Date('2030-01-01T12:10:00Z'),
        end_time: new Date('2030-01-01T12:20:00Z'),
      },
    ]);

    await expect(
      appointmentService.updateAppointment(TENANT, 'appt-1', {
        start_time: new Date('2030-01-01T12:00:00Z'),
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'SLOT_TAKEN' });

    expect(mockTx.appointment.update).not.toHaveBeenCalled();
    expect(mockPrisma.appointment.update).not.toHaveBeenCalled();
  });
});
