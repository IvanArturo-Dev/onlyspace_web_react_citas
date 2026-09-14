import { AppointmentStatus } from '@prisma/client';
import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';

/**
 * Vista publica de una resena devuelta por el servicio. No expone `tenant_id`
 * ni `customer_id` (datos internos de aislamiento); la capa de API (Task 5)
 * decide la serializacion final.
 */
export interface ReviewView {
  id: string;
  appointment_id: string;
  rating: number;
  comment: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Rating minimo permitido. */
const MIN_RATING = 1;

/** Rating maximo permitido. */
const MAX_RATING = 5;

/**
 * Mapea un registro Review de Prisma a la vista publica ReviewView.
 */
function toReviewView(record: {
  id: string;
  appointment_id: string;
  rating: number;
  comment: string | null;
  created_at: Date;
  updated_at: Date;
}): ReviewView {
  return {
    id: record.id,
    appointment_id: record.appointment_id,
    rating: record.rating,
    comment: record.comment ?? null,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

/**
 * Redondea un promedio a 1 decimal (p.ej. 4.3333 -> 4.3). Devuelve `null` tal
 * cual cuando no hay promedio.
 */
function round1(value: number | null): number | null {
  if (value == null) {
    return null;
  }
  return Math.round(value * 10) / 10;
}

/**
 * Valida que el rating sea un entero dentro de [1,5]. Lanza 400
 * VALIDATION_ERROR en caso contrario (Property 5, Requirement 3.6).
 */
function assertRating(rating: number): void {
  if (!Number.isInteger(rating) || rating < MIN_RATING || rating > MAX_RATING) {
    throw new HttpError(
      'rating debe ser un entero entre 1 y 5',
      400,
      'VALIDATION_ERROR'
    );
  }
}

/**
 * Carga una cita acotada por tenant y verifica que pertenezca al usuario
 * (comparando `booked_by_email` sin distinguir mayusculas/minusculas). Es la
 * base del aislamiento por cliente y tenant (Property 8).
 *
 * @throws HttpError 404 APPOINTMENT_NOT_FOUND si la cita no existe o es de otro
 *   tenant (indistinguible de inexistente).
 * @throws HttpError 403 FORBIDDEN si la cita no fue reservada por el usuario.
 */
async function loadOwnedAppointment(
  tenantId: string,
  userEmail: string,
  appointmentId: string
) {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, tenant_id: tenantId },
  });

  if (!appointment) {
    throw new HttpError('Cita no encontrada', 404, 'APPOINTMENT_NOT_FOUND');
  }

  const bookedBy = appointment.booked_by_email?.toLowerCase() ?? null;
  if (bookedBy == null || bookedBy !== userEmail.toLowerCase()) {
    throw new HttpError('No puedes acceder a esta cita', 403, 'FORBIDDEN');
  }

  return appointment;
}

export const reviewService = {
  /**
   * Crea o edita (upsert) la resena de una cita COMPLETED del propio cliente.
   *
   * Validaciones (Properties 3, 5, 8):
   *  - rating entero en [1,5]                          -> 400 VALIDATION_ERROR
   *  - cita inexistente o de otro tenant               -> 404 APPOINTMENT_NOT_FOUND
   *  - cita reservada por otro email                   -> 403 FORBIDDEN
   *  - cita cuyo status != COMPLETED                   -> 400 REVIEW_NOT_ALLOWED
   *
   * El upsert usa `appointment_id` (columna @unique), de modo que reenviar una
   * resena para la misma cita EDITA la existente en lugar de duplicarla: siempre
   * hay exactamente una fila por cita (Property 4, Requirements 3.3, 3.4).
   */
  async upsertReview(
    tenantId: string,
    userEmail: string,
    appointmentId: string,
    rating: number,
    comment?: string | null
  ): Promise<ReviewView> {
    assertRating(rating);

    const appointment = await loadOwnedAppointment(tenantId, userEmail, appointmentId);

    if (appointment.status !== AppointmentStatus.COMPLETED) {
      throw new HttpError(
        'Solo puedes calificar una cita realizada',
        400,
        'REVIEW_NOT_ALLOWED'
      );
    }

    const review = await prisma.review.upsert({
      where: { appointment_id: appointmentId },
      create: {
        tenant_id: tenantId,
        appointment_id: appointmentId,
        customer_id: appointment.customer_id,
        rating,
        comment: comment ?? null,
      },
      update: {
        rating,
        comment: comment ?? null,
      },
    });

    return toReviewView(review);
  },

  /**
   * Devuelve la resena de una cita del propio cliente, o `null` si aun no la ha
   * calificado. Valida que la cita exista en el tenant y pertenezca al usuario
   * (mismo aislamiento que `upsertReview`), de modo que jamas expone resenas de
   * otros clientes (Property 8).
   *
   * @throws HttpError 404 si la cita no existe/otro tenant; 403 si es ajena.
   */
  async getReview(
    tenantId: string,
    userEmail: string,
    appointmentId: string
  ): Promise<ReviewView | null> {
    // Autoriza la cita primero: solo su dueno puede consultar su resena.
    await loadOwnedAppointment(tenantId, userEmail, appointmentId);

    const review = await prisma.review.findUnique({
      where: { appointment_id: appointmentId },
    });

    return review ? toReviewView(review) : null;
  },

  /**
   * Lista las resenas del cliente: resuelve las citas que reservo dentro del
   * tenant (por `booked_by_email`) y devuelve las resenas asociadas a esas
   * citas. Aislado por tenant y por usuario (Property 8).
   */
  async getMyReviews(tenantId: string, userEmail: string): Promise<ReviewView[]> {
    const appointments = await prisma.appointment.findMany({
      where: {
        tenant_id: tenantId,
        booked_by_email: userEmail,
      },
      select: { id: true },
    });

    if (appointments.length === 0) {
      return [];
    }

    const reviews = await prisma.review.findMany({
      where: {
        tenant_id: tenantId,
        appointment_id: { in: appointments.map((a) => a.id) },
      },
      orderBy: { created_at: 'desc' },
    });

    return reviews.map(toReviewView);
  },

  /**
   * Calcula, para cada tenant solicitado, el promedio (redondeado a 1 decimal)
   * y el conteo de sus resenas (Property 6, Requirement 3.5).
   *
   * Devuelve un Map `tenant_id -> { avg, count }`. Un tenant SIN resenas NO
   * aparece en el map: el consumidor (discover) usara por defecto avg `null` y
   * count `0`. El aislamiento se garantiza filtrando por `tenant_id in [...]`,
   * de modo que solo se agregan datos de los tenants pedidos.
   */
  async ratingsForTenants(
    tenantIds: string[]
  ): Promise<Map<string, { avg: number | null; count: number }>> {
    const result = new Map<string, { avg: number | null; count: number }>();

    if (tenantIds.length === 0) {
      return result;
    }

    const groups = await prisma.review.groupBy({
      by: ['tenant_id'],
      where: { tenant_id: { in: tenantIds } },
      _avg: { rating: true },
      _count: { _all: true },
    });

    for (const group of groups) {
      result.set(group.tenant_id, {
        avg: round1(group._avg.rating ?? null),
        count: group._count._all,
      });
    }

    return result;
  },
};
