import { Response, NextFunction } from 'express';
import { requireAdmin } from '../requireAdmin';
import { HttpError } from '../../utils/errors';
import { AuthRequest } from '../../types/express';

/**
 * Unit tests for the requireAdmin authorization middleware.
 *
 * Property 7 (Aislamiento por tenant): solo un usuario con rol ADMIN (firmado
 *   en el JWT) accede a las rutas de configuracion del dueno; cualquier otro
 *   rol o la ausencia de usuario se rechaza con 403 FORBIDDEN.
 *
 * **Validates: Requirements 4.5, 9.5, 10.1**
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
    requireAdmin(req as AuthRequest, res, next);
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

describe('requireAdmin', () => {
  it('calls next() without error when role is ADMIN', () => {
    const { error, next } = run({
      user: { id: 'u1', tenant_id: 't1', role: 'ADMIN', permissions: [] },
    });

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each(['SUPERADMIN', 'CLIENT', 'PROFESSIONAL', 'RECEPTION'])(
    'rejects role "%s" with 403 and does not call next()',
    (role) => {
      const { error, next } = run({
        user: { id: 'u1', tenant_id: 't1', role, permissions: [] },
      });

      expectForbidden(error);
      expect(next).not.toHaveBeenCalled();
    }
  );

  it('rejects when req.user is absent', () => {
    const { error, next } = run({});

    expectForbidden(error);
    expect(next).not.toHaveBeenCalled();
  });
});
