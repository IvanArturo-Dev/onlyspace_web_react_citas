import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';

/**
 * Integracion con Mercado Pago para suscripciones recurrentes via la API
 * `preapproval` (suscripcion SIN plan asociado).
 *
 * Flujo:
 *  1. El emprendedor pide suscribirse -> createPreapproval() crea el preapproval
 *     en MP y persiste/actualiza el registro `Subscription` del tenant. Devuelve
 *     el `init_point` al que el frontend redirige al usuario para autorizar el
 *     cobro.
 *  2. Cada vez que MP cobra (o cambia el estado), llama al webhook publico.
 *     handleWebhookNotification() consulta el preapproval, y si esta
 *     `authorized` EXTIENDE el premium del tenant +1 mes (subscription_status
 *     'active', subscription_expires_at = max(ahora, expires_at) + 1 mes).
 *
 * SEGURIDAD: el Access Token SIEMPRE se lee de
 * `process.env.MERCADOPAGO_ACCESS_TOKEN`. Nunca se hardcodea. Si falta, los
 * endpoints de creacion responden 503 (PAYMENTS_NOT_CONFIGURED).
 */

const MP_API_BASE = 'https://api.mercadopago.com';

/**
 * Devuelve el Access Token de Mercado Pago desde el entorno o lanza 503 si no
 * esta configurado. NUNCA devuelve un valor hardcodeado.
 */
export function getAccessToken(): string {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token || !token.trim()) {
    throw new HttpError(
      'Pagos no configurados',
      503,
      'PAYMENTS_NOT_CONFIGURED'
    );
  }
  return token;
}

/** Precio mensual de la suscripcion (MXN), configurable por env. */
export function getPriceMxn(): number {
  const raw = process.env.SUBSCRIPTION_PRICE_MXN;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 99;
}

/**
 * Precio efectivo de la suscripcion (MXN) que consumen el controller/frontend
 * para no hardcodear el valor. Alias publico de getPriceMxn().
 */
export function getSubscriptionPriceMxn(): number {
  return getPriceMxn();
}

/** URL de retorno tras autorizar el pago (frontend). */
function getBackUrl(): string {
  return (
    process.env.SUBSCRIPTION_BACK_URL ||
    'http://localhost:5173/suscripcion/retorno'
  );
}

/**
 * Resuelve el email del pagador. En entornos de PRUEBA (sandbox) Mercado Pago
 * exige que el payer_email sea un test_user de la misma cuenta padre que el
 * token; el email real del emprendedor es rechazado con "Both payer and
 * collector must be real or test users". Para permitir pruebas locales sin
 * afectar produccion, si MERCADOPAGO_TEST_PAYER_EMAIL esta definida se usa ese
 * email. En produccion NO se define y se usa el email real del usuario.
 */
function resolvePayerEmail(realEmail: string): string {
  const override = process.env.MERCADOPAGO_TEST_PAYER_EMAIL;
  if (override && override.trim()) {
    return override.trim();
  }
  return realEmail;
}

/** Suma `months` meses a una fecha, preservando el resto del timestamp. */
function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  result.setMonth(result.getMonth() + months);
  return result;
}

/** True si dos fechas caen en el mismo dia UTC (guarda de idempotencia). */
function isSameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/**
 * Registra (append-only) un evento de pago en PaymentRecord para AUDITORIA.
 * Best-effort: nunca lanza (un fallo de auditoria no debe romper el webhook ni
 * el cobro). Guarda el payload crudo en `raw` para trazabilidad.
 */
async function recordPaymentEvent(entry: {
  tenantId: string;
  preapprovalId?: string | null;
  paymentId?: string | null;
  eventType?: string | null;
  status?: string | null;
  statusDetail?: string | null;
  amount?: number | null;
  currency?: string | null;
  payerEmail?: string | null;
  raw?: unknown;
}): Promise<void> {
  try {
    await prisma.paymentRecord.create({
      data: {
        tenant_id: entry.tenantId,
        provider: 'mercadopago',
        preapproval_id: entry.preapprovalId ?? null,
        payment_id: entry.paymentId ?? null,
        event_type: entry.eventType ?? null,
        status: entry.status ?? null,
        status_detail: entry.statusDetail ?? null,
        amount: entry.amount ?? 0,
        currency: entry.currency ?? 'MXN',
        payer_email: entry.payerEmail ?? null,
        raw: entry.raw !== undefined ? JSON.stringify(entry.raw) : null,
      },
    });
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.error('[mercadopago:audit] no se pudo registrar PaymentRecord', error?.message);
  }
}

