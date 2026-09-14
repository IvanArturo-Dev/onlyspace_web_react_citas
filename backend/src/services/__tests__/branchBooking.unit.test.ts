import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AppointmentStatus } from '@prisma/client';

// ---------------------------------------------------------------------------
// Mock de auditoria (no-op).
// ---------------------------------------------------------------------------
jest.mock('../../utils/audit', () => ({
  writeAudit: jest.fn(async () => undefined),
}));

// ---------------------------------------------------------------------------
// Mock del hook de Google (best-effort). No-op por defecto.
// ---------------------------------------------------------------------------
const mockRunGoogleAppointmentHook = jest.fn(async () => undefined);
jest.mock('../google-appointment-hook', () => ({
  runGoogleAppointmentHook: (...args: any[]) => mockRunGoogleAppointmentHook(...args),
}));

// ---------------------------------------------------------------------------
// Mock de Prisma. branch.findUnique / service.findFirst / holiday.findFirst y
// un $transaction que ejecuta el callback con un `tx` que expone
// appointment.findMany/create y customer.findFirst/create. Tras el commit el
// service recarga la cita con appointment.findUnique.
// ---------------------------------------------------------------------------
const mockTx = {
  appointment: {
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
  },
  customer: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
};

const mockPrisma = {
  branch: { findUnique: jest.fn() },
  service: { findFirst: jest.fn() },
  holiday: { findFirst: jest.fn() },
  appointment: { findUnique: jest.fn() },
  $transaction: jest.fn(async (cb: any) => cb(mockTx)),
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const USER = { id: 'user-1', email: 'cliente@example.com', name: 'Cliente Uno' };

const BRANCH = { id: 'branch-1', tenant_id: 'tenant-a', status: 'active' };

const SERVICE = {
  id: 'svc-1',
  branch_id: BRANCH.id,
  is_active: true,
  duration_mins: 30,
};

/** Fecha ISO futura (mañana a mediodia UTC). */
function futureISO(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return d.toISOString();
}

describe('bookingService.createBranchBooking (unit) - Property 4', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.branch.findUnique.mockResolvedValue(BRANCH as any);
    mockPrisma.service.findFirst.mockResolvedValue(SERVICE as any);
    // Por defecto la fecha no es asueto.
    mockPrisma.holiday.findFirst.mockResolvedValue(null as any);
    // Por defecto no hay solape y no existe customer previo.
    mockTx.appointment.findMany.mockResolvedValue([] as any);
    mockTx.appointment.count.mockResolvedValue(0 as any);
    mockTx.customer.findFirst.mockResolvedValue(null as any);
    mockTx.customer.create.mockImplementation(async (args: any) => ({
      id: 'cust-new',
      ...args.data,
    }));
    mockTx.appointment.create.mockImplementation(async (args: any) => ({
      id: 'appt-1',
      ...args.data,
    }));
    // Recarga por defecto: devuelve la cita sin video_call_url.
    mockPrisma.appointment.findUnique.mockResolvedValue({
      id: 'appt-1',
      modality: 'in_person',
      video_call_url: null,
    } as any);
    mockRunGoogleAppointmentHook.mockResolvedValue(undefined as any);
  });

  it('crea PENDING con branch_id y tenant de la sucursal', async () => {
    const { bookingService } = await import('../booking.service');
    const start = futureISO();

    const result = await bookingService.createBranchBooking(
      BRANCH.id,
      { service_id: SERVICE.id, start_time: start },
      USER
    );

    expect(mockTx.customer.findFirst).toHaveBeenCalledWith({
      where: { tenant_id: BRANCH.tenant_id, email: USER.email },
    });
    expect(mockTx.customer.create).toHaveBeenCalledTimes(1);

    expect(mockTx.appointment.create).toHaveBeenCalledTimes(1);
    const createArgs = (mockTx.appointment.create.mock.calls[0] as any[])[0];
    expect(createArgs.data.status).toBe(AppointmentStatus.PENDING);
    expect(createArgs.data.tenant_id).toBe(BRANCH.tenant_id);
    expect(createArgs.data.branch_id).toBe(BRANCH.id);
    expect(createArgs.data.customer_id).toBe('cust-new');
    expect(createArgs.data.service_id).toBe(SERVICE.id);
    expect(createArgs.data.booked_by_email).toBe(USER.email);
    expect(createArgs.data.booked_by_name).toBe(USER.name);

    // El re-chequeo de solape esta scoped por tenant + branch.
    const findManyArgs = (mockTx.appointment.findMany.mock.calls[0] as any[])[0];
    expect(findManyArgs.where.tenant_id).toBe(BRANCH.tenant_id);
    expect(findManyArgs.where.branch_id).toBe(BRANCH.id);

    expect(result.status).toBe(AppointmentStatus.PENDING);
  });

  it('solape en la misma sucursal -> 409 SLOT_TAKEN sin crear', async () => {
    const start = futureISO();
    const startMs = new Date(start).getTime();
    mockTx.appointment.findMany.mockResolvedValue([
      {
        start_time: new Date(startMs + 10 * 60_000),
        end_time: new Date(startMs + 40 * 60_000),
      },
    ] as any);

    const { bookingService } = await import('../booking.service');

    await expect(
      bookingService.createBranchBooking(
        BRANCH.id,
        { service_id: SERVICE.id, start_time: start },
        USER
      )
    ).rejects.toMatchObject({ statusCode: 409, code: 'SLOT_TAKEN' });

    expect(mockTx.appointment.create).not.toHaveBeenCalled();
  });

  it('reserva en dia de asueto -> 409 sin crear', async () => {
    mockPrisma.holiday.findFirst.mockResolvedValue({
      id: 'hol-1',
      branch_id: BRANCH.id,
    } as any);

    const { bookingService } = await import('../booking.service');

    await expect(
      bookingService.createBranchBooking(
        BRANCH.id,
        { service_id: SERVICE.id, start_time: futureISO() },
        USER
      )
    ).rejects.toMatchObject({ statusCode: 409, code: 'SLOT_TAKEN' });

    expect(mockTx.appointment.create).not.toHaveBeenCalled();
  });

  it('start_time en el pasado -> 400 INVALID_TIME', async () => {
    const { bookingService } = await import('../booking.service');
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    await expect(
      bookingService.createBranchBooking(
        BRANCH.id,
        { service_id: SERVICE.id, start_time: past },
        USER
      )
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_TIME' });

    expect(mockTx.appointment.create).not.toHaveBeenCalled();
  });

  it('branch inexistente/inactiva -> 404 BRANCH_NOT_FOUND', async () => {
    mockPrisma.branch.findUnique.mockResolvedValue(null as any);

    const { bookingService } = await import('../booking.service');

    await expect(
      bookingService.createBranchBooking(
        BRANCH.id,
        { service_id: SERVICE.id, start_time: futureISO() },
        USER
      )
    ).rejects.toMatchObject({ statusCode: 404, code: 'BRANCH_NOT_FOUND' });
  });

  it('servicio inexistente/inactivo en la sucursal -> 404 SERVICE_NOT_FOUND', async () => {
    mockPrisma.service.findFirst.mockResolvedValue(null as any);

    const { bookingService } = await import('../booking.service');

    await expect(
      bookingService.createBranchBooking(
        BRANCH.id,
        { service_id: 'no-such', start_time: futureISO() },
        USER
      )
    ).rejects.toMatchObject({ statusCode: 404, code: 'SERVICE_NOT_FOUND' });
  });

  // -------------------------------------------------------------------------
  // Modalidad + hook de Google (public-booking-modality Task 3).
  // -------------------------------------------------------------------------

  it("persiste modality 'online' cuando input.modality='online'", async () => {
    const { bookingService } = await import('../booking.service');

    await bookingService.createBranchBooking(
      BRANCH.id,
      { service_id: SERVICE.id, start_time: futureISO(), modality: 'online' },
      USER
    );

    const createArgs = (mockTx.appointment.create.mock.calls[0] as any[])[0];
    expect(createArgs.data.modality).toBe('online');
  });

  it("persiste modality 'in_person' por defecto (sin modality en el input)", async () => {
    const { bookingService } = await import('../booking.service');

    await bookingService.createBranchBooking(
      BRANCH.id,
      { service_id: SERVICE.id, start_time: futureISO() },
      USER
    );

    const createArgs = (mockTx.appointment.create.mock.calls[0] as any[])[0];
    expect(createArgs.data.modality).toBe('in_person');
  });

  it("normaliza valores no reconocidos de modality a 'in_person'", async () => {
    const { bookingService } = await import('../booking.service');

    await bookingService.createBranchBooking(
      BRANCH.id,
      { service_id: SERVICE.id, start_time: futureISO(), modality: 'telepatia' as any },
      USER
    );

    const createArgs = (mockTx.appointment.create.mock.calls[0] as any[])[0];
    expect(createArgs.data.modality).toBe('in_person');
  });

  it("llama runGoogleAppointmentHook('created', tenant_id, appointment.id) tras crear", async () => {
    const { bookingService } = await import('../booking.service');

    await bookingService.createBranchBooking(
      BRANCH.id,
      { service_id: SERVICE.id, start_time: futureISO(), modality: 'online' },
      USER
    );

    expect(mockRunGoogleAppointmentHook).toHaveBeenCalledTimes(1);
    expect(mockRunGoogleAppointmentHook).toHaveBeenCalledWith(
      'created',
      BRANCH.tenant_id,
      'appt-1'
    );
  });

  it('best-effort: si el hook rechaza/lanza, la reserva NO falla', async () => {
    mockRunGoogleAppointmentHook.mockRejectedValue(new Error('google down') as any);

    const { bookingService } = await import('../booking.service');

    const result = await bookingService.createBranchBooking(
      BRANCH.id,
      { service_id: SERVICE.id, start_time: futureISO(), modality: 'online' },
      USER
    );

    expect(result.status).toBe(AppointmentStatus.PENDING);
    expect(mockTx.appointment.create).toHaveBeenCalledTimes(1);
  });

  it('devuelve video_call_url cuando la recarga (findUnique) lo trae', async () => {
    mockPrisma.appointment.findUnique.mockResolvedValue({
      id: 'appt-1',
      modality: 'online',
      video_call_url: 'https://meet.google.com/abc-defg-hij',
    } as any);

    const { bookingService } = await import('../booking.service');

    const result = await bookingService.createBranchBooking(
      BRANCH.id,
      { service_id: SERVICE.id, start_time: futureISO(), modality: 'online' },
      USER
    );

    expect(result.video_call_url).toBe('https://meet.google.com/abc-defg-hij');
    expect(result.modality).toBe('online');
  });
});
