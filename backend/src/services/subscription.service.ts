import { AuditAction } from '@prisma/client';
import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';
import { writeAudit } from '../utils/audit';

/**
 * Servicio de suscripcion premium administrada MANUALMENTE por el super admin.
 *
 * La suscripcion vive en el Tenant (`subscription_status` + opcional
 * `subscription_expires_at`). El estado EFECTIVO (premium) se deriva con
 * `isPremiumEffective`: un tenant es premium solo si su estado es 'active' y su
 * fecha de expiracion (si existe) aun no ha pasado. Un 'active' vencido cuenta
 * como inactivo (Requirement 2.3 / Property 1).
 */

/** Estados de suscripcion validos que el super admin puede fijar. */
const VALID_STATUSES = ['active', 'inactive'] as const;
type SubscriptionStatus = (typeof VALID_STATUSES)[number];

/** Forma minima de tenant necesaria para evaluar el premium efectivo. */
export interface PremiumTenant {
  subscription_status: string;
  subscription_expires_at: Date | null;
}

/** Vista publica de la suscripcion de un tenant. */
export interface SubscriptionView {
  status: string;
  expires_at: Date | null;
  is_premium: boolean;
}

/**
 * Determina si un tenant es PREMIUM EFECTIVO.
 *
 * Devuelve true SOLO si `subscription_status === 'active'` y
 * (`subscription_expires_at == null` o su timestamp es futuro respecto a ahora).
 * Un estado 'active' con fecha de expiracion pasada devuelve false.
 *
 * Es una funcion pura (sin efectos) para poder reutilizarla desde el endpoint
 * publico de info sin acoplarse al servicio.
 */
export function isPremiumEffective(tenant: PremiumTenant): boolean {
  if (tenant.subscription_status !== 'active') return false;
  const expiresAt = tenant.subscription_expires_at;
  if (expiresAt == null) return true;
  return expiresAt.getTime() > Date.now();
}

/** Normaliza un expires_at entrante (ISO string | Date | null | undefined). */
function normalizeExpiresAt(input: unknown): Date | null {
  if (input === null || input === undefined || input === '') return null;
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) {
      throw new HttpError('expires_at invalido', 400, 'VALIDATION_ERROR');
    }
    return input;
  }
  if (typeof input === 'string' || typeof input === 'number') {
    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime())) {
      throw new HttpError('expires_at invalido', 400, 'VALIDATION_ERROR');
    }
    return parsed;
  }
  throw new HttpError('expires_at invalido', 400, 'VALIDATION_ERROR');
}

const TENANT_SELECT = {
  subscription_status: true,
  subscription_expires_at: true,
} as const;

function toView(row: PremiumTenant): SubscriptionView {
  return {
    status: row.subscription_status,
    expires_at: row.subscription_expires_at ?? null,
    is_premium: isPremiumEffective(row),
  };
}

export const subscriptionService = {
  isPremiumEffective,

  /**
   * Devuelve el estado de suscripcion de un tenant, incluyendo el flag
   * `is_premium` (efectivo). 404 TENANT_NOT_FOUND si el tenant no existe.
   */
  async getForTenant(tenantId: string): Promise<SubscriptionView> {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: TENANT_SELECT,
    });
    if (!tenant) {
      throw new HttpError('Tenant no encontrado', 404, 'TENANT_NOT_FOUND');
    }
    return toView(tenant as PremiumTenant);
  },

  /**
   * Fija el estado de suscripcion de un tenant (solo el super admin llega aqui,
   * garantizado por el guard de ruta requireSuperAdmin — Property 3).
   *
   * - `status` debe ser 'active' | 'inactive' (else 400 VALIDATION_ERROR).
   * - `expires_at` es opcional: ISO string / Date / null (limpia la fecha).
   * - Persiste sobre el tenant y registra auditoria (UPDATE, resource 'tenant').
   * - 404 TENANT_NOT_FOUND si el tenant no existe.
   */
  async setSubscription(
    tenantId: string,
    input: { status: string; expires_at?: unknown },
    actingUserId?: string
  ): Promise<SubscriptionView> {
    const status = String(input?.status ?? '').trim().toLowerCase();
    if (!VALID_STATUSES.includes(status as SubscriptionStatus)) {
      throw new HttpError(
        "status debe ser 'active' o 'inactive'",
        400,
        'VALIDATION_ERROR'
      );
    }

    const expiresAt = normalizeExpiresAt(input?.expires_at);

    const existing = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!existing) {
      throw new HttpError('Tenant no encontrado', 404, 'TENANT_NOT_FOUND');
    }

    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        subscription_status: status,
        subscription_expires_at: expiresAt,
      },
      select: TENANT_SELECT,
    });

    await writeAudit({
      tenant_id: tenantId,
      user_id: actingUserId,
      action: AuditAction.UPDATE,
      resource_type: 'tenant',
      resource_id: tenantId,
      details: JSON.stringify({
        subscription_status: status,
        subscription_expires_at: expiresAt ? expiresAt.toISOString() : null,
      }),
    });

    return toView(updated as PremiumTenant);
  },
};
