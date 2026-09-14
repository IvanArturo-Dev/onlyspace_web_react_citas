import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Prisma mock — only the delegates buildSpotOpenedLink touches.
// ---------------------------------------------------------------------------
const mockPrisma = {
  appointment: {
    findFirst: jest.fn(),
  },
  customer: {
    findFirst: jest.fn(),
  },
  tenant: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  branch: {
    findFirst: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

const mockWriteAudit = jest.fn(async () => undefined);
jest.mock('../../utils/audit', () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
}));

import { whatsappService } from '../whatsapp.service';

/** Builds a fake appointment (with customer/service) for tenant-a. */
function appointment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'appt-1',
    tenant_id: 'tenant-a',
    branch_id: null,
    customer_id: 'cust-1',
    service_id: 'svc-1',
    start_time: new Date('2024-06-15T18:30:00.000Z'),
    end_time: new Date('2024-06-15T19:00:00.000Z'),
    status: 'CONFIRMED',
    customer: { id: 'cust-1', name: 'Ana Perez', phone: '+52 55 1234 5678' },
    service: { id: 'svc-1', name: 'Corte' },
    ...overrides,
  } as never;
}

const TENANT = {
  name: 'Barberia Central',
  whatsapp_number: '5215599998888',
  whatsapp_template: null,
};

describe('whatsappService.buildSpotOpenedLink (unit)', () => {
  let fetchSpy: jest.SpiedFunction<any> | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.tenant.findUnique.mockResolvedValue(TENANT as never);
    mockPrisma.branch.findFirst.mockResolvedValue(null as never);
    // Spy on global fetch to assert no network calls happen (link only).
    fetchSpy = jest
      .spyOn(globalThis as any, 'fetch')
      .mockImplementation((() => {
        throw new Error('network access is forbidden in buildSpotOpenedLink');
      }) as any);
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Placeholders replaced with real values, no leftover {braces}.
  // -------------------------------------------------------------------------
  it('builds a wa.me link with the spot-opened template and replaces placeholders', async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(appointment() as never);

    const result = await whatsappService.buildSpotOpenedLink('tenant-a', 'appt-1');

    // "+52 55 1234 5678" normalizes to "525512345678".
    expect(result.phone).toBe('525512345678');
    expect(result.url.startsWith('https://wa.me/525512345678?text=')).toBe(true);

    // Spot-opened wording (distinct from the reminder template).
    expect(result.message).toContain('se abrio un espacio');
    expect(result.message).toContain('lista de espera');

    // Placeholders got their real values.
    expect(result.message).toContain('Ana Perez');
    expect(result.message).toContain('Barberia Central');
    expect(result.message).toContain('5215599998888'); // {contacto}

    // No unreplaced placeholders remain.
    expect(result.message).not.toContain('{cliente}');
    expect(result.message).not.toContain('{negocio}');
    expect(result.message).not.toContain('{sucursal}');
    expect(result.message).not.toContain('{fecha}');
    expect(result.message).not.toContain('{hora}');
    expect(result.message).not.toContain('{contacto}');

    // Date/time formatted the same way the service does.
    const fecha = new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date('2024-06-15T18:30:00.000Z'));
    const hora = new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Mexico_City',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date('2024-06-15T18:30:00.000Z'));

    expect(result.message).toContain(fecha);
    expect(result.message).toContain(hora);
    // The url carries the message url-encoded.
    expect(result.url).toContain(encodeURIComponent(result.message));

    // Link only: no network access happened.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Branch present: default template shows the branch as {negocio}.
  // -------------------------------------------------------------------------
  it('uses the branch name as {negocio} when the appointment has a branch', async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(
      appointment({ branch_id: 'branch-1' }) as never
    );
    mockPrisma.branch.findFirst.mockResolvedValue({
      timezone: 'America/Mexico_City',
      name: 'Sucursal Centro',
    } as never);

    const result = await whatsappService.buildSpotOpenedLink('tenant-a', 'appt-1');

    expect(mockPrisma.branch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'branch-1', tenant_id: 'tenant-a' },
      })
    );
    // Default template shows ONLY the branch when it exists.
    expect(result.message).toContain('Sucursal Centro');
    expect(result.message).not.toContain('Barberia Central');
  });

  // -------------------------------------------------------------------------
  // Fallback: no branch -> business name is used as {negocio}.
  // -------------------------------------------------------------------------
  it('falls back to the business name when there is no branch (branch_id null)', async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(appointment() as never);
    // beforeEach default: branch.findFirst -> null (cita sin branch_id).

    const result = await whatsappService.buildSpotOpenedLink('tenant-a', 'appt-1');

    expect(result.message).toContain('Barberia Central');
    expect(result.message).not.toContain('{negocio}');
    expect(result.message).not.toContain('{sucursal}');
  });

  // -------------------------------------------------------------------------
  // Missing/invalid phone -> 400 PHONE_REQUIRED.
  // -------------------------------------------------------------------------
  describe('missing/invalid phone rejected', () => {
    it('rejects a null phone with 400 PHONE_REQUIRED', async () => {
      mockPrisma.appointment.findFirst.mockResolvedValue(
        appointment({ customer: { id: 'cust-1', name: 'Ana', phone: null } }) as never
      );

      await expect(
        whatsappService.buildSpotOpenedLink('tenant-a', 'appt-1')
      ).rejects.toMatchObject({ statusCode: 400, code: 'PHONE_REQUIRED' });
    });

    it("rejects the public-booking placeholder 'sin-telefono'", async () => {
      mockPrisma.appointment.findFirst.mockResolvedValue(
        appointment({
          customer: { id: 'cust-1', name: 'Ana', phone: 'sin-telefono' },
        }) as never
      );

      await expect(
        whatsappService.buildSpotOpenedLink('tenant-a', 'appt-1')
      ).rejects.toMatchObject({ statusCode: 400, code: 'PHONE_REQUIRED' });
    });

    it('rejects a too-short phone (fewer than 8 digits)', async () => {
      mockPrisma.appointment.findFirst.mockResolvedValue(
        appointment({
          customer: { id: 'cust-1', name: 'Ana', phone: '12345' },
        }) as never
      );

      await expect(
        whatsappService.buildSpotOpenedLink('tenant-a', 'appt-1')
      ).rejects.toMatchObject({ statusCode: 400, code: 'PHONE_REQUIRED' });
    });
  });
});
