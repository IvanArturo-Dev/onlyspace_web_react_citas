import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Prisma mock. mercadopago.service usa subscription (findUnique/upsert/
// updateMany), tenant (findUnique/update) y prisma.$transaction.
// ---------------------------------------------------------------------------
const mockPrisma = {
  subscription: {
    findUnique: jest.fn() as jest.Mock,
    upsert: jest.fn() as jest.Mock,
    update: jest.fn() as jest.Mock,
    updateMany: jest.fn() as jest.Mock,
  },
  tenant: {
    findUnique: jest.fn() as jest.Mock,
    update: jest.fn() as jest.Mock,
  },
  // Ejecuta las promesas del array (los mocks de upsert/update ya devuelven
  // valores), reproduciendo el comportamiento de prisma.$transaction([...]).
  $transaction: jest.fn((ops: any) => Promise.all(ops)) as jest.Mock,
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

import { mercadopagoService, getAccessToken } from '../mercadopago.service';
import { HttpError } from '../../utils/errors';

const TOKEN = 'TEST-fake-access-token';

/** Construye una respuesta fetch simulada. */
function makeFetchResponse(ok: boolean, jsonBody: any, status = ok ? 200 : 400) {
  return {
    ok,
    status,
    json: async () => jsonBody,
  } as any;
}

describe('mercadopago.service (unit)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MERCADOPAGO_ACCESS_TOKEN = TOKEN;
    process.env.SUBSCRIPTION_PRICE_MXN = '299';
    delete process.env.SUBSCRIPTION_BACK_URL;
    // fetch global mockeado por defecto (cada test lo ajusta).
    (global as any).fetch = jest.fn();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    delete (global as any).fetch;
  });

  // -------------------------------------------------------------------------
  // getAccessToken
  // -------------------------------------------------------------------------
  describe('getAccessToken', () => {
    it('lanza 503 PAYMENTS_NOT_CONFIGURED cuando falta el token', () => {
      delete process.env.MERCADOPAGO_ACCESS_TOKEN;
      try {
        getAccessToken();
        throw new Error('should have thrown');
      } catch (error: any) {
        expect(error).toBeInstanceOf(HttpError);
        expect(error.statusCode).toBe(503);
        expect(error.code).toBe('PAYMENTS_NOT_CONFIGURED');
      }
    });

    it('lanza 503 cuando el token es una cadena vacia', () => {
      process.env.MERCADOPAGO_ACCESS_TOKEN = '   ';
      expect(() => getAccessToken()).toThrow(HttpError);
    });

    it('devuelve el token desde el entorno', () => {
      expect(getAccessToken()).toBe(TOKEN);
    });
  });

  // -------------------------------------------------------------------------
  // createPreapproval
  // -------------------------------------------------------------------------
  describe('createPreapproval', () => {
    it('hace el POST a /preapproval y persiste el Subscription', async () => {
      (global as any).fetch = jest.fn(async () =>
        makeFetchResponse(true, {
          id: 'preapp-123',
          init_point: 'https://mp/checkout/preapp-123',
        })
      );
      mockPrisma.subscription.upsert.mockResolvedValue({ id: 'sub-1' });

      const result = await mercadopagoService.createPreapproval({
        tenantId: 'tenant-1',
        payerEmail: 'owner@example.com',
      });

      expect(result).toEqual({
        preapproval_id: 'preapp-123',
        init_point: 'https://mp/checkout/preapp-123',
      });

      // Verifica el request a MP.
      const fetchMock = (global as any).fetch as jest.Mock;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, any];
      expect(url).toBe('https://api.mercadopago.com/preapproval');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(init.headers['Content-Type']).toBe('application/json');

      const sentBody = JSON.parse(init.body);
      expect(sentBody.external_reference).toBe('tenant-1');
      expect(sentBody.payer_email).toBe('owner@example.com');
      expect(sentBody.status).toBe('pending');
      expect(sentBody.auto_recurring.transaction_amount).toBe(299);
      expect(sentBody.auto_recurring.currency_id).toBe('MXN');
      expect(sentBody.auto_recurring.frequency).toBe(1);
      expect(sentBody.auto_recurring.frequency_type).toBe('months');

      // Verifica la persistencia (upsert por tenant_id).
      expect(mockPrisma.subscription.upsert).toHaveBeenCalledTimes(1);
      const upsertArg = mockPrisma.subscription.upsert.mock.calls[0][0] as any;
      expect(upsertArg.where).toEqual({ tenant_id: 'tenant-1' });
      expect(upsertArg.create.preapproval_id).toBe('preapp-123');
      expect(upsertArg.create.status).toBe('pending');
      expect(upsertArg.create.payer_email).toBe('owner@example.com');
      expect(upsertArg.create.amount).toBe(299);
      expect(upsertArg.update.preapproval_id).toBe('preapp-123');
    });

    it('lanza 503 antes del POST si el token no esta configurado', async () => {
      delete process.env.MERCADOPAGO_ACCESS_TOKEN;
      (global as any).fetch = jest.fn();

      await expect(
        mercadopagoService.createPreapproval({
          tenantId: 'tenant-1',
          payerEmail: 'owner@example.com',
        })
      ).rejects.toMatchObject({ statusCode: 503, code: 'PAYMENTS_NOT_CONFIGURED' });

      expect((global as any).fetch).not.toHaveBeenCalled();
      expect(mockPrisma.subscription.upsert).not.toHaveBeenCalled();
    });

    it('lanza MERCADOPAGO_ERROR cuando MP responde con error', async () => {
      (global as any).fetch = jest.fn(async () =>
        makeFetchResponse(false, { message: 'invalid payer_email' }, 400)
      );

      await expect(
        mercadopagoService.createPreapproval({
          tenantId: 'tenant-1',
          payerEmail: 'bad',
        })
      ).rejects.toMatchObject({ code: 'MERCADOPAGO_ERROR' });
    });
  });

  // -------------------------------------------------------------------------
  // handleWebhookNotification
  // -------------------------------------------------------------------------
  describe('handleWebhookNotification', () => {
    it("status 'authorized' extiende el tenant +1 mes y marca Subscription authorized", async () => {
      // getPreapproval -> GET a MP devuelve authorized + external_reference.
      (global as any).fetch = jest.fn(async () =>
        makeFetchResponse(true, {
          id: 'preapp-123',
          status: 'authorized',
          external_reference: 'tenant-1',
        })
      );

      // Sin cobro previo el mismo dia.
      mockPrisma.subscription.findUnique.mockResolvedValue({
        status: 'pending',
        last_payment_at: null,
      });
      // Tenant sin expiracion previa (base = ahora).
      mockPrisma.tenant.findUnique.mockResolvedValue({
        subscription_expires_at: null,
      });
      mockPrisma.subscription.upsert.mockResolvedValue({ id: 'sub-1' });
      mockPrisma.tenant.update.mockResolvedValue({ id: 'tenant-1' });

      const before = Date.now();
      await mercadopagoService.handleWebhookNotification(
        { type: 'preapproval', data: { id: 'preapp-123' } },
        {}
      );

      // Subscription marcado authorized con last_payment_at.
      expect(mockPrisma.subscription.upsert).toHaveBeenCalledTimes(1);
      const upsertArg = mockPrisma.subscription.upsert.mock.calls[0][0] as any;
      expect(upsertArg.update.status).toBe('authorized');
      expect(upsertArg.update.last_payment_at).toBeInstanceOf(Date);

      // Tenant extendido: status active + expires ~ ahora + 1 mes.
      expect(mockPrisma.tenant.update).toHaveBeenCalledTimes(1);
      const tenantArg = mockPrisma.tenant.update.mock.calls[0][0] as any;
      expect(tenantArg.where).toEqual({ id: 'tenant-1' });
      expect(tenantArg.data.subscription_status).toBe('active');
      const newExpires: Date = tenantArg.data.subscription_expires_at;
      expect(newExpires).toBeInstanceOf(Date);

      // Aproximadamente +1 mes desde ahora.
      const expectedMin = new Date(before);
      expectedMin.setMonth(expectedMin.getMonth() + 1);
      expect(newExpires.getTime()).toBeGreaterThanOrEqual(
        expectedMin.getTime() - 5000
      );
    });

    it('es idempotente: un segundo evento authorized el mismo dia no vuelve a extender', async () => {
      (global as any).fetch = jest.fn(async () =>
        makeFetchResponse(true, {
          id: 'preapp-123',
          status: 'authorized',
          external_reference: 'tenant-1',
        })
      );

      // Ya procesado hoy (mismo dia UTC) -> guarda de idempotencia.
      mockPrisma.subscription.findUnique.mockResolvedValue({
        status: 'authorized',
        last_payment_at: new Date(),
      });

      await mercadopagoService.handleWebhookNotification(
        { type: 'preapproval', data: { id: 'preapp-123' } },
        {}
      );

      // No se extiende el tenant ni se vuelve a hacer upsert.
      expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
      expect(mockPrisma.subscription.upsert).not.toHaveBeenCalled();
    });

    it("status 'cancelled' NO toca el tenant, solo actualiza el Subscription", async () => {
      (global as any).fetch = jest.fn(async () =>
        makeFetchResponse(true, {
          id: 'preapp-123',
          status: 'cancelled',
          external_reference: 'tenant-1',
        })
      );
      mockPrisma.subscription.updateMany.mockResolvedValue({ count: 1 });

      await mercadopagoService.handleWebhookNotification(
        { type: 'preapproval', data: { id: 'preapp-123' } },
        {}
      );

      expect(mockPrisma.subscription.updateMany).toHaveBeenCalledTimes(1);
      const arg = mockPrisma.subscription.updateMany.mock.calls[0][0] as any;
      expect(arg.where).toEqual({ tenant_id: 'tenant-1' });
      expect(arg.data.status).toBe('cancelled');

      expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
    });

    it('no lanza y no toca nada si el payload no trae id de preapproval', async () => {
      (global as any).fetch = jest.fn();

      await expect(
        mercadopagoService.handleWebhookNotification({}, {})
      ).resolves.toBeUndefined();

      expect((global as any).fetch).not.toHaveBeenCalled();
      expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
    });

    it('no lanza si getPreapproval falla (best-effort)', async () => {
      (global as any).fetch = jest.fn(async () =>
        makeFetchResponse(false, { message: 'not found' }, 404)
      );

      await expect(
        mercadopagoService.handleWebhookNotification(
          { type: 'preapproval', data: { id: 'nope' } },
          {}
        )
      ).resolves.toBeUndefined();

      expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
    });
  });
});
