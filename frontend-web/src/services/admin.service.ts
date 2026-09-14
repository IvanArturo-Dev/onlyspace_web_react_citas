import api from "./api";
import type {
  AuditEntry,
  GlobalMetrics,
  GlobalOverview,
  HealthReport,
  LandingBanner,
  LandingBannerInput,
  Paginated,
  TenantSummary,
} from "../types/admin";

function unwrap<T>(data: any): T {
  // El backend responde { success, data }; devolvemos el payload interno cuando existe.
  if (data && typeof data === "object" && "data" in data) return data.data as T;
  return data as T;
}

export const adminService = {
  async getOverview(): Promise<GlobalOverview> {
    const res = await api.get("/admin/overview");
    return unwrap<GlobalOverview>(res.data);
  },

  async getMetrics(params?: {
    start_date?: string;
    end_date?: string;
    tenant_id?: string;
  }): Promise<GlobalMetrics> {
    const res = await api.get("/admin/metrics", { params });
    return unwrap<GlobalMetrics>(res.data);
  },

  async getTenants(): Promise<TenantSummary[]> {
    const res = await api.get("/admin/tenants");
    return unwrap<TenantSummary[]>(res.data) ?? [];
  },

  async getAudit(filters?: {
    tenant_id?: string;
    user_id?: string;
    action?: string;
    resource_type?: string;
    start_date?: string;
    end_date?: string;
    page?: number;
    page_size?: number;
  }): Promise<Paginated<AuditEntry>> {
    const res = await api.get("/admin/audit", { params: filters });
    return unwrap<Paginated<AuditEntry>>(res.data);
  },

  async getHealth(): Promise<HealthReport> {
    const res = await api.get("/admin/health");
    return unwrap<HealthReport>(res.data);
  },

  // Banners del landing publico (ordenados por sort_order asc en el backend).
  async getLandingBanners(): Promise<LandingBanner[]> {
    const res = await api.get("/admin/landing-banners");
    return unwrap<LandingBanner[]>(res.data) ?? [];
  },

  async createLandingBanner(data: LandingBannerInput): Promise<LandingBanner> {
    const res = await api.post("/admin/landing-banners", data);
    return unwrap<LandingBanner>(res.data);
  },

  async updateLandingBanner(id: string, data: Partial<LandingBannerInput>): Promise<LandingBanner> {
    const res = await api.patch(`/admin/landing-banners/${id}`, data);
    return unwrap<LandingBanner>(res.data);
  },

  async deleteLandingBanner(id: string): Promise<void> {
    await api.delete(`/admin/landing-banners/${id}`);
  },
};
