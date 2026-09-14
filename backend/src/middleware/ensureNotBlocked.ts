import { Response, NextFunction } from 'express';
import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';
import { AuthRequest } from '../types/express';

/**
 * Guard that makes a "blocked" user effective on subsequent requests.
 *
 * Blocking a user sets `User.is_active = false`. Because JWTs are stateless and
 * may still be valid, this guard re-checks the persisted state on each protected
 * request and rejects with 403 USER_BLOCKED when the user no longer exists or is
 * inactive.
 *
 * Must run after `authMiddleware`, which populates `req.user`. Relies on
 * `express-async-errors` so the thrown `HttpError` reaches the error handler.
 * If there is no authenticated user it forwards to the next handler and lets
 * other guards decide how to treat the missing auth.
 */
export const ensureNotBlocked = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const userId = req.user?.id;

  if (!userId) {
    next();
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { is_active: true },
  });

  if (!user || user.is_active === false) {
    throw new HttpError('User is blocked', 403, 'USER_BLOCKED');
  }

  next();
};
