import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Prisma mock — only the delegates the WhatsApp / business services touch.
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

import { whatsappService, normalizePhoneDigits } from '../whatsapp.service';
import {
  businessService,
  validateBusinessWhatsappNumber,
} from '../business.service';
import { HttpError } from '../../utils/errors';

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

describe('whatsappService.buildReminderLink (unit)', () => {
  let fetchSpy: jest.SpiedFunction<any> | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.tenant.findUnique.mockResolvedValue(TENANT as never);
    mockPrisma.branch.findFirst.mockResolvedValue(null as never);
    // Spy on global fetch to assert Property 4 (no network calls).
    fetchSpy = jest
      .spyOn(globalThis as any, 'fetch')
      .mockImplementation((() => {
        throw new Error('network access is forbidden in buildReminderLink');
      }) as any);
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Property 3: enlace bien formado
  // -------------------------------------------------------------------------
  describe('Property 3: well-formed link', () => {
    it('builds a wa.me link with the normalized phone and a message containing name/date/time', async () => {
      mockPrisma.appointment.findFirst.mockResolvedValue(appointment() as never);

      const result = await whatsappService.buildReminderLink('tenant-a', 'appt-1');

      // "+52 55 1234 5678" normalizes to "525512345678".
      expect(result.phone).toBe('525512345678');
      expect(result.url.startsWith('https://wa.me/525512345678?text=')).toBe(true);

      // The message got its placeholders replaced with real values.
      expect(result.message).toContain('Ana Perez');
      expect(result.message).toContain('Barberia Central');
      expect(result.message).not.toContain('{cliente}');
      expect(result.message).not.toContain('{negocio}');
      expect(result.message).not.toContain('{fecha}');
      expect(result.message).not.toContain('{hora}');

      // The date and hora produced by the formatter appear in the message and in
      // the url text (encoded). We derive them the same way the service does.
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
    });

    it('uses a custom tenant template, replacing placeholders and the contact', async () => {
      mockPrisma.appointment.findFirst.mockResolvedValue(appointment() as never);
      mockPrisma.tenant.findUnique.mockResolvedValue({
        name: 'Spa Luna',
        whatsapp_number: '5210000000000',
        whatsapp_template:
          'Hola {cliente}! Cita en {negocio}. Contacto: {contacto}',
      } as never);

      const result = await whatsappService.buildReminderLink('tenant-a', 'appt-1');

      expect(result.message).toBe(
        'Hola Ana Perez! Cita en Spa Luna. Contacto: 5210000000000'
      );
    });

    it('formats date/time in the branch timezone when a branch is present', async () => {
      mockPrisma.appointment.findFirst.mockResolvedValue(
        appointment({ branch_id: 'branch-1' }) as never
      );
      mockPrisma.branch.findFirst.mockResolvedValue({
        timezone: 'America/Mexico_City',
        name: 'Sucursal Centro',
      } as never);

      const result = await whatsappService.buildReminderLink('tenant-a', 'appt-1');

      expect(mockPrisma.branch.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'branch-1', tenant_id: 'tenant-a' },
        })
      );
      expect(result.url.startsWith('https://wa.me/525512345678?text=')).toBe(true);
      // El mensaje por defecto muestra SOLO la sucursal (no el negocio) cuando
      // la cita tiene sucursal.
      expect(result.message).toContain('en Sucursal Centro.');
      expect(result.message).not.toContain('Barberia Central');
    });

    it('falls back to the business name when there is no branch (default template)', async () => {
      mockPrisma.appointment.findFirst.mockResolvedValue(appointment() as never);
      // Default beforeEach mock: branch.findFirst -> null (cita sin branch_id).

      const result = await whatsappService.buildReminderLink('tenant-a', 'appt-1');

      // Sin sucursal el default cae al nombre del negocio y no quedan placeholders.
      expect(result.message).toContain('en Barberia Central.');
      expect(result.message).not.toContain('{sucursal}');
      expect(result.message).not.toContain('{negocio}');
    });

    it('replaces {sucursal} with the pure branch name in a custom template', async () => {
      mockPrisma.appointment.findFirst.mockResolvedValue(
        appointment({ branch_id: 'branch-1' }) as never
      );
      mockPrisma.tenant.findUnique.mockResolvedValue({
        name: 'Barberia Central',
        whatsapp_number: '5215599998888',
        whatsapp_template: 'Cita en {negocio} sede {sucursal}',
      } as never);
      mockPrisma.branch.findFirst.mockResolvedValue({
        timezone: 'America/Mexico_City',
        name: 'Norte',
      } as never);

      const result = await whatsappService.buildReminderLink('tenant-a', 'appt-1');

      expect(result.message).toBe('Cita en Barberia Central sede Norte');
    });
  });

  // -------------------------------------------------------------------------
  // Property 5-for-phone: missing/invalid phone -> PHONE_REQUIRED, no url
  // -------------------------------------------------------------------------
  describe('Property 5 (phone): missing/invalid phone rejected', () => {
    it('rejects a null phone with 400 PHONE_REQUIRED', async () => {
      mockPrisma.appointment.findFirst.mockResolvedValue(
        appointment({ customer: { id: 'cust-1', name: 'Ana', phone: null } }) as never
      );

      await expect(
        whatsappService.buildReminderLink('tenant-a', 'appt-1')
      ).rejects.toMatchObject({ statusCode: 400, code: 'PHONE_REQUIRED' });
    });

    it("rejects the public-booking placeholder 'sin-telefono'", async () => {
      mockPrisma.appointment.findFirst.mockResolvedValue(
        appointment({
          customer: { id: 'cust-1', name: 'Ana', phone: 'sin-telefono' },
        }) as never
      );

      await expect(
        whatsappService.buildReminderLink('tenant-a', 'appt-1')
      ).rejects.toMatchObject({ statusCode: 400, code: 'PHONE_REQUIRED' });
    });

    it('rejects a too-short phone (fewer than 8 digits)', async () => {
      mockPrisma.appointment.findFirst.mockResolvedValue(
        appointment({
          customer: { id: 'cust-1', name: 'Ana', phone: '12345' },
        }) as never
      );

      await expect(
        whatsappService.buildReminderLink('tenant-a', 'appt-1')
      ).rejects.toMatchObject({ statusCode: 400, code: 'PHONE_REQUIRED' });
    });
  });

  // -------------------------------------------------------------------------
  // Property 4: solo enlace (no network)
  // -------------------------------------------------------------------------
  describe('Property 4: link only, no messaging API', () => {
    it('returns a string url from DB data only and never calls fetch', async () => {
      mockPrisma.appointment.findFirst.mockResolvedValue(appointment() as never);

      const result = await whatsappService.buildReminderLink('tenant-a', 'appt-1');

      expect(typeof result.url).toBe('string');
      // No network access happened while building the link (Property 4).
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Property 6: isolation — foreign appointment -> 404
  // -------------------------------------------------------------------------
  describe('Property 6: tenant isolation', () => {
    it('a foreign appointment (findFirst returns null) -> 404 APPOINTMENT_NOT_FOUND', async () => {
      mockPrisma.appointment.findFirst.mockResolvedValue(null as never);

      await expect(
        whatsappService.buildReminderLink('tenant-a', 'appt-foreign')
      ).rejects.toMatchObject({ statusCode: 404, code: 'APPOINTMENT_NOT_FOUND' });

      // Scoped by tenant_id in the query.
      expect(mockPrisma.appointment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'appt-foreign', tenant_id: 'tenant-a' },
        })
      );
    });
  });
});

