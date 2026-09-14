import { Response } from 'express';
import { AuditAction } from '@prisma/client';
import { AuthRequest } from '../types/express';
import { assistantService } from '../services/assistant.service';
import { writeAudit } from '../utils/audit';

/**
 * Controller para la gestion de asistentes (sub-usuarios) de un emprendedor.
 *
 * Todas las operaciones estan scoping-eadas al tenant del emprendedor que llama
 * (`req.user.tenant_id`); la autorizacion ADMIN la aplica el middleware de ruta.
 * Sigue el patron existente: `{ success: true, data }` en exito o
 * `{ success: false, error: { code, message } }` con el status adecuado en fallo.
 */
export const assistantController = {
  /** GET /v1/assistants */
  async list(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await assistantService.list(req.user!.tenant_id);
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

  /** POST /v1/assistants  body: { email } */
  async invite(req: AuthRequest, res: Response): Promise<void> {
    const email = req.body?.email;

    if (!email || typeof email !== 'string' || !email.trim()) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'El campo email es requerido' },
      });
      return;
    }

    try {
      const data = await assistantService.invite(
        req.user!.tenant_id,
        email,
        req.user?.id
      );

      await writeAudit({
        tenant_id: req.user!.tenant_id,
        user_id: req.user?.id,
        action: AuditAction.CREATE,
        resource_type: 'assistant',
        resource_id: data.id,
        details: JSON.stringify({ email: data.email, status: data.status }),
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

  /** PATCH /v1/assistants/:id  body: { status } */
  async setStatus(req: AuthRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const status = req.body?.status;

    try {
      const data = await assistantService.setStatus(req.user!.tenant_id, id, status);

      await writeAudit({
        tenant_id: req.user!.tenant_id,
        user_id: req.user?.id,
        action: AuditAction.UPDATE,
        resource_type: 'assistant',
        resource_id: data.id,
        details: JSON.stringify({ status: data.status }),
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
