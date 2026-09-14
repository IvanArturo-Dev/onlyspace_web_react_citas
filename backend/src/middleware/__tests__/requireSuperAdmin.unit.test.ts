import { Response, NextFunction } from 'express';
import { requireSuperAdmin } from '../requireSuperAdmin';
import { HttpError } from '../../utils/errors';
import { AuthRequest } from '../../types/express';

/**
 * Unit tests for the requireSuperAdmin authorization middleware.
 *
 * Property 1 (Aislamiento por defecto): cualquier peticion cuyo rol no sea
 *   SUPERADMIN es rechazada con 403 FORBIDDEN sin llamar a next().
 * Property 2 (Autoridad exclusiva del rol firmado): solo el rol contenido en el
 *   JWT (poblado en req.user.role) decide; ningun header/query/body puede otorgar
 *   acceso SUPERADMIN.
 *
 * **Validates: Requirements 1.5, 3.2, 3.3**
 */

const createRes = (): Response => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

/**
 * Runs the middleware and returns the thrown error (if any).
 * The middleware follows the auth.ts style: it throws HttpError instead of
 * writing to the response, so we capture the exception here.
 */
const run = (
  req: Partial<AuthRequest>
): { error: unknown; next: jest.Mock; res: Response } => {
  const next = jest.fn() as NextFunction & jest.Mock;
  const res = createRes();
  let error: unknown;

  try {
    requireSuperAdmin(req as AuthRequest, res, next);
  } catch (e) {
    error = e;
  }

  return { error, next, res };
};

const expectForbidden = (error: unknown) => {
  expect(error).toBeInstanceOf(HttpError);
  const httpError = error as HttpError;
  expect(httpError.statusCode).toBe(403);
  expect(httpError.code).toBe('FORBIDDEN');
};

describe('requireSuperAdmin', () => {
  it('calls next() without error when role is SUPERADMIN', () => {
    const req: Partial<AuthRequest> = {
      user: {
        id: 'user-1',
        tenant_id: 'default',
        role: 'SUPERADMIN',
        permissions: [],
      },
    };

    const { error, next, res } = run(req);

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  describe('Property 1: denies any non-SUPERADMIN role with 403 FORBIDDEN', () => {
    const roles = ['ADMIN', 'PROFESSIONAL', 'RECEPTION'];

    it.each(roles)('rejects role "%s" and does not call next()', (role) => {
      const req: Partial<AuthRequest> = {
        user: {
          id: 'user-1',
          tenant_id: 'tenant-1',
          role,
          permissions: [],
        },
      };

      const { error, next } = run(req);

      expectForbidden(error);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects when req.user is undefined', () => {
      const { error, next } = run({});

      expectForbidden(error);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects when req.user is explicitly undefined', () => {
      const { error, next } = run({ user: undefined });

      expectForbidden(error);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Property 2: only the signed role grants access', () => {
    it('rejects even when headers/query/body claim SUPERADMIN but JWT role is not', () => {
      const req: Partial<AuthRequest> = {
        headers: { 'x-role': 'SUPERADMIN' } as AuthRequest['headers'],
        query: { role: 'SUPERADMIN' } as AuthRequest['query'],
        body: { role: 'SUPERADMIN' },
        user: {
          id: 'user-1',
          tenant_id: 'tenant-1',
          role: 'ADMIN',
          permissions: ['*'],
        },
      };

      const { error, next } = run(req);

      expectForbidden(error);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects when spoofing signals are present and req.user is absent', () => {
      const req: Partial<AuthRequest> = {
        headers: { 'x-role': 'SUPERADMIN' } as AuthRequest['headers'],
        query: { role: 'SUPERADMIN' } as AuthRequest['query'],
        body: { role: 'SUPERADMIN' },
      };

      const { error, next } = run(req);

      expectForbidden(error);
      expect(next).not.toHaveBeenCalled();
    });

    it('grants access based solely on the signed SUPERADMIN role, ignoring other signals', () => {
      const req: Partial<AuthRequest> = {
        headers: { 'x-role': 'ADMIN' } as AuthRequest['headers'],
        query: { role: 'ADMIN' } as AuthRequest['query'],
        body: { role: 'ADMIN' },
        user: {
          id: 'user-1',
          tenant_id: 'default',
          role: 'SUPERADMIN',
          permissions: [],
        },
      };

      const { error, next } = run(req);

      expect(error).toBeUndefined();
      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
