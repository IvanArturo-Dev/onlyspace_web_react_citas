import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------
const mockPrisma = {
  appointment: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  branch: {
    findMany: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// branch.service.isTenantPremium is mocked so we can drive free/premium
// scenarios without touching the real premium resolution.
const mockIsTenantPremium = jest.fn();
jest.mock('../branch.service', () => ({
  isTenantPremium: (...args: any[]) => mockIsTenantPremium(...args),
  branchService: { get: jest.fn() },
  getPrimaryBranchId: jest.fn(),
}));

// Best-effort hooks / integrated services mocked as no-ops so importing the
// appointment service (which pulls them transitively) is side-effect free.
jest.mock('../google-appointment-hook', () => ({
  runGoogleAppointmentHook: jest.fn(async () => undefined),
}));

import { appointmentService } from '../appointment.service';
import { appointmentController } from '../../controllers/appointment.controller';

/** Minimal Express response double capturing status + json/send + headers. */
function makeRes() {
  const res: any = {};
  res.statusCode = 200;
  res.body = undefined;
  res.sent = undefined;
  res.headers = {};
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((payload: any) => {
    res.body = payload;
    return res;
  });
  res.send = jest.fn((payload: any) => {
    res.sent = payload;
    return res;
  });
  res.setHeader = jest.fn((k: string, v: string) => {
    res.headers[k] = v;
    return res;
  });
  return res;
}

const NOW = Date.UTC(2025, 5, 15, 12, 0, 0, 0); // 2025-06-15 12:00 UTC

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  mockPrisma.appointment.findMany.mockResolvedValue([] as any);
  mockPrisma.appointment.count.mockResolvedValue(0 as any);
  mockPrisma.branch.findMany.mockResolvedValue([] as any);
});

