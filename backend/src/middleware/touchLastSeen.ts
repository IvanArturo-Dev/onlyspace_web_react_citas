import { Response, NextFunction } from 'express';
import { prisma } from '../database/prisma.service';
import { AuthRequest } from '../types/express';

/**
 * Best-effort, throttled middleware that refreshes `User.last_seen` so the
 * super admin realtime dashboard can compute active sessions.
 *
 * Must run after `authMiddleware`, which populates `req.user`.
 *
 * Behaviour:
 * - Never blocks the request: the DB write is fire-and-forget and any failure
 *   is swallowed (`.catch(() => {})`). `next()` is called immediately.
 * - Throttled per user via an in-memory map so we do not issue an update on
 *   every single request; at most one write per THROTTLE_MS window.
 * - If there is no authenticated user, it simply forwards to the next handler.
 */
const THROTTLE_MS = 60_000;

// userId -> timestamp (ms) of the last update we triggered.
const lastUpdateByUser = new Map<string, number>();

export const touchLastSeen = (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): void => {
  const userId = req.user?.id;

  if (!userId) {
    next();
    return;
  }

  const now = Date.now();
  const previous = lastUpdateByUser.get(userId);

  if (previous === undefined || now - previous > THROTTLE_MS) {
    // Record the attempt before firing so concurrent requests within the
    // throttle window do not all trigger writes.
    lastUpdateByUser.set(userId, now);

    // Fire-and-forget: do not await, and never let a failure bubble up.
    prisma.user
      .update({ where: { id: userId }, data: { last_seen: new Date() } })
      .catch(() => {});
  }

  next();
};
