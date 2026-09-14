import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';

/**
 * Booking settings service — configuracion del AGENDADO del negocio.
 *
 * Por ahora expone el HORIZONTE de agendado (`booking_horizon_days`): cuantos
 * dias hacia adelante puede reservar un cliente desde hoy. Convencion:
 *   - > 0  -> limite en dias (p.ej. 30 = solo se puede reservar hasta hoy+30).
 *   - <= 0 -> sin limite (el cliente puede reservar cualquier fecha futura).
 *
 * Es configuracion sensible del negocio: la escritura la hace el ADMIN (guard
 * en la ruta). Todo scoped por tenant_id (1:1 con Tenant).
 */

/** Default sensato cuando el tenant no ha configurado el horizonte. */
export const BOOKING_HORIZON_DEFAULT = 30;

export const bookingSettingsService = {
  /**
   * Lee el horizonte de agendado del tenant. Si el tenant no existe -> 404
   * TENANT_NOT_FOUND. Si el valor es null/invalido devuelve el default (30).
   */
  async getHorizon(tenantId: string): Promise<number> {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { booking_horizon_days: true },
    });

    if (!tenant) {
      throw new HttpError('Tenant not found', 404, 'TENANT_NOT_FOUND');
    }

    const value = tenant.booking_horizon_days;
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : BOOKING_HORIZON_DEFAULT;
  },

  /**
   * Actualiza el horizonte de agendado del tenant. `days` debe ser un entero
   * >= 0 (un valor no numerico, NaN, negativo o no entero -> 400
   * VALIDATION_ERROR sin persistir). tenant inexistente -> 404 TENANT_NOT_FOUND.
   * Devuelve { booking_horizon_days }. Tenant-scoped.
   */
  async updateHorizon(
    tenantId: string,
    days: unknown
  ): Promise<{ booking_horizon_days: number }> {
    const num = typeof days === 'number' ? days : NaN;

    if (
      typeof days !== 'number' ||
      Number.isNaN(num) ||
      !Number.isFinite(num) ||
      num < 0 ||
      !Number.isInteger(num)
    ) {
      throw new HttpError(
        'booking_horizon_days must be an integer >= 0',
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
      data: { booking_horizon_days: num },
      select: { booking_horizon_days: true },
    });

    return { booking_horizon_days: updated.booking_horizon_days };
  },
};
