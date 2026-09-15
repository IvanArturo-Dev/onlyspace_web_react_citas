import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AppointmentStatus } from '@prisma/client';

// ---------------------------------------------------------------------------
// Mock del resolvedor de tenant por codigo.
// ---------------------------------------------------------------------------
const TENANT = {
  id: 'tenant-a',
  name: 'Negocio A',
  booking_enabled: true,
  offered_modality: 'both',
} as any;

const mockResolveTenantByCode = jest.fn(async (_code: string) => TENANT);

jest.mock('../public.service', () => ({
  publicService: {
    resolveTenantByCode: (code: string) => mockResolveTenantByCode(code),
  },
}));

// ---------------------------------------------------------------------------
// Mock de auditoria (no-op).
// ---------------------------------------------------------------------------
jest.mock('../../utils/audit', () => ({
  writeAudit: jest.fn(async () => undefined),
}));

// ---------------------------------------------------------------------------
// Mock de Prisma. Incluye service.findFirst y un $transaction que ejecuta el
// callback con un `tx` que expone appointment.findFirst/findMany/create y
// customer.findFirst/create.
// ---------------------------------------------------------------------------
const mockTx = {
  appointment: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
  },
  customer: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
};

const mockPrisma = {
  service: { findFirst: jest.fn() },
  customer: { findFirst: jest.fn(), create: jest.fn() },
  appointment: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
  $transaction: jest.fn(async (cb: any) => cb(mockTx)),
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const USER = { id: 'user-1', email: 'cliente@example.com', name: 'Cliente Uno' };

/** Telefono de contacto valido: assertBookingContact lo exige siempre. */
const PHONE = '5551234567';

/** Fecha ISO futura (mañana a mediodia UTC). */
function futureISO(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return d.toISOString();
}

function pastISO(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString();
}

const SERVICE = {
  id: 'svc-1',
  tenant_id: TENANT.id,
  is_active: true,
  duration_mins: 30,
};

describe('bookingService.createPublicBooking (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveTenantByCode.mockResolvedValue(TENANT as any);
    mockPrisma.service.findFirst.mockResolvedValue(SERVICE as any);
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
  });

  it('crea PENDING asociada al tenant del codigo, con booked_by_email/name y customer creado por email', async () => {
    const { bookingService } = await import('../booking.service');
    const start = futureISO();

    const result = await bookingService.createPublicBooking(
      'ab3k9p',
      { service_id: SERVICE.id, start_time: start, contact_phone: PHONE },
      USER
    );

    // Customer creado por email dentro del tenant.
    expect(mockTx.customer.findFirst).toHaveBeenCalledWith({
      where: { tenant_id: TENANT.id, email: USER.email },
    });
    expect(mockTx.customer.create).toHaveBeenCalledTimes(1);

    // Cita creada PENDING, tenant correcto, booked_by_*.
    expect(mockTx.appointment.create).toHaveBeenCalledTimes(1);
    const createArgs = (mockTx.appointment.create.mock.calls[0] as any[])[0];
    expect(createArgs.data.status).toBe(AppointmentStatus.PENDING);
    expect(createArgs.data.tenant_id).toBe(TENANT.id);
    expect(createArgs.data.customer_id).toBe('cust-new');
    expect(createArgs.data.service_id).toBe(SERVICE.id);
    expect(createArgs.data.booked_by_email).toBe(USER.email);
    expect(createArgs.data.booked_by_name).toBe(USER.name);

    expect(result.status).toBe(AppointmentStatus.PENDING);
    expect(result.service_id).toBe(SERVICE.id);
  });

  it('asocia el customer existente por email en lugar de crear uno nuevo', async () => {
    mockTx.customer.findFirst.mockResolvedValue({ id: 'cust-existing', status: 'active' } as any);

    const { bookingService } = await import('../booking.service');

    await bookingService.createPublicBooking(
      'ab3k9p',
      { service_id: SERVICE.id, start_time: futureISO(), contact_phone: PHONE },
      USER
    );

    expect(mockTx.customer.create).not.toHaveBeenCalled();
    const createArgs = (mockTx.appointment.create.mock.calls[0] as any[])[0];
    expect(createArgs.data.customer_id).toBe('cust-existing');
  });

  it('lanza 409 SLOT_TAKEN y NO crea la cita cuando hay solape en la transaccion', async () => {
    const start = futureISO();
    const startMs = new Date(start).getTime();
    // Cita existente que solapa [start, start+30min).
    mockTx.appointment.findMany.mockResolvedValue([
      {
        start_time: new Date(startMs + 10 * 60_000),
        end_time: new Date(startMs + 40 * 60_000),
      },
    ] as any);

    const { bookingService } = await import('../booking.service');

    await expect(
      bookingService.createPublicBooking(
        'ab3k9p',
        { service_id: SERVICE.id, start_time: start, contact_phone: PHONE },
        USER
      )
    ).rejects.toMatchObject({ statusCode: 409, code: 'SLOT_TAKEN' });

    expect(mockTx.appointment.create).not.toHaveBeenCalled();
  });

  it('lanza 400 INVALID_TIME cuando start_time esta en el pasado', async () => {
    const { bookingService } = await import('../booking.service');

    await expect(
      bookingService.createPublicBooking(
        'ab3k9p',
        { service_id: SERVICE.id, start_time: pastISO() },
        USER
      )
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_TIME' });

    expect(mockTx.appointment.create).not.toHaveBeenCalled();
  });

  it('lanza 404 SERVICE_NOT_FOUND cuando el servicio no existe/activo en el tenant', async () => {
    mockPrisma.service.findFirst.mockResolvedValue(null as any);

    const { bookingService } = await import('../booking.service');

    await expect(
      bookingService.createPublicBooking(
        'ab3k9p',
        { service_id: 'no-such', start_time: futureISO() },
        USER
      )
    ).rejects.toMatchObject({ statusCode: 404, code: 'SERVICE_NOT_FOUND' });
  });

  it('Property 7 (aislamiento): la cita se crea con el tenant_id resuelto por el codigo', async () => {
    // Resolver devuelve un tenant distinto para verificar aislamiento.
    const otherTenant = { id: 'tenant-b', name: 'Negocio B', booking_enabled: true };
    mockResolveTenantByCode.mockResolvedValue(otherTenant as any);
    mockPrisma.service.findFirst.mockResolvedValue({
      ...SERVICE,
      tenant_id: otherTenant.id,
    } as any);

    const { bookingService } = await import('../booking.service');

    await bookingService.createPublicBooking(
      'zzz999',
      { service_id: SERVICE.id, start_time: futureISO(), contact_phone: PHONE },
      USER
    );

    const createArgs = (mockTx.appointment.create.mock.calls[0] as any[])[0];
    expect(createArgs.data.tenant_id).toBe(otherTenant.id);

    // El re-chequeo de solape tambien se hace sobre el tenant resuelto.
    const findManyArgs = (mockTx.appointment.findMany.mock.calls[0] as any[])[0];
    expect(findManyArgs.where.tenant_id).toBe(otherTenant.id);
  });

  // -------------------------------------------------------------------------
  // Contacto/domicilio obligatorios (assertBookingContact).
  // Validates: Requirements 3.1, 3.2, 3.4
  // -------------------------------------------------------------------------

  it('modalidad home con contact_phone + home_address + maps_url validos: crea y persiste esos campos', async () => {
    // El tenant ofrece home (offered_modality 'both' no incluye home; se usa un
    // tenant con offered_modalities que si lo incluye).
    mockResolveTenantByCode.mockResolvedValue({
      ...TENANT,
      offered_modalities: 'in_person,home',
    } as any);

    const { bookingService } = await import('../booking.service');

    const result = await bookingService.createPublicBooking(
      'ab3k9p',
      {
        service_id: SERVICE.id,
        start_time: futureISO(),
        modality: 'home',
        contact_phone: PHONE,
        home_address: 'Calle Falsa 123',
        maps_url: 'https://maps.google.com/?q=19.4,-99.1',
      },
      USER
    );

    expect(result.status).toBe(AppointmentStatus.PENDING);
    const createArgs = (mockTx.appointment.create.mock.calls[0] as any[])[0];
    expect(createArgs.data.modality).toBe('home');
    expect(createArgs.data.contact_phone).toBe(PHONE);
    expect(createArgs.data.home_address).toBe('Calle Falsa 123');
    expect(createArgs.data.maps_url).toBe('https://maps.google.com/?q=19.4,-99.1');
  });

  it('sin contact_phone -> 400 CONTACT_PHONE_REQUIRED sin crear', async () => {
    const { bookingService } = await import('../booking.service');

    await expect(
      bookingService.createPublicBooking(
        'ab3k9p',
        { service_id: SERVICE.id, start_time: futureISO() },
        USER
      )
    ).rejects.toMatchObject({ statusCode: 400, code: 'CONTACT_PHONE_REQUIRED' });

    expect(mockTx.appointment.create).not.toHaveBeenCalled();
  });

  it('modalidad home sin direccion/maps_url -> 400 HOME_DETAILS_REQUIRED sin crear', async () => {
    mockResolveTenantByCode.mockResolvedValue({
      ...TENANT,
      offered_modalities: 'in_person,home',
    } as any);

    const { bookingService } = await import('../booking.service');

    await expect(
      bookingService.createPublicBooking(
        'ab3k9p',
        {
          service_id: SERVICE.id,
          start_time: futureISO(),
          modality: 'home',
          contact_phone: PHONE,
        },
        USER
      )
    ).rejects.toMatchObject({ statusCode: 400, code: 'HOME_DETAILS_REQUIRED' });

    expect(mockTx.appointment.create).not.toHaveBeenCalled();
  });
});
