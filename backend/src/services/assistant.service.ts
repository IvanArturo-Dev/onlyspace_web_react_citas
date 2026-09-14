import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';

/**
 * Vista publica de un asistente (sub-usuario) de un emprendedor.
 */
export interface AssistantView {
  id: string;
  tenant_id: string;
  email: string;
  status: string;
  invited_by: string | null;
  created_at: string;
}

/** Estados validos para un asistente. */
const VALID_STATUSES = ['active', 'revoked'] as const;
type AssistantStatus = (typeof VALID_STATUSES)[number];

/** Normaliza un email a minusculas y sin espacios alrededor. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Email del super admin, configurable por entorno. */
function superAdminEmail(): string {
  return normalizeEmail(process.env.SUPERADMIN_EMAIL || 'xcode.arturo@gmail.com');
}

function toView(record: {
  id: string;
  tenant_id: string;
  email: string;
  status: string;
  invited_by: string | null;
  created_at: Date | string;
}): AssistantView {
  return {
    id: record.id,
    tenant_id: record.tenant_id,
    email: record.email,
    status: record.status,
    invited_by: record.invited_by ?? null,
    created_at:
      record.created_at instanceof Date
        ? record.created_at.toISOString()
        : new Date(record.created_at).toISOString(),
  };
}

export const assistantService = {
  /**
   * Lista los asistentes de un tenant (los del emprendedor que llama),
   * ordenados por fecha de creacion descendente.
   */
  async list(tenantId: string): Promise<AssistantView[]> {
    const records = await prisma.assistant.findMany({
      where: { tenant_id: tenantId },
      orderBy: { created_at: 'desc' },
    });
    return records.map(toView);
  },

  /**
   * Invita (o reactiva) un asistente para el tenant del emprendedor. Idempotente:
   * si ya existe una fila para (tenant, email) la deja/pone en 'active'.
   *
   * Validaciones:
   * - email requerido -> 400 VALIDATION_ERROR.
   * - no se puede invitar al super admin -> 400 CANNOT_INVITE_SUPERADMIN.
   * - no se puede invitar a un email que sea ADMIN activo de OTRO tenant
   *   -> 400 EMAIL_IS_ADMIN.
   */
  async invite(
    tenantId: string,
    email: string,
    invitedBy?: string
  ): Promise<AssistantView> {
    if (!email || typeof email !== 'string' || !email.trim()) {
      throw new HttpError('El campo email es requerido', 400, 'VALIDATION_ERROR');
    }

    const normalized = normalizeEmail(email);

    if (normalized === superAdminEmail()) {
      throw new HttpError(
        'No se puede invitar al super admin como asistente',
        400,
        'CANNOT_INVITE_SUPERADMIN'
      );
    }

    // No permitir invitar a un ADMIN activo de otro tenant.
    const admin = await prisma.authorizedAdmin.findUnique({
      where: { email: normalized },
    });
    if (admin && admin.status === 'active' && admin.tenant_id !== tenantId) {
      throw new HttpError(
        'Ese email pertenece a un emprendedor de otro negocio',
        400,
        'EMAIL_IS_ADMIN'
      );
    }

    // Idempotente sobre (tenant_id, email).
    const existing = await prisma.assistant.findUnique({
      where: { tenant_id_email: { tenant_id: tenantId, email: normalized } },
    });

    if (existing) {
      if (existing.status !== 'active') {
        const updated = await prisma.assistant.update({
          where: { id: existing.id },
          data: { status: 'active', invited_by: invitedBy ?? existing.invited_by },
        });
        return toView(updated);
      }
      return toView(existing);
    }

    const created = await prisma.assistant.create({
      data: {
        tenant_id: tenantId,
        email: normalized,
        status: 'active',
        invited_by: invitedBy ?? null,
      },
    });
    return toView(created);
  },

  /**
   * Cambia el status de un asistente (revocar/reactivar), asegurando que el
   * asistente pertenezca al tenant del emprendedor que llama (aislamiento).
   *
   * @throws HttpError 400 si `status` no es 'active' ni 'revoked'.
   * @throws HttpError 404 ASSISTANT_NOT_FOUND si no existe en el tenant.
   */
  async setStatus(
    tenantId: string,
    id: string,
    status: string
  ): Promise<AssistantView> {
    if (!VALID_STATUSES.includes(status as AssistantStatus)) {
      throw new HttpError(
        `Status invalido: debe ser 'active' o 'revoked'`,
        400,
        'VALIDATION_ERROR'
      );
    }

    // Aislamiento por tenant: solo se puede modificar un asistente propio.
    const existing = await prisma.assistant.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!existing) {
      throw new HttpError('Asistente no encontrado', 404, 'ASSISTANT_NOT_FOUND');
    }

    const updated = await prisma.assistant.update({
      where: { id: existing.id },
      data: { status },
    });
    return toView(updated);
  },
};
