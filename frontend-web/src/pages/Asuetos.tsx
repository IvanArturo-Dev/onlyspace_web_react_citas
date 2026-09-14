import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import BranchSelector from "../components/BranchSelector";
import Spinner from "../components/Spinner";
import { trackEvent } from "../lib/firebase";
import { branchService, type Holiday } from "../services/branch.service";
import { useBranchStore } from "../store/useBranchStore";
import { pageTitle, subtitle, btn, table, th, td, emptyState } from "../ui/ui";

// Formatea "YYYY-MM-DD" a una fecha legible sin desfase por zona horaria.
function formatDate(value: string): string {
  const iso = value.length >= 10 ? value.slice(0, 10) : value;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return value;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export default function Asuetos() {
  const { activeBranchId } = useBranchStore();

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [date, setDate] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Asuetos" });
  }, []);

  useEffect(() => {
    if (!activeBranchId) {
      setHolidays([]);
      return;
    }
    load(activeBranchId);
  }, [activeBranchId]);

  const load = (branchId: string) => {
    setLoading(true);
    setError("");
    branchService
      .listHolidays(branchId)
      .then((data) => setHolidays(data))
      .catch((err) => setError(readError(err, "Error al cargar los dias de asueto")))
      .finally(() => setLoading(false));
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBranchId) return;
    if (!date) {
      setFormError("Selecciona una fecha.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      await branchService.addHoliday(activeBranchId, { date, label: label.trim() || undefined });
      setDate("");
      setLabel("");
      load(activeBranchId);
    } catch (err) {
      setFormError(readError(err, "No se pudo agregar el dia de asueto"));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (h: Holiday) => {
    if (!activeBranchId) return;
    if (!window.confirm(`Eliminar el dia de asueto del ${formatDate(h.date)}?`)) return;
    setBusyId(h.id);
    setError("");
    try {
      await branchService.removeHoliday(activeBranchId, h.id);
      load(activeBranchId);
    } catch (err) {
      setError(readError(err, "No se pudo eliminar el dia de asueto"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div style={styles.header}>
        <h1 style={pageTitle}>Dias de asueto</h1>
        <p style={subtitle}>Fechas en las que la sucursal no atiende. Se excluyen de la disponibilidad.</p>
      </div>

      <BranchSelector />

      {!activeBranchId ? (
        <div style={emptyState}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>🏢</div>
          <p style={{ fontWeight: 600, color: "var(--text)" }}>Selecciona una sucursal</p>
          <p>Elige una sucursal activa para gestionar sus dias de asueto.</p>
        </div>
      ) : (
        <>
          <form onSubmit={handleAdd} style={styles.form}>
            {formError && <div style={{ ...styles.formError, gridColumn: "1 / -1" }}>{formError}</div>}
            <div style={styles.field}>
              <label htmlFor="holiday-date">Fecha *</label>
              <input id="holiday-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div style={styles.field}>
              <label htmlFor="holiday-label">Etiqueta</label>
              <input
                id="holiday-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Ej. Dia festivo"
              />
            </div>
            <button type="submit" style={{ ...btn("primary"), alignSelf: "end" }} disabled={saving}>
              {saving ? "Agregando..." : "Agregar"}
            </button>
          </form>

          {loading && (
            <div style={styles.loading}>
              <Spinner /> Cargando...
            </div>
          )}

          {error && !loading && (
            <div>
              <p style={{ color: "var(--danger)", marginBottom: 12 }}>{error}</p>
              <button onClick={() => activeBranchId && load(activeBranchId)} style={btn("secondary")}>
                Reintentar
              </button>
            </div>
          )}

          {!loading && !error && holidays.length === 0 && (
            <div style={emptyState}>
              <div style={{ fontSize: 34, marginBottom: 8 }}>📅</div>
              <p style={{ fontWeight: 600, color: "var(--text)" }}>Sin dias de asueto</p>
              <p>Agrega las fechas en las que esta sucursal no atiende.</p>
            </div>
          )}

          {!loading && !error && holidays.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Fecha</th>
                    <th style={th}>Etiqueta</th>
                    <th style={{ ...th, textAlign: "right" }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {holidays.map((h) => (
                    <tr key={h.id}>
                      <td style={{ ...td, textTransform: "capitalize" }}>{formatDate(h.date)}</td>
                      <td style={td}>{h.label || "—"}</td>
                      <td style={{ ...td, textAlign: "right" }}>
                        <button
                          style={{ ...btn("ghost"), padding: "6px 12px", fontSize: 13, color: "var(--danger)" }}
                          onClick={() => handleRemove(h)}
                          disabled={busyId === h.id}
                        >
                          {busyId === h.id ? "..." : "Eliminar"}
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

function readError(err: any, fallback: string): string {
  return err?.response?.data?.error?.message || err?.message || fallback;
}

const styles: Record<string, CSSProperties> = {
  header: { marginBottom: 20 },
  loading: { display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)" },
  form: {
    display: "grid",
    gridTemplateColumns: "minmax(160px, 220px) 1fr auto",
    gap: 12,
    alignItems: "start",
    marginBottom: 24,
    flexWrap: "wrap",
  },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  formError: { background: "var(--danger-soft)", color: "var(--danger)", padding: 10, borderRadius: "var(--radius-sm)", fontSize: 14 },
};
