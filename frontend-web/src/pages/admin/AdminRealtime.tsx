import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { usePolling } from "../../hooks/usePolling";
import { realtimeAdminService } from "../../services/realtime.service";
import type { RealtimeSnapshot, RealtimeRange } from "../../services/realtime.service";
import { trackEvent } from "../../lib/firebase";
import { card, pageTitle, subtitle, btn, table, th, td, badge } from "../../ui/ui";
import Spinner from "../../components/Spinner";
import LineChart from "../../components/charts/LineChart";
import type { LineSeries } from "../../components/charts/LineChart";
import BarChart from "../../components/charts/BarChart";
import type { BarDatum } from "../../components/charts/BarChart";

const TOTAL_LABELS: { key: keyof RealtimeSnapshot["totals"]; label: string; caption: string }[] = [
  { key: "entrepreneurs", label: "Emprendedores", caption: "Negocios con dueño activo" },
  { key: "branches", label: "Sucursales", caption: "Ubicaciones registradas" },
  { key: "customers", label: "Clientes", caption: "Personas que agendan" },
  { key: "services", label: "Servicios", caption: "Categorias ofrecidas" },
  { key: "appointments", label: "Citas", caption: "Reservaciones totales" },
  { key: "users", label: "Usuarios", caption: "Cuentas en el sistema" },
];

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendientes",
  CONFIRMED: "Confirmadas",
  COMPLETED: "Completadas",
  CANCELLED: "Canceladas",
  NO_SHOW: "No asistio",
};

const STATUS_COLOR: Record<string, string> = {
  PENDING: "var(--warning)",
  CONFIRMED: "var(--success)",
  COMPLETED: "var(--info)",
  CANCELLED: "var(--danger)",
  NO_SHOW: "var(--danger)",
};

const RANGE_OPTIONS: { value: RealtimeRange; label: string }[] = [
  { value: "24h", label: "24 horas" },
  { value: "7d", label: "7 días" },
  { value: "30d", label: "30 días" },
];

function roleBadgeKind(role: string): "success" | "warning" | "danger" | "info" | "muted" {
  switch (role) {
    case "SUPERADMIN":
      return "danger";
    case "ADMIN":
      return "info";
    case "ASSISTANT":
      return "warning";
    case "CLIENT":
      return "success";
    default:
      return "muted";
  }
}

function formatTime(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleTimeString("es-ES");
}

// Formatea el label del eje X segun el rango: hora para 24h, dia/mes para 7d/30d.
function bucketLabel(iso: string, range: RealtimeRange): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (range === "24h") {
    return d.toLocaleTimeString("es-ES", { hour: "2-digit" });
  }
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });
}

