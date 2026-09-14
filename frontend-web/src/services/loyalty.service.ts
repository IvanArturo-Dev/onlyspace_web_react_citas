import api from "./api";

// Servicio compartido de lealtad. Envuelve los endpoints /v1/loyalty y desenvuelve
// las respuestas del backend con forma { success, data }.
// Lo consumen la seccion de emprendedor (Lealtad), el cliente (MyAppointments) y el
// panel de super admin (metricas), por lo que los tipos reflejan el backend.

export type LoyaltyProgramType = "ACCUMULATION" | "PERIODIC";
// Estados de una recompensa. "CLAIMED" = reclamada por el cliente (genera claim_code)
// pero aun no canjeada por el staff; "REDEEMED" = ya canjeada.
export type LoyaltyRewardStatus = "EARNED" | "CLAIMED" | "REDEEMED" | "EXPIRED";

export interface LoyaltyProgram {
  id: string;
  tenant_id: string;
  name: string;
  type: LoyaltyProgramType;
  goal: number;
  window_days: number | null;
  reward_text: string;
  validity_days: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LoyaltyReward {
  id: string;
  tenant_id: string;
  program_id: string;
  customer_id: string;
  status: LoyaltyRewardStatus;
  reward_text: string;
  earned_at: string;
  expires_at: string | null;
  redeemed_at: string | null;
  redeemed_by: string | null;
  // Codigo generado al reclamar la recompensa (cupon). null hasta que se reclama.
  claim_code: string | null;
  // Momento en que el cliente reclamo la recompensa. null si aun no se reclama.
  claimed_at: string | null;
}

// Metricas por tenant. Coincide con loyaltyService.statsForTenant del backend.
export interface LoyaltyStats {
  activePrograms: number;
  rewardsEarned: number;
  rewardsRedeemed: number;
  rewardsPending: number;
  rewardsExpired: number;
}

// Progreso por programa para la vista del cliente (tareas 8/9).
export interface LoyaltyProgress {
  program: {
    id: string;
    name: string;
    type: LoyaltyProgramType;
    goal: number;
    window_days: number | null;
    reward_text: string;
  };
  count: number;
}

// Entrada para crear/editar programas. window_days y validity_days son opcionales
// (validity_days vacio = sin vencimiento; window_days solo aplica a PERIODIC).
export interface LoyaltyProgramInput {
  name: string;
  type: LoyaltyProgramType;
  goal: number;
  window_days?: number | null;
  reward_text: string;
  validity_days?: number | null;
}

export interface RewardsQuery {
  status?: LoyaltyRewardStatus;
  customerId?: string;
}

// Respuesta de GET /v1/me/loyalty para la vista del cliente (tarea 8).
// Progreso por programa activo + recompensas propias del cliente.
export interface MyLoyalty {
  progress: LoyaltyProgress[];
  rewards: LoyaltyReward[];
}

// Desenvuelve respuestas del backend con forma { success, data }.
function unwrap<T>(data: any): T {
  if (data && typeof data === "object" && "data" in data) return data.data as T;
  return data as T;
}

export const loyaltyService = {
  // ------- PROGRAMAS -------
  async listPrograms(): Promise<LoyaltyProgram[]> {
    const res = await api.get("/loyalty/programs");
    return unwrap<LoyaltyProgram[]>(res.data) ?? [];
  },

  async getProgram(id: string): Promise<LoyaltyProgram> {
    const res = await api.get(`/loyalty/programs/${id}`);
    return unwrap<LoyaltyProgram>(res.data);
  },

  async createProgram(input: LoyaltyProgramInput): Promise<LoyaltyProgram> {
    const res = await api.post("/loyalty/programs", input);
    return unwrap<LoyaltyProgram>(res.data);
  },

  async updateProgram(id: string, input: Partial<LoyaltyProgramInput>): Promise<LoyaltyProgram> {
    const res = await api.patch(`/loyalty/programs/${id}`, input);
    return unwrap<LoyaltyProgram>(res.data);
  },

  async setProgramActive(id: string, active: boolean): Promise<LoyaltyProgram> {
    const res = await api.patch(`/loyalty/programs/${id}/active`, { active });
    return unwrap<LoyaltyProgram>(res.data);
  },

  // ------- RECOMPENSAS -------
  async listRewards(query: RewardsQuery = {}): Promise<LoyaltyReward[]> {
    const params: Record<string, string> = {};
    if (query.status) params.status = query.status;
    if (query.customerId) params.customer_id = query.customerId;
    const res = await api.get("/loyalty/rewards", { params });
    return unwrap<LoyaltyReward[]>(res.data) ?? [];
  },

  // Canje por parte del staff/emprendedor. Opcionalmente acepta el claim_code del
  // cupon presentado por el cliente; si viene, se envia en el body para validarlo.
  async redeemReward(id: string, claimCode?: string): Promise<LoyaltyReward> {
    const body = claimCode ? { claim_code: claimCode } : undefined;
    const res = await api.patch(`/loyalty/rewards/${id}/redeem`, body);
    return unwrap<LoyaltyReward>(res.data);
  },

  // ------- METRICAS -------
  async getStats(): Promise<LoyaltyStats> {
    const res = await api.get("/loyalty/stats");
    return unwrap<LoyaltyStats>(res.data);
  },

  // ------- CLIENTE -------
  // Progreso y recompensas del propio cliente autenticado. El backend limita los
  // datos al cliente que hace la llamada; si no existe registro devuelve vacio.
  async getMyLoyalty(): Promise<MyLoyalty> {
    const res = await api.get("/me/loyalty");
    const data = unwrap<MyLoyalty>(res.data);
    return { progress: data?.progress ?? [], rewards: data?.rewards ?? [] };
  },

  // Reclama una recompensa ganada (status EARNED -> CLAIMED). El backend genera y
  // devuelve la recompensa actualizada con claim_code y claimed_at.
  async claimReward(id: string): Promise<LoyaltyReward> {
    const res = await api.post(`/me/rewards/${id}/claim`);
    return unwrap<LoyaltyReward>(res.data);
  },

  // Cupones del propio cliente (recompensas reclamadas y su estado).
  async getMyCoupons(): Promise<LoyaltyReward[]> {
    const res = await api.get("/me/coupons");
    return unwrap<LoyaltyReward[]>(res.data) ?? [];
  },

  // ------- METRICAS GLOBALES (super admin) -------
  // Envuelve GET /v1/admin/loyalty/stats. Solo super admin.
  async getGlobalStats(): Promise<LoyaltyGlobalStats> {
    const res = await api.get("/admin/loyalty/stats");
    return unwrap<LoyaltyGlobalStats>(res.data);
  },
};

// Metricas agregadas globales para el panel de super admin.
// Coincide con loyaltyService.globalStats del backend (GET /v1/admin/loyalty/stats).
export interface LoyaltyGlobalStats {
  totalPrograms: number;
  activePrograms: number;
  totalRewards: number;
  rewardsEarned: number;
  rewardsRedeemed: number;
  rewardsExpired: number;
}
