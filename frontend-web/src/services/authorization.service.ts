import api from "./api";

export interface AuthorizedAdmin {
  id: string;
  email: string;
  status: "active" | "revoked";
  tenant_id: string | null;
  booking_code: string | null;
  created_at: string;
}

function unwrap<T>(data: any): T {
  // El backend responde { success, data }; devolvemos el payload interno cuando existe.
  if (data && typeof data === "object" && "data" in data) return data.data as T;
  return data as T;
}

export const authorizationService = {
  async list(): Promise<AuthorizedAdmin[]> {
    const res = await api.get("/admin/authorized");
    return unwrap<AuthorizedAdmin[]>(res.data) ?? [];
  },

  async authorize(email: string): Promise<AuthorizedAdmin> {
    const res = await api.post("/admin/authorized", { email });
    return unwrap<AuthorizedAdmin>(res.data);
  },

  async setStatus(id: string, status: "active" | "revoked"): Promise<AuthorizedAdmin> {
    const res = await api.patch(`/admin/authorized/${id}`, { status });
    return unwrap<AuthorizedAdmin>(res.data);
  },
};
