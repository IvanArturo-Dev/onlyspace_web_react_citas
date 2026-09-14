import api from "./api";

// Estado de la conexion de Google Workspace del emprendedor (tenant).
// El backend NUNCA devuelve tokens; solo el estado y los toggles.
export interface GoogleStatus {
  connected: boolean;
  google_email: string | null;
  online_sessions: boolean;
  save_contacts: boolean;
}

// Respuesta del inicio del flujo OAuth: URL a la que redirigir el navegador y
// el `state` que hay que conservar para validarlo al volver del callback.
export interface GoogleConnectUrl {
  auth_url: string;
  state: string;
}

// Ajustes que se pueden alternar desde la pantalla de integraciones.
export interface GoogleSettingsPayload {
  online_sessions?: boolean;
  save_contacts?: boolean;
}

// Desenvuelve respuestas del backend con forma { success, data } (patron del proyecto).
function unwrap<T>(data: any): T {
  if (data && typeof data === "object" && "data" in data) return data.data as T;
  return data as T;
}

export const googleService = {
  // GET /me/google -> estado de conexion + toggles.
  async getStatus(): Promise<GoogleStatus> {
    const res = await api.get("/me/google");
    return unwrap<GoogleStatus>(res.data);
  },

  // GET /me/google/connect -> { auth_url, state }. El caller redirige a auth_url.
  async getConnectUrl(): Promise<GoogleConnectUrl> {
    const res = await api.get("/me/google/connect");
    return unwrap<GoogleConnectUrl>(res.data);
  },

  // POST /me/google/callback -> intercambia el code y devuelve el estado actualizado.
  async submitCallback(code: string, state: string): Promise<GoogleStatus> {
    const res = await api.post("/me/google/callback", { code, state });
    return unwrap<GoogleStatus>(res.data);
  },

  // PATCH /me/google/settings -> actualiza los toggles y devuelve el estado.
  async updateSettings(payload: GoogleSettingsPayload): Promise<GoogleStatus> {
    const res = await api.patch("/me/google/settings", payload);
    return unwrap<GoogleStatus>(res.data);
  },

  // DELETE /me/google -> revoca y borra la conexion.
  async disconnect(): Promise<{ disconnected: boolean }> {
    const res = await api.delete("/me/google");
    return unwrap<{ disconnected: boolean }>(res.data);
  },
};
