import { Response, NextFunction } from 'express';
import { HttpError } from '../utils/errors';
import { AuthRequest } from '../types/express';

/**
 * Authorization guard for super administration endpoints.
 *
 * Must run after `authMiddleware`, which populates `req.user` from the verified JWT.
 * The decision relies solely on the signed role: if it is exactly "SUPERADMIN" the
 * request proceeds, otherwise access is denied with 403 FORBIDDEN. No database lookup
 * is performed, consistent with how the rest of the endpoints operate.
 */
export const requireSuperAdmin = (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  if (req.user?.role === 'SUPERADMIN') {
    next();
    return;
  }

  throw new HttpError('Forbidden', 403, 'FORBIDDEN');
};
