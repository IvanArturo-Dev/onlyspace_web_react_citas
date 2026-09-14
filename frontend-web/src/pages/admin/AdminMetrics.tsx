import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { adminService } from "../../services/admin.service";
import { trackEvent } from "../../lib/firebase";
import type { GlobalMetrics, TenantSummary } from "../../types/admin";
import { card, pageTitle, btn, field, table, th, td } from "../../ui/ui";
import Spinner from "../../components/Spinner";

function formatPercent(value: number): string {
  if (value == null || Number.isNaN(value)) return "0%";
  // Acepta tasas en fraccion (0-1) o ya en porcentaje.
  const pct = value <= 1 ? value * 100 : value;
  return `${pct.toFixed(1)}%`;
}

function formatMoney(value: number): string {
  if (value == null || Number.isNaN(value)) return "0";
  return value.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AdminMetrics() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [tenants, setTenants] = useState<TenantSummary[]>([]);

  const [metrics, setMetrics] = useState<GlobalMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadMetrics = () => {
    setLoading(true);
    setError("");
    adminService
      .getMetrics({
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        tenant_id: tenantId || undefined,
      })
      .then((data) => setMetrics(data))
      .catch((err) => setError(err?.response?.data?.error?.message || "Error al cargar las metricas"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Admin Metrics" });
    adminService
      .getTenants()
      .then((data) => setTenants(data))
      .catch(() => setTenants([]));
    loadMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <h1 style={pageTitle}>Metricas globales</h1>

      <div style={styles.controls}>
        <div style={{ ...field, marginBottom: 0 }}>
          <label htmlFor="metrics-start">Desde</label>
          <input id="metrics-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={styles.input} />
        </div>
        <div style={{ ...field, marginBottom: 0 }}>
          <label htmlFor="metrics-end">Hasta</label>
          <input id="metrics-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={styles.input} />
        </div>
        <div style={{ ...field, marginBottom: 0 }}>
          <label htmlFor="metrics-tenant">Tenant</label>
          <select id="metrics-tenant" value={tenantId} onChange={(e) => setTenantId(e.target.value)} style={styles.input}>
            <option value="">Todos</option>
            {tenants.map((t) => (
              <option key={t.tenant_id} value={t.tenant_id}>{t.name}</option>
            ))}
          </select>
        </div>
        <button onClick={loadMetrics} style={btn("primary")} disabled={loading}>
          {loading ? "Cargando..." : "Aplicar"}
        </button>
      </div>

      {loading && (
        <div style={styles.loading}>
          <Spinner /> Cargando...
        </div>
      )}

      {error && (
        <div>
          <p style={{ color: "var(--danger)", marginBottom: 12 }}>{error}</p>
          <button onClick={loadMetrics} style={btn("secondary")}>Reintentar</button>
        </div>
      )}

      {!loading && !error && metrics && (
        <>
          <div style={styles.cards}>
            <Card label="Ingresos totales" value={formatMoney(metrics.income_total)} />
            <Card label="Ocupacion" value={formatPercent(metrics.occupancy_rate)} />
            <Card label="No-show" value={formatPercent(metrics.no_show_rate)} />
          </div>

          <h2 style={styles.subtitle}>Ingresos por tenant</h2>
          {metrics.income_by_tenant?.length ? (
            <div style={{ overflowX: "auto" }}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Tenant</th>
                    <th style={{ ...th, textAlign: "right" }}>Ingresos</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.income_by_tenant.map((row) => (
                    <tr key={row.tenant_id}>
                      <td style={td}>{row.tenant_name || row.tenant_id}</td>
                      <td style={{ ...td, textAlign: "right" }}>{formatMoney(row.income)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ color: "var(--text-muted)" }}>Sin datos de ingresos por tenant.</p>
          )}
        </>
      )}
    </div>
  );
}

function Card({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ ...card, ...styles.card }}>
      <div style={styles.cardValue}>{value}</div>
      <div style={styles.cardLabel}>{label}</div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  subtitle: { fontSize: 18, fontWeight: 700, color: "var(--text)", margin: "32px 0 14px" },
  controls: { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", margin: "20px 0" },
  input: { minWidth: 170 },
  loading: { display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)" },
  cards: { display: "flex", flexWrap: "wrap", gap: 14 },
  card: { flex: "1 1 170px", minWidth: 170, padding: 18 },
  cardValue: { fontSize: 24, fontWeight: 700, color: "var(--text)" },
  cardLabel: { fontSize: 13, color: "var(--text-muted)", marginTop: 6, fontWeight: 600 },
};
