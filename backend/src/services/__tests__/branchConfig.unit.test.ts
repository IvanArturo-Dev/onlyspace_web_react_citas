import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { HttpError } from '../../utils/errors';

/**
 * Unit tests for per-branch configuration services: scheduleService (branch
 * variants), holidayService and serviceService (branch variants).
 *
 * Property 5 (Aislamiento por tenant/sucursal): ninguna operacion de un
 *   emprendedor opera datos de una sucursal ajena. Cuando branchService.get
 *   lanza 404 (sucursal de otro tenant), la operacion NO debe tocar
 *   schedule / scheduleDay / holiday / service.
 *
 * **Validates: Requirements 3.5, 3.6, 11.4**
 * **Properties: Property 5 (aislamiento)**
 */

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------
const mockPrisma = {
  schedule: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  scheduleDay: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  holiday: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
  service: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
};

// branchService.get is the tenant/branch ownership gate for every operation.
const mockBranchGet = jest.fn();

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

jest.mock('../branch.service', () => ({
  branchService: {
    get: (...args: any[]) => mockBranchGet(...args),
  },
}));

/** Makes branchService.get behave as a branch owned by the tenant. */
function branchOwned() {
  mockBranchGet.mockResolvedValue({ id: 'branch-1', name: 'Sucursal' } as any);
}

