import { useAuthStore } from "./useAuthStore";

// Selector hook derivado del rol del usuario firmado en el JWT.
// Evita duplicar estado: el rol SUPERADMIN se decide a partir de `user.role`.
export function useIsSuperAdmin(): boolean {
  return useAuthStore((s) => s.user?.role === "SUPERADMIN");
}
