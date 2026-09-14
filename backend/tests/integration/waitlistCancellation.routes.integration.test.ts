import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// El JWT secret debe configurarse ANTES de importar la app.
const TEST_JWT_SECRET = 'test-waitlist-cancellation-integration-secret';
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

// Mock de Prisma. Lo consume `authenticated`: user.findUnique (ensureNotBlocked)
// + user.update (touchLastSeen). El resto de la logica de negocio se mockea a
// nivel de servicio, asi el test no depende de la BD real.
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('../../src/database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// Mock de los servicios que exponen los endpoints de la tarea 8. El controller
// solo delega y da forma a la respuesta.
jest.mock('../../src/services/cancellationPolicy.service', () => ({
  cancellationPolicyService: {
    getOrDefault: jest.fn(),
    update: jest.fn(),
  },
}));

jest.mock('../../src/services/notification.service', () => ({
  notificationService: {
    listForTenant: jest.fn(),
    unreadCount: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
  },
}));

jest.mock('../../src/services/waitlist.service', () => ({
  waitlistService: {
    join: jest.fn(),
    listQueue: jest.fn(),
    offer: jest.fn(),
    confirmOffer: jest.fn(),
  },
}));

// listOpenAtRisk vive en appointmentService; se mockea para probar el orden de
// rutas (que "at-risk" no se capture como /:id) sin depender de la BD.
jest.mock('../../src/services/appointment.service', () => ({
  appointmentService: {
    listOpenAtRisk: jest.fn(),
  },
}));

import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/app';
import { cancellationPolicyService } from '../../src/services/cancellationPolicy.service';
import { notificationService } from '../../src/services/notification.service';
import { waitlistService } from '../../src/services/waitlist.service';
import { appointmentService } from '../../src/services/appointment.service';
import { HttpError } from '../../src/utils/errors';

/** Genera un JWT valido de ADMIN para las rutas `authenticated` + requireAdmin. */
function adminToken(): string {
  return jwt.sign(
    { user_id: 'user-admin-1', tenant_id: 'tenant-1', role: 'ADMIN', permissions: [] as string[] },
    TEST_JWT_SECRET,
    { expiresIn: '1h' }
  );
}

/** Genera un JWT valido de ASSISTANT (staff, pero NO admin). */
function assistantToken(): string {
  return jwt.sign(
    { user_id: 'user-assistant-1', tenant_id: 'tenant-1', role: 'ASSISTANT', permissions: [] as string[] },
    TEST_JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('rutas waitlist + cancellation (integracion ligera)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // ensureNotBlocked: usuario activo. touchLastSeen: no-op.
    mockPrisma.user.findUnique.mockResolvedValue({ is_active: true } as never);
    mockPrisma.user.update.mockResolvedValue({} as never);
  });

  describe('PATCH /v1/me/cancellation-policy (requireAdmin)', () => {
    it('responde 403 FORBIDDEN para un ASSISTANT y no llama al service', async () => {
      const response = await request(app)
        .patch('/v1/me/cancellation-policy')
        .set('Authorization', `Bearer ${assistantToken()}`)
        .send({ grace_hours: 12 });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FORBIDDEN');
      // requireAdmin bloquea ANTES de llegar al controller.
      expect(cancellationPolicyService.update).not.toHaveBeenCalled();
    });

    it('responde 200 para un ADMIN y persiste via el service', async () => {
      (cancellationPolicyService.update as jest.Mock).mockResolvedValue({
        tenant_id: 'tenant-1',
        grace_hours: 12,
        allowed_cancellations: 2,
        penalty_amount: 50,
        reset_days: 30,
      } as never);

      const response = await request(app)
        .patch('/v1/me/cancellation-policy')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ grace_hours: 12, allowed_cancellations: 2, penalty_amount: 50 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.grace_hours).toBe(12);
      expect(cancellationPolicyService.update).toHaveBeenCalledWith('tenant-1', {
        grace_hours: 12,
        allowed_cancellations: 2,
        penalty_amount: 50,
        reset_days: undefined,
      });
    });
  });

  describe('GET /v1/me/notifications (requireStaff)', () => {
    it('responde 200 con la lista (puede vacia) para staff', async () => {
      (notificationService.listForTenant as jest.Mock).mockResolvedValue([] as never);

      const response = await request(app)
        .get('/v1/me/notifications')
        .set('Authorization', `Bearer ${assistantToken()}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(notificationService.listForTenant).toHaveBeenCalledWith('tenant-1', {
        unreadOnly: false,
        limit: undefined,
      });
    });

    it('reenvia ?unread=1 como unreadOnly al service', async () => {
      (notificationService.listForTenant as jest.Mock).mockResolvedValue([] as never);

      await request(app)
        .get('/v1/me/notifications?unread=1')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(notificationService.listForTenant).toHaveBeenCalledWith('tenant-1', {
        unreadOnly: true,
        limit: undefined,
      });
    });
  });

  describe('GET /v1/me/notifications/unread-count (requireStaff)', () => {
    it('responde 200 con { count } y no colisiona con /:id/read', async () => {
      (notificationService.unreadCount as jest.Mock).mockResolvedValue(3 as never);

      const response = await request(app)
        .get('/v1/me/notifications/unread-count')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(response.status).toBe(200);
      expect(response.body.data.count).toBe(3);
      expect(notificationService.unreadCount).toHaveBeenCalledWith('tenant-1');
      // No debe haberse tratado "unread-count" como un :id de markRead.
      expect(notificationService.markRead).not.toHaveBeenCalled();
    });
  });

  describe('POST /v1/appointments/waitlist (requireStaff)', () => {
    it('responde 409 CUSTOMER_HAS_DEBT cuando el cliente tiene deuda', async () => {
      (waitlistService.join as jest.Mock).mockRejectedValue(
        new HttpError(
          'El cliente tiene una penalizacion pendiente de pago',
          409,
          'CUSTOMER_HAS_DEBT'
        ) as never
      );

      const response = await request(app)
        .post('/v1/appointments/waitlist')
        .set('Authorization', `Bearer ${assistantToken()}`)
        .send({
          service_id: 'svc-1',
          customer_id: 'cust-1',
          desired_date: '2025-01-10T00:00:00.000Z',
        });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('CUSTOMER_HAS_DEBT');
    });

    it('responde 201 en el happy path y delega en el service', async () => {
      (waitlistService.join as jest.Mock).mockResolvedValue({
        id: 'wl-1',
        tenant_id: 'tenant-1',
        service_id: 'svc-1',
        customer_id: 'cust-1',
        status: 'WAITING',
      } as never);

      const response = await request(app)
        .post('/v1/appointments/waitlist')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({
          service_id: 'svc-1',
          customer_id: 'cust-1',
          desired_date: '2025-01-10T00:00:00.000Z',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe('wl-1');
      expect(waitlistService.join).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /v1/appointments/waitlist/:entryId/offer (requireAdmin)', () => {
    it('responde 403 FORBIDDEN para un ASSISTANT y no llama al service', async () => {
      const response = await request(app)
        .post('/v1/appointments/waitlist/wl-1/offer')
        .set('Authorization', `Bearer ${assistantToken()}`)
        .send({
          start: '2025-01-10T10:00:00.000Z',
          end: '2025-01-10T10:30:00.000Z',
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(waitlistService.offer).not.toHaveBeenCalled();
    });
  });

  describe('POST /v1/appointments/waitlist/:entryId/confirm (requireAdmin)', () => {
    it('responde 403 FORBIDDEN para un ASSISTANT y no llama al service', async () => {
      const response = await request(app)
        .post('/v1/appointments/waitlist/wl-1/confirm')
        .set('Authorization', `Bearer ${assistantToken()}`)
        .send({});

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(waitlistService.confirmOffer).not.toHaveBeenCalled();
    });
  });

  describe('GET /v1/appointments/at-risk (requireStaff)', () => {
    it('responde 200 y NO se captura como /:id (llama a listOpenAtRisk, no a get)', async () => {
      (appointmentService.listOpenAtRisk as jest.Mock).mockResolvedValue([] as never);

      const response = await request(app)
        .get('/v1/appointments/at-risk')
        .set('Authorization', `Bearer ${assistantToken()}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      // La ruta estatica gano a /:id: se llamo listOpenAtRisk.
      expect(appointmentService.listOpenAtRisk).toHaveBeenCalledWith('tenant-1');
    });
  });
});
