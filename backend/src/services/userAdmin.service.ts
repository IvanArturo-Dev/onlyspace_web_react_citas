import { AuditAction } from '@prisma/client';
import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';
import { writeAudit } from '../utils/audit';
import { authorizationService } from './authorization.service';

/**
 * Vista de usuario para la administracion global del super admin.
 *
 * `role` es el ROL EFECTIVO del usuario, derivado de su email y de la whitelist
 * `AuthorizedAdmin` (NUNCA de `User.role_id`, que se ignora para el login):
 * - SUPERADMIN si el email coincide con SUPERADMIN_EMAIL.
 * - ADMIN si el email tiene un `AuthorizedAdmin` con status 'active'.
 * - ASSISTANT si el email tiene un `Assistant` con status 'active'.
 * - CLIENT en cualquier otro caso.
 */
export interface UserAdminView {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  last_seen: Date | null;
  tenant_id: string;
}

/** Tenant por defecto para SUPERADMIN y CLIENT. */
const DEFAULT_TENANT_ID = 'default';

/**
 * Roles que el super admin puede asignar por esta via. El sistema solo tiene
 * tres roles asignables por cambio de perfil: ADMIN (emprendedor) y CLIENT.
 * SUPERADMIN esta deliberadamente excluido: nunca se puede elevar a super admin
 * por cambio de perfil (Property 7); ese rol solo se asigna por el seed.
 */
const ASSIGNABLE_ROLES = ['ADMIN', 'CLIENT'] as const;

/** Normaliza un email a minusculas y sin espacios alrededor. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Email del super admin, configurable por entorno. */
function superAdminEmail(): string {
  return normalizeEmail(process.env.SUPERADMIN_EMAIL || 'xcode.arturo@gmail.com');
}

type UserRow = {
  id: string;
  name: string;
  email: string;
  is_active: boolean;
  last_seen: Date | null;
  tenant_id: string;
};

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  is_active: true,
  last_seen: true,
  tenant_id: true,
} as const;

/**
 * Calcula el rol efectivo de un email a partir de la whitelist y del email del
 * super admin. Recibe conjuntos precomputados de emails ADMIN/ASSISTANT activos
 * para poder mapear muchos usuarios sin N+1 consultas.
 */
function effectiveRole(
  email: string,
  activeAdminEmails: Set<string>,
  activeAssistantEmails: Set<string>
): string {
  const normalized = normalizeEmail(email);
  if (normalized === superAdminEmail()) return 'SUPERADMIN';
  if (activeAdminEmails.has(normalized)) return 'ADMIN';
  if (activeAssistantEmails.has(normalized)) return 'ASSISTANT';
  return 'CLIENT';
}

async function getUserOrThrow(userId: string): Promise<UserRow> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: USER_SELECT,
  });
  if (!user) {
    throw new HttpError('Usuario no encontrado', 404, 'USER_NOT_FOUND');
  }
  return user as UserRow;
}

