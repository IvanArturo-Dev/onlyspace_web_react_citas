import api from "./api";

export interface PublicService {
  id: string;
  name: string;
  duration_mins: number;
  price: number;
}

export interface PublicBranding {
  logo_url: string | null;
  brand_color: string | null;
  banner_title: string | null;
  banner_text: string | null;
  banner_link: string | null;
}

export interface PublicAd {
  id: string;
  title: string;
  body: string | null;
  image_url: string | null;
  link_url: string | null;
}

export interface PublicInfo {
  business: { name: string };
  branch?: { id: string; name: string };
  services: PublicService[];
  /**
   * Indica si el negocio tiene activas las "sesiones en linea" (toggle del
   * emprendedor + Google conectado). Cuando es true, el portal ofrece elegir
   * modalidad presencial / en linea (Req 3.2, 3.5).
   *
   * NOTA (gating fino): a la fecha el endpoint publico `/public/:code/info` aun
   * NO expone este flag (requiere consultar el GoogleAccount del tenant en el
   * backend, fuera del alcance de esta tarea de frontend). Mientras no se exponga,
   * el portal muestra SOLO modalidad presencial por defecto. En cuanto el backend
   * incluya `online_sessions_enabled` en la respuesta, el selector aparece solo.
   */
  online_sessions_enabled?: boolean;
  /** Flag de suscripcion premium efectiva. Solo entonces vienen branding/ads. */
  is_premium?: boolean;
  /** Personalizacion del emprendedor. Presente solo si is_premium. */
  branding?: PublicBranding;
  /** Anuncios propios activos del emprendedor. Presente solo si is_premium. */
  ads?: PublicAd[];
  /**
   * Promociones vigentes del negocio (Req 5.1). El backend solo las incluye si
   * el negocio es premium; para negocios free llega ausente o vacio.
   */
  promotions?: Array<{
    id: string;
    title: string;
    description: string | null;
    image_url: string | null;
    starts_at: string | null;
    ends_at: string | null;
  }>;
}

export interface BranchSearchResult {
  code: string;
  branch_name: string;
  business_name: string;
}

// Banner del carrusel del landing gestionado por el Super Admin. Shape publico
// reducido devuelto por GET /public/landing-banners.
export interface LandingBanner {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  link_url: string | null;
}

// Personalizacion (branding) de una sucursal en el descubrimiento. Presente
// solo cuando el negocio es premium (Req 3.4).
export interface DiscoverBranding {
  logo_url: string | null;
  brand_color: string | null;
  banner_title: string | null;
  banner_text: string | null;
  banner_link: string | null;
}

// Item devuelto por el descubrimiento de sucursales publicas (Req 1.1).
export interface DiscoverItem {
  business_name: string;
  code: string;
  branch_name: string;
  city: string | null;
  address: string | null;
  is_premium: boolean;
  categories: string[];
  distance_km: number | null;
  branding?: DiscoverBranding;
  // Promedio de calificacion (1-5) de las resenas del negocio; null si no tiene.
  rating_avg: number | null;
  // Cantidad de resenas que componen rating_avg.
  rating_count: number;
  // Promociones vigentes (Req 5.3). Solo negocios premium traen elementos; free
  // llega como [] (o ausente). Opcional para no romper consumidores existentes.
  promotions?: Array<{ id: string; title: string; image_url: string | null }>;
}

// Filtros opcionales para el descubrimiento. Se envian como query params;
// axios omite automaticamente las claves con valor undefined.
export interface DiscoverParams {
  q?: string;
  category?: string;
  lat?: number;
  lng?: number;
  radius_km?: number;
}

export interface Slot {
  start: string;
  end: string;
}

export interface PublicAvailability {
  date: string;
  service_id: string;
  slots: Slot[];
}

// Desenvuelve respuestas del backend con forma { success, data }.
function unwrap<T>(data: any): T {
  if (data && typeof data === "object" && "data" in data) return data.data as T;
  return data as T;
}

export const publicBookingService = {
  async getInfo(code: string): Promise<PublicInfo> {
    const res = await api.get(`/public/${encodeURIComponent(code)}/info`);
    return unwrap<PublicInfo>(res.data);
  },

  async getAvailability(code: string, service_id: string, date: string): Promise<PublicAvailability> {
    const res = await api.get(`/public/${encodeURIComponent(code)}/availability`, {
      params: { service_id, date },
    });
    return unwrap<PublicAvailability>(res.data);
  },

  async book(
    code: string,
    payload: {
      service_id: string;
      start_time: string;
      // Modalidad de la cita. El backend detecta "en linea" por modality === 'online'
      // o location === 'En linea'. Solo se envia cuando el negocio ofrece sesiones
      // en linea (online_sessions_enabled).
      modality?: "in_person" | "online";
    }
  ): Promise<{ id?: string; video_call_url?: string; [key: string]: unknown }> {
    const res = await api.post(`/public/${encodeURIComponent(code)}/appointments`, payload);
    return unwrap<{ id?: string; video_call_url?: string }>(res.data);
  },

  /**
   * Busqueda basica de sucursales por nombre de negocio o de sucursal.
   * Llama a GET /v1/public/search?q= (datos no sensibles).
   * El backend devuelve `{ results: BranchSearchResult[] }`.
   */
  async searchBranches(q: string): Promise<BranchSearchResult[]> {
    const res = await api.get(`/public/search`, { params: { q } });
    const data = unwrap<{ results?: BranchSearchResult[] } | BranchSearchResult[]>(res.data);
    if (Array.isArray(data)) return data;
    return data?.results ?? [];
  },

  /**
   * Descubrimiento de sucursales publicas con filtros opcionales (texto,
   * categoria, geolocalizacion). Llama a GET /public/discover; axios omite los
   * params undefined. El backend devuelve `{ items: DiscoverItem[] }` (Req 1.1).
   */
  async discover(params: DiscoverParams = {}): Promise<DiscoverItem[]> {
    const res = await api.get(`/public/discover`, { params });
    const data = unwrap<{ items?: DiscoverItem[] } | DiscoverItem[]>(res.data);
    return Array.isArray(data) ? data : data?.items ?? [];
  },

  /**
   * Lista de categorias disponibles para filtrar el descubrimiento.
   * Llama a GET /public/categories; el backend devuelve `{ categories: string[] }`.
   */
  async getCategories(): Promise<string[]> {
    const res = await api.get(`/public/categories`);
    const data = unwrap<{ categories?: string[] } | string[]>(res.data);
    return Array.isArray(data) ? data : data?.categories ?? [];
  },

  /**
   * Banners del carrusel del landing gestionados por el Super Admin (activos,
   * ordenados por sort_order). Llama a GET /public/landing-banners; el backend
   * devuelve `{ success, data: { banners: LandingBanner[] } }`.
   */
  async getLandingBanners(): Promise<LandingBanner[]> {
    const res = await api.get(`/public/landing-banners`);
    const data = unwrap<{ banners?: LandingBanner[] } | LandingBanner[]>(res.data);
    return Array.isArray(data) ? data : data?.banners ?? [];
  },
};
