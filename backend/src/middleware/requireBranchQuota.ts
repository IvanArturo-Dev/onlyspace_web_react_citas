import { Response, NextFunction } from 'express';
import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';
import { AuthRequest } from '../types/express';
import { isPremiumEffective } from '../services/subscription.service';

/**
 * Authorization guard for the branch (sucursal) creation quota.
 *
 * Must run after `authMiddleware`/`requireAdmin`, which populate `req.user`. It
 * loads the tenant of the verified JWT and derives the EFFECTIVE premium state
 * with `isPremiumEffective`. Premium tenants create branches without limit.
 * Free tenants are allowed their FIRST branch (count === 0 -> next()) but are
 * blocked from a second one (count >= 1 -> 403 PREMIUM_REQUIRED). Missing tenant
 * (or absent auth) -> 403 FORBIDDEN.
 *
 * Only the CREATION is gated here; list/get/update are untouched. Relies on
 * `express-async-errors` so the thrown `HttpError` reaches the global handler.
 */
export const requireBranchQuota = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const tenantId = req.user?.tenant_id;

  if (!tenantId) {
    throw new HttpError('Forbidden', 403, 'FORBIDDEN');
  }

  // Soporte del super admin: si el JWT lleva el claim `impersonated_by`, el
  // super admin esta actuando como este tenant y salta la cuota de sucursales
  // (puede crear aunque el negocio sea free). Sin el claim, la cuota se aplica
  // como siempre.
  if (req.user?.impersonated_by) {
    next();
    return;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { subscription_status: true, subscription_expires_at: true },
  });

  if (tenant && isPremiumEffective(tenant)) {
    next();
    return;
  }

  const count = await prisma.branch.count({
    where: { tenant_id: tenantId },
  });

  if (count >= 1) {
    throw new HttpError(
      'Agregar mas de una sucursal es solo para premium',
      403,
      'PREMIUM_REQUIRED'
    );
  }

  next();
};
