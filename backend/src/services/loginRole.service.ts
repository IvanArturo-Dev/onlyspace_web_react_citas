import { prisma } from '../database/prisma.service';
import { authorizationService } from './authorization.service';

/**
 * Rol resuelto para un inicio de sesion, junto al tenant asociado.
 *
 * - SUPERADMIN / CLIENT usan el tenant 'default' (no atan al usuario a ningun
 *   negocio en concreto).
 * - ADMIN usa el tenant propio creado en su autorizacion.
 */
export interface ResolvedLoginRole {
  role: 'SUPERADMIN' | 'ADMIN' | 'ASSISTANT' | 'CLIENT';
  tenant_id: string;
}

/** Tenant por defecto para SUPERADMIN y CLIENT. */
const DEFAULT_TENANT_ID = 'default';

/**
 * Normaliza un email a minusculas y sin espacios alrededor, para que las
 * comparaciones (super admin y whitelist) sean insensibles a mayusculas.
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Email del super admin, configurable por entorno. */
function superAdminEmail(): string {
  return normalizeEmail(process.env.SUPERADMIN_EMAIL || 'xcode.arturo@gmail.com');
}

/**
 * Decide el rol de un usuario en el login segun su email. Esta es la unica via
 * de elevacion a ADMIN (Property 1): un usuario obtiene ADMIN si y solo si su
 * email esta en `AuthorizedAdmin` con status 'active' (o es el super admin).
 * Ningun dato del request puede forzar ADMIN.
 *
 * @param email Email verificado del usuario (se normaliza internamente).
 * @returns El rol resuelto y el tenant_id que debe usarse para el JWT/usuario.
 */
export async function resolveLoginRole(email: string): Promise<ResolvedLoginRole> {
  const normalized = normalizeEmail(email);

  // Super admin: se decide unicamente por email.
  if (normalized === superAdminEmail()) {
    return { role: 'SUPERADMIN', tenant_id: DEFAULT_TENANT_ID };
  }

  // Whitelist: solo un AuthorizedAdmin activo eleva a ADMIN.
  const authorized = await prisma.authorizedAdmin.findUnique({
    where: { email: normalized },
  });

  if (authorized && authorized.status === 'active') {
    if (authorized.tenant_id) {
      return { role: 'ADMIN', tenant_id: authorized.tenant_id };
    }

    // Caso borde: autorizado activo sin tenant asociado. Aseguramos su tenant +
    // booking_code reautorizando (idempotente) y usamos ese tenant_id.
    const view = await authorizationService.authorize(normalized);
    return {
      role: 'ADMIN',
      tenant_id: view.tenant_id ?? DEFAULT_TENANT_ID,
    };
  }

  // Asistente: un Assistant activo eleva a ASSISTANT con el tenant del
  // emprendedor que lo invito. Se evalua despues de ADMIN y antes de CLIENT,
  // de modo que un email que sea ADMIN activo prevalece como ADMIN.
  const assistant = await prisma.assistant.findFirst({
    where: { email: normalized, status: 'active' },
  });

  if (assistant) {
    return { role: 'ASSISTANT', tenant_id: assistant.tenant_id };
  }

  // No autorizado o revocado: cliente.
  return { role: 'CLIENT', tenant_id: DEFAULT_TENANT_ID };
}
