import {
  AuditAction,
  LoyaltyProgram,
  LoyaltyProgramType,
  LoyaltyReward,
  LoyaltyRewardStatus,
  NotificationChannel,
  NotificationStatus,
  Prisma,
} from '@prisma/client';
import pino from 'pino';
import { randomInt } from 'crypto';
import { prisma } from '../database/prisma.service';
import { writeAudit } from '../utils/audit';
import { HttpError } from '../utils/errors';
import { BOOKING_CODE_ALPHABET } from '../utils/bookingCode';

const logger = pino();

/**
 * Minimal shape of the appointment payload the loyalty engine needs. The
 * caller (the appointment status-change hook) is responsible for only invoking
 * `onAppointmentCompleted` when an appointment actually transitions INTO the
 * COMPLETED state, so the engine treats every call as a completed appointment
 * (Requirements 2.1, 2.3). It never re-reads or trusts an arbitrary status.
 */
export interface LoyaltyAppointmentEvent {
  /** The appointment id. */
  id: string;
  /** The tenant (business) the appointment belongs to. */
  tenant_id: string;
  /** The customer that attended the appointment. */
  customer_id: string | null | undefined;
}

/**
 * Public view of a loyalty reward returned by the service. Dates are kept as
 * `Date | null` to match the surrounding engine style (the API layer, Task 6,
 * is responsible for any serialization).
 */
export interface LoyaltyRewardView {
  id: string;
  tenant_id: string;
  program_id: string;
  customer_id: string;
  status: LoyaltyRewardStatus;
  reward_text: string;
  earned_at: Date;
  expires_at: Date | null;
  redeemed_at: Date | null;
  redeemed_by: string | null;
  /** Codigo de reclamo (legible) generado cuando la recompensa pasa a CLAIMED. */
  claim_code: string | null;
  /** Momento en que el cliente reclamo la recompensa (paso a CLAIMED). */
  claimed_at: Date | null;
}

/** Filters accepted by `listRewards`. */
export interface ListRewardsFilter {
  status?: LoyaltyRewardStatus;
  customerId?: string;
}

/** Progress entry returned by `progressForCustomer`, one per active program. */
export interface LoyaltyProgressView {
  program: {
    id: string;
    name: string;
    type: LoyaltyProgramType;
    goal: number;
    window_days: number | null;
    reward_text: string;
  };
  count: number;
}

/** Prisma "unique constraint failed" error code. */
const PRISMA_UNIQUE_VIOLATION = 'P2002';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns true when the given error is a Prisma unique-constraint violation
 * (P2002). Used to make the counted-appointment insert idempotent.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === PRISMA_UNIQUE_VIOLATION
  );
}

/**
 * Computes the reward expiration date for a program. When `validity_days` is a
 * positive integer the reward expires at `now + validity_days`; otherwise the
 * reward never expires (null) (Requirements 3.3, 3.4).
 */
function computeExpiresAt(program: LoyaltyProgram, now: Date): Date | null {
  if (program.validity_days && program.validity_days > 0) {
    return new Date(now.getTime() + program.validity_days * DAY_MS);
  }
  return null;
}

/** Maps a Prisma LoyaltyReward record to the public reward view. */
function toRewardView(record: LoyaltyReward): LoyaltyRewardView {
  return {
    id: record.id,
    tenant_id: record.tenant_id,
    program_id: record.program_id,
    customer_id: record.customer_id,
    status: record.status,
    reward_text: record.reward_text,
    earned_at: record.earned_at,
    expires_at: record.expires_at ?? null,
    redeemed_at: record.redeemed_at ?? null,
    redeemed_by: record.redeemed_by ?? null,
    claim_code: record.claim_code ?? null,
    claimed_at: record.claimed_at ?? null,
  };
}

/**
 * True when a reward is past its expiration date relative to `now`. Rewards
 * with a null `expires_at` never expire (Requirement 3.4).
 */
function isPastDue(reward: { expires_at: Date | null }, now: Date): boolean {
  return reward.expires_at != null && reward.expires_at.getTime() < now.getTime();
}

