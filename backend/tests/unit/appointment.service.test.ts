import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { HttpError } from '../../src/utils/errors';

// Mock Prisma
const mockPrisma = {
  appointment: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  customer: {
    findUnique: jest.fn(),
  },
  service: {
    findUnique: jest.fn(),
  },
  professional: {
    findUnique: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  branch: {
    findUnique: jest.fn(),
  },
  // Runs the transactional reschedule callback against the same mockPrisma so
  // tx.appointment.* resolve through the existing appointment mocks.
  $transaction: jest.fn((cb: any) => cb(mockPrisma)),
};

// Mock dependencies
jest.mock('../../src/database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// Mock the Google Workspace integration so the best-effort hooks in
// appointment.service can be exercised without real network / OAuth. Every
// method is a jest.fn so each test can drive its behavior (resolve, or throw to
// prove the appointment flow survives a Google failure).
const mockGoogleIntegration = {
  syncAppointmentEvent: jest.fn(),
  deleteAppointmentEvent: jest.fn(),
  upsertContact: jest.fn(),
};
jest.mock('../../src/services/google-integration.service', () => ({
  googleIntegrationService: mockGoogleIntegration,
}));

const mockGoogleAccount = {
  getStatus: jest.fn(),
};
jest.mock('../../src/services/google-account.service', () => ({
  googleAccountService: mockGoogleAccount,
}));

// Loyalty is unrelated to these tests; mock it as an inert no-op so the loyalty
// hook never touches anything.
jest.mock('../../src/services/loyalty.service', () => ({
  loyaltyService: {
    onAppointmentCompleted: jest.fn(),
    onAppointmentUncompleted: jest.fn(),
  },
}));

// Servicios integrados en Tarea 7 (waitlist/cancelacion). create/cancel ahora
// consultan hasDebt / registerCancellation y notifican best-effort; se mockean
// como no-ops para que estos tests no dependan de su prisma (sin deuda por
// defecto, sin nadie en espera).
jest.mock('../../src/services/customerCancellation.service', () => ({
  customerCancellationService: {
    hasDebt: jest.fn(async () => false),
    registerCancellation: jest.fn(async () => undefined),
  },
}));
jest.mock('../../src/services/waitlist.service', () => ({
  waitlistService: { firstWaiting: jest.fn(async () => null) },
}));
jest.mock('../../src/services/notification.service', () => ({
  notificationService: { notify: jest.fn(async () => null) },
}));

jest.mock('../../src/utils/errors', () => ({
  HttpError: class HttpError extends Error {
    constructor(message: string, statusCode: number, code: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
    statusCode: number;
    code: string;
  },
}));

describe('AppointmentService', () => {
  const tenantId = 'tenant-123';

  // Reset all mocks before every test so mock return values never leak between
  // tests, and re-establish inert defaults for the Google best-effort hooks so
  // legacy tests (which don't configure Google) are unaffected by it.
  beforeEach(() => {
    jest.clearAllMocks();
    mockGoogleIntegration.syncAppointmentEvent.mockResolvedValue(null);
    mockGoogleIntegration.deleteAppointmentEvent.mockResolvedValue(undefined);
    mockGoogleIntegration.upsertContact.mockResolvedValue(null);
    mockGoogleAccount.getStatus.mockResolvedValue({
      connected: false,
      save_contacts: false,
      online_sessions: false,
      google_email: null,
    });
    mockPrisma.branch.findUnique.mockResolvedValue(null);
    // The hook reloads the appointment via findUnique; default to null so the
    // hook no-ops for legacy tests that don't configure Google.
    mockPrisma.appointment.findUnique.mockResolvedValue(null);
  });

  describe('listAppointments', () => {
    it('should list appointments with filters', async () => {
      const mockAppointments = [
        { id: '1', status: 'PENDING', start_time: new Date() },
        { id: '2', status: 'CONFIRMED', start_time: new Date() },
      ];
      mockPrisma.appointment.findMany.mockResolvedValue(mockAppointments);
      mockPrisma.appointment.count.mockResolvedValue(2);

      const result = await import('../../src/services/appointment.service').then(m => 
        m.appointmentService.listAppointments(tenantId, {
          start_date: '2024-01-01',
          end_date: '2024-01-31',
          professional_id: 'prof-1',
          status: 'PENDING',
          page: 1,
          limit: 20,
        })
      );

      expect(result.appointments).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('excludes archived appointments by default (where includes archived:false)', async () => {
      mockPrisma.appointment.findMany.mockResolvedValue([]);
      mockPrisma.appointment.count.mockResolvedValue(0);

      await import('../../src/services/appointment.service').then(m =>
        m.appointmentService.listAppointments(tenantId, { page: 1, limit: 20 })
      );

      // The where passed to findMany must exclude archived appointments and stay
      // scoped by tenant (Property 2 / Property 5).
      expect(mockPrisma.appointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenant_id: tenantId, archived: false }),
        })
      );
      // count is scoped the same way.
      expect(mockPrisma.appointment.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenant_id: tenantId, archived: false }),
        })
      );
    });
  });

  describe('getAppointment', () => {
    it('should return appointment if exists', async () => {
      const mockAppointment = {
        id: '1',
        tenant_id: tenantId,
        customer: { id: '1', name: 'John' },
        service: { id: '1', name: 'Service' },
      };
      mockPrisma.appointment.findUnique.mockResolvedValue(mockAppointment);

      const result = await import('../../src/services/appointment.service').then(m => 
        m.appointmentService.getAppointment(tenantId, '1')
      );

      expect(result).toEqual(mockAppointment);
    });

    it('should throw error if not found', async () => {
      mockPrisma.appointment.findUnique.mockResolvedValue(null);

      await expect(
        import('../../src/services/appointment.service').then(m => 
          m.appointmentService.getAppointment(tenantId, 'nonexistent')
        )
      ).rejects.toThrow('Appointment not found');
    });
  });

  describe('createAppointment', () => {
    it('should create appointment with validation', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ id: '1', tenant_id: tenantId });
      mockPrisma.service.findUnique.mockResolvedValue({ id: '1', tenant_id: tenantId, duration_mins: 30 });
      mockPrisma.professional.findUnique.mockResolvedValue(null);
      // No existing same-day duplicate for this customer/service.
      mockPrisma.appointment.count.mockResolvedValue(0);
      mockPrisma.appointment.findFirst.mockResolvedValue(null);
      mockPrisma.appointment.create.mockResolvedValue({
        id: '1',
        tenant_id: tenantId,
        status: 'PENDING',
      });

      const result = await import('../../src/services/appointment.service').then(m => 
        m.appointmentService.createAppointment(tenantId, {
          customer_id: '1',
          service_id: '1',
          start_time: '2024-01-01T10:00:00Z',
        })
      );

      expect(result).toHaveProperty('id');
    });

    it('should throw error if customer not found', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);

      await expect(
        import('../../src/services/appointment.service').then(m => 
          m.appointmentService.createAppointment(tenantId, {
            customer_id: 'nonexistent',
            service_id: '1',
            start_time: '2024-01-01T10:00:00Z',
          })
        )
      ).rejects.toThrow('Customer not found');
    });

    it('should throw error if service not found', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ id: '1', tenant_id: tenantId });
      mockPrisma.service.findUnique.mockResolvedValue(null);

      await expect(
        import('../../src/services/appointment.service').then(m => 
          m.appointmentService.createAppointment(tenantId, {
            customer_id: '1',
            service_id: 'nonexistent',
            start_time: '2024-01-01T10:00:00Z',
          })
        )
      ).rejects.toThrow('Service not found');
    });

    // --- Modality persistence (Property 1; Requirements 1.1, 1.2) ---

    // Arranges the happy-path mocks a createAppointment needs to reach the
    // prisma.appointment.create call, then invokes create with the given data.
    const runCreateWithModality = async (data: Record<string, unknown>) => {
      mockPrisma.customer.findUnique.mockResolvedValue({ id: '1', tenant_id: tenantId });
      mockPrisma.service.findUnique.mockResolvedValue({
        id: '1',
        tenant_id: tenantId,
        duration_mins: 30,
      });
      mockPrisma.professional.findUnique.mockResolvedValue(null);
      mockPrisma.appointment.count.mockResolvedValue(0);
      mockPrisma.appointment.findFirst.mockResolvedValue(null);
      mockPrisma.appointment.create.mockResolvedValue({
        id: '1',
        tenant_id: tenantId,
        status: 'PENDING',
      });
      // Hook reload no-ops (null) so create returns without Google side effects.
      mockPrisma.appointment.findUnique.mockResolvedValue(null);

      return import('../../src/services/appointment.service').then(m =>
        m.appointmentService.createAppointment(tenantId, {
          customer_id: '1',
          service_id: '1',
          start_time: '2024-01-01T10:00:00Z',
          ...data,
        })
      );
    };

    it('persists modality "online" when modality:"online" is provided', async () => {
      await runCreateWithModality({ modality: 'online' });

      expect(mockPrisma.appointment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ modality: 'online' }),
        })
      );
    });

    it('defaults modality to "in_person" when none is provided', async () => {
      await runCreateWithModality({});

      expect(mockPrisma.appointment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ modality: 'in_person' }),
        })
      );
    });

    it('normalizes an invalid modality to "in_person"', async () => {
      await runCreateWithModality({ modality: 'foo' });

      expect(mockPrisma.appointment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ modality: 'in_person' }),
        })
      );
    });
  });

  // --- updateAppointment modality persistence (Property 2; Req 2.1, 2.3) ---
  describe('updateAppointment', () => {
    it('persists normalized modality without touching other fields (no schedule change)', async () => {
      const existing = {
        id: 'a1',
        tenant_id: tenantId,
        customer_id: 'c1',
        service_id: 's1',
        start_time: new Date('2025-01-10T15:00:00Z'),
        modality: 'in_person',
      };
      // getAppointment (findUnique) returns the existing appointment.
      mockPrisma.appointment.findUnique.mockResolvedValue(existing);
      mockPrisma.appointment.update.mockResolvedValue({ ...existing, modality: 'online' });

      const result = await import('../../src/services/appointment.service').then(m =>
        m.appointmentService.updateAppointment(tenantId, 'a1', {
          modality: 'online',
          notes: 'hola',
        })
      );

      expect(result.modality).toBe('online');
      // No schedule change -> direct update; modality normalized, notes intact,
      // and NO transaction / no recomputed end_time.
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.appointment.update).toHaveBeenCalledWith({
        where: { id: 'a1', tenant_id: tenantId },
        data: { modality: 'online', notes: 'hola' },
      });
    });

    it('includes normalized modality in the transactional update (schedule change)', async () => {
      const existing = {
        id: 'a1',
        tenant_id: tenantId,
        customer_id: 'c1',
        service_id: 's1',
        start_time: new Date('2025-01-10T15:00:00Z'),
        modality: 'in_person',
      };
      // getAppointment (findUnique) -> existing.
      mockPrisma.appointment.findUnique.mockResolvedValue(existing);
      // Effective service load for the reschedule.
      mockPrisma.service.findUnique.mockResolvedValue({
        id: 's1',
        tenant_id: tenantId,
        duration_mins: 30,
        capacity: 1,
      });
      // No overlapping candidates -> capacity check passes.
      mockPrisma.appointment.findMany.mockResolvedValue([]);
      mockPrisma.appointment.count.mockResolvedValue(0);
      mockPrisma.appointment.update.mockResolvedValue({ ...existing, modality: 'online' });

      await import('../../src/services/appointment.service').then(m =>
        m.appointmentService.updateAppointment(tenantId, 'a1', {
          start_time: '2025-01-11T16:00:00Z',
          modality: 'online',
        })
      );

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'a1', tenant_id: tenantId },
          data: expect.objectContaining({ modality: 'online' }),
        })
      );
    });
  });

  describe('updateStatus', () => {
    it('should update appointment status', async () => {
      const mockAppointment = {
        id: '1',
        tenant_id: tenantId,
        status: 'PENDING',
      };
      const mockUpdatedAppointment = {
        ...mockAppointment,
        status: 'CONFIRMED',
      };
      mockPrisma.appointment.findUnique.mockResolvedValue(mockAppointment);
      mockPrisma.appointment.update.mockResolvedValue(mockUpdatedAppointment);

      const result = await import('../../src/services/appointment.service').then(m => 
        m.appointmentService.updateStatus(tenantId, '1', 'CONFIRMED')
      );

      expect(result.status).toBe('CONFIRMED');
    });
  });

  describe('cancelAppointment', () => {
    it('should cancel appointment', async () => {
      const mockAppointment = {
        id: '1',
        tenant_id: tenantId,
        status: 'PENDING',
      };
      const mockUpdatedAppointment = {
        ...mockAppointment,
        status: 'CANCELLED',
      };
      mockPrisma.appointment.findUnique.mockResolvedValue(mockAppointment);
      mockPrisma.appointment.update.mockResolvedValue(mockUpdatedAppointment);

      const result = await import('../../src/services/appointment.service').then(m => 
        m.appointmentService.cancelAppointment(tenantId, '1')
      );

      expect(result.status).toBe('CANCELLED');
    });
  });

  describe('archiveAppointment', () => {
    it('sets archived:true without touching status/data', async () => {
      const mockAppointment = {
        id: '1',
        tenant_id: tenantId,
        status: 'COMPLETED',
        archived: false,
      };
      mockPrisma.appointment.findUnique.mockResolvedValue(mockAppointment);
      mockPrisma.appointment.update.mockResolvedValue({
        ...mockAppointment,
        archived: true,
      });

      const result = await import('../../src/services/appointment.service').then(m =>
        m.appointmentService.archiveAppointment(tenantId, '1')
      );

      expect(result.archived).toBe(true);
      // Update is tenant-scoped and only flips archived (Property 1 / Property 5).
      expect(mockPrisma.appointment.update).toHaveBeenCalledWith({
        where: { id: '1', tenant_id: tenantId },
        data: { archived: true },
      });
    });

    it('throws 404 for a foreign appointment (getAppointment/findUnique null)', async () => {
      mockPrisma.appointment.findUnique.mockResolvedValue(null);

      await expect(
        import('../../src/services/appointment.service').then(m =>
          m.appointmentService.archiveAppointment(tenantId, 'nonexistent')
        )
      ).rejects.toThrow('Appointment not found');

      // Nothing was archived.
      expect(mockPrisma.appointment.update).not.toHaveBeenCalled();
    });

    it('does NOT trigger the Google appointment hook', async () => {
      const mockAppointment = {
        id: '1',
        tenant_id: tenantId,
        status: 'COMPLETED',
        archived: false,
      };
      mockPrisma.appointment.findUnique.mockResolvedValue(mockAppointment);
      mockPrisma.appointment.update.mockResolvedValue({
        ...mockAppointment,
        archived: true,
      });

      await import('../../src/services/appointment.service').then(m =>
        m.appointmentService.archiveAppointment(tenantId, '1')
      );

      // Archiving is a local visibility flag: it must never fire the Google
      // hook, so none of the integration side effects the hook drives run.
      expect(mockGoogleAccount.getStatus).not.toHaveBeenCalled();
      expect(mockGoogleIntegration.syncAppointmentEvent).not.toHaveBeenCalled();
      expect(mockGoogleIntegration.deleteAppointmentEvent).not.toHaveBeenCalled();
      expect(mockGoogleIntegration.upsertContact).not.toHaveBeenCalled();
    });
  });

  describe('checkAvailability', () => {
    it('should return true if available', async () => {
      // Professional exists and belongs to this tenant (through its User).
      mockPrisma.professional.findUnique.mockResolvedValue({ id: 'prof-1', user_id: 'u1' });
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', tenant_id: tenantId });
      mockPrisma.appointment.findFirst.mockResolvedValue(null);

      const result = await import('../../src/services/appointment.service').then(m => 
        m.appointmentService.checkAvailability(tenantId, 'prof-1', new Date('2024-01-01T10:00:00Z'), 30)
      );

      expect(result).toBe(true);
    });

    it('should return false if conflicting appointment exists', async () => {
      mockPrisma.professional.findUnique.mockResolvedValue({ id: 'prof-1', user_id: 'u1' });
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', tenant_id: tenantId });
      mockPrisma.appointment.findFirst.mockResolvedValue({ id: '2' });

      const result = await import('../../src/services/appointment.service').then(m => 
        m.appointmentService.checkAvailability(tenantId, 'prof-1', new Date('2024-01-01T10:00:00Z'), 30)
      );

      expect(result).toBe(false);
    });
  });

  /**
   * Google Workspace best-effort hooks (Task 7).
   *
   * These tests drive the mocked googleIntegrationService / googleAccountService
   * to prove:
   *  - created  -> syncAppointmentEvent runs and google_event_id is persisted;
   *                upsertContact runs only when save_contacts is enabled.
   *  - confirmed (online) -> video_call_url is persisted from the Meet link.
   *  - cancelled -> deleteAppointmentEvent runs.
   *  - BEST-EFFORT: a Google failure (thrown by any integration method) NEVER
   *    propagates and NEVER rolls back the appointment operation
   *    (Requirements 2.5, 3.6, 4.5, 5.3).
   */
  describe('Google hooks (best-effort)', () => {
    const appointmentModule = () => import('../../src/services/appointment.service');

    beforeEach(() => {
      jest.clearAllMocks();
      // Sensible defaults: Google resolves as connected-but-inert.
      mockGoogleIntegration.syncAppointmentEvent.mockResolvedValue(null);
      mockGoogleIntegration.deleteAppointmentEvent.mockResolvedValue(undefined);
      mockGoogleIntegration.upsertContact.mockResolvedValue(null);
      mockGoogleAccount.getStatus.mockResolvedValue({
        connected: true,
        save_contacts: false,
        online_sessions: false,
        google_email: 'admin@example.com',
      });
      mockPrisma.branch.findUnique.mockResolvedValue(null);
    });

    it('created: calls syncAppointmentEvent and persists google_event_id', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: 'c1',
        tenant_id: tenantId,
        name: 'Ana',
        phone: '5551234567',
        email: 'ana@example.com',
      });
      mockPrisma.service.findUnique.mockResolvedValue({
        id: 's1',
        tenant_id: tenantId,
        duration_mins: 30,
      });
      mockPrisma.professional.findUnique.mockResolvedValue(null);
      mockPrisma.appointment.count.mockResolvedValue(0);
      mockPrisma.appointment.findFirst.mockResolvedValue(null);
      mockPrisma.appointment.create.mockResolvedValue({
        id: 'a1',
        tenant_id: tenantId,
        status: 'PENDING',
      });
      // Hook reload (findUnique) returns the created appointment with relations.
      mockPrisma.appointment.findUnique.mockResolvedValue({
        id: 'a1',
        tenant_id: tenantId,
        branch_id: null,
        google_event_id: null,
        start_time: new Date('2025-01-10T15:00:00Z'),
        end_time: new Date('2025-01-10T15:30:00Z'),
        location: null,
        modality: 'in_person',
        notes: null,
        customer: { id: 'c1', name: 'Ana', phone: '5551234567', email: 'ana@example.com' },
        service: { id: 's1', name: 'Corte' },
      });
      mockGoogleIntegration.syncAppointmentEvent.mockResolvedValue({
        event_id: 'evt-1',
        meet_url: null,
      });
      mockPrisma.appointment.update.mockResolvedValue({});

      const result = await appointmentModule().then(m =>
        m.appointmentService.createAppointment(tenantId, {
          customer_id: 'c1',
          service_id: 's1',
          start_time: '2025-01-10T15:00:00Z',
        })
      );

      expect(result).toHaveProperty('id', 'a1');
      expect(mockGoogleIntegration.syncAppointmentEvent).toHaveBeenCalledTimes(1);
      // google_event_id was persisted on the appointment.
      expect(mockPrisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'a1', tenant_id: tenantId },
          data: expect.objectContaining({ google_event_id: 'evt-1' }),
        })
      );
    });

    it('created: calls upsertContact when save_contacts is enabled', async () => {
      mockGoogleAccount.getStatus.mockResolvedValue({
        connected: true,
        save_contacts: true,
        online_sessions: false,
        google_email: 'admin@example.com',
      });
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: 'c1',
        tenant_id: tenantId,
        name: 'Ana',
        phone: '5551234567',
        email: 'ana@example.com',
      });
      mockPrisma.service.findUnique.mockResolvedValue({
        id: 's1',
        tenant_id: tenantId,
        duration_mins: 30,
      });
      mockPrisma.professional.findUnique.mockResolvedValue(null);
      mockPrisma.appointment.count.mockResolvedValue(0);
      mockPrisma.appointment.findFirst.mockResolvedValue(null);
      mockPrisma.appointment.create.mockResolvedValue({
        id: 'a1',
        tenant_id: tenantId,
        status: 'PENDING',
      });
      mockPrisma.appointment.findUnique.mockResolvedValue({
        id: 'a1',
        tenant_id: tenantId,
        branch_id: null,
        google_event_id: null,
        start_time: new Date('2025-01-10T15:00:00Z'),
        end_time: new Date('2025-01-10T15:30:00Z'),
        location: null,
        modality: 'in_person',
        notes: null,
        customer: { id: 'c1', name: 'Ana', phone: '5551234567', email: 'ana@example.com' },
        service: { id: 's1', name: 'Corte' },
      });
      mockPrisma.appointment.update.mockResolvedValue({});

      await appointmentModule().then(m =>
        m.appointmentService.createAppointment(tenantId, {
          customer_id: 'c1',
          service_id: 's1',
          start_time: '2025-01-10T15:00:00Z',
        })
      );

      expect(mockGoogleIntegration.upsertContact).toHaveBeenCalledTimes(1);
      expect(mockGoogleIntegration.upsertContact).toHaveBeenCalledWith(
        tenantId,
        expect.objectContaining({ name: 'Ana', phone: '5551234567', email: 'ana@example.com' })
      );
    });

    it('created: does NOT call upsertContact when save_contacts is disabled', async () => {
      // getStatus default (save_contacts:false) from beforeEach.
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: 'c1',
        tenant_id: tenantId,
        name: 'Ana',
        phone: '5551234567',
        email: 'ana@example.com',
      });
      mockPrisma.service.findUnique.mockResolvedValue({
        id: 's1',
        tenant_id: tenantId,
        duration_mins: 30,
      });
      mockPrisma.professional.findUnique.mockResolvedValue(null);
      mockPrisma.appointment.count.mockResolvedValue(0);
      mockPrisma.appointment.findFirst.mockResolvedValue(null);
      mockPrisma.appointment.create.mockResolvedValue({
        id: 'a1',
        tenant_id: tenantId,
        status: 'PENDING',
      });
      mockPrisma.appointment.findUnique.mockResolvedValue({
        id: 'a1',
        tenant_id: tenantId,
        branch_id: null,
        google_event_id: null,
        start_time: new Date('2025-01-10T15:00:00Z'),
        end_time: new Date('2025-01-10T15:30:00Z'),
        location: null,
        modality: 'in_person',
        notes: null,
        customer: { id: 'c1', name: 'Ana', phone: '5551234567', email: 'ana@example.com' },
        service: { id: 's1', name: 'Corte' },
      });
      mockPrisma.appointment.update.mockResolvedValue({});

      await appointmentModule().then(m =>
        m.appointmentService.createAppointment(tenantId, {
          customer_id: 'c1',
          service_id: 's1',
          start_time: '2025-01-10T15:00:00Z',
        })
      );

      expect(mockGoogleIntegration.upsertContact).not.toHaveBeenCalled();
    });

    it('confirmed (online): persists video_call_url from the Meet link', async () => {
      // updateStatus first loads via getAppointment (findUnique), then the hook
      // reloads via findUnique again. Both return an online appointment.
      const onlineAppointment = {
        id: 'a1',
        tenant_id: tenantId,
        customer_id: 'c1',
        status: 'PENDING',
        branch_id: null,
        google_event_id: null,
        start_time: new Date('2025-01-10T15:00:00Z'),
        end_time: new Date('2025-01-10T15:30:00Z'),
        location: 'En linea',
        modality: 'online',
        notes: null,
        customer: { id: 'c1', name: 'Ana', phone: '5551234567', email: 'ana@example.com' },
        service: { id: 's1', name: 'Corte' },
      };
      mockPrisma.appointment.findUnique.mockResolvedValue(onlineAppointment);
      mockPrisma.appointment.update.mockResolvedValue({
        ...onlineAppointment,
        status: 'CONFIRMED',
      });
      mockGoogleIntegration.syncAppointmentEvent.mockResolvedValue({
        event_id: 'evt-1',
        meet_url: 'https://meet.google.com/abc-defg-hij',
      });

      const result = await appointmentModule().then(m =>
        m.appointmentService.updateStatus(tenantId, 'a1', 'CONFIRMED')
      );

      expect(result.status).toBe('CONFIRMED');
      expect(mockGoogleIntegration.syncAppointmentEvent).toHaveBeenCalledTimes(1);
      // video_call_url persisted from the Meet link.
      expect(mockPrisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            video_call_url: 'https://meet.google.com/abc-defg-hij',
          }),
        })
      );
    });

    it('cancelled: calls deleteAppointmentEvent', async () => {
      const appt = {
        id: 'a1',
        tenant_id: tenantId,
        customer_id: 'c1',
        status: 'CONFIRMED',
        branch_id: null,
        google_event_id: 'evt-1',
        start_time: new Date('2025-01-10T15:00:00Z'),
        end_time: new Date('2025-01-10T15:30:00Z'),
        location: null,
        modality: 'in_person',
        notes: null,
        customer: { id: 'c1', name: 'Ana', phone: '5551234567', email: 'ana@example.com' },
        service: { id: 's1', name: 'Corte' },
      };
      mockPrisma.appointment.findUnique.mockResolvedValue(appt);
      mockPrisma.appointment.update.mockResolvedValue({ ...appt, status: 'CANCELLED' });

      const result = await appointmentModule().then(m =>
        m.appointmentService.cancelAppointment(tenantId, 'a1')
      );

      expect(result.status).toBe('CANCELLED');
      expect(mockGoogleIntegration.deleteAppointmentEvent).toHaveBeenCalledTimes(1);
      expect(mockGoogleIntegration.deleteAppointmentEvent).toHaveBeenCalledWith(
        tenantId,
        expect.objectContaining({ google_event_id: 'evt-1' })
      );
    });

    it('best-effort: a Google failure on create does NOT propagate and the appointment still resolves', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: 'c1',
        tenant_id: tenantId,
        name: 'Ana',
        phone: '5551234567',
        email: 'ana@example.com',
      });
      mockPrisma.service.findUnique.mockResolvedValue({
        id: 's1',
        tenant_id: tenantId,
        duration_mins: 30,
      });
      mockPrisma.professional.findUnique.mockResolvedValue(null);
      mockPrisma.appointment.count.mockResolvedValue(0);
      mockPrisma.appointment.findFirst.mockResolvedValue(null);
      mockPrisma.appointment.create.mockResolvedValue({
        id: 'a1',
        tenant_id: tenantId,
        status: 'PENDING',
      });
      mockPrisma.appointment.findUnique.mockResolvedValue({
        id: 'a1',
        tenant_id: tenantId,
        branch_id: null,
        google_event_id: null,
        start_time: new Date('2025-01-10T15:00:00Z'),
        end_time: new Date('2025-01-10T15:30:00Z'),
        location: null,
        modality: 'in_person',
        notes: null,
        customer: { id: 'c1', name: 'Ana', phone: '5551234567', email: 'ana@example.com' },
        service: { id: 's1', name: 'Corte' },
      });
      // Google throws — the appointment must still be created and returned.
      mockGoogleIntegration.syncAppointmentEvent.mockRejectedValue(
        new Error('Google Calendar API down')
      );

      const result = await appointmentModule().then(m =>
        m.appointmentService.createAppointment(tenantId, {
          customer_id: 'c1',
          service_id: 's1',
          start_time: '2025-01-10T15:00:00Z',
        })
      );

      // Appointment created normally despite the Google failure.
      expect(result).toHaveProperty('id', 'a1');
      expect(mockGoogleIntegration.syncAppointmentEvent).toHaveBeenCalledTimes(1);
    });

    it('best-effort: a Google failure on cancel does NOT propagate and the cancellation still resolves', async () => {
      const appt = {
        id: 'a1',
        tenant_id: tenantId,
        customer_id: 'c1',
        status: 'CONFIRMED',
        branch_id: null,
        google_event_id: 'evt-1',
        start_time: new Date('2025-01-10T15:00:00Z'),
        end_time: new Date('2025-01-10T15:30:00Z'),
        location: null,
        modality: 'in_person',
        notes: null,
        customer: { id: 'c1', name: 'Ana', phone: '5551234567', email: 'ana@example.com' },
        service: { id: 's1', name: 'Corte' },
      };
      mockPrisma.appointment.findUnique.mockResolvedValue(appt);
      mockPrisma.appointment.update.mockResolvedValue({ ...appt, status: 'CANCELLED' });
      mockGoogleIntegration.deleteAppointmentEvent.mockRejectedValue(
        new Error('Google Calendar API down')
      );

      const result = await appointmentModule().then(m =>
        m.appointmentService.cancelAppointment(tenantId, 'a1')
      );

      // Cancellation succeeds normally despite the Google failure.
      expect(result.status).toBe('CANCELLED');
      expect(mockGoogleIntegration.deleteAppointmentEvent).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * Manual video-call URL persistence + validation (Property 2; Req 2.2, 2.3, 2.4)
   * and the Google hook not overwriting an existing URL (Property 4; Req 4.1).
   */
  describe('video_call_url (manual)', () => {
    const appointmentModule = () => import('../../src/services/appointment.service');

    // Happy-path mocks so createAppointment reaches prisma.appointment.create.
    const runCreate = async (data: Record<string, unknown>) => {
      mockPrisma.customer.findUnique.mockResolvedValue({ id: 'c1', tenant_id: tenantId });
      mockPrisma.service.findUnique.mockResolvedValue({
        id: 's1',
        tenant_id: tenantId,
        duration_mins: 30,
      });
      mockPrisma.professional.findUnique.mockResolvedValue(null);
      mockPrisma.appointment.count.mockResolvedValue(0);
      mockPrisma.appointment.findFirst.mockResolvedValue(null);
      mockPrisma.appointment.create.mockResolvedValue({
        id: 'a1',
        tenant_id: tenantId,
        status: 'PENDING',
      });
      // Hook reload no-ops so no Google side effects run.
      mockPrisma.appointment.findUnique.mockResolvedValue(null);

      return appointmentModule().then((m) =>
        m.appointmentService.createAppointment(tenantId, {
          customer_id: 'c1',
          service_id: 's1',
          start_time: '2025-01-10T15:00:00Z',
          ...data,
        })
      );
    };

    it('createAppointment persists a valid https URL', async () => {
      await runCreate({ video_call_url: 'https://meet.google.com/abc-defg-hij' });

      expect(mockPrisma.appointment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            video_call_url: 'https://meet.google.com/abc-defg-hij',
          }),
        })
      );
    });

    it('createAppointment persists null when video_call_url is an empty string', async () => {
      await runCreate({ video_call_url: '' });

      expect(mockPrisma.appointment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ video_call_url: null }),
        })
      );
    });

    it('createAppointment rejects an invalid URL with 400 VALIDATION_ERROR and does not create', async () => {
      await expect(runCreate({ video_call_url: 'foo' })).rejects.toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
      });

      expect(mockPrisma.appointment.create).not.toHaveBeenCalled();
    });

    // --- updateAppointment (no schedule change) ---
    const existingAppt = {
      id: 'a1',
      tenant_id: tenantId,
      customer_id: 'c1',
      service_id: 's1',
      start_time: new Date('2025-01-10T15:00:00Z'),
      modality: 'in_person',
      video_call_url: null,
    };

    it('updateAppointment includes a valid URL in the update (no schedule change)', async () => {
      mockPrisma.appointment.findUnique.mockResolvedValue(existingAppt);
      mockPrisma.appointment.update.mockResolvedValue({ ...existingAppt });

      await appointmentModule().then((m) =>
        m.appointmentService.updateAppointment(tenantId, 'a1', {
          video_call_url: 'https://zoom.us/j/123456',
        })
      );

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.appointment.update).toHaveBeenCalledWith({
        where: { id: 'a1', tenant_id: tenantId },
        data: { video_call_url: 'https://zoom.us/j/123456' },
      });
    });

    it('updateAppointment stores null when video_call_url is empty (no schedule change)', async () => {
      mockPrisma.appointment.findUnique.mockResolvedValue(existingAppt);
      mockPrisma.appointment.update.mockResolvedValue({ ...existingAppt });

      await appointmentModule().then((m) =>
        m.appointmentService.updateAppointment(tenantId, 'a1', { video_call_url: '' })
      );

      expect(mockPrisma.appointment.update).toHaveBeenCalledWith({
        where: { id: 'a1', tenant_id: tenantId },
        data: { video_call_url: null },
      });
    });

    it('updateAppointment rejects an invalid URL with 400 (no schedule change) and does not update', async () => {
      mockPrisma.appointment.findUnique.mockResolvedValue(existingAppt);

      await expect(
        appointmentModule().then((m) =>
          m.appointmentService.updateAppointment(tenantId, 'a1', { video_call_url: 'foo' })
        )
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });

      expect(mockPrisma.appointment.update).not.toHaveBeenCalled();
    });

    it('hook does NOT overwrite an existing video_call_url on CONFIRMED', async () => {
      // The appointment ALREADY has a manual URL; a Meet link from the sync must
      // not replace it (Requirement 4.1). updateStatus loads via findUnique, and
      // the hook reloads via findUnique again — both return the same row.
      const onlineWithManualUrl = {
        id: 'a1',
        tenant_id: tenantId,
        customer_id: 'c1',
        status: 'PENDING',
        branch_id: null,
        google_event_id: null,
        start_time: new Date('2025-01-10T15:00:00Z'),
        end_time: new Date('2025-01-10T15:30:00Z'),
        location: 'En linea',
        modality: 'online',
        notes: null,
        video_call_url: 'https://meet.jit.si/mi-sala-manual',
        customer: { id: 'c1', name: 'Ana', phone: '5551234567', email: 'ana@example.com' },
        service: { id: 's1', name: 'Corte' },
      };
      mockPrisma.appointment.findUnique.mockResolvedValue(onlineWithManualUrl);
      mockPrisma.appointment.update.mockResolvedValue({
        ...onlineWithManualUrl,
        status: 'CONFIRMED',
      });
      // Google returns a Meet link that should be IGNORED (manual URL wins).
      mockGoogleIntegration.syncAppointmentEvent.mockResolvedValue({
        event_id: 'evt-1',
        meet_url: 'https://meet.google.com/auto-generated',
      });

      await appointmentModule().then((m) =>
        m.appointmentService.updateStatus(tenantId, 'a1', 'CONFIRMED')
      );

      // Every appointment.update call must be free of a video_call_url overwrite.
      const updateCalls = mockPrisma.appointment.update.mock.calls;
      for (const [arg] of updateCalls) {
        expect((arg as any)?.data ?? {}).not.toHaveProperty('video_call_url');
      }
    });
  });
});
