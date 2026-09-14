// Tipos de administracion / observabilidad global (SuperAdmin)

import type { AppointmentStatus } from "./index";

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
  range: {
    start_date?: string;
    end_date?: string;
  };
}

export interface TenantSummary {
  tenant_id: string;
  name: string;
  users: number;
  customers: number;
  services: number;
  appointments: number;
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

export interface HealthReport {
  status: string;
  timestamp: string;
  last_24h: {
    total_actions: number;
    logins: number;
  };
}

// Banner del landing publico gestionado por el SuperAdmin.
export interface LandingBanner {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  link_url: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Datos aceptados al crear/editar un banner del landing (parciales en edicion).
export interface LandingBannerInput {
  title: string;
  subtitle?: string | null;
  image_url?: string | null;
  link_url?: string | null;
  sort_order?: number;
  is_active?: boolean;
}
