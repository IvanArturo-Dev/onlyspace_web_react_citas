import api from "./api";

export interface MyAppointment {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  service_name: string;
  business_name: string;
  video_call_url?: string | null;
  modality?: string;
}

// Resena del cliente sobre una cita completada. comment es opcional.
export interface Review {
  id: string;
  appointment_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  updated_at: string;
}

// Negocio marcado como favorito por el cliente. code puede ser null si el
// negocio no expone un codigo publico.
export interface Favorite {
  tenant_id: string;
  business_name: string;
  code: string | null;
}

// Desenvuelve respuestas del backend con forma { success, data }.
function unwrap<T>(data: any): T {
  if (data && typeof data === "object" && "data" in data) return data.data as T;
  return data as T;
}

export const clientService = {
  async myAppointments(): Promise<MyAppointment[]> {
    const res = await api.get("/me/appointments");
    return unwrap<MyAppointment[]>(res.data) ?? [];
  },

  // ------- RESENAS -------
  // Crea o actualiza la resena de una cita (upsert por appointment_id en backend).
  async upsertReview(payload: {
    appointment_id: string;
    rating: number;
    comment?: string | null;
  }): Promise<Review> {
    const res = await api.post("/me/reviews", payload);
    return unwrap<Review>(res.data);
  },

  // Lista las resenas del propio cliente autenticado.
  async getMyReviews(): Promise<Review[]> {
    const res = await api.get("/me/reviews");
    return unwrap<Review[]>(res.data) ?? [];
  },

  // ------- FAVORITOS -------
  // Lista los negocios favoritos del cliente.
  async listFavorites(): Promise<Favorite[]> {
    const res = await api.get("/me/favorites");
    return unwrap<Favorite[]>(res.data) ?? [];
  },

  // Alterna un negocio como favorito. Devuelve el estado resultante (favorited).
  async toggleFavorite(tenantId: string): Promise<{ favorited: boolean }> {
    const res = await api.post(`/me/favorites/${encodeURIComponent(tenantId)}`);
    return unwrap<{ favorited: boolean }>(res.data);
  },
};