export default function AdminRealtime() {
  const [range, setRange] = useState<RealtimeRange>("24h");

  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Admin Realtime" });
  }, []);

  return (
    <div>
      <div style={styles.header}>
        <div>
          <h1 style={pageTitle}>Tiempo real</h1>
          <p style={{ ...subtitle, marginTop: 4 }}>
            Monitoreo global del sistema con auto-refresco cada 5s. Elige el rango para ver la
            actividad reciente.
          </p>
        </div>
        <div style={styles.rangeGroup} role="group" aria-label="Rango de tiempo">
          {RANGE_OPTIONS.map((opt) => {
            const active = opt.value === range;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRange(opt.value)}
                aria-pressed={active}
                style={active ? { ...btn("primary"), ...styles.rangeBtn } : { ...btn("secondary"), ...styles.rangeBtn }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Remontamos la vista al cambiar el rango para reiniciar el polling con el nuevo rango. */}
      <RealtimeView key={range} range={range} />
    </div>
  );
}

function RealtimeView({ range }: { range: RealtimeRange }) {
  const { data, error, loading, lastUpdated, reconnecting } = usePolling<RealtimeSnapshot>(
    () => realtimeAdminService.getSnapshot(range),
    5000
  );

  const statusData: BarDatum[] = useMemo(() => {
    const byStatus = data?.appointments_by_status ?? {};
    return Object.keys(byStatus).map((s) => ({
      label: STATUS_LABELS[s] ?? s,
      value: byStatus[s],
      color: STATUS_COLOR[s] ?? "var(--brand)",
    }));
  }, [data]);

  const lineSeries: LineSeries[] = useMemo(() => {
    if (!data) return [];
    const bookings = data.timeseries?.bookings ?? [];
    const cancellations = data.timeseries?.cancellations ?? [];
    return [
      {
        name: "Reservaciones",
        color: "var(--brand)",
        points: bookings.map((b) => ({ label: bucketLabel(b.bucket, data.range), value: b.count })),
      },
      {
        name: "Cancelaciones",
        color: "var(--danger)",
        points: cancellations.map((c) => ({ label: bucketLabel(c.bucket, data.range), value: c.count })),
      },
    ];
  }, [data]);

  // Carga inicial: aun no hay datos.
  if (loading && !data) {
    return (
      <div style={styles.loading}>
        <Spinner /> Cargando...
      </div>
    );
  }

  // Nunca llego data y hubo error: pantalla de error con reintento.
  if (!data && error) {
    return (
      <div style={{ marginTop: 20 }}>
        <p style={{ color: "var(--danger)", marginBottom: 12 }}>No se pudo cargar el panel en tiempo real.</p>
        <button onClick={() => window.location.reload()} style={btn("secondary")}>
          Reintentar
        </button>
      </div>
    );
  }

  if (!data) return null;

  const bookingsSeries = lineSeries.find((s) => s.name === "Reservaciones");
  const cancellationsSeries = lineSeries.find((s) => s.name === "Cancelaciones");

  return (
    <div>
      <div style={styles.metaRow}>
        {reconnecting && <span style={badge("warning")}>Reconectando...</span>}
        {lastUpdated && <span style={{ ...subtitle, whiteSpace: "nowrap" }}>Actualizado: {formatTime(lastUpdated)}</span>}
      </div>

      <h2 style={styles.subtitle}>Totales del sistema</h2>
      <p style={styles.helper}>Volumen acumulado de cada entidad principal.</p>
      <div style={styles.cards}>
        {TOTAL_LABELS.map(({ key, label, caption }) => (
          <StatCard key={key} label={label} caption={caption} value={data.totals?.[key] ?? 0} />
        ))}
      </div>

      <h2 style={styles.subtitle}>Reservaciones y cancelaciones</h2>
      <p style={styles.helper}>Actividad a lo largo del rango seleccionado.</p>
      <div style={{ ...card, padding: 18 }}>
        {bookingsSeries && cancellationsSeries && <LineChart series={[bookingsSeries, cancellationsSeries]} />}
      </div>

      <h2 style={styles.subtitle}>Citas por estado</h2>
      <p style={styles.helper}>Distribucion actual de las citas segun su estado.</p>
      <div style={{ ...card, padding: 18 }}>
        <BarChart data={statusData} orientation="horizontal" />
      </div>

      <h2 style={styles.subtitle}>Sesiones activas</h2>
      <div style={{ ...card, padding: 18 }}>
        <div style={styles.bigCount}>{data.active_sessions?.count ?? 0}</div>
        <div style={styles.cardLabel}>usuarios con actividad reciente</div>

        {data.active_sessions?.users?.length ? (
          <div style={{ marginTop: 16, overflowX: "auto" }}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Nombre</th>
                  <th style={th}>Email</th>
                  <th style={th}>Rol</th>
                  <th style={th}>Ultima actividad</th>
                </tr>
              </thead>
              <tbody>
                {data.active_sessions.users.map((u) => (
                  <tr key={u.id}>
                    <td style={td}>{u.name}</td>
                    <td style={td}>{u.email}</td>
                    <td style={td}>
                      <span style={badge(roleBadgeKind(u.role))}>{u.role}</span>
                    </td>
                    <td style={td}>{formatTime(u.last_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ ...subtitle, marginTop: 12 }}>No hay sesiones activas.</p>
        )}
      </div>

      <h2 style={styles.subtitle}>Actividad reciente (24h)</h2>
      <div style={styles.cards}>
        <StatCard label="Reservaciones 24h" caption="Citas creadas en el ultimo dia" value={data.recent?.bookings_24h ?? 0} />
        <StatCard label="Cancelaciones 24h" caption="Citas canceladas en el ultimo dia" value={data.recent?.cancellations_24h ?? 0} />
      </div>
    </div>
  );
}

function StatCard({ label, value, caption }: { label: string; value: number | string; caption?: string }) {
  return (
    <div style={{ ...card, ...styles.card }}>
      <div style={styles.cardValue}>{value}</div>
      <div style={styles.cardLabel}>{label}</div>
      {caption && <div style={styles.cardCaption}>{caption}</div>}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  loading: { display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)", marginTop: 20 },
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 },
  rangeGroup: { display: "inline-flex", gap: 8, flexWrap: "wrap" },
  rangeBtn: { padding: "8px 14px" },
  metaRow: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 16 },
  subtitle: { fontSize: 18, fontWeight: 700, color: "var(--text)", margin: "32px 0 4px" },
  helper: { fontSize: 13, color: "var(--text-muted)", margin: "0 0 14px" },
  cards: { display: "flex", flexWrap: "wrap", gap: 14, marginTop: 8 },
  card: { flex: "1 1 160px", minWidth: 160, padding: 18 },
  cardValue: { fontSize: 26, fontWeight: 700, color: "var(--text)" },
  bigCount: { fontSize: 40, fontWeight: 800, color: "var(--brand)", lineHeight: 1 },
  cardLabel: { fontSize: 13, color: "var(--text-muted)", marginTop: 6, fontWeight: 600 },
  cardCaption: { fontSize: 12, color: "var(--text-muted)", marginTop: 4 },
};
