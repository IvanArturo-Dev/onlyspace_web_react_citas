import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

// El secreto JWT debe configurarse ANTES de importar la app (y su authMiddleware),
// para que authMiddleware pueda verificar los tokens firmados aqui.
const TEST_JWT_SECRET = 'test-authorization-integration-secret';
process.env.JWT_SECRET = TEST_JWT_SECRET;

// Mock del authorizationService para ejercitar rutas/autorizacion sin tocar la BD.
jest.mock('../../src/services/authorization.service', () => ({
  authorizationService: {
    list: jest.fn(async () => [
      {
        id: 'aa-1',
        email: 'owner@example.com',
        status: 'active',
        tenant_id: 't-1',
        booking_code: 'AB3K9P',
        created_at: '2024-01-01T00:00:00.000Z',
      },
    ]),
    authorize: jest.fn(async (email: string) => ({
      id: 'aa-1',
      email,
      status: 'active',
      tenant_id: 't-1',
      booking_code: 'AB3K9P',
      created_at: '2024-01-01T00:00:00.000Z',
    })),
    setStatus: jest.fn(async (id: string, status: string) => ({
      id,
      email: 'owner@example.com',
      status,
      tenant_id: 't-1',
      booking_code: 'AB3K9P',
      created_at: '2024-01-01T00:00:00.000Z',
    })),
  },
}));

// writeAudit es best-effort; lo mockeamos para no tocar la BD.
jest.mock('../../src/utils/audit', () => ({
  writeAudit: jest.fn(async () => undefined),
}));

// firebase-admin.service importa firebase-admin/auth -> jwks-rsa -> jose (ESM),
// que Jest no transforma. Como este test no ejercita el login, lo mockeamos
// para cortar esa cadena de importacion al cargar la app.
jest.mock('../../src/services/firebase-admin.service', () => ({
  firebaseAdminService: {
    verifyIdToken: jest.fn(),
  },
}));

// Imports que dependen del env/mock anterior deben ir despues.
import request from 'supertest';
import app from '../../src/app';
import { authorizationService } from '../../src/services/authorization.service';

function signToken(role: string): string {
  const payload = {
    user_id: 'user-1',
    tenant_id: 'tenant-1',
    role,
    permissions: [] as string[],
  };
  return jwt.sign(payload, TEST_JWT_SECRET);
}

describe('Authorization routes integration (authorization & routing)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sin token', () => {
    it('GET /v1/admin/authorized -> 401', async () => {
      const response = await request(app).get('/v1/admin/authorized');
      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('POST /v1/admin/authorized -> 401', async () => {
      const response = await request(app)
        .post('/v1/admin/authorized')
        .send({ email: 'owner@example.com' });
      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('con rol ADMIN (no SUPERADMIN)', () => {
    it('GET /v1/admin/authorized -> 403', async () => {
      const token = signToken('ADMIN');
      const response = await request(app)
        .get('/v1/admin/authorized')
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('POST /v1/admin/authorized -> 403', async () => {
      const token = signToken('ADMIN');
      const response = await request(app)
        .post('/v1/admin/authorized')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'owner@example.com' });
      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });
  });

  describe('con rol SUPERADMIN', () => {
    it('GET /v1/admin/authorized -> 200 con datos mockeados', async () => {
      const token = signToken('SUPERADMIN');
      const response = await request(app)
        .get('/v1/admin/authorized')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([
        {
          id: 'aa-1',
          email: 'owner@example.com',
          status: 'active',
          tenant_id: 't-1',
          booking_code: 'AB3K9P',
          created_at: '2024-01-01T00:00:00.000Z',
        },
      ]);
      expect(authorizationService.list).toHaveBeenCalledTimes(1);
    });

    it('POST /v1/admin/authorized -> 201 con la vista', async () => {
      const token = signToken('SUPERADMIN');
      const response = await request(app)
        .post('/v1/admin/authorized')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'nuevo@example.com' });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.email).toBe('nuevo@example.com');
      expect(authorizationService.authorize).toHaveBeenCalledTimes(1);
      expect(authorizationService.authorize).toHaveBeenCalledWith(
        'nuevo@example.com',
        'user-1'
      );
    });

    it('POST /v1/admin/authorized sin email -> 400', async () => {
      const token = signToken('SUPERADMIN');
      const response = await request(app)
        .post('/v1/admin/authorized')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(authorizationService.authorize).not.toHaveBeenCalled();
    });

    it('PATCH /v1/admin/authorized/:id -> 200 con status actualizado', async () => {
      const token = signToken('SUPERADMIN');
      const response = await request(app)
        .patch('/v1/admin/authorized/aa-1')
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'revoked' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('revoked');
      expect(authorizationService.setStatus).toHaveBeenCalledWith('aa-1', 'revoked');
    });
  });
});
