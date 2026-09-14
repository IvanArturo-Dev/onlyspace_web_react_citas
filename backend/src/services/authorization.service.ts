import { randomBytes } from 'crypto';
import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';
import {
  assignUniqueBookingCode,
  assignUniqueBranchCode,
  normalizeBookingCode,
} from '../utils/bookingCode';

/**
 * Vista publica de un administrador autorizado. Incluye el `booking_code` del
 * tenant asociado (resuelto por separado, ya que `AuthorizedAdmin` no tiene una
 * relacion Prisma directa con `Tenant`).
 */
export interface AuthorizedAdminView {
  id: string;
  email: string;
  status: string;
  tenant_id: string | null;
  booking_code: string | null;
  created_at: string;
}

/** Estados validos para un administrador autorizado. */
const VALID_STATUSES = ['active', 'revoked'] as const;
type AuthorizedAdminStatus = (typeof VALID_STATUSES)[number];

/**
 * Normaliza un email a minusculas y sin espacios alrededor, para que la
 * whitelist sea insensible a mayusculas/minusculas.
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Deriva un nombre de negocio a partir del email (la parte antes de la @).
 */
function deriveTenantName(email: string): string {
  const local = email.split('@')[0] || 'negocio';
  return local;
}

/**
 * Genera un subdominio unico para un tenant nuevo. `subdomain` es @unique y
 * requerido, por lo que se construye con un prefijo estable mas una parte
 * aleatoria en minusculas. Se reintenta ante colision.
 */
async function generateUniqueSubdomain(client = prisma): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const suffix = randomBytes(6).toString('hex'); // 12 chars hex, minusculas
    const subdomain = `biz-${suffix}`;
    const existing = await client.tenant.findUnique({ where: { subdomain } });
    if (!existing) {
      return subdomain;
    }
  }
  throw new HttpError(
    'No se pudo generar un subdominio unico',
    500,
    'SUBDOMAIN_GENERATION_FAILED'
  );
}

/**
 * Convierte un registro `AuthorizedAdmin` (mas su booking_code resuelto) a la
 * vista publica.
 */
function toView(
  record: {
    id: string;
    email: string;
    status: string;
    tenant_id: string | null;
    created_at: Date | string;
  },
  bookingCode: string | null
): AuthorizedAdminView {
  return {
    id: record.id,
    email: record.email,
    status: record.status,
    tenant_id: record.tenant_id ?? null,
    booking_code: bookingCode,
    created_at:
      record.created_at instanceof Date
        ? record.created_at.toISOString()
        : new Date(record.created_at).toISOString(),
  };
}

/**
 * Crea un tenant nuevo para un dueno de negocio, con `booking_code` unico,
 * `booking_enabled` true y un subdominio unico derivado.
 */
async function createTenantForOwner(email: string) {
  const [subdomain, bookingCode] = await Promise.all([
    generateUniqueSubdomain(),
    assignUniqueBookingCode(prisma),
  ]);

  // Prueba gratis: todo negocio nuevo arranca con 30 dias de PREMIUM. Al vencer,
  // isPremiumEffective lo trata como free automaticamente (subscription_status
  // 'active' + subscription_expires_at futuro). Los dias son configurables por
  // env (TRIAL_DAYS, default 30).
  const trialDays = Number.parseInt(process.env.TRIAL_DAYS || '30', 10);
  const trialExpiresAt = new Date(Date.now() + (Number.isFinite(trialDays) ? trialDays : 30) * 24 * 60 * 60 * 1000);

  return prisma.tenant.create({
    data: {
      name: deriveTenantName(email),
      subdomain,
      status: 'active',
      booking_enabled: true,
      booking_code: bookingCode,
      subscription_status: 'active',
      subscription_expires_at: trialExpiresAt,
    },
  });
}

/**
 * Resuelve el `booking_code` del tenant asociado a un registro (si tiene
 * tenant_id). Devuelve null si no hay tenant o no tiene codigo.
 */
async function resolveBookingCode(tenantId: string | null | undefined): Promise<string | null> {
  if (!tenantId) return null;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { booking_code: true },
  });
  return tenant?.booking_code ?? null;
}

/**
 * Asegura que un registro tenga un tenant con booking_code. Si ya tiene
 * tenant_id lo reutiliza; si el tenant existe pero no tiene booking_code, le
 * asigna uno. Devuelve el tenant_id y el booking_code resultantes.
 */
async function ensureTenantWithCode(
  email: string,
  tenantId: string | null | undefined
): Promise<{ tenantId: string; bookingCode: string }> {
  if (tenantId) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (tenant) {
      if (tenant.booking_code) {
        return { tenantId: tenant.id, bookingCode: tenant.booking_code };
      }
      const bookingCode = await assignUniqueBookingCode(prisma);
      const updated = await prisma.tenant.update({
        where: { id: tenant.id },
        data: { booking_code: bookingCode, booking_enabled: true },
      });
      return { tenantId: updated.id, bookingCode: updated.booking_code as string };
    }
  }

  // No tenant_id o el tenant referenciado ya no existe: crea uno nuevo.
  const created = await createTenantForOwner(email);
  return { tenantId: created.id, bookingCode: created.booking_code as string };
}

