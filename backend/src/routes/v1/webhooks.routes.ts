import { Router } from 'express';
import { subscriptionMpController } from '../../controllers/subscription.mp.controller';

/**
 * Webhooks PUBLICOS de proveedores externos. NO llevan auth: los invoca el
 * proveedor (p.ej. Mercado Pago) con su propio esquema de verificacion. Estas
 * rutas se montan fuera de los grupos autenticados.
 */
export const webhookRoutes = Router();

// POST /v1/webhooks/mercadopago — notificaciones de Mercado Pago (preapproval).
// Responde 200 siempre (el handler es best-effort e idempotente).
webhookRoutes.post('/mercadopago', subscriptionMpController.webhook);
