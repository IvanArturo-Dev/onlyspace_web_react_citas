import { Response, NextFunction } from 'express';
import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';
import { AuthRequest } from '../types/express';
import { isPremiumEffective } from '../services/subscription.service';

/**
 * Authorization guard that gates premium-only capabilities.
 *
 * Must run after `authMiddleware`/`requireAdmin`, which populate `req.user`. It
 * loads the tenant carried by the verified JWT and derives the EFFECTIVE premium
 * state with `isPremiumEffective` (active and not expired). Premium -> next();
 * otherwise (or missing tenant) -> 403 PREMIUM_REQUIRED. If there is no
 * authenticated tenant it rejects with 403 FORBIDDEN (Property 6: it only ever
 * evaluates the JWT's own tenant).
 *
 * Relies on `express-async-errors` so the thrown `HttpError` reaches the global
 * error handler.
 */
export const requirePremium = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const tenantId = req.user?.tenant_id;

  if (!tenantId) {
    throw new HttpError('Forbidden', 403, 'FORBIDDEN');
  }

  // Soporte del super admin: si el JWT lleva el claim `impersonated_by`, el
  // super admin esta actuando como este tenant y salta el gating premium
  // (puede gestionar todo aunque el negocio sea free). Sin el claim, el
  // comportamiento de gating queda intacto.
  if (req.user?.impersonated_by) {
    next();
    return;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { subscription_status: true, subscription_expires_at: true },
  });

  if (!tenant || !isPremiumEffective(tenant)) {
    throw new HttpError(
      'Esta funcion es solo para premium',
      403,
      'PREMIUM_REQUIRED'
    );
  }

  next();
};
