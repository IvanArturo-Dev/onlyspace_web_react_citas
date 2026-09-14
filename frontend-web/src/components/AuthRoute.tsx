import { Navigate } from "react-router-dom";
import { useAuthStore } from "../store/useAuthStore";
import { FullScreenLoader } from "./Spinner";

// Requiere unicamente estar autenticado (cualquier rol). Pensado para /mis-citas.
export default function AuthRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return <FullScreenLoader />;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
