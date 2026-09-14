import api from "./api";

// Servicio de personalizacion del emprendedor (branding + anuncios propios).
// Envuelve los endpoints /v1/me/branding y /v1/me/ads y desenvuelve las respuestas
// del backend con forma { success, data }. Lo consume la pagina Marketing (ADMIN).

export interface Branding {
  logo_url: string | null;
  brand_color: string | null;
  banner_title: string | null;
  banner_text: string | null;
  banner_link: string | null;
}

// Cualquier subconjunto de los campos de branding puede actualizarse.
export type BrandingInput = Partial<Branding>;

export interface Ad {
  id: string;
  title: string;
  body: string | null;
  image_url: string | null;
  link_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Entrada para crear/editar un anuncio. title es obligatorio al crear.
export interface AdInput {
  title: string;
  body?: string | null;
  image_url?: string | null;
  link_url?: string | null;
  is_active?: boolean;
}

// Desenvuelve respuestas del backend con forma { success, data }.
function unwrap<T>(data: any): T {
  if (data && typeof data === "object" && "data" in data) return data.data as T;
  return data as T;
}

export const brandingService = {
  // ------- BRANDING -------
  async getBranding(): Promise<Branding> {
    const res = await api.get("/me/branding");
    return unwrap<Branding>(res.data);
  },

  async updateBranding(data: BrandingInput): Promise<Branding> {
    const res = await api.patch("/me/branding", data);
    return unwrap<Branding>(res.data);
  },

  // ------- ANUNCIOS -------
  async listAds(): Promise<Ad[]> {
    const res = await api.get("/me/ads");
    return unwrap<Ad[]>(res.data) ?? [];
  },

  async createAd(input: AdInput): Promise<Ad> {
    const res = await api.post("/me/ads", input);
    return unwrap<Ad>(res.data);
  },

  async updateAd(id: string, input: Partial<AdInput>): Promise<Ad> {
    const res = await api.patch(`/me/ads/${id}`, input);
    return unwrap<Ad>(res.data);
  },

  async deleteAd(id: string): Promise<{ id: string }> {
    const res = await api.delete(`/me/ads/${id}`);
    return unwrap<{ id: string }>(res.data);
  },
};
