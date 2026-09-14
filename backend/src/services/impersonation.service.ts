import { AuditAction } from '@prisma/client';
import { prisma } from '../database/prisma.service';
import { generateAccessToken } from '../config/jwt';
import { HttpError } from '../utils/errors';
import { writeAudit } from '../utils/audit';

/**
 * Servicio de "modo soporte" del super admin por IMPERSONACION.
 *
 * No hay cambios de schema: la impersonacion vive 100% en un token JWT de vida
 * corta (~2h) emitido a nombre del super admin (user_id = superAdminUserId) pero
 * con tenant_id apuntando al negocio objetivo y el claim `impersonated_by` que
 * confirma quien esta actuando. Ese claim permite a los guards saltar el gating
 * premium/quotas (tarea 3) y deja la auditoria a nombre del super admin.
 *
 * Solo `requireSuperAdmin` puede llegar a `start`/`stop` (garantizado por el
 * guard de ruta); un rol normal no puede emitir el token (Property 3/4).
 */

/** Vista minima del tenant objetivo devuelta al iniciar la impersonacion. */
export interface ImpersonationTenant {
  id: string;
  name: string;
}

export interface StartImpersonationResult {
  token: string;
  tenant: ImpersonationTenant;
}

export const impersonationService = {
  /**
   * Inicia la impersonacion del super admin sobre `targetTenantId`.
   *
   * - Valida que el tenant exista (404 TENANT_NOT_FOUND si no).
   * - Emite un token JWT de vida corta (~2h) con role ADMIN, permissions vacio,
   *   tenant_id = objetivo, user_id = super admin e `impersonated_by` = super admin.
   * - Registra auditoria del inicio (action 'start') a nombre del super admin.
   *
   * @returns { token, tenant:{ id, name } }
   */
  async start(
    superAdminUserId: string,
    targetTenantId: string
  ): Promise<StartImpersonationResult> {
    const tenant = await prisma.tenant.findUnique({
      where: { id: targetTenantId },
      select: { id: true, name: true },
    });
    if (!tenant) {
      throw new HttpError('Tenant no encontrado', 404, 'TENANT_NOT_FOUND');
    }

    const token = generateAccessToken(
      {
        user_id: superAdminUserId,
        tenant_id: targetTenantId,
        role: 'ADMIN',
        permissions: [],
        impersonated_by: superAdminUserId,
      },
      { expiresIn: '2h' }
    );

    await writeAudit({
      tenant_id: targetTenantId,
      user_id: superAdminUserId,
      action: AuditAction.UPDATE,
      resource_type: 'impersonation',
      resource_id: targetTenantId,
      details: JSON.stringify({ action: 'start', by: superAdminUserId }),
    });

    return { token, tenant: { id: tenant.id, name: tenant.name } };
  },

  /**
   * Finaliza la impersonacion del super admin sobre `targetTenantId`.
   *
   * No necesita validar estrictamente el tenant (la sesion de impersonacion se
   * descarta del lado cliente); solo registra auditoria del cierre (action
   * 'stop') a nombre del super admin.
   *
   * @returns { ok: true }
   */
  async stop(
    superAdminUserId: string,
    targetTenantId: string
  ): Promise<{ ok: true }> {
    await writeAudit({
      tenant_id: targetTenantId,
      user_id: superAdminUserId,
      action: AuditAction.UPDATE,
      resource_type: 'impersonation',
      resource_id: targetTenantId,
      details: JSON.stringify({ action: 'stop', by: superAdminUserId }),
    });

    return { ok: true };
  },
};
