import type { CSSProperties } from "react";
import { NavLink } from "react-router-dom";

const links = [
  { to: "/admin", label: "Resumen", end: true },
  { to: "/admin/metrics", label: "Metricas" },
  { to: "/admin/audit", label: "Auditoria" },
];

// Sub-tabs de administracion estilizadas con tokens. La navegacion principal
// del area admin vive en el sidebar del Layout; este componente queda
// disponible como set de sub-tabs reutilizable.
export default function AdminNav() {
  return (
    <nav style={styles.nav}>
      {links.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.end}
          style={({ isActive }) => ({
            ...styles.link,
            ...(isActive ? styles.linkActive : {}),
          })}
        >
          {l.label}
        </NavLink>
      ))}
    </nav>
  );
}

const styles: Record<string, CSSProperties> = {
  nav: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 },
  link: {
    padding: "8px 14px",
    borderRadius: "var(--radius-sm)",
    color: "var(--text-muted)",
    fontWeight: 600,
    fontSize: 14,
    border: "1px solid var(--border)",
    background: "var(--surface)",
  },
  linkActive: { background: "var(--brand-soft)", color: "var(--brand)", borderColor: "var(--brand)" },
};
