import api from "./api";

export interface ModuleFlag {
  id: string;
  scope: string;
  tenant_id: string | null;
  module_key: string;
  enabled: boolean;
}

export interface ModuleFlagPayload {
  scope: string;
  tenant_id?: string | null;
  module_key: string;
  enabled: boolean;
}

function unwrap<T>(data: any): T {
  // El backend responde { success, data }; devolvemos el payload interno cuando existe.
  if (data && typeof data === "object" && "data" in data) return data.data as T;
  return data as T;
}

export const adminModulesService = {
  async list(): Promise<ModuleFlag[]> {
    const res = await api.get("/admin/modules");
    return unwrap<ModuleFlag[]>(res.data) ?? [];
  },

  async setFlag(payload: ModuleFlagPayload): Promise<ModuleFlag> {
    const res = await api.patch("/admin/modules", payload);
    return unwrap<ModuleFlag>(res.data);
  },
};
