import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Pruebas de actualizacion de cita consistente con aforo (Task 6.1).
//   - Property 7 (actualizacion consistente): reprogramar a un horario lleno
//     (solapes alcanzan capacity, excluyendo la propia cita) -> 409 SLOT_TAKEN
//     sin update; a un horario con cupo (< capacity) -> update OK. Con
//     capacity=1 basta un solape ajeno para bloquear (comportamiento estricto).
//   - Property 6 (aislamiento): actualizar una cita ajena (getAppointment ->
//     404) -> APPOINTMENT_NOT_FOUND sin update.
//   - Un update de solo notas (sin cambiar start_time/service_id) NO corre el
//     chequeo de aforo ni toca campos de pago.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Prisma mock. `appointment.findUnique` respalda getAppointment (carga
// scoped por tenant), `service.findUnique` carga el servicio (con capacity), y
// `$transaction` ejecuta el callback con un `tx` que expone
// appointment.findMany + appointment.update.
// ---------------------------------------------------------------------------
const mockTx = {
  appointment: { findMany: jest.fn(), update: jest.fn(), count: jest.fn() },
};

const mockPrisma = {
  appointment: { findUnique: jest.fn(), update: jest.fn() },
  service: { findUnique: jest.fn() },
  $transaction: jest.fn(async (cb: any) => cb(mockTx)),
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// audit no-op (el service no lo llama, pero se mockea para aislar el grafo).
jest.mock('../../utils/audit', () => ({
  writeAudit: jest.fn(async () => undefined),
}));

// branchService: mockeado; updateAppointment solo lo usa cuando cambia branch_id.
const mockBranchGet = jest.fn(async () => ({ id: 'branch-1' }));
jest.mock('../branch.service', () => ({
  branchService: {
    get: (...args: unknown[]) => mockBranchGet(...args),
  },
}));

// loyalty.service: mockeado; updateAppointment no lo llama, pero
// appointment.service lo importa.
jest.mock('../loyalty.service', () => ({
  loyaltyService: {
    onAppointmentCompleted: jest.fn(async () => undefined),
    onAppointmentUncompleted: jest.fn(async () => undefined),
  },
}));

import { appointmentService } from '../appointment.service';

const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';
const APPT = 'appt-1';
const SERVICE = 'svc-1';

const START = new Date('2024-06-01T10:00:00.000Z');
const END = new Date('2024-06-01T10:30:00.000Z');

/** Cita existente tal como la devolveria getAppointment (scoped por tenant). */
function appointment(overrides: Record<string, unknown> = {}) {
  return {
    id: APPT,
    tenant_id: TENANT,
    customer_id: 'cust-1',
    service_id: SERVICE,
    branch_id: null,
    professional_id: null,
    start_time: START,
    end_time: END,
    status: 'PENDING',
    payment_status: 'partial',
    amount_total: 100,
    amount_paid: 40,
    currency: 'MXN',
    notes: 'nota original',
    ...overrides,
  } as never;
}

/** Servicio con capacidad dada (duration 30 min por defecto). */
function service(capacity: number, duration = 30) {
  return {
    id: SERVICE,
    tenant_id: TENANT,
    duration_mins: duration,
    capacity,
  } as never;
}

/** Genera `n` citas que solapan [START, END). */
function overlapping(n: number) {
  return Array.from({ length: n }, () => ({
    start_time: new Date(START.getTime() + 5 * 60_000),
    end_time: new Date(START.getTime() + 25 * 60_000),
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.appointment.findUnique.mockResolvedValue(appointment());
  mockPrisma.service.findUnique.mockResolvedValue(service(1));
  mockTx.appointment.count.mockResolvedValue(0 as never);
  mockTx.appointment.findMany.mockResolvedValue([] as never);
  mockTx.appointment.update.mockImplementation(async (args: any) => ({
    ...appointment(),
    ...args.data,
  }));
  mockPrisma.appointment.update.mockImplementation(async (args: any) => ({
    ...appointment(),
    ...args.data,
  }));
});

// =========================================================================
// Property 7: actualizacion consistente con aforo
// Validates: Requirements 5.2, 5.3
// =========================================================================
describe('appointmentService.updateAppointment — Property 7 (actualizacion consistente con aforo)', () => {
  it('reprograma a un horario lleno (solapes == capacity, excluyendo self) -> 409 SLOT_TAKEN sin update', async () => {
    mockPrisma.service.findUnique.mockResolvedValue(service(2));
    // 2 solapes ajenos == capacity=2 -> lleno.
    mockTx.appointment.findMany.mockResolvedValue(overlapping(2) as never);

    await expect(
      appointmentService.updateAppointment(TENANT, APPT, {
        start_time: '2024-06-01T10:00:00.000Z',
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'SLOT_TAKEN' } as never);

    expect(mockTx.appointment.update).not.toHaveBeenCalled();
    expect(mockPrisma.appointment.update).not.toHaveBeenCalled();
  });

  it('reprograma a un horario con cupo (solapes < capacity) -> update OK con end_time recalculado', async () => {
    mockPrisma.service.findUnique.mockResolvedValue(service(2));
    // 1 solape < capacity=2 -> hay cupo.
    mockTx.appointment.findMany.mockResolvedValue(overlapping(1) as never);

    const result: any = await appointmentService.updateAppointment(TENANT, APPT, {
      start_time: '2024-06-01T10:00:00.000Z',
    });

    expect(mockTx.appointment.update).toHaveBeenCalledTimes(1);
    const updateArgs = mockTx.appointment.update.mock.calls[0][0] as any;
    // end_time se recalcula = start + duration (30 min).
    expect(new Date(updateArgs.data.end_time).toISOString()).toBe(END.toISOString());
    expect(result.start_time).toBeDefined();
  });

  it('capacity=1: un unico solape ajeno bloquea (comportamiento estricto historico)', async () => {
    mockPrisma.service.findUnique.mockResolvedValue(service(1));
    mockTx.appointment.findMany.mockResolvedValue(overlapping(1) as never);

    await expect(
      appointmentService.updateAppointment(TENANT, APPT, {
        start_time: '2024-06-01T10:00:00.000Z',
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'SLOT_TAKEN' } as never);

    expect(mockTx.appointment.update).not.toHaveBeenCalled();
  });

  it('capacity=1: sin solapes ajenos reprograma OK', async () => {
    mockPrisma.service.findUnique.mockResolvedValue(service(1));
    mockTx.appointment.findMany.mockResolvedValue([] as never);

    await appointmentService.updateAppointment(TENANT, APPT, {
      start_time: '2024-06-01T10:00:00.000Z',
    });

    expect(mockTx.appointment.update).toHaveBeenCalledTimes(1);
  });

  it('el conteo de solapes se scopea por service_id y excluye la propia cita (id != appointmentId)', async () => {
    mockPrisma.service.findUnique.mockResolvedValue(service(2));
    mockTx.appointment.findMany.mockResolvedValue([] as never);

    await appointmentService.updateAppointment(TENANT, APPT, {
      start_time: '2024-06-01T10:00:00.000Z',
    });

    const where = (mockTx.appointment.findMany.mock.calls[0] as any[])[0].where;
    expect(where.service_id).toBe(SERVICE);
    expect(where.tenant_id).toBe(TENANT);
    expect(where.id).toEqual({ not: APPT });
    expect(where.status).toEqual({ not: 'CANCELLED' });
  });

  it('cambiar service_id usa el nuevo servicio para cargar capacity/duracion y scopear el conteo', async () => {
    // La cita existente usa SERVICE; cambiamos a otro servicio.
    mockPrisma.service.findUnique.mockResolvedValue(
      service(2) as never // findUnique se resuelve con el nuevo servicio
    );
    mockTx.appointment.findMany.mockResolvedValue([] as never);

    await appointmentService.updateAppointment(TENANT, APPT, {
      service_id: 'svc-2',
    });

    // service.findUnique se cargo con el service_id nuevo.
    const findServiceArgs = mockPrisma.service.findUnique.mock.calls[0][0] as any;
    expect(findServiceArgs.where.id).toBe('svc-2');
    expect(findServiceArgs.where.tenant_id).toBe(TENANT);

    // el conteo se scopea por el nuevo service_id.
    const where = (mockTx.appointment.findMany.mock.calls[0] as any[])[0].where;
    expect(where.service_id).toBe('svc-2');
  });

  it('un service_id inexistente/ajeno al reprogramar -> 404 SERVICE_NOT_FOUND sin update', async () => {
    mockPrisma.service.findUnique.mockResolvedValue(null as never);

    await expect(
      appointmentService.updateAppointment(TENANT, APPT, {
        service_id: 'svc-x',
      })
    ).rejects.toMatchObject({ statusCode: 404, code: 'SERVICE_NOT_FOUND' } as never);

    expect(mockTx.appointment.update).not.toHaveBeenCalled();
  });
});

// =========================================================================
// notas-only: sin cambio de horario/servicio NO corre el chequeo de aforo
// ni toca campos de pago.
// Validates: Requirements 5.5
// =========================================================================
describe('appointmentService.updateAppointment — notas-only no dispara aforo ni toca pago', () => {
  it('un update de solo notas no consulta servicio ni cuenta solapes', async () => {
    await appointmentService.updateAppointment(TENANT, APPT, {
      notes: 'nueva nota interna',
    });

    // No se cargo servicio ni se conto aforo.
    expect(mockPrisma.service.findUnique).not.toHaveBeenCalled();
    expect(mockTx.appointment.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();

    // Persiste directamente solo los campos provistos, sin end_time ni pago.
    expect(mockPrisma.appointment.update).toHaveBeenCalledTimes(1);
    const updateArgs = mockPrisma.appointment.update.mock.calls[0][0] as any;
    expect(updateArgs.data).toEqual({ notes: 'nueva nota interna' });
    expect(updateArgs.data).not.toHaveProperty('payment_status');
    expect(updateArgs.data).not.toHaveProperty('amount_total');
    expect(updateArgs.data).not.toHaveProperty('amount_paid');
    expect(updateArgs.data).not.toHaveProperty('end_time');
  });

  it('reprogramar tampoco incluye campos de pago en el update (solo lo provisto + end_time)', async () => {
    mockPrisma.service.findUnique.mockResolvedValue(service(2));
    mockTx.appointment.findMany.mockResolvedValue([] as never);

    await appointmentService.updateAppointment(TENANT, APPT, {
      start_time: '2024-06-01T10:00:00.000Z',
    });

    const updateArgs = mockTx.appointment.update.mock.calls[0][0] as any;
    expect(updateArgs.data).not.toHaveProperty('payment_status');
    expect(updateArgs.data).not.toHaveProperty('amount_total');
    expect(updateArgs.data).not.toHaveProperty('amount_paid');
    expect(updateArgs.data).not.toHaveProperty('notes');
    expect(updateArgs.data.start_time).toBe('2024-06-01T10:00:00.000Z');
    expect(updateArgs.data.end_time).toBeDefined();
  });
});

// =========================================================================
// Property 6: aislamiento por tenant
// Validates: Requirements 5.4
// =========================================================================
describe('appointmentService.updateAppointment — Property 6 (aislamiento por tenant)', () => {
  it('actualizar una cita ajena (getAppointment -> null) -> 404 APPOINTMENT_NOT_FOUND sin update', async () => {
    mockPrisma.appointment.findUnique.mockResolvedValue(null as never);

    await expect(
      appointmentService.updateAppointment(OTHER_TENANT, APPT, {
        start_time: '2024-06-01T10:00:00.000Z',
      })
    ).rejects.toMatchObject({ statusCode: 404, code: 'APPOINTMENT_NOT_FOUND' } as never);

    expect(mockPrisma.service.findUnique).not.toHaveBeenCalled();
    expect(mockTx.appointment.update).not.toHaveBeenCalled();
    expect(mockPrisma.appointment.update).not.toHaveBeenCalled();
  });

  it('carga la cita scoped por tenant_id y actualiza scoped por tenant_id', async () => {
    mockPrisma.service.findUnique.mockResolvedValue(service(2));
    mockTx.appointment.findMany.mockResolvedValue([] as never);

    await appointmentService.updateAppointment(TENANT, APPT, {
      start_time: '2024-06-01T10:00:00.000Z',
    });

    const findArgs = mockPrisma.appointment.findUnique.mock.calls[0][0] as any;
    expect(findArgs.where.tenant_id).toBe(TENANT);
    expect(findArgs.where.id).toBe(APPT);

    const updateArgs = mockTx.appointment.update.mock.calls[0][0] as any;
    expect(updateArgs.where.tenant_id).toBe(TENANT);
    expect(updateArgs.where.id).toBe(APPT);
  });
});
