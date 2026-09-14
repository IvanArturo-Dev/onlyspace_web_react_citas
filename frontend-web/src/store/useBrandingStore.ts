import { create } from "zustand";
import { brandingService, type Branding, type BrandingInput } from "../services/branding.service";

/**
 * Estado compartido de la personalizacion (branding) del emprendedor: logo,
 * color de marca, titulo/banner. Vive en un store para que el menu (Layout) y
 * el Dashboard reflejen la misma marca y se ACTUALICEN al instante cuando el
 * emprendedor guarda en Personalizacion (save()), sin recargar la pagina.
 *
 * Es la vista interna del emprendedor; no depende de la suscripcion premium
 * (esa solo controla lo que ve el cliente en el portal publico).
 */
interface BrandingState {
  branding: Branding | null;
  loaded: boolean;
  loading: boolean;
  /** Carga el branding una vez (idempotente salvo force). */
  load: (force?: boolean) => Promise<void>;
  /** Guarda cambios y actualiza el store con la respuesta del backend. */
  save: (data: BrandingInput) => Promise<Branding>;
  /** Limpia el estado (p. ej. al cerrar sesion). */
  clear: () => void;
}

export const useBrandingStore = create<BrandingState>((set, get) => ({
  branding: null,
  loaded: false,
  loading: false,

  load: async (force = false) => {
    if (get().loading) return;
    if (get().loaded && !force) return;
    set({ loading: true });
    try {
      const branding = await brandingService.getBranding();
      set({ branding, loaded: true, loading: false });
    } catch {
      // Silencioso: si falla (p. ej. rol sin acceso), no bloquea la UI.
      set({ loaded: true, loading: false });
    }
  },

  save: async (data) => {
    const branding = await brandingService.updateBranding(data);
    set({ branding, loaded: true });
    return branding;
  },

  clear: () => set({ branding: null, loaded: false, loading: false }),
}));
