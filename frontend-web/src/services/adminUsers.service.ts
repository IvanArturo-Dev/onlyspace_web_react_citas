import api from "./api";

// Rol efectivo devuelto por el backend. El sistema tiene 3 roles operativos
// (SUPERADMIN, ADMIN=emprendedor, CLIENT) mas ASSISTANT (sub-usuario del emprendedor,
// no asignable desde esta lista).
export type AdminUserRole = "SUPERADMIN" | "ADMIN" | "ASSISTANT" | "CLIENT";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: AdminUserRole;
  is_active: boolean;
  last_seen: string | null;
  tenant_id: string | null;
}

// Solo estos roles pueden asignarse via PATCH /admin/users/:id/role.
export type AssignableRole = "ADMIN" | "CLIENT";

function unwrap<T>(data: any): T {
  // El backend responde { success, data }; devolvemos el payload interno cuando existe.
  if (data && typeof data === "object" && "data" in data) return data.data as T;
  return data as T;
}

export const adminUsersService = {
  async list(): Promise<AdminUser[]> {
    const res = await api.get("/admin/users");
    return unwrap<AdminUser[]>(res.data) ?? [];
  },

  async setBlocked(id: string, blocked: boolean): Promise<AdminUser> {
    const res = await api.patch(`/admin/users/${id}/block`, { blocked });
    return unwrap<AdminUser>(res.data);
  },

  async changeRole(id: string, role: AssignableRole): Promise<AdminUser> {
    const res = await api.patch(`/admin/users/${id}/role`, { role });
    return unwrap<AdminUser>(res.data);
  },
};
