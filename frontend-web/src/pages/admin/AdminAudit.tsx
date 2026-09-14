import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { adminService } from "../../services/admin.service";
import { trackEvent } from "../../lib/firebase";
import type { AuditEntry, Paginated, TenantSummary } from "../../types/admin";
import { pageTitle, btn, field, table, th, td, emptyState } from "../../ui/ui";
import Spinner from "../../components/Spinner";

const ACTIONS = ["LOGIN", "LOGOUT", "CREATE", "UPDATE", "DELETE", "CONFIRM", "CANCEL"];
const PAGE_SIZE = 20;

function formatDate(value: string): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("es-ES");
}

export default function AdminAudit() {
  const [tenantId, setTenantId] = useState("");
  const [action, setAction] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);

  const [result, setResult] = useState<Paginated<AuditEntry> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = (targetPage: number) => {
    setLoading(true);
    setError("");
    adminService
      .getAudit({
        tenant_id: tenantId || undefined,
        action: action || undefined,
        resource_type: resourceType || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        page: targetPage,
        page_size: PAGE_SIZE,
      })
      .then((data) => {
        setResult(data);
        setPage(data.page ?? targetPage);
      })
      .catch((err) => setError(err?.response?.data?.error?.message || "Error al cargar la auditoria"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Admin Audit" });
    adminService
      .getTenants()
      .then((data) => setTenants(data))
      .catch(() => setTenants([]));
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = () => {
    setPage(1);
    load(1);
  };

  const total = result?.total ?? 0;
  const pageSize = result?.page_size ?? PAGE_SIZE;
  const currentPage = result?.page ?? page;
  const canPrev = currentPage > 1;
  const canNext = currentPage * pageSize < total;

  return (
    <div>
      <h1 style={pageTitle}>Auditoria global</h1>

      <div style={styles.controls}>
        <div style={{ ...field, marginBottom: 0 }}>
          <label htmlFor="audit-tenant">Tenant</label>
          <select id="audit-tenant" value={tenantId} onChange={(e) => setTenantId(e.target.value)} style={styles.input}>
            <option value="">Todos</option>
            {tenants.map((t) => (
              <option key={t.tenant_id} value={t.tenant_id}>{t.name}</option>
            ))}
          </select>
        </div>
        <div style={{ ...field, marginBottom: 0 }}>
          <label htmlFor="audit-action">Accion</label>
          <select id="audit-action" value={action} onChange={(e) => setAction(e.target.value)} style={styles.input}>
            <option value="">Todas</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div style={{ ...field, marginBottom: 0 }}>
          <label htmlFor="audit-resource">Tipo de recurso</label>
          <input id="audit-resource" type="text" value={resourceType} onChange={(e) => setResourceType(e.target.value)} placeholder="Ej: appointment" style={styles.input} />
        </div>
        <div style={{ ...field, marginBottom: 0 }}>
          <label htmlFor="audit-start">Desde</label>
          <input id="audit-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={styles.input} />
        </div>
        <div style={{ ...field, marginBottom: 0 }}>
          <label htmlFor="audit-end">Hasta</label>
          <input id="audit-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={styles.input} />
        </div>
        <button onClick={applyFilters} style={btn("primary")} disabled={loading}>
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
          <button onClick={() => load(currentPage)} style={btn("secondary")}>Reintentar</button>
        </div>
      )}

      {!loading && !error && result && (
        <>
          {result.items.length === 0 ? (
            <div style={emptyState}>
              <div style={{ fontSize: 34, marginBottom: 8 }}>🗂️</div>
              <p style={{ fontWeight: 600, color: "var(--text)" }}>Sin registros</p>
              <p>No hay registros para los filtros seleccionados.</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={styles.thNw}>Fecha</th>
                    <th style={styles.thNw}>Usuario</th>
                    <th style={styles.thNw}>Tenant</th>
                    <th style={styles.thNw}>Accion</th>
                    <th style={styles.thNw}>Recurso</th>
                    <th style={styles.thNw}>ID recurso</th>
                    <th style={styles.thNw}>Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((row) => (
                    <tr key={row.id}>
                      <td style={styles.tdNw}>{formatDate(row.created_at)}</td>
                      <td style={styles.tdNw}>{row.user_id ?? "-"}</td>
                      <td style={styles.tdNw}>{row.tenant_id}</td>
                      <td style={styles.tdNw}>{row.action}</td>
                      <td style={styles.tdNw}>{row.resource_type}</td>
                      <td style={styles.tdNw}>{row.resource_id}</td>
                      <td style={styles.tdNw}>{row.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={styles.pagination}>
            <button onClick={() => load(currentPage - 1)} disabled={!canPrev || loading} style={btn("secondary")}>
              Anterior
            </button>
            <span style={styles.pageInfo}>
              Pagina {currentPage} {total > 0 ? `de ${Math.max(1, Math.ceil(total / pageSize))}` : ""} ({total} registros)
            </span>
            <button onClick={() => load(currentPage + 1)} disabled={!canNext || loading} style={btn("secondary")}>
              Siguiente
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  controls: { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", margin: "20px 0" },
  input: { minWidth: 150 },
  loading: { display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)" },
  thNw: { ...th, whiteSpace: "nowrap" },
  tdNw: { ...td, whiteSpace: "nowrap", fontSize: 13 },
  pagination: { display: "flex", alignItems: "center", gap: 12, marginTop: 16, flexWrap: "wrap" },
  pageInfo: { fontSize: 13, color: "var(--text-muted)" },
};