describe('normalizePhoneDigits (unit)', () => {
  it('strips separators and the leading + keeping country digits', () => {
    expect(normalizePhoneDigits('+52 55 1234 5678')).toBe('525512345678');
    expect(normalizePhoneDigits('(52) 55-1234-5678')).toBe('525512345678');
    expect(normalizePhoneDigits(null)).toBe('');
    expect(normalizePhoneDigits('sin-telefono')).toBe('');
  });
});

describe('validateBusinessWhatsappNumber / businessService (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validation', () => {
    it('accepts a valid international number and strips separators', () => {
      expect(validateBusinessWhatsappNumber('+52 55 1234 5678')).toBe('+525512345678');
      expect(validateBusinessWhatsappNumber('5215599998888')).toBe('5215599998888');
    });

    it('treats empty/null/undefined as a clear (returns null)', () => {
      expect(validateBusinessWhatsappNumber('')).toBeNull();
      expect(validateBusinessWhatsappNumber('   ')).toBeNull();
      expect(validateBusinessWhatsappNumber(null)).toBeNull();
      expect(validateBusinessWhatsappNumber(undefined)).toBeNull();
    });

    it('rejects an invalid number with 400 VALIDATION_ERROR', () => {
      expect(() => validateBusinessWhatsappNumber('abc123')).toThrow(HttpError);
      expect(() => validateBusinessWhatsappNumber('123')).toThrow(HttpError);
      try {
        validateBusinessWhatsappNumber('123');
      } catch (e: any) {
        expect(e.statusCode).toBe(400);
        expect(e.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('updateBusinessProfile', () => {
    it('persists a validated number and template, tenant-scoped', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-a' } as never);
      mockPrisma.tenant.update.mockResolvedValue({
        whatsapp_number: '+525512345678',
        whatsapp_template: 'Hola {cliente}',
      } as never);

      const result = await businessService.updateBusinessProfile('tenant-a', {
        whatsapp_number: '+52 55 1234 5678',
        whatsapp_template: 'Hola {cliente}',
      });

      expect(mockPrisma.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tenant-a' },
          data: expect.objectContaining({ whatsapp_number: '+525512345678' }),
        })
      );
      expect(result.whatsapp_number).toBe('+525512345678');
    });

    it('rejects an invalid number before writing', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-a' } as never);

      await expect(
        businessService.updateBusinessProfile('tenant-a', { whatsapp_number: 'nope' })
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });

      expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
    });
  });
});
