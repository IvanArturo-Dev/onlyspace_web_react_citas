import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// El JWT secret debe configurarse ANTES de importar la app.
const TEST_JWT_SECRET = 'test-me-client-integration-secret';
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

// Mock de Prisma: la cadena `authenticated` usa user.findUnique (ensureNotBlocked)
// y user.update (touchLastSeen). Los handlers /me resuelven el customer del
// usuario por email; para estos endpoints se mockea lo que consumen.
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  customer: {
    findMany: jest.fn(),
  },
};

jest.mock('../../src/database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// Mock de los services de dominio: el controller solo delega y da forma a la
// respuesta, asi el test no depende de la BD.
jest.mock('../../src/services/loyalty.service', () => ({
  loyaltyService: {
    listRewards: jest.fn(),
    claim: jest.fn(),
  },
}));

jest.mock('../../src/services/favorite.service', () => ({
  favoriteService: {
    toggle: jest.fn(),
    list: jest.fn(),
  },
}));

import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/app';
import { loyaltyService } from '../../src/services/loyalty.service';
import { favoriteService } from '../../src/services/favorite.service';

/** Genera un JWT valido de cliente para las rutas `authenticated`. */
function clientToken(): string {
  return jwt.sign(
    {
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      role: 'CLIENT',
      permissions: [],
    },
    TEST_JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('rutas /v1/me del cliente (integracion ligera)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // ensureNotBlocked: usuario activo. touchLastSeen: no-op.
    mockPrisma.user.findUnique.mockResolvedValue({
      is_active: true,
      email: 'client@example.com',
    } as never);
    mockPrisma.user.update.mockResolvedValue({} as never);
  });

  describe('GET /v1/me/coupons', () => {
    it('responde 200 con las recompensas del cliente', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([{ id: 'cust-1' }] as never);
      (loyaltyService.listRewards as jest.Mock).mockResolvedValue([
        {
          id: 'rw-1',
          status: 'EARNED',
          reward_text: '10% de descuento',
          expires_at: null,
          claim_code: null,
        },
      ] as never);

      const response = await request(app)
        .get('/v1/me/coupons')
        .set('Authorization', `Bearer ${clientToken()}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data[0].id).toBe('rw-1');
      expect(loyaltyService.listRewards).toHaveBeenCalledWith('tenant-1', {
        customerId: 'cust-1',
      });
    });

    it('responde 200 con array vacio cuando el usuario no tiene customers', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([] as never);

      const response = await request(app)
        .get('/v1/me/coupons')
        .set('Authorization', `Bearer ${clientToken()}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
      expect(loyaltyService.listRewards).not.toHaveBeenCalled();
    });

    it('responde 401 sin token', async () => {
      const response = await request(app).get('/v1/me/coupons');
      expect(response.status).toBe(401);
    });
  });

  describe('POST /v1/me/favorites/:tenantId', () => {
    it('responde 200 con el resultado del toggle', async () => {
      (favoriteService.toggle as jest.Mock).mockResolvedValue({
        favorited: true,
      } as never);

      const response = await request(app)
        .post('/v1/me/favorites/tenant-2')
        .set('Authorization', `Bearer ${clientToken()}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({ favorited: true });
      expect(favoriteService.toggle).toHaveBeenCalledWith('user-1', 'tenant-2');
    });

    it('propaga 404 cuando el negocio no existe', async () => {
      const err: any = new Error('Negocio no encontrado');
      err.statusCode = 404;
      err.code = 'TENANT_NOT_FOUND';
      (favoriteService.toggle as jest.Mock).mockRejectedValue(err as never);

      const response = await request(app)
        .post('/v1/me/favorites/no-existe')
        .set('Authorization', `Bearer ${clientToken()}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('TENANT_NOT_FOUND');
    });
  });
});
