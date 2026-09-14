import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

// El JWT secret debe configurarse ANTES de importar la app, para que
// authMiddleware pueda verificar los tokens firmados abajo.
const TEST_JWT_SECRET = 'test-premium-gating-integration-secret';
process.env.JWT_SECRET = TEST_JWT_SECRET;

// firebase-admin.service importa firebase-admin/auth -> jose (ESM), que Jest no
// transforma. Este test no ejercita el login, asi que lo mockeamos para cortar
// esa cadena de importacion al cargar la app.
jest.mock('../../src/services/firebase-admin.service', () => ({
  firebaseAdminService: {
    verifyIdToken: jest.fn(),
  },
}));

// Mock de los servicios que estan DETRAS de los guards premium. Cuando un
// request premium pasa el guard, el controller llama a estos servicios; los
// mockeamos para que respondan ok y podamos asegurar que la ruta NO devuelve
// 403 PREMIUM_REQUIRED por motivos ajenos al gating.
jest.mock('../../src/services/assistant.service', () => ({
  assistantService: {
    invite: jest.fn(async () => ({
      id: 'assistant-1',
      email: 'nuevo@example.com',
      status: 'active',
      invited_by: 'user-1',
      created_at: new Date().toISOString(),
    })),
  },
}));

jest.mock('../../src/services/loyaltyProgram.service', () => ({
  loyaltyProgramService: {
    create: jest.fn(async () => ({ id: 'program-1', name: 'Programa Uno' })),
  },
}));

jest.mock('../../src/services/branch.service', () => ({
  branchService: {
    create: jest.fn(async () => ({ id: 'branch-1', name: 'Sucursal Uno' })),
  },
}));

// El modulo 'branches' debe estar habilitado para que la ruta POST /branches
// llegue al guard de quota (no queremos MODULE_DISABLED).
jest.mock('../../src/services/module.service', () => ({
  moduleService: {
    isModuleEnabled: jest.fn(async () => true),
  },
}));

// writeAudit toca prisma.auditLog; lo neutralizamos para no depender de la BD.
jest.mock('../../src/utils/audit', () => ({
  writeAudit: jest.fn(async () => undefined),
}));

// Estado mutable que cada test configura antes de golpear las rutas.
const state: {
  subscription_status: string;
  subscription_expires_at: Date | null;
  branchCount: number;
} = {
  subscription_status: 'inactive',
  subscription_expires_at: null,
  branchCount: 0,
};

// Mock de prisma. La cadena `authenticated` usa user.findUnique
// (ensureNotBlocked) y user.update (touchLastSeen). Los guards premium usan
// tenant.findUnique y branch.count.
jest.mock('../../src/database/prisma.service', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(async () => ({ is_active: true })),
      update: jest.fn(async () => ({})),
    },
    tenant: {
      findUnique: jest.fn(async () => ({
        subscription_status: state.subscription_status,
        subscription_expires_at: state.subscription_expires_at,
      })),
    },
    branch: {
      count: jest.fn(async () => state.branchCount),
    },
  },
}));

// Imports que dependen del env/mocks de arriba deben ir despues.
import request from 'supertest';
import app from '../../src/app';

function signAdminToken(): string {
  return jwt.sign(
    { user_id: 'user-1', tenant_id: 'tenant-1', role: 'ADMIN', permissions: [] as string[] },
    TEST_JWT_SECRET
  );
}

function setFree(): void {
  state.subscription_status = 'inactive';
  state.subscription_expires_at = null;
}

function setPremium(): void {
  state.subscription_status = 'active';
  state.subscription_expires_at = null;
}

describe('Premium gating en rutas de creacion (integration)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setFree();
    state.branchCount = 0;
  });

  describe('tenant FREE', () => {
    it('POST /v1/assistants -> 403 PREMIUM_REQUIRED', async () => {
      setFree();
      const token = signAdminToken();

      const response = await request(app)
        .post('/v1/assistants')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'nuevo@example.com' });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('PREMIUM_REQUIRED');
    });

    it('POST /v1/loyalty/programs -> 403 PREMIUM_REQUIRED', async () => {
      setFree();
      const token = signAdminToken();

      const response = await request(app)
        .post('/v1/loyalty/programs')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Programa Uno', type: 'visits', goal: 10, reward_text: 'Cafe gratis' });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('PREMIUM_REQUIRED');
    });

    it('POST /v1/branches con 1 sucursal existente -> 403 PREMIUM_REQUIRED', async () => {
      setFree();
      state.branchCount = 1;
      const token = signAdminToken();

      const response = await request(app)
        .post('/v1/branches')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Segunda Sucursal' });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('PREMIUM_REQUIRED');
    });

    it('POST /v1/branches con 0 sucursales -> NO es 403 PREMIUM_REQUIRED (primera sucursal)', async () => {
      setFree();
      state.branchCount = 0;
      const token = signAdminToken();

      const response = await request(app)
        .post('/v1/branches')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Primera Sucursal' });

      expect(response.body?.error?.code).not.toBe('PREMIUM_REQUIRED');
      expect(response.status).not.toBe(403);
    });
  });

  describe('tenant PREMIUM', () => {
    it('POST /v1/assistants -> NO es 403 PREMIUM_REQUIRED', async () => {
      setPremium();
      const token = signAdminToken();

      const response = await request(app)
        .post('/v1/assistants')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'nuevo@example.com' });

      expect(response.body?.error?.code).not.toBe('PREMIUM_REQUIRED');
      expect(response.status).not.toBe(403);
    });

    it('POST /v1/loyalty/programs -> NO es 403 PREMIUM_REQUIRED', async () => {
      setPremium();
      const token = signAdminToken();

      const response = await request(app)
        .post('/v1/loyalty/programs')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Programa Uno', type: 'visits', goal: 10, reward_text: 'Cafe gratis' });

      expect(response.body?.error?.code).not.toBe('PREMIUM_REQUIRED');
      expect(response.status).not.toBe(403);
    });

    it('POST /v1/branches con varias sucursales -> NO es 403 PREMIUM_REQUIRED', async () => {
      setPremium();
      state.branchCount = 3;
      const token = signAdminToken();

      const response = await request(app)
        .post('/v1/branches')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Otra Sucursal' });

      expect(response.body?.error?.code).not.toBe('PREMIUM_REQUIRED');
      expect(response.status).not.toBe(403);
    });
  });
});
