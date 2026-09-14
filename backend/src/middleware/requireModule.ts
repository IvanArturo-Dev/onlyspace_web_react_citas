import { Response, NextFunction } from 'express';
import { HttpError } from '../utils/errors';
import { moduleService } from '../services/module.service';
import { AuthRequest } from '../types/express';

/**
 * Guard factory that blocks access to an endpoint when the given module is
 * disabled for the requesting user's tenant (or system-wide).
 *
 * Must run after `authMiddleware`, which populates `req.user` (so
 * `tenant_id` is available). Resolution follows `moduleService.isModuleEnabled`:
 *   1. A tenant-scoped flag for this tenant+key takes precedence.
 *   2. Otherwise a system-scoped flag for this key applies.
 *   3. With no flags, the module is enabled by default.
 *
 * When the module is disabled it responds 403 `MODULE_DISABLED`, matching the
 * error contract in the design (Req 10.4/10.5). SUPERADMIN is exempt: the super
 * admin administers modules and must never be locked out of its own tooling.
 */
export const requireModule = (moduleKey: string) => {
  return async (
    req: AuthRequest,
    _res: Response,
    next: NextFunction
  ): Promise<void> => {
    // Super admin is never gated by tenant/system module flags.
    if (req.user?.role === 'SUPERADMIN') {
      next();
      return;
    }

    const tenantId = req.user?.tenant_id;

    // No tenant context: leave the auth decision to earlier guards.
    if (!tenantId) {
      next();
      return;
    }

    const enabled = await moduleService.isModuleEnabled(tenantId, moduleKey);

    if (!enabled) {
      throw new HttpError('Module is disabled', 403, 'MODULE_DISABLED');
    }

    next();
  };
};
