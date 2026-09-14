import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// El JWT secret debe configurarse ANTES de importar la app.
const TEST_JWT_SECRET = 'test-promotions-integration-secret';
process.env.JWT_SECRET = TEST_JWT_SECRET;

// firebase-admin.service importa firebase-admin/auth -> jose (ESM), que Jest
// no transforma. Este test no ejercita el login, asi que lo mockeamos para
// cortar esa cadena de importacion al cargar la app (mismo patron que los
// otros tests de integracion del repo).
jest.mock('../../src/services/firebase-admin.service', () => ({
  firebaseAdminService: {
    verifyIdToken: jest.fn(),
  },
}));

// Mock de Prisma. Lo consumen:
// - `authenticated`: user.findUnique (ensureNotBlocked) + user.update (touchLastSeen).
// - requireModule('branches'): moduleFlag.findFirst (null -> modulo habilitado).
// - requirePremium: tenant.findUnique (subscription_status / expires_at).
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  moduleFlag: {
    findFirst: jest.fn(),
  },
  tenant: {
    findUnique: jest.fn(),
  },
};

jest.mock('../../src/database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// Mock del promotionService: el controller solo delega y da forma a la
// respuesta, asi el test no depende de la BD.
jest.mock('../../src/services/promotion.service', () => ({
  promotionService: {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  },
}));

import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/app';
import { promotionService } from '../../src/services/promotion.service';

/** Genera un JWT valido de ADMIN para las rutas `authenticated` + requireAdmin. */
function adminToken(): string {
  return jwt.sign(
    {
      user_id: 'user-admin-1',
      tenant_id: 'tenant-1',
      role: 'ADMIN',
      permissions: [],
    },
    TEST_JWT_SECRET,
    { expiresIn: '1h' }
  );
}

/** Configura el tenant como premium (subscription activa, sin expiracion). */
function setPremiumTenant(): void {
  mockPrisma.tenant.findUnique.mockResolvedValue({
    subscription_status: 'active',
    subscription_expires_at: null,
  } as never);
}

/** Configura el tenant como free (subscription inactiva). */
function setFreeTenant(): void {
  mockPrisma.tenant.findUnique.mockResolvedValue({
    subscription_status: 'inactive',
    subscription_expires_at: null,
  } as never);
}

describe('rutas /v1/branches/:id/promotions (integracion ligera)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // ensureNotBlocked: usuario activo. touchLastSeen: no-op.
    mockPrisma.user.findUnique.mockResolvedValue({
      is_active: true,
      email: 'admin@example.com',
    } as never);
    mockPrisma.user.update.mockResolvedValue({} as never);
    // requireModule('branches'): sin flags -> modulo habilitado por defecto.
    mockPrisma.moduleFlag.findFirst.mockResolvedValue(null as never);
  });

  describe('POST /v1/branches/:id/promotions', () => {
    it('responde 201 para un ADMIN de tenant PREMIUM', async () => {
      setPremiumTenant();
      (promotionService.create as jest.Mock).mockResolvedValue({
        id: 'promo-1',
        branch_id: 'branch-1',
        title: 'Oferta',
        description: null,
        image_url: null,
        starts_at: null,
        ends_at: null,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never);

      const response = await request(app)
        .post('/v1/branches/branch-1/promotions')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ title: 'Oferta' });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe('promo-1');
      expect(promotionService.create).toHaveBeenCalledWith(
        'tenant-1',
        'branch-1',
        { title: 'Oferta' }
      );
    });

    it('responde 403 PREMIUM_REQUIRED para un ADMIN de tenant FREE y no llama al service', async () => {
      setFreeTenant();

      const response = await request(app)
        .post('/v1/branches/branch-1/promotions')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ title: 'Oferta' });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('PREMIUM_REQUIRED');
      // requirePremium bloquea ANTES de llegar al controller.
      expect(promotionService.create).not.toHaveBeenCalled();
    });
  });

  describe('GET /v1/branches/:id/promotions', () => {
    it('responde 200 para un ADMIN de tenant FREE (list no requiere premium)', async () => {
      setFreeTenant();
      (promotionService.list as jest.Mock).mockResolvedValue([
        {
          id: 'promo-1',
          branch_id: 'branch-1',
          title: 'Oferta',
          description: null,
          image_url: null,
          starts_at: null,
          ends_at: null,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ] as never);

      const response = await request(app)
        .get('/v1/branches/branch-1/promotions')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data[0].id).toBe('promo-1');
      expect(promotionService.list).toHaveBeenCalledWith('tenant-1', 'branch-1');
    });
  });
});
