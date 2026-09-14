import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Prisma mock (patrón branding.service.unit.test.ts)
// ---------------------------------------------------------------------------
const mockPrisma = {
  notification: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

import { notificationService } from '../notification.service';
import { HttpError } from '../../utils/errors';

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Property 8 — notify is best-effort: it never throws nor breaks the caller.
// ---------------------------------------------------------------------------
describe('Property 8: notify best-effort', () => {
  it('does NOT throw when prisma.notification.create rejects (resolves without throw)', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockPrisma.notification.create.mockRejectedValue(new Error('db down') as never);

    const result = await notificationService.notify('t1', {
      event_type: 'appointment_created',
      title: 'Nueva cita',
      body: 'Se creó una cita',
    });

    expect(result).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('creates a notification with correct event_type/title/body/tenant_id', async () => {
    mockPrisma.notification.create.mockResolvedValue({ id: 'n1' } as never);

    await notificationService.notify('t1', {
      event_type: 'appointment_cancelled',
      title: 'Cita cancelada',
      body: 'El cliente canceló',
      appointment_id: 'a1',
      customer_id: 'c1',
    });

    const call = mockPrisma.notification.create.mock.calls[0][0] as any;
    expect(call.data).toMatchObject({
      tenant_id: 't1',
      event_type: 'appointment_cancelled',
      title: 'Cita cancelada',
      body: 'El cliente canceló',
      appointment_id: 'a1',
      customer_id: 'c1',
      channel: 'PUSH',
      status: 'PENDING',
    });
  });

  it('defaults optional ids to null when omitted', async () => {
    mockPrisma.notification.create.mockResolvedValue({ id: 'n1' } as never);

    await notificationService.notify('t1', {
      event_type: 'appointment_waitlisted',
      title: 'Encolado',
      body: 'Cliente en espera',
    });

    const call = mockPrisma.notification.create.mock.calls[0][0] as any;
    expect(call.data.appointment_id).toBeNull();
    expect(call.data.customer_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Property 1 — tenant isolation on listing / counting.
// ---------------------------------------------------------------------------
describe('Property 1: listForTenant tenant + in-app scoping', () => {
  it('filters by tenant_id and event_type != null, ordered by created_at desc, default limit 50', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([] as never);

    await notificationService.listForTenant('t1');

    const call = mockPrisma.notification.findMany.mock.calls[0][0] as any;
    expect(call.where.tenant_id).toBe('t1');
    expect(call.where.event_type).toEqual({ not: null });
    expect(call.where.read_at).toBeUndefined();
    expect(call.orderBy).toEqual({ created_at: 'desc' });
    expect(call.take).toBe(50);
  });

  it('adds read_at=null when unreadOnly is set and respects a custom limit', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([] as never);

    await notificationService.listForTenant('t1', { unreadOnly: true, limit: 10 });

    const call = mockPrisma.notification.findMany.mock.calls[0][0] as any;
    expect(call.where.tenant_id).toBe('t1');
    expect(call.where.event_type).toEqual({ not: null });
    expect(call.where.read_at).toBeNull();
    expect(call.take).toBe(10);
  });
});

describe('Property 1: unreadCount scoped by tenant + read_at null', () => {
  it('counts in-app notifications scoped by tenant and read_at null', async () => {
    mockPrisma.notification.count.mockResolvedValue(3 as never);

    const count = await notificationService.unreadCount('t1');

    expect(count).toBe(3);
    const call = mockPrisma.notification.count.mock.calls[0][0] as any;
    expect(call.where).toEqual({
      tenant_id: 't1',
      event_type: { not: null },
      read_at: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Property 1 — markRead is tenant-scoped; markAllRead scoped by tenant.
// ---------------------------------------------------------------------------
describe('Property 1: markRead tenant isolation', () => {
  it('throws 404 NOTIFICATION_NOT_FOUND for a foreign/missing notification and never updates', async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(null as never);

    await expect(
      notificationService.markRead('t1', 'n-of-other-tenant')
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOTIFICATION_NOT_FOUND' });

    const call = mockPrisma.notification.findFirst.mock.calls[0][0] as any;
    expect(call.where).toEqual({ id: 'n-of-other-tenant', tenant_id: 't1' });
    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
  });

  it('sets read_at when the notification belongs to the tenant', async () => {
    mockPrisma.notification.findFirst.mockResolvedValue({ id: 'n1', tenant_id: 't1' } as never);
    mockPrisma.notification.update.mockResolvedValue({ id: 'n1', read_at: new Date() } as never);

    await notificationService.markRead('t1', 'n1');

    const call = mockPrisma.notification.update.mock.calls[0][0] as any;
    expect(call.where).toEqual({ id: 'n1' });
    expect(call.data.read_at).toBeInstanceOf(Date);
  });

  it('is a HttpError instance on 404', async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(null as never);
    await expect(notificationService.markRead('t1', 'x')).rejects.toBeInstanceOf(HttpError);
  });
});

describe('markAllRead scoped by tenant and read_at null', () => {
  it('calls updateMany scoped by tenant + read_at null and returns updated count', async () => {
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 4 } as never);

    const result = await notificationService.markAllRead('t1');

    expect(result).toEqual({ updated: 4 });
    const call = mockPrisma.notification.updateMany.mock.calls[0][0] as any;
    expect(call.where).toEqual({ tenant_id: 't1', read_at: null });
    expect(call.data.read_at).toBeInstanceOf(Date);
  });
});
