import { AppointmentStatus, AuditAction } from '@prisma/client';
import { prisma } from '../database/prisma.service';

export interface GlobalOverview {
  tenants: number;
  users: number;
  customers: number;
  services: number;
  appointments_by_status: Record<AppointmentStatus, number>;
}

export interface TenantIncome {
  tenant_id: string;
  tenant_name: string;
  income: number;
}

export interface GlobalMetrics {
  income_total: number;
  income_by_tenant: TenantIncome[];
  occupancy_rate: number;
  no_show_rate: number;
  range: { start_date?: string; end_date?: string };
}

export interface TenantSummary {
  tenant_id: string;
  name: string;
  users: number;
  customers: number;
  services: number;
  appointments: number;
}

export interface HealthReport {
  status: 'ok';
  timestamp: string;
  last_24h: {
    total_actions: number;
    logins: number;
  };
}

export interface AuditFilters {
  tenant_id?: string;
  user_id?: string;
  action?: string;
  resource_type?: string;
  start_date?: string;
  end_date?: string;
  page?: number;
  page_size?: number;
}

export interface AuditEntry {
  id: string;
  created_at: string;
  user_id: string | null;
  tenant_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  result: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
}

const AUDIT_DEFAULT_PAGE_SIZE = 20;
const AUDIT_MAX_PAGE_SIZE = 100;

/**
 * Builds a Record<AppointmentStatus, number> initialized to 0 for every status
 * in the AppointmentStatus enum.
 */
function emptyStatusRecord(): Record<AppointmentStatus, number> {
  const record = {} as Record<AppointmentStatus, number>;
  for (const status of Object.values(AppointmentStatus)) {
    record[status] = 0;
  }
  return record;
}

