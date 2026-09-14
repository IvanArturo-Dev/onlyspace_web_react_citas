import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// El JWT secret debe configurarse ANTES de importar la app.
const TEST_JWT_SECRET = 'test-public-discover-integration-secret';
process.env.JWT_SECRET = TEST_JWT_SECRET;

// firebase-admin.service importa firebase-admin/auth -> jose (ESM), que Jest
// no transforma. Este test no ejercita el login, asi que lo mockeamos para
// cortar esa cadena de importacion al cargar la app.
jest.mock('../../src/services/firebase-admin.service', () => ({
  firebaseAdminService: {
    verifyIdToken: jest.fn(),
  },
}));

// Mock del discoveryService: el controller solo delega y da forma a la
// respuesta, asi evitamos depender de la BD (mismo patron que los otros
// tests de integracion del repo, p.ej. publicBranch.routes.integration).
jest.mock('../../src/services/discovery.service', () => ({
  discoveryService: {
    discover: jest.fn(),
    categories: jest.fn(),
  },
}));

import request from 'supertest';
import app from '../../src/app';
import { discoveryService } from '../../src/services/discovery.service';

describe('GET /v1/public/discover integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('responde 200 con data.items como array', async () => {
    (discoveryService.discover as jest.Mock).mockResolvedValue([
      {
        business_name: 'Negocio Uno',
        code: 'AB3K9P',
        branch_name: 'Sucursal Centro',
        city: 'Ciudad',
        address: 'Calle 1',
        is_premium: true,
        categories: ['Barberia'],
        distance_km: null,
      },
    ] as never);

    const response = await request(app).get('/v1/public/discover');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data.items)).toBe(true);
    expect(response.body.data.items[0].code).toBe('AB3K9P');
    // "discover" no debe resolverse como codigo de sucursal.
    expect(discoveryService.discover).toHaveBeenCalledTimes(1);
  });

  it('responde 200 con data.items array vacio cuando no hay resultados', async () => {
    (discoveryService.discover as jest.Mock).mockResolvedValue([] as never);

    const response = await request(app).get('/v1/public/discover?q=nada');

    expect(response.status).toBe(200);
    expect(response.body.data.items).toEqual([]);
  });

  it('pasa lat/lng/radius_km numericos al service', async () => {
    (discoveryService.discover as jest.Mock).mockResolvedValue([] as never);

    await request(app).get(
      '/v1/public/discover?q=corte&category=barberia&lat=19.4&lng=-99.1&radius_km=5'
    );

    expect(discoveryService.discover).toHaveBeenCalledWith({
      q: 'corte',
      category: 'barberia',
      lat: 19.4,
      lng: -99.1,
      radius_km: 5,
    });
  });
});

describe('GET /v1/public/categories integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('responde 200 con data.categories como array', async () => {
    (discoveryService.categories as jest.Mock).mockResolvedValue([
      'Barberia',
      'Spa',
    ] as never);

    const response = await request(app).get('/v1/public/categories');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data.categories)).toBe(true);
    expect(response.body.data.categories).toEqual(['Barberia', 'Spa']);
    // "categories" no debe resolverse como codigo de sucursal.
    expect(discoveryService.categories).toHaveBeenCalledTimes(1);
  });

  it('responde 200 con array vacio cuando no hay categorias', async () => {
    (discoveryService.categories as jest.Mock).mockResolvedValue([] as never);

    const response = await request(app).get('/v1/public/categories');

    expect(response.status).toBe(200);
    expect(response.body.data.categories).toEqual([]);
  });
});