export interface CreatePreapprovalInput {
  tenantId: string;
  payerEmail: string;
}

export interface CreatePreapprovalResult {
  preapproval_id: string;
  init_point: string | null;
}

/**
 * Realiza una peticion autenticada a la API de Mercado Pago y devuelve el JSON
 * parseado. Lanza HttpError con el detalle de MP si la respuesta no es ok.
 */
async function mpFetch(
  path: string,
  init: { method: string; body?: unknown }
): Promise<any> {
  const token = getAccessToken();
  const response = await fetch(`${MP_API_BASE}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const detail =
      (data && (data.message || data.error)) || `HTTP ${response.status}`;
    throw new HttpError(
      `Error de Mercado Pago: ${detail}`,
      502,
      'MERCADOPAGO_ERROR'
    );
  }

  return data;
}

export const mercadopagoService = {
  getAccessToken,
  getPriceMxn,
  getSubscriptionPriceMxn,

  /**
   * Crea un preapproval (suscripcion recurrente) en Mercado Pago para el tenant
   * y persiste/actualiza el registro `Subscription` (upsert por tenant_id).
   * Devuelve { preapproval_id, init_point }.
   */
  async createPreapproval(
    input: CreatePreapprovalInput
  ): Promise<CreatePreapprovalResult> {
    const { tenantId } = input;
    const payerEmail = resolvePayerEmail(input.payerEmail);
    const amount = getPriceMxn();

    const body = {
      reason: 'Suscripcion onlyspace',
      external_reference: tenantId,
      payer_email: payerEmail,
      back_url: getBackUrl(),
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: amount,
        currency_id: 'MXN',
      },
      status: 'pending',
    };

    const data = await mpFetch('/preapproval', { method: 'POST', body });

    const preapprovalId: string | undefined = data?.id;
    const initPoint: string | null = data?.init_point ?? null;

    await prisma.subscription.upsert({
      where: { tenant_id: tenantId },
      create: {
        tenant_id: tenantId,
        provider: 'mercadopago',
        preapproval_id: preapprovalId ?? null,
        status: 'pending',
        payer_email: payerEmail,
        amount,
        currency: 'MXN',
      },
      update: {
        preapproval_id: preapprovalId ?? null,
        status: 'pending',
        payer_email: payerEmail,
        amount,
        currency: 'MXN',
      },
    });

    if (!preapprovalId) {
      throw new HttpError(
        'Mercado Pago no devolvio un preapproval_id',
        502,
        'MERCADOPAGO_ERROR'
      );
    }

    return { preapproval_id: preapprovalId, init_point: initPoint };
  },

  /** Consulta un preapproval por id. Devuelve el JSON de MP. */
  async getPreapproval(preapprovalId: string): Promise<any> {
    return mpFetch(`/preapproval/${encodeURIComponent(preapprovalId)}`, {
      method: 'GET',
    });
  },

  /** Cancela un preapproval en MP (status = cancelled). Devuelve el JSON. */
  async cancelPreapproval(preapprovalId: string): Promise<any> {
    return mpFetch(`/preapproval/${encodeURIComponent(preapprovalId)}`, {
      method: 'PUT',
      body: { status: 'cancelled' },
    });
  },

  /**
   * Procesa una notificacion (webhook) de Mercado Pago. MP envia distintos
   * shapes (type/topic + data.id/id), asi que esta funcion es TOLERANTE a
   * formatos, idempotente y best-effort: nunca lanza para no provocar reintentos
   * infinitos por un problema nuestro.
   *
   * Cuando el preapproval consultado esta `authorized` (cobro exitoso), marca el
   * `Subscription` como authorized (last_payment_at = ahora) y EXTIENDE el
   * tenant: subscription_status 'active' y subscription_expires_at =
   * max(ahora, expires_at actual) + 1 mes. Idempotencia: si ya se proceso un
   * cobro el mismo dia UTC, no se vuelve a extender.
   *
   * Para 'cancelled'/'paused' actualiza solo el Subscription y deja que el
   * tenant expire por su cuenta (no toca el premium).
   */
  async handleWebhookNotification(
    body: any,
    query: any
  ): Promise<void> {
    try {
      // eslint-disable-next-line no-console
      console.log('[mercadopago:webhook] received', {
        body,
        query,
      });

      const type = body?.type ?? body?.topic ?? query?.type ?? query?.topic;
      const preapprovalId =
        body?.data?.id ?? body?.id ?? query?.['data.id'] ?? query?.id;

      if (!preapprovalId) {
        // eslint-disable-next-line no-console
        console.warn('[mercadopago:webhook] no preapproval id in payload');
        return;
      }

      // Solo nos interesan las notificaciones de suscripcion/preapproval. Si el
      // type no lo indica, intentamos igualmente resolver el preapproval (MP a
      // veces omite/renombra el type). Si no es un preapproval, getPreapproval
      // fallara y lo tratamos como best-effort.
      const typeStr = typeof type === 'string' ? type.toLowerCase() : '';
      const looksLikePreapproval =
        typeStr === '' ||
        typeStr.includes('preapproval') ||
        typeStr.includes('subscription');

      if (!looksLikePreapproval) {
        // eslint-disable-next-line no-console
        console.log('[mercadopago:webhook] ignoring type', typeStr);
        return;
      }

      let preapproval: any;
      try {
        preapproval = await this.getPreapproval(String(preapprovalId));
      } catch (error: any) {
        // eslint-disable-next-line no-console
        console.warn(
          '[mercadopago:webhook] getPreapproval failed',
          error?.message
        );
        return;
      }

      const status: string = preapproval?.status ?? '';
      const tenantId: string | undefined =
        preapproval?.external_reference ?? undefined;

      if (!tenantId) {
        // eslint-disable-next-line no-console
        console.warn('[mercadopago:webhook] preapproval without external_reference');
        return;
      }

      // AUDITORIA: registra el evento recibido (append-only) con el payload crudo.
      await recordPaymentEvent({
        tenantId,
        preapprovalId: String(preapprovalId),
        eventType: typeStr || 'preapproval',
        status,
        amount: Number(preapproval?.auto_recurring?.transaction_amount ?? 0) || 0,
        currency: preapproval?.auto_recurring?.currency_id ?? 'MXN',
        payerEmail: preapproval?.payer_email ?? null,
        raw: { body, query, preapproval },
      });

      if (status === 'authorized') {
        await this.applyAuthorizedPayment(tenantId, String(preapprovalId));
        return;
      }

      if (status === 'cancelled' || status === 'paused') {
        // Actualiza el registro pero NO toca el tenant (se deja expirar solo).
        await prisma.subscription.updateMany({
          where: { tenant_id: tenantId },
          data: { status },
        });
        return;
      }

      // Otros estados (pending, etc.): solo reflejamos el estado si tenemos
      // registro. Best-effort.
      if (status) {
        await prisma.subscription.updateMany({
          where: { tenant_id: tenantId },
          data: { status },
        });
      }
    } catch (error: any) {
      // Nunca propagamos: el webhook debe responder 200 salvo firma invalida.
      // eslint-disable-next-line no-console
      console.error('[mercadopago:webhook] unexpected error', error?.message);
    }
  },

  /**
   * Aplica un cobro autorizado: marca el Subscription authorized y extiende el
   * premium del tenant +1 mes. Idempotente por dia (last_payment_at).
   */
  async applyAuthorizedPayment(
    tenantId: string,
    preapprovalId: string
  ): Promise<void> {
    const now = new Date();

    const subscription = await prisma.subscription.findUnique({
      where: { tenant_id: tenantId },
    });

    // Guarda de idempotencia: si ya procesamos un cobro authorized el mismo dia
    // UTC, no volvemos a extender el tenant (evita duplicar meses si MP reenvia
    // el mismo evento).
    if (
      subscription?.status === 'authorized' &&
      subscription.last_payment_at &&
      isSameUtcDay(subscription.last_payment_at, now)
    ) {
      return;
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { subscription_expires_at: true },
    });

    // Base = max(ahora, expires_at actual) para no perder dias si paga antes de
    // vencer.
    const currentExpires = tenant?.subscription_expires_at ?? null;
    const base =
      currentExpires && currentExpires.getTime() > now.getTime()
        ? currentExpires
        : now;
    const newExpires = addMonths(base, 1);

    await prisma.$transaction([
      prisma.subscription.upsert({
        where: { tenant_id: tenantId },
        create: {
          tenant_id: tenantId,
          provider: 'mercadopago',
          preapproval_id: preapprovalId,
          status: 'authorized',
          last_payment_at: now,
          currency: 'MXN',
        },
        update: {
          preapproval_id: preapprovalId,
          status: 'authorized',
          last_payment_at: now,
        },
      }),
      prisma.tenant.update({
        where: { id: tenantId },
        data: {
          subscription_status: 'active',
          subscription_expires_at: newExpires,
        },
      }),
    ]);
  },
};

export default mercadopagoService;