export const userAdminService = {
  /**
   * Lista todos los usuarios (sin filtro de tenant; uso exclusivo del super
   * admin) con su ROL EFECTIVO, estado y ultima actividad. El rol se calcula
   * desde email + whitelist (AuthorizedAdmin/Assistant), no desde role_id.
   */
  async list(): Promise<UserAdminView[]> {
    const [users, activeAdmins, activeAssistants] = await Promise.all([
      prisma.user.findMany({
        select: USER_SELECT,
        orderBy: { created_at: 'desc' },
      }),
      prisma.authorizedAdmin.findMany({
        where: { status: 'active' },
        select: { email: true },
      }),
      prisma.assistant.findMany({
        where: { status: 'active' },
        select: { email: true },
      }),
    ]);

    const activeAdminEmails = new Set(
      activeAdmins.map((a) => normalizeEmail(a.email))
    );
    const activeAssistantEmails = new Set(
      activeAssistants.map((a) => normalizeEmail(a.email))
    );

    return (users as UserRow[]).map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: effectiveRole(user.email, activeAdminEmails, activeAssistantEmails),
      is_active: user.is_active,
      last_seen: user.last_seen ?? null,
      tenant_id: user.tenant_id,
    }));
  },

  /**
   * Bloquea o desbloquea un usuario. "Bloquear" (blocked=true) equivale a
   * is_active=false; desbloquear (blocked=false) equivale a is_active=true.
   * 404 USER_NOT_FOUND si el usuario no existe.
   */
  async setBlocked(userId: string, blocked: boolean): Promise<UserAdminView> {
    const current = await getUserOrThrow(userId);

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { is_active: !blocked },
      select: USER_SELECT,
    });

    await writeAudit({
      tenant_id: current.tenant_id,
      user_id: userId,
      action: AuditAction.UPDATE,
      resource_type: 'user',
      resource_id: userId,
      details: JSON.stringify({ blocked }),
    });

    return this.viewFor(updated as UserRow);
  },

  /**
   * Cambia el PERFIL EFECTIVO de un usuario. El rol efectivo NO vive en
   * `User.role_id` (que se ignora en el login), sino en la whitelist
   * `AuthorizedAdmin` + el email. Por tanto:
   *
   * - target 'ADMIN' (promocion a emprendedor): reautoriza el email via
   *   `authorizationService.authorize` (crea/activa el AuthorizedAdmin y su
   *   tenant + sucursal inicial de forma idempotente) y reconcilia
   *   `User.tenant_id` al tenant del emprendedor.
   * - target 'CLIENT' (degradacion): revoca el AuthorizedAdmin del email (si
   *   existe) y reconcilia `User.tenant_id` a 'default'. No borra datos.
   *
   * VALIDACIONES:
   * - 'SUPERADMIN' -> 403 FORBIDDEN_ROLE (nunca asignable, Property 7).
   * - Cambiar el rol del usuario SUPERADMIN configurado -> 403 FORBIDDEN_ROLE.
   * - Cualquier otro rol distinto de ADMIN/CLIENT -> 400 INVALID_ROLE.
   */
  async changeRole(
    userId: string,
    roleName: string,
    superAdminId?: string
  ): Promise<UserAdminView> {
    const normalized = String(roleName ?? '').trim().toUpperCase();

    // Nunca elevar a SUPERADMIN por esta via.
    if (normalized === 'SUPERADMIN') {
      throw new HttpError('No se permite asignar SUPERADMIN', 403, 'FORBIDDEN_ROLE');
    }

    if (!ASSIGNABLE_ROLES.includes(normalized as (typeof ASSIGNABLE_ROLES)[number])) {
      throw new HttpError('Rol no soportado', 400, 'INVALID_ROLE');
    }

    const current = await getUserOrThrow(userId);
    const email = normalizeEmail(current.email);

    // No se puede cambiar el rol del super admin configurado.
    if (email === superAdminEmail()) {
      throw new HttpError(
        'No se permite cambiar el rol del super admin',
        403,
        'FORBIDDEN_ROLE'
      );
    }

    let newTenantId = current.tenant_id;

    if (normalized === 'ADMIN') {
      // Promocion: activa/crea la autorizacion (tenant + sucursal inicial) y
      // fija el tenant del usuario al tenant del emprendedor.
      const authorized = await authorizationService.authorize(email, superAdminId);
      newTenantId = authorized.tenant_id ?? DEFAULT_TENANT_ID;
    } else {
      // Degradacion a CLIENT: revoca el AuthorizedAdmin si existe (no borra),
      // y devuelve el usuario al tenant por defecto.
      const existing = await prisma.authorizedAdmin.findUnique({
        where: { email },
      });
      if (existing && existing.status !== 'revoked') {
        await prisma.authorizedAdmin.update({
          where: { id: existing.id },
          data: { status: 'revoked' },
        });
      }
      newTenantId = DEFAULT_TENANT_ID;
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { tenant_id: newTenantId },
      select: USER_SELECT,
    });

    await writeAudit({
      tenant_id: newTenantId,
      user_id: userId,
      action: AuditAction.UPDATE,
      resource_type: 'user',
      resource_id: userId,
      details: JSON.stringify({ role: normalized }),
    });

    // El rol efectivo del usuario tras el cambio es exactamente el objetivo
    // (ADMIN o CLIENT); SUPERADMIN esta descartado arriba (Property 7).
    return {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: normalized,
      is_active: updated.is_active,
      last_seen: updated.last_seen ?? null,
      tenant_id: updated.tenant_id,
    };
  },

  /**
   * Construye una vista con el rol efectivo para un usuario ya cargado,
   * resolviendo su rol desde la whitelist en una consulta puntual.
   */
  async viewFor(user: UserRow): Promise<UserAdminView> {
    const email = normalizeEmail(user.email);
    let role = 'CLIENT';
    if (email === superAdminEmail()) {
      role = 'SUPERADMIN';
    } else {
      const [admin, assistant] = await Promise.all([
        prisma.authorizedAdmin.findUnique({ where: { email } }),
        prisma.assistant.findFirst({ where: { email, status: 'active' } }),
      ]);
      if (admin && admin.status === 'active') role = 'ADMIN';
      else if (assistant) role = 'ASSISTANT';
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role,
      is_active: user.is_active,
      last_seen: user.last_seen ?? null,
      tenant_id: user.tenant_id,
    };
  },
};
