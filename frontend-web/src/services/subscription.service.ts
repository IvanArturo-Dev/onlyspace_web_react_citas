import api from "./api";

// Servicio de suscripcion premium (control del super admin). Envuelve los endpoints
// /v1/admin/tenants/:id/subscription y desenvuelve las respuestas { success, data }.
// Solo lo consume el super admin (AdminUsers).

export type SubscriptionStatus = "active" | "inactive";

export interface Subscription {
  status: SubscriptionStatus;
  expires_at: string | null;
  is_premium: boolean;
}

// Entrada para fijar la suscripcion. expires_at ISO string o null (sin vencimiento).
export interface SubscriptionInput {
  status: SubscriptionStatus;
  expires_at?: string | null;
}

function unwrap<T>(data: any): T {
  if (data && typeof data === "object" && "data" in data) return data.data as T;
  return data as T;
}

export const subscriptionService = {
  async getSubscription(tenantId: string): Promise<Subscription> {
    const res = await api.get(`/admin/tenants/${tenantId}/subscription`);
    return unwrap<Subscription>(res.data);
  },

  async setSubscription(tenantId: string, input: SubscriptionInput): Promise<Subscription> {
    const res = await api.patch(`/admin/tenants/${tenantId}/subscription`, input);
    return unwrap<Subscription>(res.data);
  },
};

// --- Suscripcion premium del propio emprendedor (self-service via Mercado Pago) ---
// A diferencia de subscriptionService (que controla el super admin sobre cualquier
// tenant), estos endpoints operan sobre el tenant del usuario logueado y envuelven
// /v1/me/subscription. Las respuestas tienen forma { success, data }.

export interface CreateSubscriptionResult {
  // URL de Mercado Pago a la que hay que redirigir el navegador para autorizar el pago.
  init_point: string;
  preapproval_id: string;
}

export interface MySubscriptionStatus {
  // Datos crudos de la suscripcion (o null si nunca se creo una).
  subscription: any | null;
  is_premium: boolean;
  days_left: number | null;
}

export const mySubscriptionService = {
  // Crea/inicia la suscripcion y devuelve el init_point de Mercado Pago.
  async create(): Promise<CreateSubscriptionResult> {
    const res = await api.post("/me/subscription");
    return unwrap<CreateSubscriptionResult>(res.data);
  },

  // Estado actual de la suscripcion del tenant logueado.
  async getStatus(): Promise<MySubscriptionStatus> {
    const res = await api.get("/me/subscription");
    return unwrap<MySubscriptionStatus>(res.data);
  },

  // Cancela la suscripcion activa del tenant logueado.
  async cancel(): Promise<void> {
    await api.post("/me/subscription/cancel");
  },
};
