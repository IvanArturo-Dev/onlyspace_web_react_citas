import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./store/useAuthStore";
import { useImpersonation } from "./store/useImpersonation";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import SuperAdminRoute from "./components/SuperAdminRoute";
import AuthRoute from "./components/AuthRoute";
import Login from "./pages/Login";
import CodeEntry from "./pages/public/CodeEntry";
import BuscarSucursal from "./pages/public/BuscarSucursal";
import BookingPortal from "./pages/public/BookingPortal";
import Landing from "./pages/public/Landing";
import Terminos from "./pages/public/Terminos";
import Privacidad from "./pages/public/Privacidad";
import MyAppointments from "./pages/client/MyAppointments";
import MisCupones from "./pages/client/MisCupones";
import Dashboard from "./pages/Dashboard";
import Appointments from "./pages/Appointments";
import Customers from "./pages/Customers";
import Services from "./pages/Services";
import Horarios from "./pages/Horarios";
import Sucursales from "./pages/Sucursales";
import Asuetos from "./pages/Asuetos";
import Asistentes from "./pages/Asistentes";
import Lealtad from "./pages/Lealtad";
import MiCodigo from "./pages/MiCodigo";
import Marketing from "./pages/Marketing";
import Promociones from "./pages/Promociones";
import Profile from "./pages/Profile";
import GuiaUso from "./pages/GuiaUso";
import Suscripcion from "./pages/Suscripcion";
import SuscripcionRetorno from "./pages/SuscripcionRetorno";
import AdminOverview from "./pages/admin/AdminOverview";
import AdminTenants from "./pages/admin/AdminTenants";
import AdminRealtime from "./pages/admin/AdminRealtime";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminModules from "./pages/admin/AdminModules";
import AdminMetrics from "./pages/admin/AdminMetrics";
import AdminLoyalty from "./pages/admin/AdminLoyalty";
import AdminAudit from "./pages/admin/AdminAudit";
import AdminAuthorizations from "./pages/admin/AdminAuthorizations";
import AdminLanding from "./pages/admin/AdminLanding";

// Redirige la ruta desconocida a un destino sensato segun el estado/rol.
// Para visitantes NO autenticados muestra la landing publica (Req 1.1, 1.4).
function RoleHome() {
  const { isAuthenticated, isLoading, user } = useAuthStore();
  const impersonating = useImpersonation((st) => st.isImpersonating);
  if (isLoading) return null;
  if (!isAuthenticated) return <Landing />;
  // Si el super admin esta impersonando, su home es el area de gestion del negocio.
  if (user?.role === "SUPERADMIN" && !impersonating) return <Navigate to="/admin" replace />;
  if (user?.role === "SUPERADMIN") return <Navigate to="/" replace />;
  // Cliente (sin perfil de emprendedor): su home es el descubrimiento de sucursales
  // cerca de el (Landing en /inicio), con navegacion por menu consistente.
  if (user?.role === "CLIENT") return <Navigate to="/inicio" replace />;
  // ADMIN (emprendedor) y ASSISTANT (sub-usuario del emprendedor) usan el area de gestion.
  return <Navigate to="/" replace />;
}

export default function App() {
  const init = useAuthStore((s) => s.init);

  useEffect(() => {
    init();
  }, [init]);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* Landing publica accesible directamente (Req 1.1). "/" para no autenticados
          tambien la muestra (via ProtectedRoute -> /inicio). */}
      <Route path="/inicio" element={<Landing />} />
      {/* Rutas publicas: no requieren estar logueado para ver info/slots. */}
      {/* Panel publico de busqueda de sucursal (por codigo o por nombre). */}
      <Route path="/buscar" element={<BuscarSucursal />} />
      {/* /codigo se mantiene por compatibilidad (redirige al panel de busqueda). */}
      <Route path="/codigo" element={<CodeEntry />} />
      <Route path="/reservar/:code" element={<BookingPortal />} />
      {/* Paginas legales publicas (Terminos y Aviso de Privacidad). */}
      <Route path="/terminos" element={<Terminos />} />
      <Route path="/privacidad" element={<Privacidad />} />
      {/* Citas del cliente: requiere sesion (cualquier rol). */}
      <Route
        path="/mis-citas"
        element={
          <AuthRoute>
            <MyAppointments />
          </AuthRoute>
        }
      />
      {/* Panel "Mis cupones": progreso de lealtad y recompensas del cliente. */}
      <Route
        path="/mis-cupones"
        element={
          <AuthRoute>
            <MisCupones />
          </AuthRoute>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="appointments" element={<Appointments />} />
        <Route path="customers" element={<Customers />} />
        <Route path="asistentes" element={<Asistentes />} />
        <Route path="lealtad" element={<Lealtad />} />
        <Route path="sucursales" element={<Sucursales />} />
        <Route path="services" element={<Services />} />
        <Route path="horarios" element={<Horarios />} />
        <Route path="asuetos" element={<Asuetos />} />
        <Route path="mi-codigo" element={<MiCodigo />} />
        <Route path="marketing" element={<Marketing />} />
        <Route path="promociones" element={<Promociones />} />
        <Route path="suscripcion" element={<Suscripcion />} />
        <Route path="suscripcion/retorno" element={<SuscripcionRetorno />} />
        <Route path="profile" element={<Profile />} />
        <Route path="guia" element={<GuiaUso />} />
      </Route>
      <Route
        path="/admin"
        element={
          <SuperAdminRoute>
            <Layout />
          </SuperAdminRoute>
        }
      >
        <Route index element={<AdminOverview />} />
        <Route path="landing" element={<AdminLanding />} />
        <Route path="realtime" element={<AdminRealtime />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="tenants" element={<AdminTenants />} />
        <Route path="modules" element={<AdminModules />} />
        <Route path="metrics" element={<AdminMetrics />} />
        <Route path="loyalty" element={<AdminLoyalty />} />
        <Route path="audit" element={<AdminAudit />} />
        <Route path="authorizations" element={<AdminAuthorizations />} />
      </Route>
      <Route path="*" element={<RoleHome />} />
    </Routes>
  );
}
