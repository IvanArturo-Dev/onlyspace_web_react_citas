import { Navigate } from "react-router-dom";
import { useAuthStore } from "../store/useAuthStore";
import { useImpersonation } from "../store/useImpersonation";
import { FullScreenLoader } from "./Spinner";

export default function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuthStore();
  const impersonating = useImpersonation((st) => st.isImpersonating);

  if (isLoading) {
    return <FullScreenLoader />;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (user?.role !== "SUPERADMIN") {
    return <Navigate to="/" replace />;
  }
  // Mientras el super admin esta impersonando ("Actuar como"), su token efectivo
  // es del tenant y los endpoints /admin devolverian 403. Lo llevamos al contexto
  // del negocio (/). Para volver al panel de super admin debe usar "Salir" del banner.
  if (impersonating) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
