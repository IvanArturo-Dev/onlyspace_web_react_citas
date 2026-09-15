import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';

/**
 * Umbral centralizado para la deteccion de tendencia a inasistencias (NO_SHOW).
 * Ajustar aqui para cambiar el criterio en todo el sistema.
 * - minNoShow: numero absoluto de NO_SHOW que por si solo marca tendencia.
 * - minClosed: minimo de citas cerradas (attended+cancelled+no_show) requerido
 *   para evaluar el criterio por ratio.
 * - ratio: proporcion de NO_SHOW sobre cerradas que marca tendencia.
 */
export const NO_SHOW_TENDENCY = { minNoShow: 3, minClosed: 4, ratio: 0.3 } as const;

export interface CustomerBehavior {
  attended: number;
  cancelled: number;
  no_show: number;
}

const EMPTY_BEHAVIOR: CustomerBehavior = { attended: 0, cancelled: 0, no_show: 0 };

/**
 * Mapea un estado de cita a la clave de comportamiento correspondiente.
 * Solo COMPLETED / CANCELLED / NO_SHOW cuentan.
 */
function statusToBehaviorKey(status: string): keyof CustomerBehavior | null {
  switch (status) {
    case 'COMPLETED':
      return 'attended';
    case 'CANCELLED':
      return 'cancelled';
    case 'NO_SHOW':
      return 'no_show';
    default:
      return null;
  }
}

export const customerService = {
  async listCustomers(tenantId: string, search: string = '', page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const customers = await prisma.customer.findMany({
      where: {
        tenant_id: tenantId,
        status: { in: ['active', 'blocked'] },
        OR: [
          { name: { contains: search } },
          { email: { contains: search } },
          { phone: { contains: search } },
        ],
      },
      skip,
      take: limit,
      orderBy: { created_at: 'desc' },
    });

    const total = await prisma.customer.count({
      where: {
        tenant_id: tenantId,
        status: { in: ['active', 'blocked'] },
        OR: [
          { name: { contains: search } },
          { email: { contains: search } },
          { phone: { contains: search } },
        ],
      },
    });

    return { customers, total, page, limit };
  },

  async getCustomer(tenantId: string, customerId: string) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId, tenant_id: tenantId },
    });

    if (!customer) {
      throw new HttpError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
    }

    return customer;
  },

  async createCustomer(tenantId: string, data: any) {
    const { email, phone } = data;

    // Check if email already exists
    if (email) {
      const existing = await prisma.customer.findFirst({
        where: { tenant_id: tenantId, email },
      });
      if (existing) {
        throw new HttpError('Email already exists', 409, 'EMAIL_EXISTS');
      }
    }

    // Check if phone already exists
    const existingPhone = await prisma.customer.findFirst({
      where: { tenant_id: tenantId, phone },
    });
    if (existingPhone) {
      throw new HttpError('Phone already exists', 409, 'PHONE_EXISTS');
    }

    return prisma.customer.create({
      data: {
        tenant_id: tenantId,
        ...data,
      },
    });
  },

  async updateCustomer(tenantId: string, customerId: string, data: any) {
    await this.getCustomer(tenantId, customerId);

    // Check email uniqueness if changing
    if (data.email) {
      const existing = await prisma.customer.findFirst({
        where: {
          tenant_id: tenantId,
          email: data.email,
          id: { not: customerId },
        },
      });
      if (existing) {
        throw new HttpError('Email already exists', 409, 'EMAIL_EXISTS');
      }
    }

    return prisma.customer.update({
      where: { id: customerId, tenant_id: tenantId },
      data,
    });
  },

  async deleteCustomer(tenantId: string, customerId: string) {
    await this.getCustomer(tenantId, customerId);
    return prisma.customer.update({
      where: { id: customerId, tenant_id: tenantId },
      data: { status: 'inactive' },
    });
  },

  /**
   * Bloquea/desbloquea un cliente cambiando Customer.status entre
   * 'active' y 'blocked', scoped por tenant. Reversible y sin perder historial
   * (Requirement 4.1, 4.3, 4.4). Valida el estado (400 si no es
   * 'active'/'blocked') y que el cliente exista/sea del tenant (404 via
   * getCustomer). Devuelve el customer actualizado.
   */
  async setStatus(tenantId: string, customerId: string, status: string) {
    if (status !== 'active' && status !== 'blocked') {
      throw new HttpError(
        "Invalid status. Allowed values: 'active', 'blocked'",
        400,
        'INVALID_STATUS'
      );
    }

    await this.getCustomer(tenantId, customerId);

    return prisma.customer.update({
      where: { id: customerId, tenant_id: tenantId },
      data: { status },
    });
  },

  /**
   * Conteos de comportamiento de un cliente por estado de cita, scoped por tenant.
   * COMPLETED -> attended, CANCELLED -> cancelled, NO_SHOW -> no_show.
   * Usa un unico groupBy por status para ser eficiente.
   */
  async getCustomerBehavior(tenantId: string, customerId: string): Promise<CustomerBehavior> {
    const grouped = await prisma.appointment.groupBy({
      by: ['status'],
      where: {
        tenant_id: tenantId,
        customer_id: customerId,
        status: { in: ['COMPLETED', 'CANCELLED', 'NO_SHOW'] },
      },
      _count: { _all: true },
    });

    const behavior: CustomerBehavior = { ...EMPTY_BEHAVIOR };
    for (const row of grouped) {
      const key = statusToBehaviorKey(row.status);
      if (key) {
        behavior[key] = row._count._all;
      }
    }
    return behavior;
  },

  /**
   * Resuelve el comportamiento de multiples clientes en LOTE con un solo
   * groupBy por (customer_id, status), evitando N+1. Devuelve un objeto
   * indexado por customerId; los clientes sin citas aparecen en ceros.
   * Si ids esta vacio, devuelve {} sin consultar la base de datos.
   */
  async getBehaviorForCustomers(
    tenantId: string,
    ids: string[]
  ): Promise<Record<string, CustomerBehavior>> {
    if (!ids || ids.length === 0) {
      return {};
    }

    const result: Record<string, CustomerBehavior> = {};
    for (const id of ids) {
      result[id] = { ...EMPTY_BEHAVIOR };
    }

    const grouped = await prisma.appointment.groupBy({
      by: ['customer_id', 'status'],
      where: {
        tenant_id: tenantId,
        customer_id: { in: ids },
        status: { in: ['COMPLETED', 'CANCELLED', 'NO_SHOW'] },
      },
      _count: { _all: true },
    });

    for (const row of grouped) {
      const key = statusToBehaviorKey(row.status);
      if (!key) continue;
      const entry = result[row.customer_id] ?? { ...EMPTY_BEHAVIOR };
      entry[key] = row._count._all;
      result[row.customer_id] = entry;
    }

    return result;
  },
};

/**
 * Helper PURO (sin DB): determina si un comportamiento indica tendencia a
 * inasistencias. Tiene tendencia si:
 *  - no_show >= NO_SHOW_TENDENCY.minNoShow, O
 *  - hay al menos NO_SHOW_TENDENCY.minClosed citas cerradas y la proporcion de
 *    no_show sobre cerradas supera NO_SHOW_TENDENCY.ratio.
 */
export function hasNoShowTendency(behavior: CustomerBehavior): boolean {
  const closed = behavior.attended + behavior.cancelled + behavior.no_show;
  if (behavior.no_show >= NO_SHOW_TENDENCY.minNoShow) {
    return true;
  }
  return (
    closed >= NO_SHOW_TENDENCY.minClosed &&
    behavior.no_show / closed > NO_SHOW_TENDENCY.ratio
  );
}