/** Makes branchService.get behave as a branch of another tenant (404). */
function branchForeign() {
  mockBranchGet.mockRejectedValue(
    new HttpError('Branch not found', 404, 'BRANCH_NOT_FOUND')
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// scheduleService branch variants
// ---------------------------------------------------------------------------
describe('scheduleService branch variants (unit) - Property 5', () => {
  it('getBranchSchedule queries scoped by tenant_id + branch_id', async () => {
    branchOwned();
    mockPrisma.schedule.findFirst.mockResolvedValue({
      id: 'sched-b1',
      timezone: 'America/Mexico_City',
      days: [{ day_of_week: 1, open_time: '09:00', close_time: '17:00', is_active: true }],
    } as any);

    const { scheduleService } = await import('../schedule.service');
    const result = await scheduleService.getBranchSchedule('tenant-a', 'branch-1');

    expect(mockBranchGet).toHaveBeenCalledWith('tenant-a', 'branch-1');
    expect(mockPrisma.schedule.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenant_id: 'tenant-a', branch_id: 'branch-1', is_active: true },
      })
    );
    expect(result.id).toBe('sched-b1');
  });

  it('getBranchSchedule does not touch schedule when the branch belongs to another tenant', async () => {
    branchForeign();

    const { scheduleService } = await import('../schedule.service');
    await expect(
      scheduleService.getBranchSchedule('tenant-a', 'foreign-branch')
    ).rejects.toBeInstanceOf(HttpError);

    expect(mockPrisma.schedule.findFirst).not.toHaveBeenCalled();
  });

  it('updateBranchSchedule creates a Default schedule scoped to tenant+branch and replaces its days', async () => {
    branchOwned();
    mockPrisma.schedule.findFirst
      .mockResolvedValueOnce(null as any) // no existing
      .mockResolvedValueOnce({
        id: 'sched-new',
        timezone: 'America/Mexico_City',
        days: [{ day_of_week: 1, open_time: '09:00', close_time: '17:00', is_active: true }],
      } as any);
    mockPrisma.schedule.create.mockResolvedValue({ id: 'sched-new' } as any);
    mockPrisma.scheduleDay.deleteMany.mockResolvedValue({ count: 0 } as any);
    mockPrisma.scheduleDay.createMany.mockResolvedValue({ count: 1 } as any);

    const { scheduleService } = await import('../schedule.service');
    await scheduleService.updateBranchSchedule('tenant-a', 'branch-1', {
      days: [{ day_of_week: 1, open_time: '09:00', close_time: '17:00' }],
    });

    expect(mockPrisma.schedule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenant_id: 'tenant-a',
          branch_id: 'branch-1',
          name: 'Default',
        }),
      })
    );
    expect(mockPrisma.scheduleDay.deleteMany).toHaveBeenCalledWith({
      where: { schedule_id: 'sched-new' },
    });
    expect(mockPrisma.scheduleDay.createMany).toHaveBeenCalledWith({
      data: [
        {
          schedule_id: 'sched-new',
          day_of_week: 1,
          open_time: '09:00',
          close_time: '17:00',
          is_active: true,
        },
      ],
    });
  });

  it('updateBranchSchedule scopes lookup by branch_id (one branch does not affect another)', async () => {
    branchOwned();
    mockPrisma.schedule.findFirst
      .mockResolvedValueOnce({ id: 'sched-existing' } as any)
      .mockResolvedValueOnce({ id: 'sched-existing', timezone: 'x', days: [] } as any);
    mockPrisma.scheduleDay.deleteMany.mockResolvedValue({ count: 1 } as any);
    mockPrisma.scheduleDay.createMany.mockResolvedValue({ count: 1 } as any);

    const { scheduleService } = await import('../schedule.service');
    await scheduleService.updateBranchSchedule('tenant-a', 'branch-1', {
      days: [{ day_of_week: 2, open_time: '08:00', close_time: '12:00' }],
    });

    // The lookup filters by the specific branch, never a bare tenant lookup.
    expect(mockPrisma.schedule.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenant_id: 'tenant-a', branch_id: 'branch-1', is_active: true },
      })
    );
    expect(mockPrisma.schedule.create).not.toHaveBeenCalled();
    // Only this branch's schedule days are replaced.
    expect(mockPrisma.scheduleDay.deleteMany).toHaveBeenCalledWith({
      where: { schedule_id: 'sched-existing' },
    });
  });

  it('updateBranchSchedule does not touch schedule/scheduleDay for a foreign branch', async () => {
    branchForeign();

    const { scheduleService } = await import('../schedule.service');
    await expect(
      scheduleService.updateBranchSchedule('tenant-a', 'foreign-branch', {
        days: [{ day_of_week: 1, open_time: '09:00', close_time: '17:00' }],
      })
    ).rejects.toBeInstanceOf(HttpError);

    expect(mockPrisma.schedule.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.create).not.toHaveBeenCalled();
    expect(mockPrisma.scheduleDay.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.scheduleDay.createMany).not.toHaveBeenCalled();
  });

  it('updateBranchSchedule validates days (400) but only after the branch is owned', async () => {
    branchOwned();

    const { scheduleService } = await import('../schedule.service');
    let error: unknown;
    try {
      await scheduleService.updateBranchSchedule('tenant-a', 'branch-1', {
        days: [{ day_of_week: 9, open_time: '09:00', close_time: '17:00' }],
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).statusCode).toBe(400);
    expect(mockPrisma.schedule.create).not.toHaveBeenCalled();
    expect(mockPrisma.scheduleDay.deleteMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// holidayService
// ---------------------------------------------------------------------------
describe('holidayService (unit) - Property 5', () => {
  it('list returns holidays of the branch as YYYY-MM-DD, ordered by date asc', async () => {
    branchOwned();
    mockPrisma.holiday.findMany.mockResolvedValue([
      { id: 'h1', date: new Date(Date.UTC(2024, 11, 25)), label: 'Navidad' },
    ] as any);

    const { holidayService } = await import('../holiday.service');
    const result = await holidayService.list('tenant-a', 'branch-1');

    expect(mockBranchGet).toHaveBeenCalledWith('tenant-a', 'branch-1');
    expect(mockPrisma.holiday.findMany).toHaveBeenCalledWith({
      where: { branch_id: 'branch-1' },
      orderBy: { date: 'asc' },
    });
    expect(result).toEqual([{ id: 'h1', date: '2024-12-25', label: 'Navidad' }]);
  });

  it('list does not query holidays for a foreign branch', async () => {
    branchForeign();

    const { holidayService } = await import('../holiday.service');
    await expect(holidayService.list('tenant-a', 'foreign')).rejects.toBeInstanceOf(
      HttpError
    );
    expect(mockPrisma.holiday.findMany).not.toHaveBeenCalled();
  });

  it('add creates a holiday at midnight UTC scoped to the branch', async () => {
    branchOwned();
    mockPrisma.holiday.findUnique.mockResolvedValue(null as any);
    mockPrisma.holiday.create.mockResolvedValue({
      id: 'h2',
      date: new Date(Date.UTC(2025, 0, 1)),
      label: 'Ano nuevo',
    } as any);

    const { holidayService } = await import('../holiday.service');
    const result = await holidayService.add('tenant-a', 'branch-1', {
      date: '2025-01-01',
      label: 'Ano nuevo',
    });

    const createArg = mockPrisma.holiday.create.mock.calls[0][0] as any;
    expect(createArg.data.branch_id).toBe('branch-1');
    expect((createArg.data.date as Date).toISOString()).toBe('2025-01-01T00:00:00.000Z');
    expect(result).toEqual({ id: 'h2', date: '2025-01-01', label: 'Ano nuevo' });
  });

  it('add rejects an invalid date format with 400 and does not create', async () => {
    branchOwned();

    const { holidayService } = await import('../holiday.service');
    let error: unknown;
    try {
      await holidayService.add('tenant-a', 'branch-1', { date: '01/01/2025' });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).statusCode).toBe(400);
    expect(mockPrisma.holiday.create).not.toHaveBeenCalled();
  });

  it('add returns 409 DUPLICATE_HOLIDAY on an existing [branch, date]', async () => {
    branchOwned();
    mockPrisma.holiday.findUnique.mockResolvedValue({ id: 'existing' } as any);

    const { holidayService } = await import('../holiday.service');
    let error: unknown;
    try {
      await holidayService.add('tenant-a', 'branch-1', { date: '2025-01-01' });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).statusCode).toBe(409);
    expect((error as HttpError).code).toBe('DUPLICATE_HOLIDAY');
    expect(mockPrisma.holiday.create).not.toHaveBeenCalled();
  });

  it('remove deletes a holiday that belongs to the branch', async () => {
    branchOwned();
    mockPrisma.holiday.findFirst.mockResolvedValue({ id: 'h1', branch_id: 'branch-1' } as any);
    mockPrisma.holiday.delete.mockResolvedValue({ id: 'h1' } as any);

    const { holidayService } = await import('../holiday.service');
    const result = await holidayService.remove('tenant-a', 'branch-1', 'h1');

    expect(mockPrisma.holiday.findFirst).toHaveBeenCalledWith({
      where: { id: 'h1', branch_id: 'branch-1' },
    });
    expect(mockPrisma.holiday.delete).toHaveBeenCalledWith({ where: { id: 'h1' } });
    expect(result).toEqual({ id: 'h1' });
  });

  it('remove of a holiday from another branch returns 404 and does not delete', async () => {
    branchOwned();
    // The holiday is not found under this branch (belongs to another branch).
    mockPrisma.holiday.findFirst.mockResolvedValue(null as any);

    const { holidayService } = await import('../holiday.service');
    let error: unknown;
    try {
      await holidayService.remove('tenant-a', 'branch-1', 'other-branch-holiday');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).statusCode).toBe(404);
    expect(mockPrisma.holiday.delete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// serviceService branch variants
// ---------------------------------------------------------------------------
describe('serviceService branch variants (unit) - Property 5', () => {
  it('listByBranch queries scoped by tenant_id + branch_id', async () => {
    branchOwned();
    mockPrisma.service.findMany.mockResolvedValue([] as any);

    const { serviceService } = await import('../service.service');
    await serviceService.listByBranch('tenant-a', 'branch-1');

    expect(mockBranchGet).toHaveBeenCalledWith('tenant-a', 'branch-1');
    expect(mockPrisma.service.findMany).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-a', branch_id: 'branch-1', is_active: true },
      orderBy: { name: 'asc' },
    });
  });

  it('listByBranch does not query services for a foreign branch', async () => {
    branchForeign();

    const { serviceService } = await import('../service.service');
    await expect(
      serviceService.listByBranch('tenant-a', 'foreign')
    ).rejects.toBeInstanceOf(HttpError);
    expect(mockPrisma.service.findMany).not.toHaveBeenCalled();
  });

  it('createForBranch forces tenant_id + branch_id from the validated scope', async () => {
    branchOwned();
    mockPrisma.service.create.mockResolvedValue({ id: 'svc-1' } as any);

    const { serviceService } = await import('../service.service');
    await serviceService.createForBranch('tenant-a', 'branch-1', {
      name: 'Corte',
      duration_mins: 30,
      price: 100,
      // Attempts to inject another tenant/branch must be ignored.
      tenant_id: 'evil-tenant',
      branch_id: 'evil-branch',
    });

    const createArg = mockPrisma.service.create.mock.calls[0][0] as any;
    expect(createArg.data.tenant_id).toBe('tenant-a');
    expect(createArg.data.branch_id).toBe('branch-1');
    expect(createArg.data.name).toBe('Corte');
  });

  it('createForBranch does not create for a foreign branch', async () => {
    branchForeign();

    const { serviceService } = await import('../service.service');
    await expect(
      serviceService.createForBranch('tenant-a', 'foreign', { name: 'x' })
    ).rejects.toBeInstanceOf(HttpError);
    expect(mockPrisma.service.create).not.toHaveBeenCalled();
  });
});
