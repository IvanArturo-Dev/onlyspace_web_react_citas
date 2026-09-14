import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Unit test for the loyalty hook wired into appointmentService status changes
// (Task 6). We mock prisma (only the appointment delegate the paths touch) and
// the loyalty engine, then assert the correct engine entry point is invoked for
// each COMPLETED transition — and that loyalty failures never break the flow.
// ---------------------------------------------------------------------------

const mockPrisma = {
  appointment: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

const mockOnCompleted = jest.fn(async () => undefined);
const mockOnUncompleted = jest.fn(async () => undefined);
jest.mock('../loyalty.service', () => ({
  loyaltyService: {
    onAppointmentCompleted: (...args: unknown[]) => mockOnCompleted(...args),
    onAppointmentUncompleted: (...args: unknown[]) => mockOnUncompleted(...args),
  },
}));

// branchService is imported by appointment.service but not used on these paths.
jest.mock('../branch.service', () => ({
  branchService: { get: jest.fn() },
}));

// Servicios integrados en Tarea 7. cancelAppointment ahora registra la
// cancelacion del cliente y notifica/consulta la waitlist (best-effort); se
// mockean como no-ops para aislar estas pruebas del hook de lealtad.
jest.mock('../customerCancellation.service', () => ({
  customerCancellationService: {
    hasDebt: jest.fn(async () => false),
    registerCancellation: jest.fn(async () => undefined),
  },
}));
jest.mock('../waitlist.service', () => ({
  waitlistService: { firstWaiting: jest.fn(async () => null) },
}));
jest.mock('../notification.service', () => ({
  notificationService: { notify: jest.fn(async () => null) },
}));

import { appointmentService } from '../appointment.service';

/** Builds a fake appointment record with the loyalty-relevant fields. */
function appt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'appt-1',
    tenant_id: 'tenant-a',
    customer_id: 'cust-1',
    status: 'CONFIRMED',
    ...overrides,
  } as never;
}

describe('appointmentService loyalty hook (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('updateStatus transition detection', () => {
    it('calls onAppointmentCompleted when transitioning INTO COMPLETED', async () => {
      mockPrisma.appointment.findUnique.mockResolvedValue(appt({ status: 'CONFIRMED' }) as never);
      mockPrisma.appointment.update.mockResolvedValue(
        appt({ status: 'COMPLETED' }) as never
      );

      await appointmentService.updateStatus('tenant-a', 'appt-1', 'COMPLETED');

      expect(mockOnCompleted).toHaveBeenCalledTimes(1);
      expect(mockOnCompleted).toHaveBeenCalledWith({
        id: 'appt-1',
        tenant_id: 'tenant-a',
        customer_id: 'cust-1',
      });
      expect(mockOnUncompleted).not.toHaveBeenCalled();
    });

    it('calls onAppointmentUncompleted when transitioning OUT OF COMPLETED', async () => {
      mockPrisma.appointment.findUnique.mockResolvedValue(appt({ status: 'COMPLETED' }) as never);
      mockPrisma.appointment.update.mockResolvedValue(
        appt({ status: 'CONFIRMED' }) as never
      );

      await appointmentService.updateStatus('tenant-a', 'appt-1', 'CONFIRMED');

      expect(mockOnUncompleted).toHaveBeenCalledTimes(1);
      expect(mockOnUncompleted).toHaveBeenCalledWith({
        id: 'appt-1',
        tenant_id: 'tenant-a',
        customer_id: 'cust-1',
      });
      expect(mockOnCompleted).not.toHaveBeenCalled();
    });

    it('does nothing loyalty-wise for non-COMPLETED transitions (PENDING -> CONFIRMED)', async () => {
      mockPrisma.appointment.findUnique.mockResolvedValue(appt({ status: 'PENDING' }) as never);
      mockPrisma.appointment.update.mockResolvedValue(
        appt({ status: 'CONFIRMED' }) as never
      );

      await appointmentService.updateStatus('tenant-a', 'appt-1', 'CONFIRMED');

      expect(mockOnCompleted).not.toHaveBeenCalled();
      expect(mockOnUncompleted).not.toHaveBeenCalled();
    });

    it('does not re-fire when already COMPLETED stays COMPLETED', async () => {
      mockPrisma.appointment.findUnique.mockResolvedValue(appt({ status: 'COMPLETED' }) as never);
      mockPrisma.appointment.update.mockResolvedValue(
        appt({ status: 'COMPLETED' }) as never
      );

      await appointmentService.updateStatus('tenant-a', 'appt-1', 'COMPLETED');

      expect(mockOnCompleted).not.toHaveBeenCalled();
      expect(mockOnUncompleted).not.toHaveBeenCalled();
    });

    it('never throws when the loyalty engine fails (status change still returns)', async () => {
      mockPrisma.appointment.findUnique.mockResolvedValue(appt({ status: 'CONFIRMED' }) as never);
      const updatedRecord = appt({ status: 'COMPLETED' });
      mockPrisma.appointment.update.mockResolvedValue(updatedRecord as never);
      mockOnCompleted.mockRejectedValueOnce(new Error('loyalty boom') as never);

      const result = await appointmentService.updateStatus('tenant-a', 'appt-1', 'COMPLETED');

      // The appointment update result is returned unchanged despite the failure.
      expect(result).toBe(updatedRecord);
      expect(mockOnCompleted).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancelAppointment transition detection', () => {
    it('reverses loyalty when a COMPLETED appointment is cancelled', async () => {
      mockPrisma.appointment.findUnique.mockResolvedValue(appt({ status: 'COMPLETED' }) as never);
      mockPrisma.appointment.update.mockResolvedValue(
        appt({ status: 'CANCELLED' }) as never
      );

      await appointmentService.cancelAppointment('tenant-a', 'appt-1');

      expect(mockOnUncompleted).toHaveBeenCalledTimes(1);
      expect(mockOnCompleted).not.toHaveBeenCalled();
    });

    it('does nothing loyalty-wise when cancelling a non-COMPLETED appointment', async () => {
      mockPrisma.appointment.findUnique.mockResolvedValue(appt({ status: 'CONFIRMED' }) as never);
      mockPrisma.appointment.update.mockResolvedValue(
        appt({ status: 'CANCELLED' }) as never
      );

      await appointmentService.cancelAppointment('tenant-a', 'appt-1');

      expect(mockOnCompleted).not.toHaveBeenCalled();
      expect(mockOnUncompleted).not.toHaveBeenCalled();
    });
  });
});
