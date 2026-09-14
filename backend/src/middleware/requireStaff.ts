import { Response, NextFunction } from 'express';
import { HttpError } from '../utils/errors';
import { AuthRequest } from '../types/express';

/**
 * Authorization guard for appointment-management endpoints that may be operated
 * by an entrepreneur (ADMIN) or one of their assistants (ASSISTANT).
 *
 * Must run after `authMiddleware`, which populates `req.user` from the verified
 * JWT. Both ADMIN and ASSISTANT proceed; every other role is denied with
 * 403 FORBIDDEN. Tenant scoping is enforced downstream: handlers use
 * `req.user.tenant_id`, which the login already pins to the entrepreneur's
 * tenant for both roles, so an assistant can only touch their tenant's data.
 *
 * Sensitive configuration (branches, schedules, holidays, services,
 * categories) stays ADMIN-only via `requireAdmin`; this guard is intended for
 * appointment CRUD/status/availability only.
 */
export const requireStaff = (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  if (req.user?.role === 'ADMIN' || req.user?.role === 'ASSISTANT') {
    next();
    return;
  }

  throw new HttpError('Forbidden', 403, 'FORBIDDEN');
};
