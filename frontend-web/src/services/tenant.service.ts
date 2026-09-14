import api from "./api";

export interface MyTenant {
  id: string;
  name: string;
  booking_code: string | null;
  booking_enabled: boolean;
  portal_path: string;
  is_premium?: boolean;
  subscription_status?: string;
  subscription_expires_at?: string | null;
  days_left?: number | null;
}

// Desenvuelve respuestas del backend con forma { success, data }.
function unwrap<T>(data: any): T {
  if (data && typeof data === "object" && "data" in data) return data.data as T;
  return data as T;
}

export const tenantService = {
  async getMine(): Promise<MyTenant> {
    const res = await api.get("/me/tenant");
    return unwrap<MyTenant>(res.data);
  },

  // Actualiza el nombre del negocio (dato basico, NO premium). ADMIN-only.
  async updateName(name: string): Promise<MyTenant> {
    const res = await api.patch("/me/tenant", { name });
    return unwrap<MyTenant>(res.data);
  },
};
