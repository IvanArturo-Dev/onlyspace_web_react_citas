import { Response } from 'express';
import { LoyaltyRewardStatus } from '@prisma/client';
import { AuthRequest } from '../types/express';
import { loyaltyProgramService } from '../services/loyaltyProgram.service';
import { loyaltyService } from '../services/loyalty.service';

/**
 * Controller para los endpoints de lealtad del emprendedor y sus asistentes.
 *
 * Todas las operaciones se delimitan al tenant del usuario autenticado
 * (`req.user.tenant_id`); la autorizacion por rol la aplican los middlewares de
 * ruta (`requireAdmin` / `requireStaff`). Sigue el patron del repo:
 * `{ success: true, data }` en exito o `{ success: false, error: { code, message } }`
 * con el status adecuado en fallo.
 */

/** Envia una respuesta de error siguiendo el contrato del backend. */
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

const REWARD_STATUSES: LoyaltyRewardStatus[] = ['EARNED', 'REDEEMED', 'EXPIRED'];

export const loyaltyController = {
  // --- Programas (requireAdmin) ---

  /** GET /v1/loyalty/programs */
  async listPrograms(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await loyaltyProgramService.list(req.user!.tenant_id);
      res.status(200).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  },

  /** POST /v1/loyalty/programs */
  async createProgram(req: AuthRequest, res: Response): Promise<void> {
    const body = req.body ?? {};
    try {
      const data = await loyaltyProgramService.create(
        req.user!.tenant_id,
        {
          name: body.name,
          type: body.type,
          goal: body.goal,
          window_days: body.window_days,
          reward_text: body.reward_text,
          validity_days: body.validity_days,
        },
        req.user?.id
      );
      res.status(201).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  },

  /** GET /v1/loyalty/programs/:id */
  async getProgram(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await loyaltyProgramService.get(req.user!.tenant_id, req.params.id);
      res.status(200).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  },

  /** PATCH /v1/loyalty/programs/:id */
  async updateProgram(req: AuthRequest, res: Response): Promise<void> {
    const body = req.body ?? {};
    try {
      const data = await loyaltyProgramService.update(
        req.user!.tenant_id,
        req.params.id,
        {
          name: body.name,
          type: body.type,
          goal: body.goal,
          window_days: body.window_days,
          reward_text: body.reward_text,
          validity_days: body.validity_days,
        },
        req.user?.id
      );
      res.status(200).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  },

  /** PATCH /v1/loyalty/programs/:id/active  body: { active: boolean } */
  async setProgramActive(req: AuthRequest, res: Response): Promise<void> {
    const active = req.body?.active;
    if (typeof active !== 'boolean') {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'El campo active (boolean) es requerido' },
      });
      return;
    }
    try {
      const data = await loyaltyProgramService.setActive(
        req.user!.tenant_id,
        req.params.id,
        active,
        req.user?.id
      );
      res.status(200).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  },

  // --- Recompensas ---

  /** GET /v1/loyalty/rewards?status=&customer_id=  (requireStaff) */
  async listRewards(req: AuthRequest, res: Response): Promise<void> {
    const statusRaw = req.query.status as string | undefined;
    const customerId = req.query.customer_id as string | undefined;

    if (statusRaw && !REWARD_STATUSES.includes(statusRaw as LoyaltyRewardStatus)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: "status debe ser 'EARNED', 'REDEEMED' o 'EXPIRED'",
        },
      });
      return;
    }

    try {
      const data = await loyaltyService.listRewards(req.user!.tenant_id, {
        status: statusRaw ? (statusRaw as LoyaltyRewardStatus) : undefined,
        customerId: customerId || undefined,
      });
      res.status(200).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  },

  /** PATCH /v1/loyalty/rewards/:id/redeem  (requireStaff) */
  async redeemReward(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await loyaltyService.redeem(
        req.user!.tenant_id,
        req.params.id,
        req.user!.id
      );
      res.status(200).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  },

  /** GET /v1/loyalty/stats  (requireAdmin) */
  async getStats(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await loyaltyService.statsForTenant(req.user!.tenant_id);
      res.status(200).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  },
};
