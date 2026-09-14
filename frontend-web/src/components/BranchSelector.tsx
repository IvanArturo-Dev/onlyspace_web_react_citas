import { useEffect } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useBranchStore } from "../store/useBranchStore";
import Spinner from "./Spinner";

// Selector reutilizable de la sucursal activa. Se muestra arriba en cada pagina
// de configuracion del emprendedor. Poblado y persistido por el store.
export default function BranchSelector() {
  const { branches, activeBranchId, loading, error, setActiveBranch, loadBranches } = useBranchStore();

  useEffect(() => {
    if (branches.length === 0) loadBranches();
  }, [branches.length, loadBranches]);

  if (loading && branches.length === 0) {
    return (
      <div style={{ ...styles.wrap, color: "var(--text-muted)" }}>
        <Spinner /> Cargando sucursales...
      </div>
    );
  }

  if (error && branches.length === 0) {
    return (
      <div style={styles.wrap}>
        <span style={{ color: "var(--danger)", fontSize: 14 }}>{error}</span>
        <button style={styles.retryBtn} onClick={() => loadBranches()}>
          Reintentar
        </button>
      </div>
    );
  }

  if (branches.length === 0) {
    return (
      <div style={styles.wrap}>
        <span style={{ color: "var(--text-muted)", fontSize: 14 }}>
          No tienes sucursales todavia.
        </span>
        <Link to="/sucursales" style={styles.link}>
          Crear sucursal
        </Link>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <span style={styles.label}>Sucursal</span>
      <select
        value={activeBranchId ?? ""}
        onChange={(e) => setActiveBranch(e.target.value)}
        style={styles.select}
        aria-label="Sucursal activa"
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
            {b.status !== "active" ? " (inactiva)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
    flexWrap: "wrap",
  },
  label: {
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
  },
  select: {
    padding: "8px 10px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border-strong)",
    background: "var(--surface)",
    color: "var(--text)",
    fontSize: 14,
    minWidth: 200,
  },
  link: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--brand)",
  },
  retryBtn: {
    padding: "6px 12px",
    fontSize: 13,
    fontWeight: 600,
    borderRadius: "var(--radius-sm)",
    background: "var(--surface)",
    color: "var(--text)",
    border: "1px solid var(--border-strong)",
  },
};
