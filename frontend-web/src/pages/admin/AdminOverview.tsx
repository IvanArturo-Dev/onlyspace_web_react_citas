import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { adminService } from "../../services/admin.service";
import { trackEvent } from "../../lib/firebase";
import type { GlobalOverview, HealthReport } from "../../types/admin";
import type { AppointmentStatus } from "../../types";
import { card, pageTitle, subtitle, btn, badge } from "../../ui/ui";
import Spinner from "../../components/Spinner";
import BarChart from "../../components/charts/BarChart";
import type { BarDatum } from "../../components/charts/BarChart";

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  PENDING: "Pendientes",
  CONFIRMED: "Confirmadas",
  COMPLETED: "Completadas",
  CANCELLED: "Canceladas",
  NO_SHOW: "No asistio",
};

const STATUS_COLOR: Record<AppointmentStatus, string> = {
  PENDING: "var(--warning)",
  CONFIRMED: "var(--success)",
  COMPLETED: "var(--info)",
  CANCELLED: "var(--danger)",
  NO_SHOW: "var(--danger)",
};

export default function AdminOverview() {
  const [overview, setOverview] = useState<GlobalOverview | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [healthUnavailable, setHealthUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    setHealthUnavailable(false);

    const overviewPromise = adminService.getOverview();
    const healthPromise = adminService.getHealth();

    overviewPromise
      .then((data) => setOverview(data))
      .catch((err) => setError(err?.response?.data?.error?.message || "Error al cargar el resumen global"))
      .finally(() => setLoading(false));

    // Degradacion elegante: si health falla, no rompe la pagina.
    healthPromise
      .then((data) => {
        setHealth(data);
        setHealthUnavailable(false);
      })
      .catch(() => {
        setHealth(null);
        setHealthUnavailable(true);
      });
  };

  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Admin Overview" });
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statuses = Object.keys(STATUS_LABELS) as AppointmentStatus[];
  const statusData: BarDatum[] = overview
    ? statuses.map((s) => ({
        label: STATUS_LABELS[s],
        value: overview.appointments_by_status?.[s] ?? 0,
        color: STATUS_COLOR[s],
      }))
    : [];
  const totalAppointments = statusData.reduce((acc, d) => acc + d.value, 0);

  return (
    <div>
      <h1 style={pageTitle}>Resumen global</h1>
      <p style={{ ...subtitle, marginTop: 4 }}>
        Vista general de todo el sistema: cuantos negocios y cuentas existen, la actividad de citas y
        el estado de salud de la plataforma.
      </p>

      {loading && (
        <div style={styles.loading}>
          <Spinner /> Cargando...
        </div>
      )}

      {error && (
        <div style={{ marginTop: 20 }}>
          <p style={{ color: "var(--danger)", marginBottom: 12 }}>{error}</p>
          <button onClick={load} style={btn("secondary")}>Reintentar</button>
        </div>
      )}

      {!loading && !error && overview && (
        <>
          {/* Grupo: Negocio */}
          <h2 style={styles.subtitle}>Negocio</h2>
          <p style={styles.helper}>Quienes y que hay registrado en la plataforma.</p>
          <div style={styles.cards}>
            <Card label="Negocios (Tenants)" value={overview.tenants} caption="Negocios registrados" />
            <Card label="Usuarios" value={overview.users} caption="Cuentas totales del sistema" />
            <Card label="Clientes" value={overview.customers} caption="Personas que agendan citas" />
            <Card label="Servicios" value={overview.services} caption="Categorias/servicios ofrecidos" />
          </div>

          {/* Grupo: Actividad */}
          <h2 style={styles.subtitle}>Actividad</h2>
          <p style={styles.helper}>
            {totalAppointments > 0
              ? `${totalAppointments} citas en total, distribuidas por estado.`
              : "Aun no hay citas registradas en el sistema."}
          </p>
          <div style={{ ...card, padding: 18 }}>
            <BarChart data={statusData} orientation="horizontal" />
          </div>

          {/* Grupo: Salud */}
          <h2 style={styles.subtitle}>Salud del sistema</h2>
          <p style={styles.helper}>Estado operativo y actividad de las ultimas 24 horas.</p>
          {healthUnavailable && (
            <div style={{ ...card, ...styles.panel }}>
              <p style={{ color: "var(--warning)", margin: 0, fontWeight: 600 }}>
                Estado no disponible en este momento.
              </p>
            </div>
          )}
          {!healthUnavailable && health && (
            <div style={styles.cards}>
              <div style={{ ...card, ...styles.card }}>
                <div style={{ marginBottom: 6 }}>
                  <span style={badge(health.status === "ok" || health.status === "healthy" ? "success" : "warning")}>
                    {health.status}
                  </span>
                </div>
                <div style={styles.cardLabel}>Estado</div>
                <div style={styles.cardCaption}>Salud reportada por el backend</div>
              </div>
              <Card label="Acciones (24h)" value={health.last_24h?.total_actions ?? 0} caption="Operaciones registradas" />
              <Card label="Logins (24h)" value={health.last_24h?.logins ?? 0} caption="Inicios de sesion" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Card({ label, value, caption }: { label: string; value: number | string; caption?: string }) {
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
  subtitle: { fontSize: 18, fontWeight: 700, color: "var(--text)", margin: "32px 0 4px" },
  helper: { fontSize: 13, color: "var(--text-muted)", margin: "0 0 14px" },
  cards: { display: "flex", flexWrap: "wrap", gap: 14, marginTop: 8 },
  card: { flex: "1 1 160px", minWidth: 160, padding: 18 },
  cardValue: { fontSize: 26, fontWeight: 700, color: "var(--text)" },
  cardLabel: { fontSize: 13, color: "var(--text-muted)", marginTop: 6, fontWeight: 600 },
  cardCaption: { fontSize: 12, color: "var(--text-muted)", marginTop: 4 },
  panel: { padding: 16, background: "var(--warning-soft)", borderColor: "var(--warning)" },
};
