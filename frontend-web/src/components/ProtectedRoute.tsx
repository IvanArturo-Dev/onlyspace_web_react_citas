import { Navigate } from "react-router-dom";
import { useAuthStore } from "../store/useAuthStore";
import { useImpersonation } from "../store/useImpersonation";
import { FullScreenLoader } from "./Spinner";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuthStore();
  const impersonating = useImpersonation((st) => st.isImpersonating);

  if (isLoading) {
    return <FullScreenLoader />;
  }
  if (!isAuthenticated) {
    // Un visitante no autenticado que llega a "/" ve la landing publica (Req 1.1),
    // no la pantalla de login. Desde la landing puede iniciar sesion.
    return <Navigate to="/inicio" replace />;
  }
  // Los superadmin no usan el area de gestion: se les redirige a su area /admin.
  // EXCEPCION: si el super admin esta impersonando ("Actuar como"), su token es de
  // un tenant (rol ADMIN) y SI usa el area de gestion. Sin esto se produce un bucle:
  // ProtectedRoute -> /admin -> SuperAdminRoute(impersona) -> / -> ...
  if (user?.role === "SUPERADMIN" && !impersonating) {
    return <Navigate to="/admin" replace />;
  }
  // Los clientes no ven la gestion: se les envia a sus citas.
  if (user?.role === "CLIENT") {
    return <Navigate to="/mis-citas" replace />;
  }
  return <>{children}</>;
}
