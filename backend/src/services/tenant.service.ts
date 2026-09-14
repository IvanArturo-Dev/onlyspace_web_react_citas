import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';

/**
 * Tenant service — datos BASICOS del negocio del emprendedor.
 *
 * El nombre del negocio (`tenant.name`) es un dato basico y editable por
 * cualquier ADMIN (dueno), sea premium o NO. Por eso vive aqui y NO en el
 * servicio de branding (que es premium-gated). Se deriva del email al
 * registrarse (deriveTenantName) pero puede editarse despues desde el panel.
 */

const NAME_MAX_LENGTH = 100;

export interface TenantNameView {
  id: string;
  name: string;
}

export const tenantService = {
  /**
   * Actualiza el nombre del negocio del tenant. Tenant-scoped.
   *  - name requerido, string, trim; longitud 1..100.
   *  - vacio tras trim -> 400 VALIDATION_ERROR; >100 -> 400 VALIDATION_ERROR.
   *  - tenant inexistente -> 404 TENANT_NOT_FOUND.
   * Devuelve el tenant actualizado ({ id, name }).
   */
  async updateName(tenantId: string, name: unknown): Promise<TenantNameView> {
    if (typeof name !== 'string') {
      throw new HttpError('El nombre del negocio es obligatorio', 400, 'VALIDATION_ERROR');
    }

    const trimmed = name.trim();

    if (trimmed.length === 0) {
      throw new HttpError('El nombre del negocio es obligatorio', 400, 'VALIDATION_ERROR');
    }

    if (trimmed.length > NAME_MAX_LENGTH) {
      throw new HttpError(
        `El nombre del negocio no puede superar los ${NAME_MAX_LENGTH} caracteres`,
        400,
        'VALIDATION_ERROR'
      );
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });

    if (!tenant) {
      throw new HttpError('Tenant not found', 404, 'TENANT_NOT_FOUND');
    }

    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: { name: trimmed },
      select: { id: true, name: true },
    });

    return { id: updated.id, name: updated.name };
  },
};