export const adminService = {
  /**
   * Global (cross-tenant) counters and appointments grouped by status.
   */
  async getOverview(): Promise<GlobalOverview> {
    const [tenants, users, customers, services, grouped] = await Promise.all([
      prisma.tenant.count(),
      prisma.user.count(),
      prisma.customer.count(),
      prisma.service.count(),
      prisma.appointment.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);

    const appointmentsByStatus = emptyStatusRecord();
    for (const row of grouped) {
      appointmentsByStatus[row.status as AppointmentStatus] = row._count._all;
    }

    return {
      tenants,
      users,
      customers,
      services,
      appointments_by_status: appointmentsByStatus,
    };
  },

  /**
   * Global (cross-tenant) business metrics for an optional date range and
   * optional tenant filter.
   *
   * occupancy_rate is approximated as the proportion of COMPLETED appointments
   * over the total number of appointments in the range. It is a proxy for how
   * much of the booked activity was actually fulfilled, and returns 0 when
   * there are no appointments.
   */
  async getMetrics(params: {
    start_date?: string;
    end_date?: string;
    tenant_id?: string;
  }): Promise<GlobalMetrics> {
    const { start_date, end_date, tenant_id } = params;

    const dateFilter =
      start_date && end_date
        ? {
            created_at: {
              gte: new Date(start_date),
              lte: new Date(end_date),
            },
          }
        : {};

    const baseWhere: any = {
      ...(tenant_id ? { tenant_id } : {}),
      ...dateFilter,
    };

    // Total appointments in range (for rate denominators).
    const totalAppointments = await prisma.appointment.count({ where: baseWhere });

    // NO_SHOW count in range.
    const noShowCount = await prisma.appointment.count({
      where: { ...baseWhere, status: AppointmentStatus.NO_SHOW },
    });

    // COMPLETED appointments with their service price (for income + occupancy).
    const completedAppointments = await prisma.appointment.findMany({
      where: { ...baseWhere, status: AppointmentStatus.COMPLETED },
      select: {
        tenant_id: true,
        service: { select: { price: true } },
      },
    });

    const completedCount = completedAppointments.length;

    // Aggregate income totals globally and per tenant.
    let incomeTotal = 0;
    const incomeByTenantMap = new Map<string, number>();

    for (const appt of completedAppointments) {
      const price = appt.service?.price ? Number(appt.service.price) : 0;
      incomeTotal += price;
      incomeByTenantMap.set(
        appt.tenant_id,
        (incomeByTenantMap.get(appt.tenant_id) ?? 0) + price
      );
    }

    // Resolve tenant names for the tenants that produced income.
    const tenantIds = Array.from(incomeByTenantMap.keys());
    const tenants = tenantIds.length
      ? await prisma.tenant.findMany({
          where: { id: { in: tenantIds } },
          select: { id: true, name: true },
        })
      : [];
    const tenantNameById = new Map(tenants.map((t) => [t.id, t.name]));

    const incomeByTenant: TenantIncome[] = tenantIds.map((id) => ({
      tenant_id: id,
      tenant_name: tenantNameById.get(id) ?? id,
      income: incomeByTenantMap.get(id) ?? 0,
    }));

    const noShowRate = totalAppointments === 0 ? 0 : noShowCount / totalAppointments;
    const occupancyRate = totalAppointments === 0 ? 0 : completedCount / totalAppointments;

    return {
      income_total: incomeTotal,
      income_by_tenant: incomeByTenant,
      occupancy_rate: occupancyRate,
      no_show_rate: noShowRate,
      range: { start_date, end_date },
    };
  },

  /**
   * Lists all tenants with basic per-tenant counters.
   */
  async listTenants(): Promise<TenantSummary[]> {
    const tenants = await prisma.tenant.findMany({
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            users: true,
            customers: true,
            services: true,
            appointments: true,
          },
        },
      },
    });

    return tenants.map((t) => ({
      tenant_id: t.id,
      name: t.name,
      users: t._count.users,
      customers: t._count.customers,
      services: t._count.services,
      appointments: t._count.appointments,
    }));
  },

  /**
   * Backend health report plus activity counters from AuditLog for the last 24h.
   */
  async getHealth(): Promise<HealthReport> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [totalActions, logins] = await Promise.all([
      prisma.auditLog.count({ where: { created_at: { gte: since } } }),
      prisma.auditLog.count({
        where: { created_at: { gte: since }, action: 'LOGIN' },
      }),
    ]);

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      last_24h: {
        total_actions: totalActions,
        logins,
      },
    };
  },

  /**
   * Read-only, paginated audit trail across tenants with optional filters.
   *
   * Filters are applied only when present. The date range is applied to
   * `created_at` (inclusive) only when both `start_date` and `end_date` are
   * provided. Results are ordered by `created_at` descending.
   *
   * Pagination is 1-based: `page` defaults to 1 (minimum 1) and `page_size`
   * defaults to 20 and is capped at 100.
   */
  async getAuditTrail(filters: AuditFilters): Promise<Paginated<AuditEntry>> {
    const {
      tenant_id,
      user_id,
      action,
      resource_type,
      start_date,
      end_date,
    } = filters;

    const where: any = {
      ...(tenant_id ? { tenant_id } : {}),
      ...(user_id ? { user_id } : {}),
      ...(action ? { action: action as AuditAction } : {}),
      ...(resource_type ? { resource_type } : {}),
      ...(start_date && end_date
        ? {
            created_at: {
              gte: new Date(start_date),
              lte: new Date(end_date),
            },
          }
        : {}),
    };

    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(
      AUDIT_MAX_PAGE_SIZE,
      Math.max(1, filters.page_size ?? AUDIT_DEFAULT_PAGE_SIZE)
    );
    const skip = (page - 1) * pageSize;

    const [total, records] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: pageSize,
      }),
    ]);

    const items: AuditEntry[] = records.map((r: any) => ({
      id: r.id,
      created_at:
        r.created_at instanceof Date
          ? r.created_at.toISOString()
          : new Date(r.created_at).toISOString(),
      user_id: r.user_id ?? null,
      tenant_id: r.tenant_id,
      action: String(r.action),
      resource_type: r.resource_type,
      resource_id: r.resource_id,
      result: r.result,
    }));

    return {
      items,
      page,
      page_size: pageSize,
      total,
    };
  },
};
