import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

// El JWT secret debe configurarse ANTES de importar la app para que el
// authMiddleware pueda verificar los tokens firmados aqui.
const TEST_JWT_SECRET = 'test-booking-integration-secret';
process.env.JWT_SECRET = TEST_JWT_SECRET;

// firebase-admin.service importa firebase-admin/auth -> jose (ESM), que Jest
// no transforma. Este test no ejercita el login, asi que lo mockeamos para
// cortar esa cadena de importacion al cargar la app.
jest.mock('../../src/services/firebase-admin.service', () => ({
  firebaseAdminService: {
    verifyIdToken: jest.fn(),
  },
}));

// Mock del bookingService para no tocar la base de datos. El controller
// publico ahora reserva por sucursal (createBranchBooking).
jest.mock('../../src/services/booking.service', () => ({
  bookingService: {
    createBranchBooking: jest.fn(),
  },
}));

// El controller resuelve la sucursal por codigo antes de reservar.
jest.mock('../../src/services/public.service', () => ({
  publicService: {
    resolveBranchByCode: jest.fn(async () => ({
      id: 'branch-1',
      tenant_id: 'tenant-1',
      name: 'Sucursal Centro',
      status: 'active',
      booking_code: 'AB3K9P',
    })),
  },
}));

// El controller consulta prisma.user por el id del token para obtener email/name.
jest.mock('../../src/database/prisma.service', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(async () => ({
        email: 'cliente@example.com',
        name: 'Cliente Uno',
      })),
    },
  },
}));

// Imports que dependen del env/mock anteriores deben ir despues.
import request from 'supertest';
import app from '../../src/app';
import { bookingService } from '../../src/services/booking.service';
import { HttpError } from '../../src/utils/errors';

function signToken(role: string): string {
  const payload = {
    user_id: 'user-1',
    tenant_id: 'tenant-1',
    role,
    permissions: [] as string[],
  };
  return jwt.sign(payload, TEST_JWT_SECRET);
}

describe('POST /v1/public/:code/appointments integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 without a token', async () => {
    const response = await request(app)
      .post('/v1/public/AB3K9P/appointments')
      .send({ service_id: 'svc-1', start_time: new Date(Date.now() + 3600_000).toISOString() });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it('returns 201 with a valid token and a mocked booking', async () => {
    (bookingService.createBranchBooking as jest.Mock).mockResolvedValue({
      id: 'appt-1',
      start_time: new Date(),
      end_time: new Date(),
      status: 'PENDING',
      service_id: 'svc-1',
    } as never);

    const token = signToken('CLIENT');

    const response = await request(app)
      .post('/v1/public/AB3K9P/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({ service_id: 'svc-1', start_time: new Date(Date.now() + 3600_000).toISOString() });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Cita agendada');
    expect(response.body.data.id).toBe('appt-1');
    expect(bookingService.createBranchBooking).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when required fields are missing', async () => {
    const token = signToken('CLIENT');

    const response = await request(app)
      .post('/v1/public/AB3K9P/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({ service_id: 'svc-1' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(bookingService.createBranchBooking).not.toHaveBeenCalled();
  });

  it('returns 409 SLOT_TAKEN when the service reports the slot is taken', async () => {
    (bookingService.createBranchBooking as jest.Mock).mockRejectedValue(
      new HttpError('El horario ya no esta disponible', 409, 'SLOT_TAKEN') as never
    );

    const token = signToken('CLIENT');

    const response = await request(app)
      .post('/v1/public/AB3K9P/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({ service_id: 'svc-1', start_time: new Date(Date.now() + 3600_000).toISOString() });

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('SLOT_TAKEN');
  });
});
