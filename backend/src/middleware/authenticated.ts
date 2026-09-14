import { authMiddleware } from './auth';
import { ensureNotBlocked } from './ensureNotBlocked';
import { touchLastSeen } from './touchLastSeen';

/**
 * Composed middleware chain for authenticated (non-public) routes.
 *
 * Order matters:
 * 1. `authMiddleware` verifies the JWT and populates `req.user`.
 * 2. `ensureNotBlocked` rejects users that have been blocked (is_active=false)
 *    with 403 USER_BLOCKED, keeping blocking effective across requests.
 * 3. `touchLastSeen` refreshes `User.last_seen` (best-effort, throttled) so the
 *    realtime dashboard can compute active sessions.
 *
 * IMPORTANT: do NOT apply this to public routes (e.g. `/v1/public/:code/info`
 * and `/availability`) — those have no auth and must remain reachable without a
 * token. Protected routes should progressively migrate to this array; it is
 * applied to `me.routes.ts` as a functional demonstration.
 *
 * Usage:
 *   router.get('/thing', ...authenticated, controller.handler);
 */
export const authenticated = [authMiddleware, ensureNotBlocked, touchLastSeen];