/** Longitud del codigo de reclamo de recompensa (legible, sin ambiguos). */
const CLAIM_CODE_LENGTH = 8;

/** Numero maximo de intentos para encontrar un claim_code unico. */
const CLAIM_CODE_MAX_ATTEMPTS = 10;

/**
 * Genera un codigo de reclamo legible de 8 caracteres tomados del alfabeto de
 * codigos de negocio (excluye caracteres ambiguos como O/0/I/1). Usa
 * `crypto.randomInt` para aleatoriedad de calidad.
 */
function generateClaimCode(): string {
  let code = '';
  for (let i = 0; i < CLAIM_CODE_LENGTH; i++) {
    code += BOOKING_CODE_ALPHABET[randomInt(BOOKING_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Genera un `claim_code` unico verificando contra `LoyaltyReward.claim_code`
 * (columna @unique). Reintenta ante colision hasta `CLAIM_CODE_MAX_ATTEMPTS`.
 *
 * @throws HttpError 500 si no logra un codigo libre tras el limite de intentos.
 */
async function generateUniqueClaimCode(): Promise<string> {
  for (let attempt = 0; attempt < CLAIM_CODE_MAX_ATTEMPTS; attempt++) {
    const code = generateClaimCode();
    const existing = await prisma.loyaltyReward.findUnique({
      where: { claim_code: code },
    });
    if (!existing) {
      return code;
    }
  }
  throw new HttpError(
    'No se pudo generar un codigo de reclamo unico',
    500,
    'CLAIM_CODE_GENERATION_FAILED'
  );
}

/**
 * Best-effort notification on reward grant. Never throws: a notification
 * failure must not roll back or block the loyalty flow (Requirement 3.5).
 */
async function notifyReward(params: {
  tenant_id: string;
  customer_id: string;
  reward_text: string;
}): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        tenant_id: params.tenant_id,
        customer_id: params.customer_id,
        channel: NotificationChannel.PUSH,
        status: NotificationStatus.PENDING,
        title: 'Recompensa ganada',
        body: `Has ganado una recompensa: ${params.reward_text}`,
      },
    });
  } catch (error) {
    logger.error({ err: error, ...params }, 'Failed to send loyalty reward notification');
  }
}

