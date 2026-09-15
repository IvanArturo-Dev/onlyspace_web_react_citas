import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Prisma mock (patron branding.service.unit.test.ts). $transaction ejecuta el
// callback con el propio mockPrisma para simular el cliente transaccional.
// ---------------------------------------------------------------------------
const mockPrisma = {
  waitlistEntry: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  customer: {
    findFirst: jest.fn(),
  },
  appointment: {
    findMany: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// customerCancellationService.hasDebt mock.
const mockHasDebt = jest.fn();
jest.mock('../customerCancellation.service', () => ({
  customerCancellationService: {
    hasDebt: (...args: unknown[]) => mockHasDebt(...args),
  },
}));

import { waitlistService } from '../waitlist.service';

// Enum values usados en asserts (evitamos importar @prisma/client aqui para no
// acoplar el test al cliente generado; los strings coinciden con el enum).
const WAITING = 'WAITING';
const OFFERED = 'OFFERED';
const CONFIRMED = 'CONFIRMED';
const PENDING = 'PENDING';

beforeEach(() => {
  jest.clearAllMocks();
  // Por defecto sin deuda.
  mockHasDebt.mockResolvedValue(false as never);
  // Por defecto el cliente existe y esta activo (status "active"), de modo que
  // el enforcement de bloqueo (409 CUSTOMER_BLOCKED) no interfiere salvo cuando
  // un test lo configure explicitamente.
  mockPrisma.customer.findFirst.mockResolvedValue({
    id: 'c1',
    tenant_id: 't1',
    status: 'active',
  } as never);
  // $transaction ejecuta el callback con el mockPrisma como tx.
  mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
});

const day = new Date('2025-06-01T10:00:00Z');

// ---------------------------------------------------------------------------
// join
// ---------------------------------------------------------------------------
describe('join', () => {
  it('bloquea con 409 CUSTOMER_HAS_DEBT cuando hasDebt es true', async () => {
    mockHasDebt.mockResolvedValue(true as never);

    await expect(
      waitlistService.join({
        tenantId: 't1',
        serviceId: 's1',
        customerId: 'c1',
        desiredDate: day,
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'CUSTOMER_HAS_DEBT' });

    expect(mockPrisma.waitlistEntry.create).not.toHaveBeenCalled();
    expect(mockPrisma.waitlistEntry.findFirst).not.toHaveBeenCalled();
  });

  it('es idempotente: si existe una entrada activa NO crea y devuelve la existente', async () => {
    const existing = { id: 'w1', status: WAITING, customer_id: 'c1', service_id: 's1' };
    mockPrisma.waitlistEntry.findFirst.mockResolvedValue(existing as never);

    const result = await waitlistService.join({
      tenantId: 't1',
      serviceId: 's1',
      customerId: 'c1',
      desiredDate: day,
    });

    expect(result).toBe(existing);
    expect(mockPrisma.waitlistEntry.create).not.toHaveBeenCalled();

    // La busqueda de idempotencia es scoped y filtra por estados activos.
    const call = mockPrisma.waitlistEntry.findFirst.mock.calls[0][0] as any;
    expect(call.where.tenant_id).toBe('t1');
    expect(call.where.service_id).toBe('s1');
    expect(call.where.customer_id).toBe('c1');
    expect(call.where.status).toEqual({ in: [WAITING, OFFERED] });
    expect(call.where.desired_date.gte).toBeInstanceOf(Date);
    expect(call.where.desired_date.lt).toBeInstanceOf(Date);
  });

  it('crea una entrada WAITING cuando no hay duplicado ni deuda', async () => {
    mockPrisma.waitlistEntry.findFirst.mockResolvedValue(null as never);
    const created = { id: 'w2', status: WAITING };
    mockPrisma.waitlistEntry.create.mockResolvedValue(created as never);

    const result = await waitlistService.join({
      tenantId: 't1',
      branchId: 'b1',
      serviceId: 's1',
      customerId: 'c1',
      desiredDate: day,
      desiredStart: day,
    });

    expect(result).toBe(created);
    const call = mockPrisma.waitlistEntry.create.mock.calls[0][0] as any;
    expect(call.data.tenant_id).toBe('t1');
    expect(call.data.branch_id).toBe('b1');
    expect(call.data.service_id).toBe('s1');
    expect(call.data.customer_id).toBe('c1');
    expect(call.data.status).toBe(WAITING);
  });
});

// ---------------------------------------------------------------------------
// listQueue / firstWaiting — FIFO (created_at asc)
// ---------------------------------------------------------------------------
describe('listQueue / firstWaiting FIFO', () => {
  it('listQueue consulta WAITING del servicio/dia ordenado por created_at asc', async () => {
    const rows = [
      { id: 'w1', created_at: new Date('2025-06-01T08:00:00Z') },
      { id: 'w2', created_at: new Date('2025-06-01T09:00:00Z') },
    ];
    mockPrisma.waitlistEntry.findMany.mockResolvedValue(rows as never);

    const result = await waitlistService.listQueue('t1', { serviceId: 's1', date: day });

    expect(result).toBe(rows);
    const call = mockPrisma.waitlistEntry.findMany.mock.calls[0][0] as any;
    expect(call.where.tenant_id).toBe('t1');
    expect(call.where.service_id).toBe('s1');
    expect(call.where.status).toBe(WAITING);
    expect(call.orderBy).toEqual({ created_at: 'asc' });
  });

  it('firstWaiting devuelve la primera FIFO (created_at asc) o null', async () => {
    const first = { id: 'w1' };
    mockPrisma.waitlistEntry.findFirst.mockResolvedValue(first as never);

    const result = await waitlistService.firstWaiting('t1', 's1', day);
    expect(result).toBe(first);

    const call = mockPrisma.waitlistEntry.findFirst.mock.calls[0][0] as any;
    expect(call.where.status).toBe(WAITING);
    expect(call.orderBy).toEqual({ created_at: 'asc' });
  });

  it('firstWaiting devuelve null cuando la cola esta vacia', async () => {
    mockPrisma.waitlistEntry.findFirst.mockResolvedValue(null as never);
    const result = await waitlistService.firstWaiting('t1', 's1', day);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// offer — re-verificacion de solape + creacion PENDING + OFFERED
// ---------------------------------------------------------------------------
describe('offer', () => {
  const start = new Date('2025-06-01T12:00:00Z');
  const end = new Date('2025-06-01T12:30:00Z');

  it('re-verifica solape: si hay solape -> 409 SLOT_TAKEN y no crea cita', async () => {
    mockPrisma.waitlistEntry.findFirst.mockResolvedValue({
      id: 'w1',
      tenant_id: 't1',
      service_id: 's1',
      customer_id: 'c1',
      branch_id: null,
    } as never);
    // Cita existente que solapa [12:00, 12:30).
    mockPrisma.appointment.findMany.mockResolvedValue([
      { start_time: new Date('2025-06-01T12:15:00Z'), end_time: new Date('2025-06-01T12:45:00Z') },
    ] as never);

    await expect(
      waitlistService.offer('t1', 'w1', { start, end })
    ).rejects.toMatchObject({ statusCode: 409, code: 'SLOT_TAKEN' });

    expect(mockPrisma.appointment.create).not.toHaveBeenCalled();
    expect(mockPrisma.waitlistEntry.update).not.toHaveBeenCalled();
  });

  it('si el slot esta libre crea cita PENDING y marca OFFERED con offered_appointment_id', async () => {
    mockPrisma.waitlistEntry.findFirst.mockResolvedValue({
      id: 'w1',
      tenant_id: 't1',
      service_id: 's1',
      customer_id: 'c1',
      branch_id: 'b1',
    } as never);
    mockPrisma.appointment.findMany.mockResolvedValue([] as never);
    const appt = { id: 'a1', status: PENDING };
    mockPrisma.appointment.create.mockResolvedValue(appt as never);
    const updatedEntry = { id: 'w1', status: OFFERED, offered_appointment_id: 'a1' };
    mockPrisma.waitlistEntry.update.mockResolvedValue(updatedEntry as never);

    const result = await waitlistService.offer('t1', 'w1', { start, end });

    expect(result.appointment).toBe(appt);
    expect(result.entry).toBe(updatedEntry);

    const apptCall = mockPrisma.appointment.create.mock.calls[0][0] as any;
    expect(apptCall.data.tenant_id).toBe('t1');
    expect(apptCall.data.branch_id).toBe('b1');
    expect(apptCall.data.customer_id).toBe('c1');
    expect(apptCall.data.service_id).toBe('s1');
    expect(apptCall.data.status).toBe(PENDING);
    expect(apptCall.data.start_time).toBe(start);
    expect(apptCall.data.end_time).toBe(end);

    const entryCall = mockPrisma.waitlistEntry.update.mock.calls[0][0] as any;
    expect(entryCall.data.status).toBe(OFFERED);
    expect(entryCall.data.offered_appointment_id).toBe('a1');
  });

  it('entrada ajena / inexistente -> 404 WAITLIST_ENTRY_NOT_FOUND', async () => {
    mockPrisma.waitlistEntry.findFirst.mockResolvedValue(null as never);

    await expect(
      waitlistService.offer('t1', 'foreign', { start, end })
    ).rejects.toMatchObject({ statusCode: 404, code: 'WAITLIST_ENTRY_NOT_FOUND' });

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// confirmOffer
// ---------------------------------------------------------------------------
describe('confirmOffer', () => {
  it('marca CONFIRMED la entrada y su cita asociada', async () => {
    mockPrisma.waitlistEntry.findFirst.mockResolvedValue({
      id: 'w1',
      tenant_id: 't1',
      offered_appointment_id: 'a1',
    } as never);
    const updatedEntry = { id: 'w1', status: CONFIRMED };
    mockPrisma.waitlistEntry.update.mockResolvedValue(updatedEntry as never);
    mockPrisma.appointment.updateMany.mockResolvedValue({ count: 1 } as never);

    const result = await waitlistService.confirmOffer('t1', 'w1');

    expect(result).toBe(updatedEntry);
    const apptCall = mockPrisma.appointment.updateMany.mock.calls[0][0] as any;
    expect(apptCall.where).toEqual({ id: 'a1', tenant_id: 't1' });
    expect(apptCall.data.status).toBe(CONFIRMED);
    const entryCall = mockPrisma.waitlistEntry.update.mock.calls[0][0] as any;
    expect(entryCall.data.status).toBe(CONFIRMED);
  });

  it('entrada ajena / inexistente -> 404 WAITLIST_ENTRY_NOT_FOUND', async () => {
    mockPrisma.waitlistEntry.findFirst.mockResolvedValue(null as never);

    await expect(
      waitlistService.confirmOffer('t1', 'foreign')
    ).rejects.toMatchObject({ statusCode: 404, code: 'WAITLIST_ENTRY_NOT_FOUND' });

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
