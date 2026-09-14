import { useEffect } from "react";
import { create } from "zustand";
import { tenantService } from "../services/tenant.service";

/**
 * Estado compartido del plan premium del tenant. Se resuelve una sola vez
 * (cacheado) y se reutiliza en el Dashboard (badge "Premium") y en las vistas
 * que muestran leyendas "Solo premium" (Sucursales, Colaboradores, Lealtad,
 * Personalizacion). Consulta GET /me/tenant -> is_premium.
 *
 * Es best-effort: si la carga falla, isPremium queda en false (trato como free)
 * sin bloquear la UI. El backend siempre es la fuente de verdad (403
 * PREMIUM_REQUIRED), esto solo mejora la experiencia mostrando el estado.
 */
interface PremiumState {
  isPremium: boolean;
  loading: boolean;
  loaded: boolean;
  /** Carga el estado premium una vez (idempotente salvo force). */
  load: (force?: boolean) => Promise<void>;
  /** Fuerza una recarga del estado premium. */
  refresh: () => void;
  /** Limpia el estado (p. ej. al cerrar sesion). */
  clear: () => void;
}

export const usePremiumStore = create<PremiumState>((set, get) => ({
  isPremium: false,
  loading: false,
  loaded: false,

  load: async (force = false) => {
    if (get().loading) return;
    if (get().loaded && !force) return;
    set({ loading: true });
    try {
      const tenant = await tenantService.getMine();
      set({ isPremium: !!tenant.is_premium, loaded: true, loading: false });
    } catch {
      // Silencioso: si falla, se trata como free y no se bloquea la UI.
      set({ isPremium: false, loaded: true, loading: false });
    }
  },

  refresh: () => {
    void get().load(true);
  },

  clear: () => set({ isPremium: false, loaded: false, loading: false }),
}));

/**
 * Hook de conveniencia para las vistas. Dispara la carga (best-effort, cacheada)
 * al montar y expone { isPremium, loading, refresh }.
 */
export function usePremium(): { isPremium: boolean; loading: boolean; refresh: () => void } {
  const isPremium = usePremiumStore((s) => s.isPremium);
  const loading = usePremiumStore((s) => s.loading);
  const load = usePremiumStore((s) => s.load);
  const refresh = usePremiumStore((s) => s.refresh);

  useEffect(() => {
    void load();
  }, [load]);

  return { isPremium, loading, refresh };
}
