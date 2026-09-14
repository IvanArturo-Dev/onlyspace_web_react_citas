import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mock de Prisma. Solo se declaran los delegados que el servicio de resenas
// utiliza: appointment.findFirst/findMany y review.upsert/findUnique/findMany/
// groupBy. El servicio importa `prisma` desde '../../database/prisma.service',
// por lo que sustituimos ese modulo por completo (mismo patron que el resto de
// *.unit.test.ts del proyecto).
// ---------------------------------------------------------------------------
const mockPrisma = {
  appointment: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  review: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    groupBy: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

import { reviewService } from '../review.service';

/** Tenant y usuario de referencia para las pruebas. */
const TENANT = 'tenant-1';
const EMAIL = 'client@example.com';
const APPT = 'appt-1';

/** Construye una cita valida con overrides puntuales. */
function makeAppointment(overrides: Record<string, any> = {}) {
  return {
    id: APPT,
    tenant_id: TENANT,
    booked_by_email: EMAIL,
    customer_id: 'cust-1',
    status: 'COMPLETED',
    ...overrides,
  };
}

/** Construye un registro Review de Prisma con overrides puntuales. */
function makeReviewRecord(overrides: Record<string, any> = {}) {
  return {
    id: 'rev-1',
    appointment_id: APPT,
    tenant_id: TENANT,
    customer_id: 'cust-1',
    rating: 5,
    comment: 'Excelente',
    created_at: new Date('2025-01-10T10:00:00Z'),
    updated_at: new Date('2025-01-10T10:00:00Z'),
    ...overrides,
  };
}

/**
 * Property 3, 4, 5, 8: alta/edicion de resenas.
 *
 * **Validates: Requirements 3.1, 3.3, 3.4, 3.6**
 */
describe('reviewService.upsertReview (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('califica una cita COMPLETED propia y devuelve la vista (upsert por appointment_id)', async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(makeAppointment() as any);
    mockPrisma.review.upsert.mockResolvedValue(makeReviewRecord() as any);

    const view = await reviewService.upsertReview(TENANT, EMAIL, APPT, 5, 'Excelente');

    // La cita se carga acotada por tenant (aislamiento, Property 8).
    expect(mockPrisma.appointment.findFirst).toHaveBeenCalledWith({
      where: { id: APPT, tenant_id: TENANT },
    });

    // El upsert usa la columna @unique appointment_id.
    const call = mockPrisma.review.upsert.mock.calls[0][0] as any;
    expect(call.where).toEqual({ appointment_id: APPT });
    expect(call.create).toEqual({
      tenant_id: TENANT,
      appointment_id: APPT,
      customer_id: 'cust-1',
      rating: 5,
      comment: 'Excelente',
    });
    expect(call.update).toEqual({ rating: 5, comment: 'Excelente' });

    // La vista no expone tenant_id ni customer_id.
    expect(view).toEqual({
      id: 'rev-1',
      appointment_id: APPT,
      rating: 5,
      comment: 'Excelente',
      created_at: new Date('2025-01-10T10:00:00Z'),
      updated_at: new Date('2025-01-10T10:00:00Z'),
    });
  });

  it('reconoce al dueno de la cita sin distinguir mayusculas/minusculas', async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(
      makeAppointment({ booked_by_email: 'Client@Example.com' }) as any
    );
    mockPrisma.review.upsert.mockResolvedValue(makeReviewRecord() as any);

    await expect(
      reviewService.upsertReview(TENANT, 'client@example.com', APPT, 4)
    ).resolves.toBeDefined();

    expect(mockPrisma.review.upsert).toHaveBeenCalledTimes(1);
  });

  it('reenviar una resena para la misma cita EDITA la existente (mismo upsert)', async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(makeAppointment() as any);
    // Segunda llamada -> Prisma devuelve el registro ya actualizado.
    mockPrisma.review.upsert
      .mockResolvedValueOnce(makeReviewRecord({ rating: 5 }) as any)
      .mockResolvedValueOnce(
        makeReviewRecord({ rating: 2, comment: 'Regular', updated_at: new Date('2025-02-01T00:00:00Z') }) as any
      );

    await reviewService.upsertReview(TENANT, EMAIL, APPT, 5, 'Excelente');
    const second = await reviewService.upsertReview(TENANT, EMAIL, APPT, 2, 'Regular');

    // Ambas llamadas apuntan a la misma clave unica: nunca se duplica (Property 4).
    expect(mockPrisma.review.upsert).toHaveBeenCalledTimes(2);
    expect((mockPrisma.review.upsert.mock.calls[0][0] as any).where).toEqual({ appointment_id: APPT });
    expect((mockPrisma.review.upsert.mock.calls[1][0] as any).where).toEqual({ appointment_id: APPT });
    expect(second.rating).toBe(2);
    expect(second.comment).toBe('Regular');
  });

  it('convierte comment undefined en null', async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(makeAppointment() as any);
    mockPrisma.review.upsert.mockResolvedValue(makeReviewRecord({ comment: null }) as any);

    const view = await reviewService.upsertReview(TENANT, EMAIL, APPT, 3);

    const call = mockPrisma.review.upsert.mock.calls[0][0] as any;
    expect(call.create.comment).toBeNull();
    expect(call.update.comment).toBeNull();
    expect(view.comment).toBeNull();
  });

  it('rechaza calificar una cita cuyo status != COMPLETED (400 REVIEW_NOT_ALLOWED, sin upsert)', async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(
      makeAppointment({ status: 'PENDING' }) as any
    );

    await expect(
      reviewService.upsertReview(TENANT, EMAIL, APPT, 5)
    ).rejects.toMatchObject({ statusCode: 400, code: 'REVIEW_NOT_ALLOWED' });

    expect(mockPrisma.review.upsert).not.toHaveBeenCalled();
  });

  it('rechaza calificar una cita reservada por otro email (403 FORBIDDEN, sin upsert)', async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(
      makeAppointment({ booked_by_email: 'other@example.com' }) as any
    );

    await expect(
      reviewService.upsertReview(TENANT, EMAIL, APPT, 5)
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });

    expect(mockPrisma.review.upsert).not.toHaveBeenCalled();
  });

  it('devuelve 404 APPOINTMENT_NOT_FOUND cuando la cita no existe o es de otro tenant', async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(null as any);

    await expect(
      reviewService.upsertReview(TENANT, EMAIL, APPT, 5)
    ).rejects.toMatchObject({ statusCode: 404, code: 'APPOINTMENT_NOT_FOUND' });

    expect(mockPrisma.review.upsert).not.toHaveBeenCalled();
  });

  it('rechaza ratings fuera de rango o no enteros (400 VALIDATION_ERROR antes de cargar la cita)', async () => {
    for (const bad of [0, 6, 3.5]) {
      await expect(
        reviewService.upsertReview(TENANT, EMAIL, APPT, bad)
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    }

    // La validacion del rating ocurre primero: nunca se toca la DB.
    expect(mockPrisma.appointment.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.review.upsert).not.toHaveBeenCalled();
  });
});

