import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';

/**
 * Cancellation policy service (appointment-waitlist-cancellation, Requirement 1).
 *
 * Holds the tenant-level configuration that governs when a customer may cancel
 * without cost and when a penalty (debt) applies:
 *   - grace_hours: horas de gracia antes de la cita para cancelar sin costo.
 *   - allowed_cancellations: cancelaciones permitidas dentro del periodo.
 *   - penalty_amount: penalizacion (moneda del tenant) al superar el limite.
 *   - reset_days: dias del periodo (0 = no reinicia).
 *
 * Todo esta scoped por tenant_id (1:1 con Tenant). El modelo Prisma expone
 * penalty_amount como Decimal; aqui se expone/recibe como number.
 */

export interface CancellationPolicyView {
  tenant_id: string;
  grace_hours: number;
  allowed_cancellations: number;
  penalty_amount: number;
  reset_days: number;
}

export interface UpdateCancellationPolicyInput {
  grace_hours?: number;
  allowed_cancellations?: number;
  penalty_amount?: number;
  reset_days?: number;
}

/** Defaults sensatos cuando el tenant no ha configurado la politica (AC 1.4). */
export const CANCELLATION_POLICY_DEFAULTS = {
  grace_hours: 24,
  allowed_cancellations: 1,
  penalty_amount: 0,
  reset_days: 30,
} as const;

/**
 * Builds the consistent view from a raw policy record (Decimal -> number),
 * o desde los defaults cuando no existe registro persistido.
 */
function toPolicyView(
  tenantId: string,
  record: {
    grace_hours: number;
    allowed_cancellations: number;
    penalty_amount: unknown;
    reset_days: number;
  } | null
): CancellationPolicyView {
  if (!record) {
    return {
      tenant_id: tenantId,
      grace_hours: CANCELLATION_POLICY_DEFAULTS.grace_hours,
      allowed_cancellations: CANCELLATION_POLICY_DEFAULTS.allowed_cancellations,
      penalty_amount: CANCELLATION_POLICY_DEFAULTS.penalty_amount,
      reset_days: CANCELLATION_POLICY_DEFAULTS.reset_days,
    };
  }

  return {
    tenant_id: tenantId,
    grace_hours: record.grace_hours,
    allowed_cancellations: record.allowed_cancellations,
    penalty_amount: Number(record.penalty_amount),
    reset_days: record.reset_days,
  };
}

/**
 * Validates a supplied numeric field. Returns the coerced number when valid.
 * Invalid (no numerico, NaN, negativo, o no entero cuando se exige) ->
 * 400 VALIDATION_ERROR sin persistir (AC 1.3).
 */
function validateNumber(
  field: string,
  value: unknown,
  { integer }: { integer: boolean }
): number {
  const num = typeof value === 'number' ? value : NaN;

  if (typeof value !== 'number' || Number.isNaN(num) || !Number.isFinite(num)) {
    throw new HttpError(
      `${field} must be a number`,
      400,
      'VALIDATION_ERROR'
    );
  }
  if (num < 0) {
    throw new HttpError(
      `${field} must be >= 0`,
      400,
      'VALIDATION_ERROR'
    );
  }
  if (integer && !Number.isInteger(num)) {
    throw new HttpError(
      `${field} must be an integer`,
      400,
      'VALIDATION_ERROR'
    );
  }

  return num;
}

export const cancellationPolicyService = {
  /**
   * Returns the tenant's cancellation policy, or the defaults (WITHOUT
   * persisting) when none has been configured (AC 1.1, 1.4). Tenant-scoped.
   */
  async getOrDefault(tenantId: string): Promise<CancellationPolicyView> {
    const record = await prisma.cancellationPolicy.findUnique({
      where: { tenant_id: tenantId },
    });

    return toPolicyView(tenantId, record);
  },

  /**
   * Updates (upsert) the tenant's cancellation policy. Solo los campos
   * provistos se validan; cada uno debe ser numerico y >= 0 (grace_hours,
   * allowed_cancellations, reset_days enteros; penalty_amount decimal). Un
   * valor invalido -> 400 VALIDATION_ERROR SIN persistir (AC 1.3). Devuelve la
   * vista actualizada (Decimal -> number). Tenant-scoped.
   */
  async update(
    tenantId: string,
    data: UpdateCancellationPolicyInput
  ): Promise<CancellationPolicyView> {
    // Validate everything BEFORE touching the database (AC 1.3: sin persistir).
    const patch: {
      grace_hours?: number;
      allowed_cancellations?: number;
      penalty_amount?: number;
      reset_days?: number;
    } = {};

    if (data.grace_hours !== undefined) {
      patch.grace_hours = validateNumber('grace_hours', data.grace_hours, {
        integer: true,
      });
    }
    if (data.allowed_cancellations !== undefined) {
      patch.allowed_cancellations = validateNumber(
        'allowed_cancellations',
        data.allowed_cancellations,
        { integer: true }
      );
    }
    if (data.reset_days !== undefined) {
      patch.reset_days = validateNumber('reset_days', data.reset_days, {
        integer: true,
      });
    }
    if (data.penalty_amount !== undefined) {
      patch.penalty_amount = validateNumber(
        'penalty_amount',
        data.penalty_amount,
        { integer: false }
      );
    }

    const record = await prisma.cancellationPolicy.upsert({
      where: { tenant_id: tenantId },
      create: {
        tenant_id: tenantId,
        grace_hours:
          patch.grace_hours ?? CANCELLATION_POLICY_DEFAULTS.grace_hours,
        allowed_cancellations:
          patch.allowed_cancellations ??
          CANCELLATION_POLICY_DEFAULTS.allowed_cancellations,
        penalty_amount:
          patch.penalty_amount ?? CANCELLATION_POLICY_DEFAULTS.penalty_amount,
        reset_days: patch.reset_days ?? CANCELLATION_POLICY_DEFAULTS.reset_days,
      },
      update: patch,
    });

    return toPolicyView(tenantId, record);
  },
};
