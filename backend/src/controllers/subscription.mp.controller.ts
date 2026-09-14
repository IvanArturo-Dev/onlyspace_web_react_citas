import { Response } from 'express';
import { AuthRequest } from '../types/express';
import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';
import { mercadopagoService } from '../services/mercadopago.service';
import { isPremiumEffective } from '../services/subscription.service';

/**
 * Controlador de la suscripcion de pago (Mercado Pago) del emprendedor.
 *
 * Rutas del emprendedor (ADMIN, tenant-scoped) para crear/consultar/cancelar la
 * suscripcion, mas el webhook PUBLICO que MP invoca en cada cambio de estado.
 */

/** Responder de error coherente con el resto de controladores. */
function sendError(res: Response, error: any): void {
  if (error && error.statusCode) {
    res.status(error.statusCode).json({
      success: false,
      error: { code: error.code, message: error.message },
    });
    return;
  }
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
}

export const subscriptionMpController = {
  /**
   * Crea la suscripcion en Mercado Pago para el tenant del ADMIN autenticado.
   * Resuelve el email del payer desde el usuario autenticado (req.user no lleva
   * email, se busca en la DB). Devuelve { init_point, preapproval_id }.
   */
  async createSubscription(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { email: true },
      });

      const payerEmail = user?.email;
      if (!payerEmail) {
        throw new HttpError(
          'No se pudo determinar el email del pagador',
          400,
          'PAYER_EMAIL_MISSING'
        );
      }

      const result = await mercadopagoService.createPreapproval({
        tenantId,
        payerEmail,
      });

      res.status(200).json({
        success: true,
        data: {
          init_point: result.init_point,
          preapproval_id: result.preapproval_id,
        },
      });
    } catch (error: any) {
      sendError(res, error);
    }
  },

  /**
   * Devuelve el estado de la suscripcion del tenant: el registro Subscription
   * (si existe) junto con is_premium y days_left derivados del tenant.
   */
  async getMySubscription(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    try {
      const [subscription, tenant] = await Promise.all([
        prisma.subscription.findUnique({ where: { tenant_id: tenantId } }),
        prisma.tenant.findUnique({
          where: { id: tenantId },
          select: {
            subscription_status: true,
            subscription_expires_at: true,
          },
        }),
      ]);

      if (!tenant) {
        throw new HttpError('Tenant no encontrado', 404, 'TENANT_NOT_FOUND');
      }

      let daysLeft: number | null = null;
      if (tenant.subscription_expires_at) {
        const ms =
          new Date(tenant.subscription_expires_at).getTime() - Date.now();
        daysLeft = Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
      }

      res.status(200).json({
        success: true,
        data: {
          subscription: subscription
            ? {
                status: subscription.status,
                provider: subscription.provider,
                preapproval_id: subscription.preapproval_id,
                payer_email: subscription.payer_email,
                amount: subscription.amount,
                currency: subscription.currency,
                last_payment_at: subscription.last_payment_at,
              }
            : null,
          is_premium: isPremiumEffective(tenant),
          subscription_status: tenant.subscription_status,
          subscription_expires_at: tenant.subscription_expires_at,
          days_left: daysLeft,
        },
      });
    } catch (error: any) {
      sendError(res, error);
    }
  },

  /**
   * Cancela el preapproval del tenant en Mercado Pago y actualiza el registro
   * Subscription a 'cancelled'. NO toca el premium del tenant: los dias ya
   * pagados se respetan y expiran por su cuenta.
   */
  async cancelMySubscription(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    try {
      const subscription = await prisma.subscription.findUnique({
        where: { tenant_id: tenantId },
      });

      if (!subscription || !subscription.preapproval_id) {
        throw new HttpError(
          'No hay una suscripcion activa para cancelar',
          404,
          'SUBSCRIPTION_NOT_FOUND'
        );
      }

      await mercadopagoService.cancelPreapproval(subscription.preapproval_id);

      const updated = await prisma.subscription.update({
        where: { tenant_id: tenantId },
        data: { status: 'cancelled' },
      });

      res.status(200).json({
        success: true,
        data: { status: updated.status },
      });
    } catch (error: any) {
      sendError(res, error);
    }
  },

  /**
   * Webhook PUBLICO de Mercado Pago. MP lo invoca sin auth. Delega en el
   * servicio (tolerante a formatos e idempotente) y responde 200 SIEMPRE para
   * no provocar reintentos infinitos por un problema nuestro.
   */
  async webhook(req: AuthRequest, res: Response): Promise<void> {
    try {
      await mercadopagoService.handleWebhookNotification(req.body, req.query);
    } catch (error: any) {
      // handleWebhookNotification ya es best-effort, pero por si acaso: logueamos
      // y respondemos 200 igual.
      // eslint-disable-next-line no-console
      console.error('[mercadopago:webhook] controller error', error?.message);
    }
    res.status(200).json({ received: true });
  },
};

export default subscriptionMpController;
