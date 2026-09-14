import { Navigate } from "react-router-dom";

// La entrada por codigo se consolido en el panel de busqueda de sucursal (/buscar),
// que ofrece tanto el input de codigo como la busqueda por nombre.
// Se conserva esta ruta por compatibilidad con enlaces/QR antiguos.
export default function CodeEntry() {
  return <Navigate to="/buscar" replace />;
}
