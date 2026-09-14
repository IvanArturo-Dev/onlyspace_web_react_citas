import { Response, NextFunction } from 'express';
import { customerRoutes } from '../customer.routes';
import { requireStaff } from '../../../middleware/requireStaff';
import { requireAdmin } from '../../../middleware/requireAdmin';
import { HttpError } from '../../../utils/errors';
import { AuthRequest } from '../../../types/express';

/**
 * Role tests for client (customer) management — Property 4 (Permisos de
 * colaborador).
 *
 * Managing clients is staff-only: the entrepreneur (ADMIN) OR one of their
 * assistants (ASSISTANT/colaborador) may list/get/create/update/patch/delete
 * customers; a final CLIENT (or an unauthenticated request) is denied with
 * 403 FORBIDDEN. The customer routes achieve this by composing the
 * `authenticated` chain with `requireStaff`, mirroring appointment.routes.ts.
 *
 * These are focused unit tests (no supertest dependency): we (1) exercise the
 * `requireStaff` guard directly across the role matrix and (2) assert that every
 * registered customer route wires `requireStaff` into its middleware stack.
 *
 * **Validates: Requirements 5.2, 5.3, 5.5**
 */

const createRes = (): Response => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const run = (
  req: Partial<AuthRequest>
): { error: unknown; next: jest.Mock } => {
  const next = jest.fn() as NextFunction & jest.Mock;
  const res = createRes();
  let error: unknown;

  try {
    requireStaff(req as AuthRequest, res, next);
  } catch (e) {
    error = e;
  }

  return { error, next };
};

const expectForbidden = (error: unknown) => {
  expect(error).toBeInstanceOf(HttpError);
  const httpError = error as HttpError;
  expect(httpError.statusCode).toBe(403);
  expect(httpError.code).toBe('FORBIDDEN');
};

describe('customer routes — Property 4 (permisos de colaborador)', () => {
  describe('requireStaff role matrix', () => {
    it.each(['ADMIN', 'ASSISTANT'])(
      'allows staff role "%s" to manage clients (next called, no error)',
      (role) => {
        const { error, next } = run({
          user: { id: 'u1', tenant_id: 't1', role, permissions: [] },
        });

        expect(error).toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
      }
    );

    it.each(['CLIENT', 'PROFESSIONAL', 'RECEPTION', 'SUPERADMIN'])(
      'denies non-staff role "%s" with 403 and does not call next()',
      (role) => {
        const { error, next } = run({
          user: { id: 'u1', tenant_id: 't1', role, permissions: [] },
        });

        expectForbidden(error);
        expect(next).not.toHaveBeenCalled();
      }
    );

    it('denies an unauthenticated request (no req.user) with 403', () => {
      const { error, next } = run({});

      expectForbidden(error);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('router wiring: every customer route is guarded by requireStaff', () => {
    // Express stores registered routes on router.stack; each layer that carries
    // a `route` exposes the route's own middleware stack via route.stack, whose
    // handles are the functions passed to the verb (authenticated..., requireStaff,
    // controller). We assert requireStaff is present on each.
    const layers = (
      customerRoutes as unknown as {
        stack: Array<{
          route?: {
            path: string;
            methods: Record<string, boolean>;
            stack: Array<{ handle: unknown }>;
          };
        }>;
      }
    ).stack.filter((l) => l.route);

    it('registra las rutas de gestion de clientes + estado/deuda de cancelacion', () => {
      expect(layers).toHaveLength(8);
    });

    it.each(layers.map((l) => l.route!))(
      'route $path esta protegida por un guard staff/admin',
      (route) => {
        const handles = route.stack.map((s) => s.handle);
        const guarded = handles.includes(requireStaff) || handles.includes(requireAdmin);
        expect(guarded).toBe(true);
      }
    );
  });
});
