import api from "./api";

// Politica de cancelacion del tenant. Controla ventana de gracia, cantidad de
// cancelaciones permitidas antes de penalizar, monto de penalizacion y cada
// cuantos dias se reinicia el contador.
export interface CancellationPolicy {
  tenant_id: string;
  grace_hours: number;
  allowed_cancellations: number;
  penalty_amount: number;
  reset_days: number;
}

// Cuerpo parcial para actualizar la politica (PATCH). Todos los campos opcionales.
export type CancellationPolicyInput = Partial<
  Pick<
    CancellationPolicy,
    "grace_hours" | "allowed_cancellations" | "penalty_amount" | "reset_days"
  >
>;

// Estado de cancelaciones/deuda de un cliente concreto.
export interface CustomerCancellationState {
  tenant_id: string;
  customer_id: string;
  count: number;
  debt_amount: number;
  debt_reason: string | null;
  period_started_at: string | null;
}

// Desenvuelve respuestas del backend con forma { success, data }.
function unwrap<T>(data: any): T {
  if (data && typeof data === "object" && "data" in data) return data.data as T;
  return data as T;
}

export const cancellationPolicyService = {
  // ------- POLITICA DEL TENANT -------
  async get(): Promise<CancellationPolicy> {
    const res = await api.get("/me/cancellation-policy");
    return unwrap<CancellationPolicy>(res.data);
  },

  async update(data: CancellationPolicyInput): Promise<CancellationPolicy> {
    const res = await api.patch("/me/cancellation-policy", data);
    return unwrap<CancellationPolicy>(res.data);
  },

  // ------- ESTADO / DEUDA DEL CLIENTE -------
  async getCustomerCancellationState(
    customerId: string
  ): Promise<CustomerCancellationState> {
    const res = await api.get(
      `/customers/${encodeURIComponent(customerId)}/cancellation-state`
    );
    return unwrap<CustomerCancellationState>(res.data);
  },

  // Confirma el pago de la penalizacion; devuelve el estado actualizado.
  async confirmPenaltyPayment(
    customerId: string
  ): Promise<CustomerCancellationState> {
    const res = await api.post(
      `/customers/${encodeURIComponent(customerId)}/confirm-penalty-payment`
    );
    return unwrap<CustomerCancellationState>(res.data);
  },
};
