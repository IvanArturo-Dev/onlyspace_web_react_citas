import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { adminModulesService } from "../../services/adminModules.service";
import type { ModuleFlag } from "../../services/adminModules.service";
import { trackEvent } from "../../lib/firebase";
import { pageTitle, subtitle, btn, table, th, td, badge, emptyState, card } from "../../ui/ui";
import Spinner from "../../components/Spinner";

export default function AdminModules() {
  const [items, setItems] = useState<ModuleFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Formulario de creacion / actualizacion.
  const [scope, setScope] = useState<"system" | "tenant">("system");
  const [tenantId, setTenantId] = useState("");
  const [moduleKey, setModuleKey] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    adminModulesService
      .list()
      .then((data) => setItems(data))
      .catch((err) => setError(err?.response?.data?.error?.message || "Error al cargar los modulos"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Admin Modules" });
    load();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = moduleKey.trim();
    if (!key) {
      setFormError("Ingresa la clave del modulo.");
      return;
    }
    if (scope === "tenant" && !tenantId.trim()) {
      setFormError("El tenant_id es requerido para el alcance por emprendedor.");
      return;
    }
    setSubmitting(true);
    setFormError("");
    try {
      await adminModulesService.setFlag({
        scope,
        tenant_id: scope === "tenant" ? tenantId.trim() : null,
        module_key: key,
        enabled,
      });
      setModuleKey("");
      setTenantId("");
      setEnabled(true);
      setScope("system");
      load();
    } catch (err: any) {
      setFormError(err?.response?.data?.error?.message || "No se pudo guardar el modulo.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (row: ModuleFlag) => {
    setBusyId(row.id);
    setError("");
    try {
      await adminModulesService.setFlag({
        scope: row.scope,
        tenant_id: row.tenant_id,
        module_key: row.module_key,
        enabled: !row.enabled,
      });
      load();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || "No se pudo actualizar el modulo.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div style={styles.header}>
        <div>
          <h1 style={pageTitle}>Modulos</h1>
          <p style={{ ...subtitle, marginTop: 4 }}>
            Habilita o deshabilita funcionalidades a nivel de sistema o de emprendedor.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ ...card, ...styles.form }}>
        <div style={styles.formRow}>
          <label style={styles.label}>
            <span style={styles.labelText}>Alcance</span>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as "system" | "tenant")}
              style={styles.control}
              disabled={submitting}
            >
              <option value="system">system</option>
              <option value="tenant">tenant</option>
            </select>
          </label>

          <label style={styles.label}>
            <span style={styles.labelText}>Tenant ID{scope === "tenant" ? " *" : ""}</span>
            <input
              type="text"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder={scope === "tenant" ? "tenant_..." : "(no aplica)"}
              style={styles.control}
              disabled={submitting || scope !== "tenant"}
            />
          </label>

          <label style={styles.label}>
            <span style={styles.labelText}>Clave del modulo *</span>
            <input
              type="text"
              value={moduleKey}
              onChange={(e) => setModuleKey(e.target.value)}
              placeholder="branches, reservations, search..."
              style={styles.control}
              disabled={submitting}
            />
          </label>

          <label style={{ ...styles.label, flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-end" }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={submitting}
            />
            <span style={styles.labelText}>Habilitado</span>
          </label>

          <button type="submit" style={{ ...btn("primary"), alignSelf: "flex-end" }} disabled={submitting}>
            {submitting ? "Guardando..." : "Guardar"}
          </button>
        </div>
        {formError && <p style={{ color: "var(--danger)", margin: "8px 0 0" }}>{formError}</p>}
      </form>

      {loading && (
        <div style={styles.loading}>
          <Spinner /> Cargando...
        </div>
      )}

      {!loading && error && (
        <div>
          <p style={{ color: "var(--danger)", marginBottom: 12 }}>{error}</p>
          <button onClick={load} style={btn("secondary")}>Reintentar</button>
        </div>
      )}

      {!loading && !error && (
        <>
          {items.length === 0 ? (
            <div style={emptyState}>
              <div style={{ fontSize: 34, marginBottom: 8 }}>🧩</div>
              <p style={{ fontWeight: 600, color: "var(--text)" }}>Sin modulos configurados</p>
              <p>Crea un flag para empezar a controlar funcionalidades.</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Alcance</th>
                    <th style={th}>Tenant</th>
                    <th style={th}>Modulo</th>
                    <th style={th}>Estado</th>
                    <th style={{ ...th, textAlign: "right" }}>Accion</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.id}>
                      <td style={td}>
                        <span style={badge(row.scope === "system" ? "info" : "muted")}>{row.scope}</span>
                      </td>
                      <td style={{ ...td, fontFamily: "var(--font-mono, monospace)" }}>
                        {row.tenant_id ?? "system"}
                      </td>
                      <td style={td}>{row.module_key}</td>
                      <td style={td}>
                        {row.enabled ? (
                          <span style={badge("success")}>Habilitado</span>
                        ) : (
                          <span style={badge("danger")}>Deshabilitado</span>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        <button
                          type="button"
                          onClick={() => handleToggle(row)}
                          style={row.enabled ? { ...btn("ghost"), color: "var(--danger)" } : btn("secondary")}
                          disabled={busyId === row.id}
                          aria-busy={busyId === row.id}
                          aria-label={`${row.enabled ? "Deshabilitar" : "Habilitar"} el modulo ${row.module_key}`}
                        >
                          {busyId === row.id ? "Guardando..." : row.enabled ? "Deshabilitar" : "Habilitar"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 20, flexWrap: "wrap" },
  form: { padding: 18, marginBottom: 20 },
  formRow: { display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" },
  label: { display: "flex", flexDirection: "column", gap: 6, minWidth: 180 },
  labelText: { fontSize: 13, fontWeight: 600, color: "var(--text-muted)" },
  control: {
    padding: "8px 10px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border-strong)",
    background: "var(--surface)",
    color: "var(--text)",
    fontSize: 14,
  },
  loading: { display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)" },
};
