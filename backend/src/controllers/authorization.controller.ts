import { Response } from 'express';
import { AuditAction } from '@prisma/client';
import { AuthRequest } from '../types/express';
import { authorizationService } from '../services/authorization.service';
import { writeAudit } from '../utils/audit';

/**
 * Controller para los endpoints de autorizacion de administradores (Super Admin).
 *
 * Sigue el patron existente: envuelve la llamada al servicio en try/catch y
 * responde con `{ success: true, data }` en exito o
 * `{ success: false, error: { code, message } }` con el status adecuado en fallo.
 * La autorizacion (SUPERADMIN) la aplica el middleware de ruta, no aqui.
 */
export const authorizationController = {
  /** GET /v1/admin/authorized */
  async list(_req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await authorizationService.list();
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      if (error.statusCode) {
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
  },

  /** POST /v1/admin/authorized  body: { email } */
  async authorize(req: AuthRequest, res: Response): Promise<void> {
    const email = req.body?.email;

    if (!email || typeof email !== 'string' || !email.trim()) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'El campo email es requerido' },
      });
      return;
    }

    try {
      const data = await authorizationService.authorize(email, req.user?.id);

      await writeAudit({
        tenant_id: req.user?.tenant_id as string,
        user_id: req.user?.id,
        action: AuditAction.CREATE,
        resource_type: 'authorized_admin',
        resource_id: data.id,
      });

      res.status(201).json({ success: true, data });
    } catch (error: any) {
      if (error.statusCode) {
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
  },

  /** PATCH /v1/admin/authorized/:id  body: { status } */
  async setStatus(req: AuthRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const status = req.body?.status;

    try {
      const data = await authorizationService.setStatus(id, status);

      await writeAudit({
        tenant_id: req.user?.tenant_id as string,
        user_id: req.user?.id,
        action: AuditAction.UPDATE,
        resource_type: 'authorized_admin',
        resource_id: data.id,
      });

      res.status(200).json({ success: true, data });
    } catch (error: any) {
      if (error.statusCode) {
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
  },
};
