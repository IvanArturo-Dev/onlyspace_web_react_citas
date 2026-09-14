import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AuditAction } from '@prisma/client';

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------
const mockPrisma = {
  auditLog: { count: jest.fn(), findMany: jest.fn() },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// ---------------------------------------------------------------------------
// In-memory dataset of AuditLog records
// ---------------------------------------------------------------------------
interface FakeAuditLog {
  id: string;
  tenant_id: string;
  user_id: string | null;
  action: AuditAction;
  resource_type: string;
  resource_id: string;
  ip_address: string | null;
  user_agent: string | null;
  result: string;
  details: string | null;
  created_at: Date;
}

const ACTIONS: AuditAction[] = [
  AuditAction.LOGIN,
  AuditAction.LOGOUT,
  AuditAction.CREATE,
  AuditAction.UPDATE,
  AuditAction.DELETE,
  AuditAction.CONFIRM,
  AuditAction.CANCEL,
];

/**
 * Builds N deterministic AuditLog records for a single tenant. Timestamps are
 * spaced one minute apart so that the ordering (created_at desc) is stable and
 * distinct.
 */
function buildDataset(n: number, tenantId = 'tenant-a'): FakeAuditLog[] {
  const base = Date.UTC(2024, 0, 1, 0, 0, 0);
  const rows: FakeAuditLog[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      id: `audit-${i}`,
      tenant_id: tenantId,
      user_id: i % 3 === 0 ? null : `user-${i % 4}`,
      action: ACTIONS[i % ACTIONS.length],
      resource_type: 'appointment',
      resource_id: `res-${i}`,
      ip_address: '127.0.0.1',
      user_agent: 'jest',
      result: 'success',
      details: null,
      created_at: new Date(base + i * 60_000),
    });
  }
  return rows;
}

/**
 * Applies an audit `where` filter (as built by getAuditTrail) to the dataset.
 * Only the filters used by the service under test are supported.
 */
function applyWhere(rows: FakeAuditLog[], where: any): FakeAuditLog[] {
  return rows.filter((r) => {
    if (where.tenant_id && r.tenant_id !== where.tenant_id) return false;
    if (where.user_id && r.user_id !== where.user_id) return false;
    if (where.action && r.action !== where.action) return false;
    if (where.resource_type && r.resource_type !== where.resource_type) return false;
    if (where.created_at) {
      if (where.created_at.gte && r.created_at < where.created_at.gte) return false;
      if (where.created_at.lte && r.created_at > where.created_at.lte) return false;
    }
    return true;
  });
}

/**
 * Wires prisma.auditLog.count/findMany so that they are coherent with each
 * other: both operate over the same filtered + ordered dataset, and findMany
 * honors orderBy created_at desc together with skip/take.
 */
function wirePrisma(dataset: FakeAuditLog[]): void {
  mockPrisma.auditLog.count.mockImplementation((args: any) => {
    const filtered = applyWhere(dataset, args?.where ?? {});
    return Promise.resolve(filtered.length as any);
  });

  mockPrisma.auditLog.findMany.mockImplementation((args: any) => {
    const filtered = applyWhere(dataset, args?.where ?? {});
    const ordered = [...filtered].sort(
      (a, b) => b.created_at.getTime() - a.created_at.getTime()
    );
    const skip = args?.skip ?? 0;
    const take = args?.take ?? ordered.length;
    return Promise.resolve(ordered.slice(skip, skip + take) as any);
  });
}

describe('adminService.getAuditTrail (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Property 8: total pagination (no duplicates, no omissions)', () => {
    it('walking every page concatenates exactly `total` records with unique, complete ids', async () => {
      const N = 23;
      const PAGE_SIZE = 10;
      const dataset = buildDataset(N);
      wirePrisma(dataset);

      const { adminService } = await import('../admin.service');

      // First page tells us the total.
      const firstPage = await adminService.getAuditTrail({
        tenant_id: 'tenant-a',
        page: 1,
        page_size: PAGE_SIZE,
      });
      const total = firstPage.total;
      expect(total).toBe(N);

      const expectedPages = Math.ceil(total / PAGE_SIZE);

      // Walk all pages and collect every item.
      const collected: string[] = [];
      let pagesWalked = 0;
      for (let page = 1; page <= expectedPages; page++) {
        const result = await adminService.getAuditTrail({
          tenant_id: 'tenant-a',
          page,
          page_size: PAGE_SIZE,
        });
        pagesWalked += 1;
        expect(result.total).toBe(total);
        expect(result.page).toBe(page);
        expect(result.page_size).toBe(PAGE_SIZE);
        // Every page except (possibly) the last is full.
        if (page < expectedPages) {
          expect(result.items.length).toBe(PAGE_SIZE);
        }
        collected.push(...result.items.map((i) => i.id));
      }

      // Number of pages is ceil(total / page_size).
      expect(pagesWalked).toBe(expectedPages);

      // No omissions: collected count equals total.
      expect(collected.length).toBe(total);

      // No duplicates: all ids unique.
      const uniqueIds = new Set(collected);
      expect(uniqueIds.size).toBe(total);

      // Complete: the set of walked ids equals the dataset's set of ids.
      const datasetIds = new Set(dataset.map((r) => r.id));
      expect(uniqueIds).toEqual(datasetIds);
    });

    it('orders results by created_at descending across pages', async () => {
      const N = 23;
      const PAGE_SIZE = 10;
      const dataset = buildDataset(N);
      wirePrisma(dataset);

      const { adminService } = await import('../admin.service');

      const timestamps: number[] = [];
      const expectedPages = Math.ceil(N / PAGE_SIZE);
      for (let page = 1; page <= expectedPages; page++) {
        const result = await adminService.getAuditTrail({
          tenant_id: 'tenant-a',
          page,
          page_size: PAGE_SIZE,
        });
        for (const item of result.items) {
          timestamps.push(new Date(item.created_at).getTime());
        }
      }

      const sortedDesc = [...timestamps].sort((a, b) => b - a);
      expect(timestamps).toEqual(sortedDesc);
    });
  });

  describe('action filter narrows the result set', () => {
    it('filtering by action reduces total and returns only matching records', async () => {
      const N = 23;
      const dataset = buildDataset(N);
      wirePrisma(dataset);

      const { adminService } = await import('../admin.service');

      // Unfiltered total.
      const unfiltered = await adminService.getAuditTrail({
        tenant_id: 'tenant-a',
        page_size: 100,
      });
      expect(unfiltered.total).toBe(N);

      // Independent expectation: how many records carry LOGIN.
      const expectedLogin = dataset.filter((r) => r.action === AuditAction.LOGIN).length;

      const filtered = await adminService.getAuditTrail({
        tenant_id: 'tenant-a',
        action: AuditAction.LOGIN,
        page_size: 100,
      });

      expect(filtered.total).toBe(expectedLogin);
      expect(filtered.total).toBeLessThan(unfiltered.total);
      expect(filtered.items.length).toBe(expectedLogin);
      expect(filtered.items.every((i) => i.action === AuditAction.LOGIN)).toBe(true);
    });
  });
});