// ---------------------------------------------------------------------------
// listAppointments — premium gating de la ventana de fechas
// ---------------------------------------------------------------------------
describe('appointmentService.listAppointments premium windowing', () => {
  it('isPremium=false FUERZA la ventana [hoy-7, hoy+7] ignorando el rango pedido', async () => {
    await appointmentService.listAppointments('t1', {
      isPremium: false,
      // Rango amplio que DEBE ser ignorado en free.
      start_date: '2020-01-01T00:00:00.000Z',
      end_date: '2030-01-01T00:00:00.000Z',
    });

    const where = (mockPrisma.appointment.findMany.mock.calls[0] as any[])[0].where;
    expect(where.tenant_id).toBe('t1');
    // gte = inicio del dia de hace 7 dias (2025-06-08 00:00:00.000Z).
    expect((where.start_time.gte as Date).toISOString()).toBe(
      new Date(Date.UTC(2025, 5, 8, 0, 0, 0, 0)).toISOString()
    );
    // lte = fin del dia de dentro de 7 dias (2025-06-22 23:59:59.999Z).
    expect((where.start_time.lte as Date).toISOString()).toBe(
      new Date(Date.UTC(2025, 5, 22, 23, 59, 59, 999)).toISOString()
    );
  });

  it('isPremium=true respeta el rango pedido', async () => {
    await appointmentService.listAppointments('t1', {
      isPremium: true,
      start_date: '2025-01-01T00:00:00.000Z',
      end_date: '2025-03-01T00:00:00.000Z',
    });

    const where = (mockPrisma.appointment.findMany.mock.calls[0] as any[])[0].where;
    expect((where.start_time.gte as Date).toISOString()).toBe(
      new Date('2025-01-01T00:00:00.000Z').toISOString()
    );
    expect((where.start_time.lte as Date).toISOString()).toBe(
      new Date('2025-03-01T00:00:00.000Z').toISOString()
    );
  });

  it('isPremium=true sin rango no restringe start_time', async () => {
    await appointmentService.listAppointments('t1', { isPremium: true });
    const where = (mockPrisma.appointment.findMany.mock.calls[0] as any[])[0].where;
    expect(where.start_time).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// list handler — expone is_premium y pasa isPremium al servicio
// ---------------------------------------------------------------------------
describe('appointmentController.list is_premium', () => {
  it('resuelve premium y lo incluye en data.is_premium (free)', async () => {
    mockIsTenantPremium.mockResolvedValue(false);
    const req: any = { user: { tenant_id: 't1' }, query: {} };
    const res = makeRes();

    await appointmentController.list(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.is_premium).toBe(false);
    // El where quedo forzado a la ventana limitada (free).
    const where = (mockPrisma.appointment.findMany.mock.calls[0] as any[])[0].where;
    expect(where.start_time).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// monthlyStats — 403 en free; agrupa por mes en premium
// ---------------------------------------------------------------------------
describe('appointmentController.monthlyStats', () => {
  it('403 PREMIUM_REQUIRED cuando no es premium', async () => {
    mockIsTenantPremium.mockResolvedValue(false);
    const req: any = { user: { tenant_id: 't1' }, query: {} };
    const res = makeRes();

    await appointmentController.monthlyStats(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('PREMIUM_REQUIRED');
    expect(mockPrisma.appointment.findMany).not.toHaveBeenCalled();
  });

  it('premium agrupa por mes con by_status e income (excluye canceladas)', async () => {
    mockIsTenantPremium.mockResolvedValue(true);
    // Dos citas en 2025-06: una COMPLETED (paga 100) y una CANCELLED (paga 50,
    // NO cuenta en income).
    mockPrisma.appointment.findMany.mockResolvedValue([
      {
        start_time: new Date(Date.UTC(2025, 5, 10, 9, 0, 0)),
        status: 'COMPLETED',
        amount_paid: 100,
      },
      {
        start_time: new Date(Date.UTC(2025, 5, 12, 9, 0, 0)),
        status: 'CANCELLED',
        amount_paid: 50,
      },
    ] as any);

    const req: any = { user: { tenant_id: 't1' }, query: { months: '3' } };
    const res = makeRes();

    await appointmentController.monthlyStats(req, res);

    expect(res.statusCode).toBe(200);
    const series = res.body.data as any[];
    // 3 meses: 2025-04, 2025-05, 2025-06.
    expect(series.map((s) => s.month)).toEqual(['2025-04', '2025-05', '2025-06']);
    const june = series.find((s) => s.month === '2025-06');
    expect(june.total).toBe(2);
    expect(june.by_status.COMPLETED).toBe(1);
    expect(june.by_status.CANCELLED).toBe(1);
    // income solo suma la COMPLETED (100); la CANCELLED se excluye.
    expect(june.income).toBe(100);
    // Meses vacios en cero.
    const april = series.find((s) => s.month === '2025-04');
    expect(april.total).toBe(0);
    expect(april.income).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// exportReport — 403 en free; CSV en premium
// ---------------------------------------------------------------------------
describe('appointmentController.exportReport', () => {
  it('403 PREMIUM_REQUIRED cuando no es premium', async () => {
    mockIsTenantPremium.mockResolvedValue(false);
    const req: any = { user: { tenant_id: 't1' }, query: {} };
    const res = makeRes();

    await appointmentController.exportReport(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('PREMIUM_REQUIRED');
    expect(mockPrisma.appointment.findMany).not.toHaveBeenCalled();
  });

  it('premium genera CSV con headers y escapa comas/comillas', async () => {
    mockIsTenantPremium.mockResolvedValue(true);
    mockPrisma.appointment.findMany.mockResolvedValue([
      {
        id: 'a1',
        branch_id: 'b1',
        start_time: new Date(Date.UTC(2025, 5, 10, 9, 30, 0)),
        status: 'COMPLETED',
        amount_total: 200,
        amount_paid: 200,
        payment_status: 'paid',
        customer: { name: 'Ana, Perez' }, // contiene coma -> se escapa
        service: { name: 'Corte "premium"' }, // contiene comillas -> se escapa
      },
    ] as any);
    mockPrisma.branch.findMany.mockResolvedValue([
      { id: 'b1', name: 'Centro' },
    ] as any);

    const req: any = {
      user: { tenant_id: 't1' },
      query: {
        start_date: '2025-06-01T00:00:00.000Z',
        end_date: '2025-06-30T00:00:00.000Z',
      },
    };
    const res = makeRes();

    await appointmentController.exportReport(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['Content-Disposition']).toBe(
      'attachment; filename="reporte-citas.csv"'
    );

    const csv = res.sent as string;
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(
      'fecha,hora,cliente,servicio,estado,sucursal,monto_total,monto_pagado,estado_pago'
    );
    // fila: fecha=2025-06-10, hora=09:30, cliente escapado, servicio escapado.
    expect(lines[1]).toBe(
      '2025-06-10,09:30,"Ana, Perez","Corte ""premium""",COMPLETED,Centro,200,200,paid'
    );
  });
});
