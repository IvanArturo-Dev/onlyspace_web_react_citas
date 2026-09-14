import { useState } from "react";
import type { CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import ThemeToggle from "./ThemeToggle";
import { useAuthStore } from "../store/useAuthStore";

interface NavItem {
  label: string;
  to: string;
}

// Enlaces del menu del cliente. El orden refleja la prioridad: descubrir
// (home), luego sus citas y sus cupones.
const NAV_ITEMS: NavItem[] = [
  { label: "Descubrir", to: "/inicio" },
  { label: "Mis citas", to: "/mis-citas" },
  { label: "Mis cupones", to: "/mis-cupones" },
];

/**
 * Barra de navegacion consistente para las pantallas del cliente. Reemplaza los
 * botones sueltos que cada pantalla tenia por un menu unico y coherente:
 *  - Marca "Citas" (lleva a /inicio, el descubrimiento).
 *  - Enlaces con resaltado del activo (aria-current="page").
 *  - ThemeToggle y "Cerrar sesion" a la derecha.
 * Responsiva: en pantallas angostas los enlaces hacen scroll horizontal.
 */
export default function ClientNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useAuthStore((s) => s.logout);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <nav style={styles.nav} aria-label="Navegacion del cliente">
      <button
        type="button"
        style={styles.brand}
        onClick={() => navigate("/inicio")}
        aria-label="Ir al inicio"
      >
        <img src="/onlyspace.png" alt="onlyspace" style={styles.brandLogo} />
      </button>

      <div style={styles.links}>
        {NAV_ITEMS.map((item) => (
          <NavItemLink
            key={item.to}
            item={item}
            active={location.pathname === item.to}
            onClick={() => navigate(item.to)}
          />
        ))}
      </div>

      <div style={styles.actions}>
        <ThemeToggle />
        <button type="button" style={styles.logoutBtn} onClick={handleLogout}>
          Cerrar sesion
        </button>
      </div>
    </nav>
  );
}

function NavItemLink({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-current={active ? "page" : undefined}
      style={{
        ...styles.link,
        ...(active ? styles.linkActive : null),
        ...(!active && hover ? styles.linkHover : null),
      }}
    >
      {item.label}
    </button>
  );
}

const styles: Record<string, CSSProperties> = {
  nav: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 20px",
    background: "var(--bg-elevated, var(--surface))",
    borderBottom: "1px solid var(--border)",
    boxShadow: "var(--shadow-sm)",
    position: "sticky",
    top: 0,
    zIndex: 20,
  },
  brand: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontSize: 20,
    fontWeight: 800,
    letterSpacing: "-0.02em",
    color: "var(--brand)",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 0,
    flexShrink: 0,
    transition: "opacity 0.15s ease",
  },
  links: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flex: 1,
    minWidth: 0,
    overflowX: "auto",
    // Oculta la barra de scroll horizontal manteniendo el desplazamiento.
    scrollbarWidth: "none",
  },
  link: {
    padding: "8px 14px",
    fontSize: 14,
    fontWeight: 600,
    borderRadius: "var(--radius-sm)",
    border: "1px solid transparent",
    background: "transparent",
    color: "var(--text-muted)",
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease",
  },
  linkHover: {
    background: "var(--surface-hover)",
    color: "var(--text)",
  },
  linkActive: {
    background: "var(--brand-soft)",
    color: "var(--brand)",
    borderColor: "var(--brand)",
  },
  brandLogo: { height: 30, width: "auto", objectFit: "contain", display: "block" },
  brandDot: {
    fontSize: 18,
    lineHeight: 1,
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
  },
  logoutBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "9px 14px",
    fontSize: 14,
    fontWeight: 600,
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border-strong)",
    background: "var(--surface)",
    color: "var(--text)",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
};
