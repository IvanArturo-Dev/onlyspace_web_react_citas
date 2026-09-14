import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';
import { branchService } from './branch.service';

/**
 * Normaliza y valida el campo `capacity` (aforo por servicio) dentro de un
 * objeto de datos de create/update.
 *
 * Reglas (Requirement 1.1):
 *  - Si `capacity` NO viene en `data`, se deja tal cual (Prisma aplica el
 *    default @default(1) en create; en update no se toca).
 *  - Si viene, debe ser un entero >= 1. Cualquier otro valor (no numero,
 *    no entero, < 1) -> HttpError 400 VALIDATION_ERROR.
 *
 * Devuelve una copia de `data` con `capacity` normalizado (Number) cuando
 * corresponde.
 */
function validateCapacity<T extends Record<string, any>>(data: T): T {
  if (data == null || !('capacity' in data) || data.capacity === undefined) {
    return data;
  }

  const value = (data as any).capacity;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    !Number.isFinite(value) ||
    value < 1
  ) {
    throw new HttpError(
      'capacity debe ser un entero mayor o igual a 1',
      400,
      'VALIDATION_ERROR'
    );
  }

  return { ...data, capacity: value };
}

export const serviceService = {
  async listServices(tenantId: string, categoryId?: string, isActive: boolean = true) {
    return prisma.service.findMany({
      where: {
        tenant_id: tenantId,
        category_id: categoryId,
        is_active: isActive,
      },
      orderBy: { name: 'asc' },
    });
  },

  async getService(tenantId: string, serviceId: string) {
    const service = await prisma.service.findUnique({
      where: { id: serviceId, tenant_id: tenantId },
      include: { category: true },
    });

    if (!service) {
      throw new HttpError('Service not found', 404, 'SERVICE_NOT_FOUND');
    }

    return service;
  },

  async createService(tenantId: string, data: any) {
    const validated = validateCapacity(data ?? {});
    return prisma.service.create({
      data: { tenant_id: tenantId, ...validated },
    });
  },

  async updateService(tenantId: string, serviceId: string, data: any) {
    await this.getService(tenantId, serviceId);
    // A tenant can never move a service to another branch/tenant: branch_id and
    // tenant_id are not editable through this path.
    const { tenant_id: _t, branch_id: _b, ...safe } = validateCapacity(data ?? {});
    return prisma.service.update({
      where: { id: serviceId, tenant_id: tenantId },
      data: safe,
    });
  },

  /**
   * Lists the services (categorias) of a specific branch of the tenant.
   * Validates that the branch belongs to the tenant first (404 otherwise), so
   * one tenant/branch can never read another's services (Property 5).
   */
  async listByBranch(tenantId: string, branchId: string, isActive: boolean = true) {
    await branchService.get(tenantId, branchId);
    return prisma.service.findMany({
      where: {
        tenant_id: tenantId,
        branch_id: branchId,
        is_active: isActive,
      },
      orderBy: { name: 'asc' },
    });
  },

  /**
   * Creates a service (categoria) for a specific branch. Validates the branch
   * ownership first and forces tenant_id + branch_id from the validated
   * scope (any tenant_id/branch_id in `data` is ignored).
   */
  async createForBranch(tenantId: string, branchId: string, data: any) {
    await branchService.get(tenantId, branchId);
    const { tenant_id: _t, branch_id: _b, ...safe } = validateCapacity(data ?? {});
    return prisma.service.create({
      data: { ...safe, tenant_id: tenantId, branch_id: branchId },
    });
  },

  async deleteService(tenantId: string, serviceId: string) {
    await this.getService(tenantId, serviceId);
    return prisma.service.update({
      where: { id: serviceId, tenant_id: tenantId },
      data: { is_active: false },
    });
  },

  async listCategories(tenantId: string) {
    return prisma.category.findMany({
      where: { tenant_id: tenantId },
      orderBy: { name: 'asc' },
    });
  },

  async createCategory(tenantId: string, data: any) {
    return prisma.category.create({
      data: { tenant_id: tenantId, ...data },
    });
  },
};
