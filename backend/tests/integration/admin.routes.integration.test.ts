import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

// Ensure the JWT secret is configured BEFORE the app (and its auth middleware)
// is imported, so that authMiddleware can verify the tokens signed below.
const TEST_JWT_SECRET = 'test-admin-integration-secret';
process.env.JWT_SECRET = TEST_JWT_SECRET;

// Mock adminService so the routes/authorization can be exercised without
// touching the database. Every method returns trivial data.
jest.mock('../../src/services/admin.service', () => ({
  adminService: {
    getOverview: jest.fn(async () => ({ overview: true })),
    getMetrics: jest.fn(async () => ({ metrics: true })),
    listTenants: jest.fn(async () => [{ tenant_id: 't1', name: 'Tenant 1' }]),
    getAuditTrail: jest.fn(async () => ({ items: [], page: 1, page_size: 20, total: 0 })),
    getHealth: jest.fn(async () => ({ status: 'ok' })),
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
import { adminService } from '../../src/services/admin.service';

function signToken(role: string): string {
  const payload = {
    user_id: 'user-1',
    tenant_id: 'tenant-1',
    role,
    permissions: [] as string[],
  };
  return jwt.sign(payload, TEST_JWT_SECRET);
}

describe('Admin routes integration (authorization & routing)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('without a token', () => {
    it('returns 401 for GET /v1/admin/overview', async () => {
      const response = await request(app).get('/v1/admin/overview');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('returns 401 for GET /v1/admin/metrics', async () => {
      const response = await request(app).get('/v1/admin/metrics');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('with a non-SUPERADMIN token', () => {
    it('returns 403 for GET /v1/admin/overview when role is ADMIN', async () => {
      const token = signToken('ADMIN');

      const response = await request(app)
        .get('/v1/admin/overview')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('returns 403 for GET /v1/admin/tenants when role is ADMIN', async () => {
      const token = signToken('ADMIN');

      const response = await request(app)
        .get('/v1/admin/tenants')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });
  });

  describe('with a SUPERADMIN token', () => {
    it('returns 200 and mocked data for GET /v1/admin/overview', async () => {
      const token = signToken('SUPERADMIN');

      const response = await request(app)
        .get('/v1/admin/overview')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({ overview: true });
      expect(adminService.getOverview).toHaveBeenCalledTimes(1);
    });

    it('returns 200 and mocked data for GET /v1/admin/tenants', async () => {
      const token = signToken('SUPERADMIN');

      const response = await request(app)
        .get('/v1/admin/tenants')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([{ tenant_id: 't1', name: 'Tenant 1' }]);
    });

    it('returns 200 and mocked data for GET /v1/admin/health', async () => {
      const token = signToken('SUPERADMIN');

      const response = await request(app)
        .get('/v1/admin/health')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({ status: 'ok' });
    });

    it('passes tenant_id from query to the service for GET /v1/admin/metrics', async () => {
      const token = signToken('SUPERADMIN');

      const response = await request(app)
        .get('/v1/admin/metrics?tenant_id=tenant-xyz')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({ metrics: true });
      expect(adminService.getMetrics).toHaveBeenCalledTimes(1);
      expect(adminService.getMetrics).toHaveBeenCalledWith(
        expect.objectContaining({ tenant_id: 'tenant-xyz' })
      );
    });
  });
});