/**
 * Property 8: consulta de la resena de una cita del propio cliente.
 *
 * **Validates: Requirements 3.2**
 */
describe('reviewService.getReview (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('devuelve la vista cuando la cita es propia y ya tiene resena', async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(makeAppointment() as any);
    mockPrisma.review.findUnique.mockResolvedValue(makeReviewRecord() as any);

    const view = await reviewService.getReview(TENANT, EMAIL, APPT);

    expect(mockPrisma.review.findUnique).toHaveBeenCalledWith({
      where: { appointment_id: APPT },
    });
    expect(view).not.toBeNull();
    expect(view!.appointment_id).toBe(APPT);
    expect(view!.rating).toBe(5);
  });

  it('devuelve null cuando la cita es propia pero aun no tiene resena', async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(makeAppointment() as any);
    mockPrisma.review.findUnique.mockResolvedValue(null as any);

    const view = await reviewService.getReview(TENANT, EMAIL, APPT);

    expect(view).toBeNull();
  });

  it('rechaza consultar la resena de una cita ajena (403 FORBIDDEN, sin leer review)', async () => {
    mockPrisma.appointment.findFirst.mockResolvedValue(
      makeAppointment({ booked_by_email: 'other@example.com' }) as any
    );

    await expect(
      reviewService.getReview(TENANT, EMAIL, APPT)
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });

    expect(mockPrisma.review.findUnique).not.toHaveBeenCalled();
  });
});

