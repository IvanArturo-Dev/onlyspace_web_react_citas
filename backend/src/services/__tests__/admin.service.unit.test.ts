import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AppointmentStatus } from '@prisma/client';

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------
const mockPrisma = {
  tenant: { count: jest.fn(), findMany: jest.fn() },
  user: { count: jest.fn() },
  customer: { count: jest.fn() },
  service: { count: jest.fn() },
  appointment: { count: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
  auditLog: { count: jest.fn() },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// ---------------------------------------------------------------------------
// In-memory dataset: appointments across at least 2 tenants and several states
// ---------------------------------------------------------------------------
interface FakeAppointment {
  tenant_id: string;
  status: AppointmentStatus;
}

const dataset: FakeAppointment[] = [
  // tenant-a
  { tenant_id: 'tenant-a', status: AppointmentStatus.PENDING },
  { tenant_id: 'tenant-a', status: AppointmentStatus.PENDING },
  { tenant_id: 'tenant-a', status: AppointmentStatus.CONFIRMED },
  { tenant_id: 'tenant-a', status: AppointmentStatus.COMPLETED },
  { tenant_id: 'tenant-a', status: AppointmentStatus.NO_SHOW },
  // tenant-b
  { tenant_id: 'tenant-b', status: AppointmentStatus.PENDING },
  { tenant_id: 'tenant-b', status: AppointmentStatus.CONFIRMED },
  { tenant_id: 'tenant-b', status: AppointmentStatus.CONFIRMED },
  { tenant_id: 'tenant-b', status: AppointmentStatus.COMPLETED },
  { tenant_id: 'tenant-b', status: AppointmentStatus.COMPLETED },
  { tenant_id: 'tenant-b', status: AppointmentStatus.CANCELLED },
  // tenant-c (a third tenant, to make the cross-tenant sum non-trivial)
  { tenant_id: 'tenant-c', status: AppointmentStatus.NO_SHOW },
  { tenant_id: 'tenant-c', status: AppointmentStatus.CANCELLED },
];

const ALL_TENANTS = ['tenant-a', 'tenant-b', 'tenant-c'];

/**
 * Emulates prisma.appointment.groupBy({ by: ['status'], _count: { _all } })
 * over the given subset of appointments.
 */
function groupByStatus(rows: FakeAppointment[]) {
  const counts = new Map<AppointmentStatus, number>();
  for (const r of rows) {
    counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([status, n]) => ({
    status,
    _count: { _all: n },
  }));
}

function emptyStatusRecord(): Record<AppointmentStatus, number> {
  const record = {} as Record<AppointmentStatus, number>;
  for (const status of Object.values(AppointmentStatus)) {
    record[status] = 0;
  }
  return record;
}

/**
 * Computes appointments_by_status for a single tenant directly from the dataset.
 * This is the independent "per tenant" reference used to validate the property.
 */
function statusesForTenant(tenantId: string): Record<AppointmentStatus, number> {
  const record = emptyStatusRecord();
  for (const r of dataset.filter((a) => a.tenant_id === tenantId)) {
    record[r.status] += 1;
  }
  return record;
}

describe('adminService (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getOverview - Property 7: consistency of aggregations', () => {
    it('global appointments_by_status equals the sum of per-tenant counts across all tenants', async () => {
      // Wire the global groupBy mock coherently with the full dataset.
      mockPrisma.appointment.groupBy.mockResolvedValue(groupByStatus(dataset) as any);
      mockPrisma.tenant.count.mockResolvedValue(ALL_TENANTS.length as any);
      mockPrisma.user.count.mockResolvedValue(0 as any);
      mockPrisma.customer.count.mockResolvedValue(0 as any);
      mockPrisma.service.count.mockResolvedValue(0 as any);

      const { adminService } = await import('../admin.service');
      const overview = await adminService.getOverview();

      // Build the per-tenant sum independently from the dataset.
      const perTenantSum = emptyStatusRecord();
      for (const tenantId of ALL_TENANTS) {
        const tenantStatuses = statusesForTenant(tenantId);
        for (const status of Object.values(AppointmentStatus)) {
          perTenantSum[status] += tenantStatuses[status];
        }
      }

      // Property 7: the global metric equals the sum over all tenants.
      expect(overview.appointments_by_status).toEqual(perTenantSum);

      // Sanity: totals also match the dataset length.
      const globalTotal = Object.values(overview.appointments_by_status).reduce(
        (a, b) => a + b,
        0
      );
      expect(globalTotal).toBe(dataset.length);
    });

    it('initializes every AppointmentStatus to 0, including statuses with no rows', async () => {
      // Dataset with only two statuses present.
      const partial: FakeAppointment[] = [
        { tenant_id: 'tenant-a', status: AppointmentStatus.PENDING },
        { tenant_id: 'tenant-b', status: AppointmentStatus.COMPLETED },
      ];
      mockPrisma.appointment.groupBy.mockResolvedValue(groupByStatus(partial) as any);
      mockPrisma.tenant.count.mockResolvedValue(2 as any);
      mockPrisma.user.count.mockResolvedValue(0 as any);
      mockPrisma.customer.count.mockResolvedValue(0 as any);
      mockPrisma.service.count.mockResolvedValue(0 as any);

      const { adminService } = await import('../admin.service');
      const overview = await adminService.getOverview();

      expect(overview.appointments_by_status[AppointmentStatus.PENDING]).toBe(1);
      expect(overview.appointments_by_status[AppointmentStatus.COMPLETED]).toBe(1);
      expect(overview.appointments_by_status[AppointmentStatus.CONFIRMED]).toBe(0);
      expect(overview.appointments_by_status[AppointmentStatus.CANCELLED]).toBe(0);
      expect(overview.appointments_by_status[AppointmentStatus.NO_SHOW]).toBe(0);
    });
  });
});
