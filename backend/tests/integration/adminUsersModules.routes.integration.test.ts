import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

// Ensure the JWT secret is configured BEFORE the app (and its auth middleware)
// is imported, so that authMiddleware can verify the tokens signed below.
const TEST_JWT_SECRET = 'test-admin-users-modules-integration-secret';
process.env.JWT_SECRET = TEST_JWT_SECRET;

// Mock userAdminService and moduleService so the routes/authorization can be
// exercised without touching the database.
jest.mock('../../src/services/userAdmin.service', () => ({
  userAdminService: {
    list: jest.fn(async () => []),
    setBlocked: jest.fn(async () => ({})),
    changeRole: jest.fn(async () => ({})),
  },
}));

jest.mock('../../src/services/module.service', () => ({
  moduleService: {
    list: jest.fn(async () => []),
    setFlag: jest.fn(async () => ({})),
  },
}));

// firebase-admin.service importa firebase-admin/auth -> jwks-rsa -> jose (ESM),
// que Jest no transforma. Como este test no ejercita el login, lo mockeamos
// para cortar esa cadena de importacion al cargar la app.
jest.mock('../../src/services/firebase-admin.service', () => ({
  firebaseAdminService: {
    verifyIdToken: jest.fn(),
  },
}));

// Imports that depend on the env/mock above must come after they are set up.
import request from 'supertest';
import app from '../../src/app';
import { userAdminService } from '../../src/services/userAdmin.service';
import { moduleService } from '../../src/services/module.service';

function signToken(role: string): string {
  const payload = {
    user_id: 'user-1',
    tenant_id: 'tenant-1',
    role,
    permissions: [] as string[],
  };
  return jwt.sign(payload, TEST_JWT_SECRET);
}

describe('Admin users & modules routes integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --- Role matrix (401 / 403 / 200) ---

  describe('role matrix', () => {
    it('returns 401 without a token for GET /v1/admin/users', async () => {
      const response = await request(app).get('/v1/admin/users');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('returns 401 without a token for GET /v1/admin/modules', async () => {
      const response = await request(app).get('/v1/admin/modules');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('returns 403 for an ADMIN token on GET /v1/admin/users', async () => {
      const token = signToken('ADMIN');

      const response = await request(app)
        .get('/v1/admin/users')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('returns 403 for an ADMIN token on GET /v1/admin/modules', async () => {
      const token = signToken('ADMIN');

      const response = await request(app)
        .get('/v1/admin/modules')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    it('returns 200 for a SUPERADMIN token on GET /v1/admin/users', async () => {
      const token = signToken('SUPERADMIN');

      const response = await request(app)
        .get('/v1/admin/users')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(userAdminService.list).toHaveBeenCalledTimes(1);
    });

    it('returns 200 for a SUPERADMIN token on GET /v1/admin/modules', async () => {
      const token = signToken('SUPERADMIN');

      const response = await request(app)
        .get('/v1/admin/modules')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(moduleService.list).toHaveBeenCalledTimes(1);
    });
  });

  // --- Property 6: bloqueo efectivo ---

  describe('PATCH /v1/admin/users/:id/block (Property 6)', () => {
    it('blocks a user (blocked=true) and calls setBlocked(id, true)', async () => {
      const token = signToken('SUPERADMIN');
      (userAdminService.setBlocked as jest.Mock).mockResolvedValue({
        id: 'u-9',
        is_active: false,
      } as never);

      const response = await request(app)
        .patch('/v1/admin/users/u-9/block')
        .set('Authorization', `Bearer ${token}`)
        .send({ blocked: true });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(userAdminService.setBlocked).toHaveBeenCalledWith('u-9', true);
    });

    it('unblocks a user (blocked=false) and calls setBlocked(id, false)', async () => {
      const token = signToken('SUPERADMIN');
      (userAdminService.setBlocked as jest.Mock).mockResolvedValue({
        id: 'u-9',
        is_active: true,
      } as never);

      const response = await request(app)
        .patch('/v1/admin/users/u-9/block')
        .set('Authorization', `Bearer ${token}`)
        .send({ blocked: false });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(userAdminService.setBlocked).toHaveBeenCalledWith('u-9', false);
    });

    it('returns 400 when blocked is not a boolean', async () => {
      const token = signToken('SUPERADMIN');

      const response = await request(app)
        .patch('/v1/admin/users/u-9/block')
        .set('Authorization', `Bearer ${token}`)
        .send({ blocked: 'yes' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(userAdminService.setBlocked).not.toHaveBeenCalled();
    });
  });

  // --- Property 7: no elevacion a SUPERADMIN ---

  describe('PATCH /v1/admin/users/:id/role (Property 7)', () => {
    it('changes role to RECEPTION and calls changeRole(id, "RECEPTION")', async () => {
      const token = signToken('SUPERADMIN');
      (userAdminService.changeRole as jest.Mock).mockResolvedValue({
        id: 'u-9',
        role: 'RECEPTION',
      } as never);

      const response = await request(app)
        .patch('/v1/admin/users/u-9/role')
        .set('Authorization', `Bearer ${token}`)
        .send({ role: 'RECEPTION' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(userAdminService.changeRole).toHaveBeenCalledWith('u-9', 'RECEPTION', 'user-1');
    });

    it('returns 403 when the service rejects SUPERADMIN (FORBIDDEN_ROLE)', async () => {
      const token = signToken('SUPERADMIN');
      const err: any = new Error('No se permite asignar SUPERADMIN');
      err.statusCode = 403;
      err.code = 'FORBIDDEN_ROLE';
      (userAdminService.changeRole as jest.Mock).mockRejectedValue(err as never);

      const response = await request(app)
        .patch('/v1/admin/users/u-9/role')
        .set('Authorization', `Bearer ${token}`)
        .send({ role: 'SUPERADMIN' });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FORBIDDEN_ROLE');
    });

    it('returns 400 when role is missing', async () => {
      const token = signToken('SUPERADMIN');

      const response = await request(app)
        .patch('/v1/admin/users/u-9/role')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(userAdminService.changeRole).not.toHaveBeenCalled();
    });
  });

  // --- Property 9: conmutacion de modulo ---

  describe('PATCH /v1/admin/modules (Property 9)', () => {
    it('toggles a module and calls setFlag with the body', async () => {
      const token = signToken('SUPERADMIN');
      (moduleService.setFlag as jest.Mock).mockResolvedValue({
        id: 'm-1',
        module_key: 'branches',
        enabled: false,
      } as never);

      const body = {
        scope: 'tenant',
        tenant_id: 'tenant-1',
        module_key: 'branches',
        enabled: false,
      };

      const response = await request(app)
        .patch('/v1/admin/modules')
        .set('Authorization', `Bearer ${token}`)
        .send(body);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(moduleService.setFlag).toHaveBeenCalledWith(
        expect.objectContaining(body)
      );
    });

    it('returns 400 when module_key is missing', async () => {
      const token = signToken('SUPERADMIN');

      const response = await request(app)
        .patch('/v1/admin/modules')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'system', enabled: true });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(moduleService.setFlag).not.toHaveBeenCalled();
    });
  });
});
