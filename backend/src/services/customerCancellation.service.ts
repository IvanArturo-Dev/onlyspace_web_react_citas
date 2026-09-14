import { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';

/**
 * Servicio de estado de cancelaciones por cliente/tenant.
 *
 * Gestiona el contador de cancelaciones en un periodo, la deuda (penalizacion)
 * derivada de superar el limite permitido, y el reinicio del contador cuando
 * transcurre `reset_days`. La deuda se confirma como pagada manualmente por el
 * emprendedor (ADMIN).
 *
 * Nota de acoplamiento: aunque existe `cancellationPolicy.service.ts` con
 * `getOrDefault`, este servicio lee la politica directo con
 * `prisma.cancellationPolicy.findUnique` y aplica los mismos defaults para
 * evitar dependencias cruzadas mientras ambos servicios se construyen.
 */

/** Cliente de prisma o de transaccion. */
type Db = typeof prisma | Prisma.TransactionClient;

/** Defaults de la politica de cancelacion cuando el tenant no tiene registro. */
const POLICY_DEFAULTS = {
  grace_hours: 24,
  allowed_cancellations: 1,
  penalty_amount: 0,
  reset_days: 30,
} as const;

/** Vista publica del estado de cancelacion (Decimal ya normalizado a number). */
export interface CustomerCancellationView {
  tenant_id: string;
  customer_id: string;
  count: number;
  debt_amount: number;
  debt_reason: string | null;
  period_started_at: Date;
}

/** Politica efectiva usada para calcular penalizaciones y reinicios. */
interface EffectivePolicy {
  grace_hours: number;
  allowed_cancellations: number;
  penalty_amount: number;
  reset_days: number;
}

const DEBT_REASON_PENALTY = 'Penalizacion por cancelaciones';

/**
 * Lee la politica del tenant o devuelve los defaults si no existe.
 */
async function getPolicy(tenantId: string, db: Db = prisma): Promise<EffectivePolicy> {
  const policy = await db.cancellationPolicy.findUnique({ where: { tenant_id: tenantId } });
  if (!policy) {
    return { ...POLICY_DEFAULTS };
  }
  return {
    grace_hours: policy.grace_hours,
    allowed_cancellations: policy.allowed_cancellations,
    penalty_amount: Number(policy.penalty_amount),
    reset_days: policy.reset_days,
  };
}

/**
 * Indica si el periodo vigente expiro segun `reset_days` (0 = nunca reinicia).
 */
function isPeriodExpired(periodStartedAt: Date, resetDays: number, now: Date): boolean {
  if (resetDays <= 0) return false;
  const resetMs = resetDays * 24 * 60 * 60 * 1000;
  return periodStartedAt.getTime() + resetMs < now.getTime();
}

/**
 * Obtiene el estado logico de cancelacion de un cliente.
 *
 * Si no existe registro devuelve un estado logico con count 0 (sin persistir).
 * Si existe y el periodo expiro (`period_started_at + reset_days < now`), la
 * vista refleja el reinicio logico (count 0, period_started_at = now) aunque no
 * se persista hasta un `registerCancellation`.
 */
async function getState(
  tenantId: string,
  customerId: string,
  db: Db = prisma
): Promise<CustomerCancellationView> {
  const now = new Date();
  const record = await db.customerCancellationState.findUnique({
    where: { tenant_id_customer_id: { tenant_id: tenantId, customer_id: customerId } },
  });

  if (!record) {
    return {
      tenant_id: tenantId,
      customer_id: customerId,
      count: 0,
      debt_amount: 0,
      debt_reason: null,
      period_started_at: now,
    };
  }

  const policy = await getPolicy(tenantId, db);
  if (isPeriodExpired(record.period_started_at, policy.reset_days, now)) {
    return {
      tenant_id: tenantId,
      customer_id: customerId,
      count: 0,
      debt_amount: Number(record.debt_amount),
      debt_reason: record.debt_reason,
      period_started_at: now,
    };
  }

  return {
    tenant_id: tenantId,
    customer_id: customerId,
    count: record.count,
    debt_amount: Number(record.debt_amount),
    debt_reason: record.debt_reason,
    period_started_at: record.period_started_at,
  };
}

/**
 * Registra una cancelacion para el cliente.
 *
 * Aplica reinicio de periodo si corresponde, incrementa el contador en 1 y, si
 * el contador supera `allowed_cancellations`, agrega `penalty_amount` a la deuda
 * y fija la razon de deuda. Persiste con upsert por [tenant_id, customer_id].
 *
 * Acepta opcionalmente un cliente de transaccion `tx` para poder ejecutarse
 * dentro de la transaccion de cancelacion de la cita; si no se provee usa prisma.
 */
async function registerCancellation(
  tenantId: string,
  customerId: string,
  tx?: Prisma.TransactionClient
): Promise<CustomerCancellationView> {
  const db: Db = tx ?? prisma;
  const now = new Date();

  const policy = await getPolicy(tenantId, db);
  const record = await db.customerCancellationState.findUnique({
    where: { tenant_id_customer_id: { tenant_id: tenantId, customer_id: customerId } },
  });

  // Estado base tras aplicar reinicio logico de periodo si corresponde.
  let baseCount = 0;
  let baseDebt = 0;
  let baseReason: string | null = null;
  let periodStartedAt = now;

  if (record) {
    baseDebt = Number(record.debt_amount);
    baseReason = record.debt_reason;
    if (isPeriodExpired(record.period_started_at, policy.reset_days, now)) {
      baseCount = 0;
      periodStartedAt = now;
    } else {
      baseCount = record.count;
      periodStartedAt = record.period_started_at;
    }
  }

  const nextCount = baseCount + 1;
  let debtAmount = baseDebt;
  let debtReason = baseReason;

  if (nextCount > policy.allowed_cancellations) {
    debtAmount = baseDebt + policy.penalty_amount;
    debtReason = DEBT_REASON_PENALTY;
  }

  const saved = await db.customerCancellationState.upsert({
    where: { tenant_id_customer_id: { tenant_id: tenantId, customer_id: customerId } },
    create: {
      tenant_id: tenantId,
      customer_id: customerId,
      count: nextCount,
      period_started_at: periodStartedAt,
      debt_amount: debtAmount,
      debt_reason: debtReason,
    },
    update: {
      count: nextCount,
      period_started_at: periodStartedAt,
      debt_amount: debtAmount,
      debt_reason: debtReason,
    },
  });

  return {
    tenant_id: tenantId,
    customer_id: customerId,
    count: saved.count,
    debt_amount: Number(saved.debt_amount),
    debt_reason: saved.debt_reason,
    period_started_at: saved.period_started_at,
  };
}

/**
 * Indica si el cliente tiene deuda pendiente (debt_amount > 0).
 */
async function hasDebt(tenantId: string, customerId: string, db: Db = prisma): Promise<boolean> {
  const state = await getState(tenantId, customerId, db);
  return state.debt_amount > 0;
}

/**
 * Confirma el pago de la penalizacion: pone la deuda en 0 y limpia la razon.
 * Solo tiene efecto si existe un registro; si no existe, devuelve el estado
 * logico (sin deuda) sin crear registro.
 */
async function confirmPayment(
  tenantId: string,
  customerId: string,
  tx?: Prisma.TransactionClient
): Promise<CustomerCancellationView> {
  const db: Db = tx ?? prisma;

  const record = await db.customerCancellationState.findUnique({
    where: { tenant_id_customer_id: { tenant_id: tenantId, customer_id: customerId } },
  });

  if (!record) {
    // Nada que pagar: no persiste, devuelve estado logico sin deuda.
    return getState(tenantId, customerId, db);
  }

  const saved = await db.customerCancellationState.update({
    where: { tenant_id_customer_id: { tenant_id: tenantId, customer_id: customerId } },
    data: { debt_amount: 0, debt_reason: null },
  });

  return {
    tenant_id: tenantId,
    customer_id: customerId,
    count: saved.count,
    debt_amount: Number(saved.debt_amount),
    debt_reason: saved.debt_reason,
    period_started_at: saved.period_started_at,
  };
}

export const customerCancellationService = {
  getState,
  registerCancellation,
  hasDebt,
  confirmPayment,
};

// Re-export para conveniencia de importadores que prefieran funciones sueltas.
export { getState, registerCancellation, hasDebt, confirmPayment };

// `HttpError` se reexporta implicitamente via su uso; se mantiene el import
// disponible para futuras validaciones que lancen errores HTTP.
void HttpError;
