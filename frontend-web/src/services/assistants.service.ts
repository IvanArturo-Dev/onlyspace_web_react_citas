import api from "./api";

export type AssistantStatus = "active" | "revoked";

export interface Assistant {
  id: string;
  tenant_id: string;
  email: string;
  status: AssistantStatus;
  invited_by: string;
  created_at: string;
}

function unwrap<T>(data: any): T {
  // El backend responde { success, data }; devolvemos el payload interno cuando existe.
  if (data && typeof data === "object" && "data" in data) return data.data as T;
  return data as T;
}

export const assistantsService = {
  async list(): Promise<Assistant[]> {
    const res = await api.get("/assistants");
    return unwrap<Assistant[]>(res.data) ?? [];
  },

  async invite(email: string): Promise<Assistant> {
    const res = await api.post("/assistants", { email });
    return unwrap<Assistant>(res.data);
  },

  async setStatus(id: string, status: AssistantStatus): Promise<Assistant> {
    const res = await api.patch(`/assistants/${id}`, { status });
    return unwrap<Assistant>(res.data);
  },
};
