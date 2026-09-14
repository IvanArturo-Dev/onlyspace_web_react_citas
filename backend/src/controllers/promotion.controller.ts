import { Response } from 'express';
import { AuditAction } from '@prisma/client';
import { AuthRequest } from '../types/express';
import { promotionService } from '../services/promotion.service';
import { writeAudit } from '../utils/audit';

/**
 * Mapea un error a la respuesta JSON de error estandar del proyecto: si es un
 * HttpError se usan su statusCode/code, en cualquier otro caso 500
 * INTERNAL_ERROR (mismo patron que branch.controller).
 */
function sendError(res: Response, error: any): void {
  if (error?.statusCode) {
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

/**
 * Controlador HTTP de las promociones informativas por sucursal (Requirements
 * 1.1, 2.1, 2.2, 2.3, 6.1).
 *
 * Delega toda la logica en promotionService, que ya acota por tenant/sucursal.
 * Sigue la convencion del proyecto: en error, mapear statusCode/code del
 * HttpError; si no, 500 INTERNAL_ERROR. Las mutaciones (create/update/remove)
 * se auditan best-effort con writeAudit.
 *
 * El gating premium del modulo se aplica en la RUTA (requirePremium), no aqui:
 * `list` es accesible tambien para negocios free (para ver el estado), mientras
 * que crear/editar/borrar quedan protegidas por requirePremium en la ruta.
 */
export const promotionController = {
  async list(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const branchId = req.params.id;
    try {
      const promotions = await promotionService.list(tenantId, branchId);
      res.status(200).json({ success: true, data: promotions });
    } catch (error: any) {
      sendError(res, error);
    }
  },

  async create(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const branchId = req.params.id;
    try {
      const promo = await promotionService.create(tenantId, branchId, req.body);
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.CREATE,
        resource_type: 'promotion',
        resource_id: promo.id,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(201).json({ success: true, data: promo });
    } catch (error: any) {
      sendError(res, error);
    }
  },

  async update(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const branchId = req.params.id;
    const promoId = req.params.promoId;
    try {
      const promo = await promotionService.update(
        tenantId,
        branchId,
        promoId,
        req.body
      );
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.UPDATE,
        resource_type: 'promotion',
        resource_id: promoId,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(200).json({ success: true, data: promo });
    } catch (error: any) {
      sendError(res, error);
    }
  },

  async remove(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const branchId = req.params.id;
    const promoId = req.params.promoId;
    try {
      const removed = await promotionService.remove(tenantId, branchId, promoId);
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.DELETE,
        resource_type: 'promotion',
        resource_id: promoId,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(200).json({ success: true, data: { id: removed.id } });
    } catch (error: any) {
      sendError(res, error);
    }
  },
};