export const loyaltyService = {
  /**
   * Loyalty engine entry point. Invoked (from the appointment status hook) when
   * an appointment transitions INTO the COMPLETED state.
   *
   * For each ACTIVE loyalty program of the appointment's tenant, in its own
   * transaction:
   *  1. Insert a `LoyaltyCountedAppointment (program_id, appointment_id)`. The
   *     unique (program_id, appointment_id) constraint makes this idempotent:
   *     reprocessing the same appointment inserts nothing and grants nothing
   *     (Requirements 2.5, 3.6, 8.2).
   *  2. Increment `LoyaltyProgress` (upsert on unique [program_id, customer_id]).
   *  3. Evaluate the goal by program type:
   *     - ACCUMULATION: when `count >= goal`, create one `LoyaltyReward(EARNED)`
   *       and decrement the stored count by `goal` (Requirements 3.1, 3.2).
   *     - PERIODIC: count only `LoyaltyCountedAppointment` rows with
   *       `counted_at >= now - window_days`; when that windowed count reaches
   *       `goal` and there is no still-valid EARNED reward from the current
   *       cycle, grant one (Requirements 2.6, 3.1, 7 — window).
   *
   * Accumulation is per-tenant: any branch of the business feeds the same
   * progress (Requirement 2.2). A grant sets `expires_at` when the program has
   * `validity_days`, writes an audit entry, and fires a best-effort
   * notification (Requirements 3.3, 3.4, 3.5, 8.1).
   */
  async onAppointmentCompleted(appointment: LoyaltyAppointmentEvent): Promise<void> {
    const { id: appointmentId, tenant_id: tenantId, customer_id: customerId } = appointment;

    // Without a customer we cannot attribute progress; nothing to do.
    if (!customerId) {
      return;
    }

    const programs = await prisma.loyaltyProgram.findMany({
      where: { tenant_id: tenantId, is_active: true },
    });

    for (const program of programs) {
      await this.applyProgram(program, appointmentId, customerId);
    }
  },

  /**
   * Applies a single program to a single completed appointment inside one
   * transaction. Extracted so each program is isolated: a failure evaluating
   * one program does not corrupt another. Idempotency is enforced by the
   * counted-appointment unique constraint.
   */
  async applyProgram(
    program: LoyaltyProgram,
    appointmentId: string,
    customerId: string
  ): Promise<void> {
    const now = new Date();

    const granted = await prisma.$transaction(async (tx) => {
      // 1. Idempotent count: attempt to record this appointment for the
      //    program. A unique violation means it was already counted -> skip.
      try {
        await tx.loyaltyCountedAppointment.create({
          data: {
            program_id: program.id,
            appointment_id: appointmentId,
            customer_id: customerId,
            counted_at: now,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          // Already counted for this program: fully idempotent, no grant.
          return null;
        }
        throw error;
      }

      // 2. Increment progress (upsert on unique [program_id, customer_id]).
      const progress = await tx.loyaltyProgress.upsert({
        where: {
          program_id_customer_id: {
            program_id: program.id,
            customer_id: customerId,
          },
        },
        create: {
          tenant_id: program.tenant_id,
          program_id: program.id,
          customer_id: customerId,
          count: 1,
        },
        update: {
          count: { increment: 1 },
        },
      });

      // 3. Evaluate the goal by program type.
      if (program.type === LoyaltyProgramType.ACCUMULATION) {
        if (progress.count >= program.goal) {
          // Cross the goal: grant exactly one reward and reset by `goal`.
          await tx.loyaltyProgress.update({
            where: {
              program_id_customer_id: {
                program_id: program.id,
                customer_id: customerId,
              },
            },
            data: { count: { decrement: program.goal } },
          });

          const reward = await tx.loyaltyReward.create({
            data: {
              tenant_id: program.tenant_id,
              program_id: program.id,
              customer_id: customerId,
              status: LoyaltyRewardStatus.EARNED,
              reward_text: program.reward_text,
              earned_at: now,
              expires_at: computeExpiresAt(program, now),
            },
          });
          return reward;
        }
        return null;
      }

      // PERIODIC: only appointments inside the current window count.
      const windowDays = program.window_days ?? 0;
      const windowStart = new Date(now.getTime() - windowDays * DAY_MS);

      const windowedCount = await tx.loyaltyCountedAppointment.count({
        where: {
          program_id: program.id,
          customer_id: customerId,
          counted_at: { gte: windowStart },
        },
      });

      if (windowedCount < program.goal) {
        return null;
      }

      // Do not duplicate a grant for the current cycle: skip if there is
      // already a still-valid EARNED reward earned within this window.
      const existingReward = await tx.loyaltyReward.findFirst({
        where: {
          program_id: program.id,
          customer_id: customerId,
          status: LoyaltyRewardStatus.EARNED,
          earned_at: { gte: windowStart },
        },
      });
      if (existingReward) {
        return null;
      }

      const reward = await tx.loyaltyReward.create({
        data: {
          tenant_id: program.tenant_id,
          program_id: program.id,
          customer_id: customerId,
          status: LoyaltyRewardStatus.EARNED,
          reward_text: program.reward_text,
          earned_at: now,
          expires_at: computeExpiresAt(program, now),
        },
      });
      return reward;
    });

    // Side effects on grant happen outside the transaction so audit and
    // notification failures never roll back the count/grant (Requirement 8.1).
    if (granted) {
      await writeAudit({
        tenant_id: program.tenant_id,
        action: AuditAction.CREATE,
        resource_type: 'loyalty_reward',
        resource_id: granted.id,
        details: `Reward granted for program ${program.id}, customer ${customerId}`,
      });

      await notifyReward({
        tenant_id: program.tenant_id,
        customer_id: customerId,
        reward_text: program.reward_text,
      });
    }
  },

  /**
   * Reversal entry point: invoked when an appointment leaves the COMPLETED
   * state. The full reversal logic and its tests are Task 4; this minimal,
   * correct implementation removes the counted-appointment rows for the
   * appointment and decrements the affected progress counters so no orphan
   * counts remain. It never lets the count go below zero and does not revoke
   * already-earned rewards.
   */
  async onAppointmentUncompleted(appointment: LoyaltyAppointmentEvent): Promise<void> {
    const { id: appointmentId, customer_id: customerId } = appointment;
    if (!customerId) {
      return;
    }

    const counted = await prisma.loyaltyCountedAppointment.findMany({
      where: { appointment_id: appointmentId, customer_id: customerId },
    });

    for (const row of counted) {
      await prisma.$transaction(async (tx) => {
        await tx.loyaltyCountedAppointment.delete({ where: { id: row.id } });

        const progress = await tx.loyaltyProgress.findUnique({
          where: {
            program_id_customer_id: {
              program_id: row.program_id,
              customer_id: customerId,
            },
          },
        });

        if (progress && progress.count > 0) {
          await tx.loyaltyProgress.update({
            where: {
              program_id_customer_id: {
                program_id: row.program_id,
                customer_id: customerId,
              },
            },
            data: { count: { decrement: 1 } },
          });
        }
      });
    }
  },

  /**
   * Redeems (marks REDEEMED) an EARNED reward on behalf of the business.
   *
   * The reward is loaded scoped by tenant so a reward from another tenant is
   * indistinguishable from a missing one (Requirement 4.5): both return 404.
   *
   * State machine (Requirements 4.2, 4.3):
   *  - not found (or other tenant)         -> 404 REWARD_NOT_FOUND
   *  - already REDEEMED                    -> 409 REWARD_ALREADY_REDEEMED
   *  - EXPIRED, or EARNED-but-past-due     -> 400 REWARD_EXPIRED
   *      (an EARNED-but-past-due reward is lazily flipped to EXPIRED as a side
   *       effect so the store reflects reality)
   *  - EARNED and not past due             -> status=REDEEMED, redeemed_at=now,
   *                                           redeemed_by=userId; audited.
   */
  /**
   * Reclamo de recompensa por parte del CLIENTE (Requirements 2.1, 2.2, 2.4,
   * 2.5). El cliente reclama una recompensa EARNED: se genera un `claim_code`
   * legible y unico y la recompensa pasa a CLAIMED con `claimed_at`. El negocio
   * confirma luego el canje via `redeem`.
   *
   * La recompensa se carga acotada por tenant y cliente, de modo que una
   * recompensa de otro cliente o de otro tenant es indistinguible de una
   * inexistente (Requirement 2.5): ambas devuelven 404.
   *
   * Maquina de estados:
   *  - no encontrada (otro cliente/tenant) -> 404 REWARD_NOT_FOUND
   *  - REDEEMED                            -> 409 REWARD_ALREADY_REDEEMED
   *  - EXPIRED, o EARNED-pero-vencida      -> 400 REWARD_EXPIRED
   *      (la EARNED vencida se marca perezosamente como EXPIRED antes de fallar)
   *  - CLAIMED ya                          -> idempotente: devuelve la recompensa
   *      tal cual (con su claim_code existente), SIN regenerar el codigo.
   *  - EARNED y no vencida                 -> genera claim_code, status=CLAIMED,
   *      claimed_at=now; auditado.
   */
  async claim(
    tenantId: string,
    rewardId: string,
    customerId: string
  ): Promise<LoyaltyRewardView> {
    const now = new Date();

    const reward = await prisma.loyaltyReward.findFirst({
      where: { id: rewardId, tenant_id: tenantId, customer_id: customerId },
    });

    if (!reward) {
      throw new HttpError('Recompensa no encontrada', 404, 'REWARD_NOT_FOUND');
    }

    if (reward.status === LoyaltyRewardStatus.REDEEMED) {
      throw new HttpError(
        'La recompensa ya fue canjeada',
        409,
        'REWARD_ALREADY_REDEEMED'
      );
    }

    if (reward.status === LoyaltyRewardStatus.EXPIRED) {
      throw new HttpError('La recompensa esta expirada', 400, 'REWARD_EXPIRED');
    }

    // Ya reclamada: idempotente. Devuelve la recompensa tal cual (con su
    // claim_code actual) sin regenerar el codigo ni volver a auditar.
    if (reward.status === LoyaltyRewardStatus.CLAIMED) {
      return toRewardView(reward);
    }

    // status === EARNED de aqui en adelante.
    if (isPastDue(reward, now)) {
      // Refleja la realidad de forma perezosa: marca EXPIRED (best-effort).
      try {
        await prisma.loyaltyReward.update({
          where: { id: reward.id },
          data: { status: LoyaltyRewardStatus.EXPIRED },
        });
      } catch (error) {
        logger.error({ err: error, rewardId }, 'Failed to lazily expire reward on claim');
      }
      throw new HttpError('La recompensa esta expirada', 400, 'REWARD_EXPIRED');
    }

    const claimCode = await generateUniqueClaimCode();

    const updated = await prisma.loyaltyReward.update({
      where: { id: reward.id },
      data: {
        status: LoyaltyRewardStatus.CLAIMED,
        claim_code: claimCode,
        claimed_at: now,
      },
    });

    await writeAudit({
      tenant_id: tenantId,
      action: AuditAction.UPDATE,
      resource_type: 'loyalty_reward',
      resource_id: updated.id,
      details: JSON.stringify({ claimed: true, customer_id: updated.customer_id }),
    });

    return toRewardView(updated);
  },

  /**
   * Canje (marca REDEEMED) de una recompensa a cargo del NEGOCIO.
   *
   * La recompensa se carga acotada por tenant, de modo que una recompensa de
   * otro tenant es indistinguible de una inexistente (Requirement 2.5): ambas
   * devuelven 404.
   *
   * Maquina de estados (Requirements 2.3, 2.4):
   *  - no encontrada (otro tenant)         -> 404 REWARD_NOT_FOUND
   *  - REDEEMED                            -> 409 REWARD_ALREADY_REDEEMED
   *  - EXPIRED, o EARNED-pero-vencida      -> 400 REWARD_EXPIRED
   *      (la EARNED vencida se marca perezosamente como EXPIRED antes de fallar)
   *  - EARNED (no vencida) o CLAIMED       -> status=REDEEMED, redeemed_at=now,
   *      redeemed_by=userId; auditado.
   *
   * Cuando se recibe `claimCode` y la recompensa tiene un `claim_code`, ambos
   * deben coincidir; en caso contrario se rechaza con 400 INVALID_CLAIM_CODE.
   * Si no se envia `claimCode`, el negocio canjea validando visualmente y no se
   * verifica el codigo (parametro opcional para no romper llamadas existentes).
   */
  async redeem(
    tenantId: string,
    rewardId: string,
    userId: string,
    claimCode?: string
  ): Promise<LoyaltyRewardView> {
    const now = new Date();

    const reward = await prisma.loyaltyReward.findFirst({
      where: { id: rewardId, tenant_id: tenantId },
    });

    if (!reward) {
      throw new HttpError('Recompensa no encontrada', 404, 'REWARD_NOT_FOUND');
    }

    if (reward.status === LoyaltyRewardStatus.REDEEMED) {
      throw new HttpError(
        'La recompensa ya fue canjeada',
        409,
        'REWARD_ALREADY_REDEEMED'
      );
    }

    if (reward.status === LoyaltyRewardStatus.EXPIRED) {
      throw new HttpError('La recompensa esta expirada', 400, 'REWARD_EXPIRED');
    }

    // Solo una recompensa EARNED puede estar vencida por el sweep; una CLAIMED
    // se considera canjeable salvo estados terminales (REDEEMED/EXPIRED).
    if (reward.status === LoyaltyRewardStatus.EARNED && isPastDue(reward, now)) {
      // Refleja la realidad de forma perezosa: marca EXPIRED (best-effort).
      try {
        await prisma.loyaltyReward.update({
          where: { id: reward.id },
          data: { status: LoyaltyRewardStatus.EXPIRED },
        });
      } catch (error) {
        logger.error({ err: error, rewardId }, 'Failed to lazily expire reward on redeem');
      }
      throw new HttpError('La recompensa esta expirada', 400, 'REWARD_EXPIRED');
    }

    // Validacion opcional del codigo de reclamo: si el negocio lo envia y la
    // recompensa tiene uno asignado, deben coincidir exactamente.
    if (claimCode != null && reward.claim_code != null && reward.claim_code !== claimCode) {
      throw new HttpError('Codigo de reclamo invalido', 400, 'INVALID_CLAIM_CODE');
    }

    // status === EARNED (no vencida) o CLAIMED de aqui en adelante: canjeable.
    const updated = await prisma.loyaltyReward.update({
      where: { id: reward.id },
      data: {
        status: LoyaltyRewardStatus.REDEEMED,
        redeemed_at: now,
        redeemed_by: userId,
      },
    });

    await writeAudit({
      tenant_id: tenantId,
      user_id: userId,
      action: AuditAction.UPDATE,
      resource_type: 'loyalty_reward',
      resource_id: updated.id,
      details: JSON.stringify({ redeemed: true, customer_id: updated.customer_id }),
    });

    return toRewardView(updated);
  },

  /**
   * Bulk-expires overdue rewards: sets status=EXPIRED for every reward that is
   * currently EARNED and has a non-null `expires_at` strictly in the past
   * (Requirement 4.4). When `tenantId` is provided the sweep is scoped to that
   * tenant; otherwise it runs globally (e.g. for a scheduled job).
   *
   * Returns the number of rewards updated.
   */
  async expireDue(tenantId?: string): Promise<number> {
    const now = new Date();

    const where: Prisma.LoyaltyRewardWhereInput = {
      status: LoyaltyRewardStatus.EARNED,
      expires_at: { not: null, lt: now },
    };
    if (tenantId) {
      where.tenant_id = tenantId;
    }

    const result = await prisma.loyaltyReward.updateMany({
      where,
      data: { status: LoyaltyRewardStatus.EXPIRED },
    });

    return result.count;
  },

  /**
   * Lists a tenant's rewards, optionally filtered by status and/or customer,
   * ordered by `earned_at` descending.
   *
   * Applies LAZY expiration first: any EARNED-but-past-due reward is flipped to
   * EXPIRED so the returned list reflects reality (Requirement 4.4). The lazy
   * sweep is best-effort and never throws — if it fails, the list is still
   * returned from fresh data.
   */
  async listRewards(
    tenantId: string,
    filter: ListRewardsFilter = {}
  ): Promise<LoyaltyRewardView[]> {
    // Best-effort lazy expiration; never let a sweep failure break the read.
    try {
      await this.expireDue(tenantId);
    } catch (error) {
      logger.error({ err: error, tenantId }, 'Lazy reward expiration failed');
    }

    const where: Prisma.LoyaltyRewardWhereInput = { tenant_id: tenantId };
    if (filter.status) {
      where.status = filter.status;
    }
    if (filter.customerId) {
      where.customer_id = filter.customerId;
    }

    const records = await prisma.loyaltyReward.findMany({
      where,
      orderBy: { earned_at: 'desc' },
    });

    return records.map(toRewardView);
  },

  /**
   * Returns the customer's progress for each ACTIVE program of the tenant. When
   * a customer has no progress row for a program, its count defaults to 0
   * (Requirement 5.1). Used by the client-facing endpoint (Task 6).
   */
  async progressForCustomer(
    tenantId: string,
    customerId: string
  ): Promise<LoyaltyProgressView[]> {
    const programs = await prisma.loyaltyProgram.findMany({
      where: { tenant_id: tenantId, is_active: true },
      orderBy: { created_at: 'desc' },
    });

    if (programs.length === 0) {
      return [];
    }

    const progressRows = await prisma.loyaltyProgress.findMany({
      where: {
        tenant_id: tenantId,
        customer_id: customerId,
        program_id: { in: programs.map((p) => p.id) },
      },
    });

    const countByProgram = new Map<string, number>();
    for (const row of progressRows) {
      countByProgram.set(row.program_id, row.count);
    }

    return programs.map((program) => ({
      program: {
        id: program.id,
        name: program.name,
        type: program.type,
        goal: program.goal,
        window_days: program.window_days ?? null,
        reward_text: program.reward_text,
      },
      count: countByProgram.get(program.id) ?? 0,
    }));
  },

  /**
   * Small loyalty metrics for a single tenant (Requirement 6.2). Runs a
   * best-effort lazy expiration first so pending/earned counts reflect reality,
   * then returns:
   *  - activePrograms: count of active programs for the tenant
   *  - rewardsEarned / rewardsRedeemed / rewardsPending: reward counts by status
   *    (pending == EARNED, i.e. earned-but-not-yet-redeemed)
   * All counts are scoped by `tenant_id` (Requirements 7.2, 8.4).
   */
  async statsForTenant(tenantId: string): Promise<{
    activePrograms: number;
    rewardsEarned: number;
    rewardsRedeemed: number;
    rewardsPending: number;
    rewardsExpired: number;
  }> {
    try {
      await this.expireDue(tenantId);
    } catch (error) {
      logger.error({ err: error, tenantId }, 'Lazy reward expiration failed in statsForTenant');
    }

    const [activePrograms, rewardsEarned, rewardsRedeemed, rewardsExpired] = await Promise.all([
      prisma.loyaltyProgram.count({ where: { tenant_id: tenantId, is_active: true } }),
      prisma.loyaltyReward.count({
        where: { tenant_id: tenantId, status: LoyaltyRewardStatus.EARNED },
      }),
      prisma.loyaltyReward.count({
        where: { tenant_id: tenantId, status: LoyaltyRewardStatus.REDEEMED },
      }),
      prisma.loyaltyReward.count({
        where: { tenant_id: tenantId, status: LoyaltyRewardStatus.EXPIRED },
      }),
    ]);

    return {
      activePrograms,
      rewardsEarned,
      rewardsRedeemed,
      // "Pending por canjear" are the EARNED (not yet redeemed) rewards.
      rewardsPending: rewardsEarned,
      rewardsExpired,
    };
  },

  /**
   * Global loyalty aggregates for the super admin (Requirement 7.4), computed
   * WITHOUT any tenant filter:
   *  - totalPrograms / activePrograms
   *  - rewardsEarned / rewardsRedeemed / rewardsExpired (rewards by status)
   *  - totalRewards
   */
  async globalStats(): Promise<{
    totalPrograms: number;
    activePrograms: number;
    totalRewards: number;
    rewardsEarned: number;
    rewardsRedeemed: number;
    rewardsExpired: number;
  }> {
    const [
      totalPrograms,
      activePrograms,
      totalRewards,
      rewardsEarned,
      rewardsRedeemed,
      rewardsExpired,
    ] = await Promise.all([
      prisma.loyaltyProgram.count(),
      prisma.loyaltyProgram.count({ where: { is_active: true } }),
      prisma.loyaltyReward.count(),
      prisma.loyaltyReward.count({ where: { status: LoyaltyRewardStatus.EARNED } }),
      prisma.loyaltyReward.count({ where: { status: LoyaltyRewardStatus.REDEEMED } }),
      prisma.loyaltyReward.count({ where: { status: LoyaltyRewardStatus.EXPIRED } }),
    ]);

    return {
      totalPrograms,
      activePrograms,
      totalRewards,
      rewardsEarned,
      rewardsRedeemed,
      rewardsExpired,
    };
  },
};
