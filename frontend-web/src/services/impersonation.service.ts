import api from "./api";

// Claves en sessionStorage: el token de impersonacion vive aparte del token normal
// (localStorage) del super admin, para no pisar su sesion. Al salir se limpian y el
// super admin retoma su sesion intacta.
export const IMPERSONATION_TOKEN_KEY = "impersonation_token";
export const IMPERSONATION_NAME_KEY = "impersonation_name";
export const IMPERSONATION_TENANT_KEY = "impersonation_tenant";

function unwrap<T>(data: any): T {
  // El backend responde { success, data }; devolvemos el payload interno cuando existe.
  if (data && typeof data === "object" && "data" in data) return data.data as T;
  return data as T;
}

export interface ImpersonationStartResult {
  token: string;
  tenant: { id: string; name: string };
}

export const impersonationService = {
  // Inicia la impersonacion de un tenant. Devuelve el token corto y el tenant objetivo.
  async start(tenantId: string): Promise<ImpersonationStartResult> {
    const res = await api.post(`/admin/impersonation/${tenantId}`);
    return unwrap<ImpersonationStartResult>(res.data);
  },

  // Termina la impersonacion (best-effort: si falla, igual limpiamos el estado local).
  async stop(tenantId: string): Promise<void> {
    try {
      await api.post(`/admin/impersonation/${tenantId}/stop`);
    } catch {
      // Ignoramos fallos: la salida local no debe depender del backend.
    }
  },
};

// Helpers de estado local (sessionStorage).
export function getImpersonationToken(): string | null {
  return sessionStorage.getItem(IMPERSONATION_TOKEN_KEY);
}

export function getImpersonationName(): string | null {
  return sessionStorage.getItem(IMPERSONATION_NAME_KEY);
}

export function getImpersonationTenantId(): string | null {
  return sessionStorage.getItem(IMPERSONATION_TENANT_KEY);
}

export function setImpersonation(token: string, name: string, tenantId: string): void {
  sessionStorage.setItem(IMPERSONATION_TOKEN_KEY, token);
  sessionStorage.setItem(IMPERSONATION_NAME_KEY, name);
  sessionStorage.setItem(IMPERSONATION_TENANT_KEY, tenantId);
}

export function clearImpersonation(): void {
  sessionStorage.removeItem(IMPERSONATION_TOKEN_KEY);
  sessionStorage.removeItem(IMPERSONATION_NAME_KEY);
  sessionStorage.removeItem(IMPERSONATION_TENANT_KEY);
}

export function isImpersonating(): boolean {
  return !!getImpersonationToken();
}
