import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// El JWT secret debe configurarse ANTES de importar la app.
const TEST_JWT_SECRET = 'test-public-branch-integration-secret';
process.env.JWT_SECRET = TEST_JWT_SECRET;

// firebase-admin.service importa firebase-admin/auth -> jose (ESM), que Jest
// no transforma. Este test no ejercita el login, asi que lo mockeamos para
// cortar esa cadena de importacion al cargar la app.
jest.mock('../../src/services/firebase-admin.service', () => ({
  firebaseAdminService: {
    verifyIdToken: jest.fn(),
  },
}));

// Mock del publicService: resolucion por sucursal y busqueda.
jest.mock('../../src/services/public.service', () => ({
  publicService: {
    resolveBranchByCode: jest.fn(),
    searchBranches: jest.fn(),
    resolveTenantByCode: jest.fn(),
  },
}));

// El controller consulta prisma.tenant y prisma.service en /info.
jest.mock('../../src/database/prisma.service', () => ({
  prisma: {
    tenant: {
      findUnique: jest.fn(async () => ({ id: 'tenant-1', name: 'Negocio Uno' })),
    },
    service: {
      findMany: jest.fn(async () => [
        { id: 'svc-1', name: 'Corte', duration_mins: 30, price: 100 },
      ]),
    },
    googleAccount: {
      // No Google connected for the test tenant -> online_sessions_enabled false.
      findUnique: jest.fn(async () => null),
    },
    user: {
      findUnique: jest.fn(async () => ({ email: 'cliente@example.com', name: 'Cliente' })),
    },
  },
}));

import request from 'supertest';
import app from '../../src/app';
import { publicService } from '../../src/services/public.service';
import { HttpError } from '../../src/utils/errors';

const ACTIVE_BRANCH = {
  id: 'branch-1',
  tenant_id: 'tenant-1',
  name: 'Sucursal Centro',
  status: 'active',
  booking_code: 'AB3K9P',
} as any;

describe('GET /v1/public/:code/info integration (por sucursal)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 200 with business, branch and services for a valid code', async () => {
    (publicService.resolveBranchByCode as jest.Mock).mockResolvedValue(ACTIVE_BRANCH as never);

    const response = await request(app).get('/v1/public/AB3K9P/info');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.business.name).toBe('Negocio Uno');
    expect(response.body.data.branch).toEqual({
      id: 'branch-1',
      name: 'Sucursal Centro',
      maps_url: null,
    });
    expect(response.body.data.services[0].id).toBe('svc-1');
    // No Google connected -> derived flag is false and no tokens leak.
    expect(response.body.data.online_sessions_enabled).toBe(false);
  });

  it('returns 404 INVALID_CODE for an invalid/inactive code', async () => {
    (publicService.resolveBranchByCode as jest.Mock).mockRejectedValue(
      new HttpError('Codigo de sucursal invalido', 404, 'INVALID_CODE') as never
    );

    const response = await request(app).get('/v1/public/ZZ9999/info');

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INVALID_CODE');
  });
});

describe('GET /v1/public/search integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 200 with non-sensitive results', async () => {
    (publicService.searchBranches as jest.Mock).mockResolvedValue([
      { code: 'AB3K9P', branch_name: 'Sucursal Centro', business_name: 'Negocio Uno' },
    ] as never);

    const response = await request(app).get('/v1/public/search?q=centro');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.results).toEqual([
      { code: 'AB3K9P', branch_name: 'Sucursal Centro', business_name: 'Negocio Uno' },
    ]);
    // "search" no debe resolverse como codigo de sucursal.
    expect(publicService.resolveBranchByCode).not.toHaveBeenCalled();
  });

  it('returns 200 with [] for a short query', async () => {
    (publicService.searchBranches as jest.Mock).mockResolvedValue([] as never);

    const response = await request(app).get('/v1/public/search?q=a');

    expect(response.status).toBe(200);
    expect(response.body.data.results).toEqual([]);
  });
});