/**
 * Garantiza que un tenant tenga al menos una sucursal (`Branch`). Es
 * idempotente: si ya existe alguna sucursal para el tenant, no crea otra.
 * Si no hay ninguna, crea una sucursal "Principal" activa con su propio
 * `booking_code` unico.
 *
 * NOTA de consistencia con el backfill (tarea 1.1): la migracion creo una
 * Branch "Principal" heredando el booking_code del tenant. Para NUEVOS
 * emprendedores, la sucursal inicial tendra su PROPIO codigo nuevo (via
 * `assignUniqueBranchCode`), distinto del codigo del tenant. Esto es correcto
 * porque la resolucion publica ahora es por `Branch.booking_code` (tarea 7),
 * no por el codigo del tenant.
 */
async function ensureInitialBranch(tenantId: string): Promise<void> {
  const existing = await prisma.branch.findFirst({
    where: { tenant_id: tenantId },
  });
  if (existing) {
    return;
  }

  const bookingCode = await assignUniqueBranchCode(prisma);
  await prisma.branch.create({
    data: {
      tenant_id: tenantId,
      name: 'Principal',
      status: 'active',
      booking_code: bookingCode,
    },
  });
}

export const authorizationService = {
  /**
   * Lista todos los administradores autorizados con su email, status,
   * tenant_id, created_at y el booking_code del tenant asociado.
   */
  async list(): Promise<AuthorizedAdminView[]> {
    const records = await prisma.authorizedAdmin.findMany({
      orderBy: { created_at: 'desc' },
    });

    // Resuelve los booking_code de los tenants referenciados en un solo lote.
    const tenantIds = Array.from(
      new Set(records.map((r) => r.tenant_id).filter((id): id is string => !!id))
    );
    const tenants = tenantIds.length
      ? await prisma.tenant.findMany({
          where: { id: { in: tenantIds } },
          select: { id: true, booking_code: true },
        })
      : [];
    const codeByTenant = new Map(tenants.map((t) => [t.id, t.booking_code ?? null]));

    return records.map((r) =>
      toView(r, r.tenant_id ? codeByTenant.get(r.tenant_id) ?? null : null)
    );
  },

  /**
   * Autoriza un email como dueno de negocio (ADMIN). Idempotente:
   * - Si ya existe y esta 'active', lo devuelve tal cual.
   * - Si existe y esta 'revoked', lo reactiva y asegura tenant + booking_code.
   * - Si no existe, crea un tenant nuevo con booking_code y el registro activo.
   *
   * @param email Email del dueno (se normaliza a minusculas/trim).
   * @param superAdminId Id del super admin que autoriza (para `created_by`).
   */
  async authorize(email: string, superAdminId?: string): Promise<AuthorizedAdminView> {
    const normalized = normalizeEmail(email);

    const existing = await prisma.authorizedAdmin.findUnique({
      where: { email: normalized },
    });

    if (existing) {
      // Idempotente: garantizamos tenant + codigo en cualquier caso.
      const { tenantId, bookingCode } = await ensureTenantWithCode(
        normalized,
        existing.tenant_id
      );

      // Garantiza que el tenant (nuevo o reactivado) tenga sucursal inicial.
      await ensureInitialBranch(tenantId);

      const needsReactivation = existing.status !== 'active';
      const needsTenantUpdate = existing.tenant_id !== tenantId;

      if (needsReactivation || needsTenantUpdate) {
        const updated = await prisma.authorizedAdmin.update({
          where: { id: existing.id },
          data: {
            status: 'active',
            tenant_id: tenantId,
          },
        });
        return toView(updated, bookingCode);
      }

      return toView(existing, bookingCode);
    }

    // Nuevo dueno: crear tenant + booking_code y el registro autorizado.
    const tenant = await createTenantForOwner(normalized);

    // Garantiza la sucursal inicial ("Principal") para el tenant recien creado.
    await ensureInitialBranch(tenant.id);

    const created = await prisma.authorizedAdmin.create({
      data: {
        email: normalized,
        status: 'active',
        tenant_id: tenant.id,
        created_by: superAdminId ?? null,
      },
    });

    return toView(created, tenant.booking_code as string);
  },

  /**
   * Actualiza el status de un administrador autorizado.
   *
   * @throws HttpError 400 si `status` no es 'active' ni 'revoked'.
   */
  async setStatus(id: string, status: string): Promise<AuthorizedAdminView> {
    if (!VALID_STATUSES.includes(status as AuthorizedAdminStatus)) {
      throw new HttpError(
        `Status invalido: debe ser 'active' o 'revoked'`,
        400,
        'VALIDATION_ERROR'
      );
    }

    const updated = await prisma.authorizedAdmin.update({
      where: { id },
      data: { status },
    });

    const bookingCode = await resolveBookingCode(updated.tenant_id);
    return toView(updated, bookingCode);
  },
};

// Re-export para pruebas/uso externo del normalizador de codigo si se requiere.
export { normalizeBookingCode };