/**
 * Property 8: listado de resenas del propio cliente.
 *
 * **Validates: Requirements 3.2**
 */
describe('reviewService.getMyReviews (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('devuelve las resenas de las citas que el usuario reservo en el tenant', async () => {
    mockPrisma.appointment.findMany.mockResolvedValue([
      { id: 'appt-1' },
      { id: 'appt-2' },
    ] as any);
    mockPrisma.review.findMany.mockResolvedValue([
      makeReviewRecord({ id: 'rev-1', appointment_id: 'appt-1' }),
      makeReviewRecord({ id: 'rev-2', appointment_id: 'appt-2', rating: 4 }),
    ] as any);

    const views = await reviewService.getMyReviews(TENANT, EMAIL);

    // Las citas se resuelven filtrando por tenant + email del propio cliente.
    expect(mockPrisma.appointment.findMany).toHaveBeenCalledWith({
      where: { tenant_id: TENANT, booked_by_email: EMAIL },
      select: { id: true },
    });
    // Las resenas se acotan a las citas resueltas y al tenant.
    const reviewCall = mockPrisma.review.findMany.mock.calls[0][0] as any;
    expect(reviewCall.where).toEqual({
      tenant_id: TENANT,
      appointment_id: { in: ['appt-1', 'appt-2'] },
    });
    expect(views).toHaveLength(2);
    expect(views.map((v) => v.id)).toEqual(['rev-1', 'rev-2']);
  });

  it('devuelve [] cuando el usuario no tiene citas en el tenant (sin consultar reviews)', async () => {
    mockPrisma.appointment.findMany.mockResolvedValue([] as any);

    const views = await reviewService.getMyReviews(TENANT, EMAIL);

    expect(views).toEqual([]);
    expect(mockPrisma.review.findMany).not.toHaveBeenCalled();
  });
});

/**
 * Property 6: agregacion de promedio y conteo por tenant.
 *
 * **Validates: Requirements 3.5**
 */
describe('reviewService.ratingsForTenants (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('devuelve avg (redondeado a 1 decimal) y count por tenant', async () => {
    mockPrisma.review.groupBy.mockResolvedValue([
      { tenant_id: 't1', _avg: { rating: 4.3333 }, _count: { _all: 3 } },
      { tenant_id: 't2', _avg: { rating: 5 }, _count: { _all: 1 } },
    ] as any);

    const map = await reviewService.ratingsForTenants(['t1', 't2', 't3']);

    expect(mockPrisma.review.groupBy).toHaveBeenCalledWith({
      by: ['tenant_id'],
      where: { tenant_id: { in: ['t1', 't2', 't3'] } },
      _avg: { rating: true },
      _count: { _all: true },
    });

    // Redondeo a 1 decimal: 4.3333 -> 4.3.
    expect(map.get('t1')).toEqual({ avg: 4.3, count: 3 });
    expect(map.get('t2')).toEqual({ avg: 5, count: 1 });
    // t3 no tiene resenas: ausente del map (el consumidor asume avg null/count 0).
    expect(map.has('t3')).toBe(false);
  });

  it('devuelve un map vacio y NO consulta groupBy cuando la lista de tenants esta vacia', async () => {
    const map = await reviewService.ratingsForTenants([]);

    expect(map.size).toBe(0);
    expect(mockPrisma.review.groupBy).not.toHaveBeenCalled();
  });
});
