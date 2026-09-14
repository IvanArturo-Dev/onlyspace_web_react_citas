import api from "./api";

// Promocion informativa por sucursal. Coincide con el modelo del backend.
export interface Promotion {
  id: string;
  branch_id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Datos de entrada para crear/editar una promocion.
export interface PromotionInput {
  title: string;
  description?: string | null;
  image_url?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  is_active?: boolean;
}

// Desenvuelve respuestas del backend con forma { success, data }.
function unwrap<T>(data: any): T {
  if (data && typeof data === "object" && "data" in data) return data.data as T;
  return data as T;
}

export const promotionService = {
  async list(branchId: string): Promise<Promotion[]> {
    const res = await api.get(`/branches/${branchId}/promotions`);
    return unwrap<Promotion[]>(res.data) ?? [];
  },

  async create(branchId: string, input: PromotionInput): Promise<Promotion> {
    const res = await api.post(`/branches/${branchId}/promotions`, input);
    return unwrap<Promotion>(res.data);
  },

  async update(branchId: string, promoId: string, input: PromotionInput): Promise<Promotion> {
    const res = await api.patch(`/branches/${branchId}/promotions/${promoId}`, input);
    return unwrap<Promotion>(res.data);
  },

  async remove(branchId: string, promoId: string): Promise<{ id: string }> {
    const res = await api.delete(`/branches/${branchId}/promotions/${promoId}`);
    return unwrap<{ id: string }>(res.data);
  },
};
