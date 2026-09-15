import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AppointmentStatus } from '@prisma/client';

// ---------------------------------------------------------------------------
// Pruebas de la regla anti-duplicado por cliente/dia/servicio (Task 1.1).
//   - Property 1 (anti-duplicado): un cliente no puede tener dos citas ACTIVAS
//     del MISMO servicio el MISMO dia; el segundo intento (publico, sucursal y
//     panel) -> 409 DUPLICATE_BOOKING sin crear la cita. Una cita CANCELADA no
//     cuenta (no bloquea).
//   - Property 2 (consistente y aislado): la verificacion corre en la MISMA
//     transaccion que la creacion (sobre el `tx`) y se scopea por tenant_id +
//     service_id + status != CANCELLED + rango del dia de start_time.
//   - updateAppointment: reprogramar a un dia/servicio donde el cliente ya
//     tiene OTRA cita activa del mismo servicio -> 409 DUPLICATE_BOOKING,
//     excluyendo la propia cita (id != appointmentId).
//
// La regla es DISTINTA del aforo (SLOT_TAKEN / APPOINTMENT_CONFLICT): aqui el
// codigo es DUPLICATE_BOOKING y el criterio es cliente/dia/categoria.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Prisma mock compartido por booking.service y appointment.service.
//   - $transaction ejecuta el callback con `mockTx` (misma transaccion).
//   - `mockTx.appointment.count` respalda la verificacion anti-duplicado en la
//     transaccion; `mockTx.appointment.findMany` respalda el aforo.
//   - `prisma.appointment.count` respalda el anti-duplicado no-transaccional de
//     appointmentService.createAppointment.
// ---------------------------------------------------------------------------
const mockTx = {
  appointment: {
    count: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  customer: { findFirst: jest.fn(), create: jest.fn() },
};

const mockPrisma = {
  service: { findFirst: jest.fn(), findUnique: jest.fn() },
  branch: { findUnique: jest.fn() },
  holiday: { findFirst: jest.fn() },
  tenant: { findUnique: jest.fn() },
  customer: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
  professional: { findUnique: jest.fn() },
  user: { findUnique: jest.fn() },
  appointment: {
    count: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(async (cb: any) => cb(mockTx)),
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// Servicios integrados en appointment.service (waitlist/cancelacion/notif).
// createAppointment consulta hasDebt (sin deuda por defecto) y notifica;
// cancelAppointment registra la cancelacion y sugiere waitlist. Se mockean
// como no-op para que estos tests no dependan de su prisma.
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


// publicService mock (booking publico).
const TENANT = { id: 'tenant-a', name: 'Negocio A', booking_enabled: true } as any;
const mockResolveTenantByCode = jest.fn(async (_code: string) => TENANT);
jest.mock('../public.service', () => ({
  publicService: {
    resolveTenantByCode: (code: string) => mockResolveTenantByCode(code),
  },
}));

// audit no-op.
jest.mock('../../utils/audit', () => ({
  writeAudit: jest.fn(async () => undefined),
}));

// hook de Google no-op (best-effort).
jest.mock('../google-appointment-hook', () => ({
  runGoogleAppointmentHook: jest.fn(async () => undefined),
}));

// branchService (appointmentService.createAppointment/updateAppointment).
const mockBranchGet = jest.fn(async () => ({ id: 'branch-1' }));
jest.mock('../branch.service', () => ({
  branchService: {
    get: (...args: unknown[]) => mockBranchGet(...args),
  },
}));

// loyalty.service (importado por appointment.service).
jest.mock('../loyalty.service', () => ({
  loyaltyService: {
    onAppointmentCompleted: jest.fn(async () => undefined),
    onAppointmentUncompleted: jest.fn(async () => undefined),
  },
}));

import { bookingService } from '../booking.service';
import { appointmentService } from '../appointment.service';

// Helpers ------------------------------------------------------------------

const USER = { id: 'user-1', email: 'cliente@example.com', name: 'Cliente Uno' };

/** Telefono de contacto valido: assertBookingContact lo exige siempre. */
const PHONE = '5551234567';

/** ISO futuro (24h) para pasar la validacion de start_time futuro. */
function futureISO(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

function publicService(capacity = 1) {
  return { id: 'svc-1', tenant_id: TENANT.id, is_active: true, duration_mins: 30, capacity } as any;
}

function branchServiceRec(capacity = 1) {
  return { id: 'svc-1', branch_id: 'branch-1', is_active: true, duration_mins: 30, capacity } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveTenantByCode.mockResolvedValue(TENANT as any);
  // Customer ya existe -> resolvemos por email (no crea uno nuevo).
  mockTx.customer.findFirst.mockResolvedValue({ id: 'cust-1', tenant_id: TENANT.id, status: 'active' } as any);
  mockTx.customer.create.mockImplementation(async (args: any) => ({ id: 'cust-new', ...args.data }));
  // Sin aforo lleno por defecto.
  mockTx.appointment.findMany.mockResolvedValue([] as any);
  mockTx.appointment.create.mockImplementation(async (args: any) => ({ id: 'appt-new', ...args.data }));
  mockTx.appointment.update.mockImplementation(async (args: any) => ({ id: 'appt-1', ...args.data }));
  // Sin duplicado por defecto.
  mockTx.appointment.count.mockResolvedValue(0 as any);
  mockPrisma.appointment.count.mockResolvedValue(0 as any);
  // El negocio ofrece ambas modalidades por defecto (Requirements 2.2, 2.4).
  mockPrisma.tenant.findUnique.mockResolvedValue({ offered_modality: 'both' } as any);
  mockPrisma.branch.findUnique.mockResolvedValue({
    id: 'branch-1',
    tenant_id: TENANT.id,
    status: 'active',
  } as any);
  mockPrisma.holiday.findFirst.mockResolvedValue(null as any);
});

// =========================================================================
// Property 1: anti-duplicado por cliente/dia/servicio
// Validates: Requirements 1.1, 1.3, 1.4
// =========================================================================
describe('Anti-duplicado — Property 1 (cliente/dia/servicio)', () => {
  it('createPublicBooking: segundo booking mismo cliente/servicio/dia -> 409 DUPLICATE_BOOKING sin crear', async () => {
    mockPrisma.service.findFirst.mockResolvedValue(publicService(1));
    // Ya existe una cita activa del mismo cliente/servicio ese dia.
    mockTx.appointment.count.mockResolvedValue(1 as any);

    await expect(
      bookingService.createPublicBooking('abc123', { service_id: 'svc-1', start_time: futureISO(), contact_phone: PHONE }, USER)
    ).rejects.toMatchObject({ statusCode: 409, code: 'DUPLICATE_BOOKING' } as never);

    expect(mockTx.appointment.create).not.toHaveBeenCalled();
  });

  it('createBranchBooking: segundo booking mismo cliente/servicio/dia -> 409 DUPLICATE_BOOKING sin crear', async () => {
    mockPrisma.service.findFirst.mockResolvedValue(branchServiceRec(1));
    mockTx.appointment.count.mockResolvedValue(1 as any);

    await expect(
      bookingService.createBranchBooking('branch-1', { service_id: 'svc-1', start_time: futureISO(), contact_phone: PHONE }, USER)
    ).rejects.toMatchObject({ statusCode: 409, code: 'DUPLICATE_BOOKING' } as never);

    expect(mockTx.appointment.create).not.toHaveBeenCalled();
  });

  it('createAppointment (panel): segundo agendamiento mismo cliente/servicio/dia -> 409 DUPLICATE_BOOKING sin crear', async () => {
    mockPrisma.customer.findUnique.mockResolvedValue({ id: 'cust-1', tenant_id: TENANT.id, status: 'active' } as any);
    mockPrisma.service.findUnique.mockResolvedValue({
      id: 'svc-1',
      tenant_id: TENANT.id,
      duration_mins: 30,
    } as any);
    mockPrisma.appointment.count.mockResolvedValue(1 as any);

    await expect(
      appointmentService.createAppointment(TENANT.id, {
        customer_id: 'cust-1',
        service_id: 'svc-1',
        start_time: '2024-06-01T10:00:00.000Z',
        contact_phone: PHONE,
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'DUPLICATE_BOOKING' } as never);

    expect(mockPrisma.appointment.create).not.toHaveBeenCalled();
  });

  it('una cita CANCELADA no cuenta (count filtra status != CANCELLED) -> se permite reservar', async () => {
    mockPrisma.service.findFirst.mockResolvedValue(publicService(1));
    // count devuelve 0 porque la unica cita del cliente ese dia esta CANCELLED
    // y queda fuera del filtro status != CANCELLED.
    mockTx.appointment.count.mockResolvedValue(0 as any);

    const result = await bookingService.createPublicBooking(
      'abc123',
      { service_id: 'svc-1', start_time: futureISO(), contact_phone: PHONE },
      USER
    );

    expect(result.status).toBe(AppointmentStatus.PENDING);
    expect(mockTx.appointment.create).toHaveBeenCalledTimes(1);
  });

  it('createPublicBooking: sin duplicado crea la cita normalmente', async () => {
    mockPrisma.service.findFirst.mockResolvedValue(publicService(1));
    mockTx.appointment.count.mockResolvedValue(0 as any);

    const result = await bookingService.createPublicBooking(
      'abc123',
      { service_id: 'svc-1', start_time: futureISO(), contact_phone: PHONE },
      USER
    );

    expect(result.status).toBe(AppointmentStatus.PENDING);
    expect(mockTx.appointment.create).toHaveBeenCalledTimes(1);
  });
});

// =========================================================================
// Property 2: verificacion consistente (misma transaccion) y aislada por tenant
// Validates: Requirements 1.6, 1.7
// =========================================================================
describe('Anti-duplicado — Property 2 (consistente en transaccion y aislado por tenant)', () => {
  it('createPublicBooking: el count anti-duplicado corre en el `tx` (misma transaccion), scoped por tenant/servicio/estado/dia', async () => {
    const start = '2999-03-10T15:00:00.000Z';
    mockPrisma.service.findFirst.mockResolvedValue(publicService(1));
    mockTx.appointment.count.mockResolvedValue(0 as any);

    await bookingService.createPublicBooking('abc123', { service_id: 'svc-1', start_time: start, contact_phone: PHONE }, USER);

    // La verificacion corre sobre el tx, no sobre prisma directo.
    expect(mockTx.appointment.count).toHaveBeenCalledTimes(1);
    expect(mockPrisma.appointment.count).not.toHaveBeenCalled();

    const where = (mockTx.appointment.count.mock.calls[0] as any[])[0].where;
    expect(where.tenant_id).toBe(TENANT.id);
    expect(where.service_id).toBe('svc-1');
    expect(where.customer_id).toBe('cust-1');
    expect(where.status).toEqual({ not: AppointmentStatus.CANCELLED });
    // Rango del dia [medianoche UTC, medianoche + 1 dia).
    expect(where.start_time.gte.toISOString()).toBe('2999-03-10T00:00:00.000Z');
    expect(where.start_time.lt.toISOString()).toBe('2999-03-11T00:00:00.000Z');
  });

  it('createBranchBooking: el count anti-duplicado corre en el `tx` y se scopea al tenant de la sucursal', async () => {
    const start = '2999-03-10T15:00:00.000Z';
    mockPrisma.service.findFirst.mockResolvedValue(branchServiceRec(1));
    mockTx.appointment.count.mockResolvedValue(0 as any);

    await bookingService.createBranchBooking('branch-1', { service_id: 'svc-1', start_time: start, contact_phone: PHONE }, USER);

    expect(mockTx.appointment.count).toHaveBeenCalledTimes(1);
    const where = (mockTx.appointment.count.mock.calls[0] as any[])[0].where;
    expect(where.tenant_id).toBe(TENANT.id);
    expect(where.service_id).toBe('svc-1');
    expect(where.status).toEqual({ not: AppointmentStatus.CANCELLED });
    expect(where.start_time.gte.toISOString()).toBe('2999-03-10T00:00:00.000Z');
    expect(where.start_time.lt.toISOString()).toBe('2999-03-11T00:00:00.000Z');
  });
});

// =========================================================================
// updateAppointment: reprogramar a dia/servicio con duplicado -> 409
// Validates: Requirements 1.1, 1.4, 1.6, 1.7
// =========================================================================
describe('appointmentService.updateAppointment — anti-duplicado al reprogramar', () => {
  const APPT = 'appt-1';
  const EXISTING = {
    id: APPT,
    tenant_id: TENANT.id,
    customer_id: 'cust-1',
    service_id: 'svc-1',
    branch_id: null,
    professional_id: null,
    start_time: new Date('2024-06-01T10:00:00.000Z'),
    end_time: new Date('2024-06-01T10:30:00.000Z'),
    status: 'PENDING',
  } as any;

  beforeEach(() => {
    mockPrisma.appointment.findUnique.mockResolvedValue(EXISTING);
    mockPrisma.service.findUnique.mockResolvedValue({
      id: 'svc-1',
      tenant_id: TENANT.id,
      duration_mins: 30,
      capacity: 1,
    } as any);
  });

  it('cambiar a un DIA donde el cliente ya tiene OTRA cita activa del mismo servicio -> 409 DUPLICATE_BOOKING sin update', async () => {
    // Existe OTRA cita del cliente ese dia/servicio.
    mockTx.appointment.count.mockResolvedValue(1 as any);

    await expect(
      appointmentService.updateAppointment(TENANT.id, APPT, {
        start_time: '2024-06-05T10:00:00.000Z',
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'DUPLICATE_BOOKING' } as never);

    expect(mockTx.appointment.update).not.toHaveBeenCalled();
  });

  it('la verificacion excluye la propia cita (id != appointmentId) y se scopea por cliente/servicio/tenant/dia', async () => {
    mockTx.appointment.count.mockResolvedValue(0 as any);

    await appointmentService.updateAppointment(TENANT.id, APPT, {
      start_time: '2024-06-05T10:00:00.000Z',
    });

    expect(mockTx.appointment.count).toHaveBeenCalledTimes(1);
    const where = (mockTx.appointment.count.mock.calls[0] as any[])[0].where;
    expect(where.id).toEqual({ not: APPT });
    expect(where.customer_id).toBe('cust-1');
    expect(where.service_id).toBe('svc-1');
    expect(where.tenant_id).toBe(TENANT.id);
    expect(where.status).toEqual({ not: 'CANCELLED' });
    expect(where.start_time.gte.toISOString()).toBe('2024-06-05T00:00:00.000Z');
    expect(where.start_time.lt.toISOString()).toBe('2024-06-06T00:00:00.000Z');
  });

  it('un cambio de solo hora dentro del MISMO dia y mismo servicio NO corre la verificacion anti-duplicado', async () => {
    mockTx.appointment.count.mockResolvedValue(0 as any);

    // Mismo dia (2024-06-01), otra hora, mismo servicio.
    await appointmentService.updateAppointment(TENANT.id, APPT, {
      start_time: '2024-06-01T14:00:00.000Z',
    });

    expect(mockTx.appointment.count).not.toHaveBeenCalled();
    // El aforo si corre (findMany) y el update se aplica.
    expect(mockTx.appointment.update).toHaveBeenCalledTimes(1);
  });
});
