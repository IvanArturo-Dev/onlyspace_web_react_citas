import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/useAuthStore";
import { useBranchStore } from "../store/useBranchStore";
import { dataService } from "../services/data.service";
import { useBrandingStore } from "../store/useBrandingStore";
import { usePremium } from "../store/usePremium";
import type { Branding } from "../services/branding.service";
import { trackEvent } from "../lib/firebase";
import type { Appointment, AppointmentStatus } from "../types";
import { card, pageTitle, subtitle, btn, badge } from "../ui/ui";
import Spinner from "../components/Spinner";
import DonutChart from "../components/charts/DonutChart";
import type { DonutSegment } from "../components/charts/DonutChart";
import DayBarChart from "../components/charts/DayBarChart";
import type { Bar } from "../components/charts/DayBarChart";

const ALL_BRANCHES = "__all__";

type RangeKey = "today" | "7d" | "30d";

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Hoy" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
];

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  PENDING: "Pendientes",
  CONFIRMED: "Confirmadas",
  COMPLETED: "Completadas",
  CANCELLED: "Canceladas",
  NO_SHOW: "No asistio",
};

const STATUS_BADGE: Record<AppointmentStatus, "success" | "warning" | "danger" | "info" | "muted"> = {
  PENDING: "warning",
  CONFIRMED: "info",
  COMPLETED: "success",
  CANCELLED: "danger",
  NO_SHOW: "muted",
};

// Colores de cada estado para la grafica de dona (tokens del tema).
const STATUS_COLOR: Record<AppointmentStatus, string> = {
  PENDING: "var(--warning)",
  CONFIRMED: "var(--info)",
  COMPLETED: "var(--success)",
  CANCELLED: "var(--danger)",
  NO_SHOW: "var(--text-muted)",
};

const STATUS_ORDER: AppointmentStatus[] = ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"];

interface DaySeriesPoint {
  dayLabel: string; // dd/mm
  total: number;
}

interface Metrics {
  total: number;
  byStatus: Record<AppointmentStatus, number>;
  series: DaySeriesPoint[];
  today: Appointment[];
  upcoming: Appointment[];
  pendingCount: number;
  amountPaid: number;
  amountDue: number;
  amountTotalBilled: number;
  currency: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Devuelve el rango [inicio, fin) del dia calendario local para el timestamp dado. */
function localDayBounds(now: Date): { start: number; end: number } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
  const end = start + DAY_MS;
  return { start, end };
}

/**
 * Limites del rango seleccionado en ms (dia local):
 * - today: [inicio hoy, fin hoy)
 * - 7d: [inicio hace 6 dias, fin de hoy 23:59:59.999)
 * - 30d: [inicio hace 29 dias, fin de hoy 23:59:59.999)
 */
function rangeBounds(range: RangeKey, now: Date = new Date()): { start: number; end: number } {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
  const todayEnd = todayStart + DAY_MS - 1; // 23:59:59.999 de hoy
  if (range === "today") {
    return { start: todayStart, end: todayEnd };
  }
  const daysBack = range === "7d" ? 6 : 29;
  return { start: todayStart - daysBack * DAY_MS, end: todayEnd };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Construye la serie por dia (dd/mm) del rango, incluyendo dias sin citas (total 0). */
function buildDaySeries(range: RangeKey, inRange: Appointment[], now: Date): DaySeriesPoint[] {
  const totalDays = range === "today" ? 1 : range === "7d" ? 7 : 30;
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
  const firstDayStart = todayStart - (totalDays - 1) * DAY_MS;

  // Conteo por indice de dia dentro del rango.
  const counts = new Array<number>(totalDays).fill(0);
  inRange.forEach((a) => {
    const t = new Date(a.start_time).getTime();
    if (isNaN(t)) return;
    const idx = Math.floor((t - firstDayStart) / DAY_MS);
    if (idx >= 0 && idx < totalDays) counts[idx] += 1;
  });

  return counts.map((total, i) => {
    const d = new Date(firstDayStart + i * DAY_MS);
    return { dayLabel: `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`, total };
  });
}

export default function Dashboard() {
  const { user } = useAuthStore();
  const { branches, loadBranches } = useBranchStore();
  const navigate = useNavigate();
  // Seleccion local: "todas" o el id de una sucursal concreta.
  const [selected, setSelected] = useState<string>(ALL_BRANCHES);
  // Rango temporal para acotar metricas y graficas (default 7 dias).
  const [range, setRange] = useState<RangeKey>("7d");
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const branding = useBrandingStore((st) => st.branding);
  const loadBranding = useBrandingStore((st) => st.load);
  // Plan premium del tenant (best-effort). Muestra el badge "Premium" en el encabezado.
  const { isPremium } = usePremium();

  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Dashboard" });
    if (branches.length === 0) loadBranches();
    // Carga la personalizacion del negocio (logo/titulo/color) desde el store
    // compartido para mostrarla en el panel; se actualiza sola al guardar en
    // Personalizacion. Es su vista interna, no depende de premium.
    loadBranding();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = () => {
    setLoading(true);
    setError("");
    const branch_id = selected === ALL_BRANCHES ? undefined : selected;
    dataService
      .listAppointments({ branch_id })
      .then((list) => setAppointments(list))
      .catch((err) => {
        setError(err?.response?.data?.error?.message || err?.message || "Error al cargar el dashboard");
        setAppointments(null);
      })
      .finally(() => setLoading(false));
  };

  // Solo el cambio de sucursal requiere volver a pedir datos al backend; el
  // cambio de rango se resuelve en cliente derivando de las citas cargadas.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // Derivacion de metricas: se recalcula al cambiar las citas o el rango.
  const metrics = useMemo<Metrics | null>(() => {
    if (!appointments) return null;

    const nowDate = new Date();
    const now = nowDate.getTime();
    const { start: dayStart, end: dayEnd } = localDayBounds(nowDate);
    const { start: rangeStart, end: rangeEnd } = rangeBounds(range, nowDate);

    const ts = (a: Appointment) => new Date(a.start_time).getTime();
    const isActive = (a: Appointment) => a.status === "PENDING" || a.status === "CONFIRMED";

    // Citas cuyo start_time cae dentro del rango seleccionado (Property 1).
    const inRange = appointments.filter((a) => {
      const t = ts(a);
      return !isNaN(t) && t >= rangeStart && t <= rangeEnd;
    });

    // Conteo por estado dentro del rango.
    const byStatus: Record<AppointmentStatus, number> = {
      PENDING: 0,
      CONFIRMED: 0,
      COMPLETED: 0,
      CANCELLED: 0,
      NO_SHOW: 0,
    };
    inRange.forEach((a) => {
      if (byStatus[a.status] !== undefined) byStatus[a.status] += 1;
    });

    // Serie por dia (para la grafica de barras), con dias sin citas en 0.
    const series = buildDaySeries(range, inRange, nowDate);

    // Citas de HOY: mismo dia calendario local (estado activo). No acotado al rango
    // porque siempre es util verlas.
    const today = appointments
      .filter(isActive)
      .filter((a) => {
        const t = ts(a);
        return !isNaN(t) && t >= dayStart && t < dayEnd;
      })
      .sort((a, b) => ts(a) - ts(b));

    // Proximas: estrictamente despues del fin del dia de hoy (no se duplican con Hoy).
    const upcoming = appointments
      .filter(isActive)
      .filter((a) => {
        const t = ts(a);
        return !isNaN(t) && t >= dayEnd;
      })
      .sort((a, b) => ts(a) - ts(b))
      .slice(0, 8);

    // Finanzas: se calculan sobre TODAS las citas activas (no canceladas) del
    // tenant/sucursal, NO solo el rango, para que el emprendedor siempre vea su
    // cobrado y su saldo real. Las graficas y conteos si respetan el rango.
    let amountPaid = 0;
    let amountDue = 0;
    let amountTotalBilled = 0;
    let currency = "MXN";
    appointments.forEach((a) => {
      if (a.status === "CANCELLED") return;
      if (a.currency) currency = a.currency;
      const paid = typeof a.amount_paid === "number" ? a.amount_paid : 0;
      const total = typeof a.amount_total === "number" ? a.amount_total : 0;
      amountPaid += paid;
      amountTotalBilled += total;
      const due = total - paid;
      if (due > 0) amountDue += due;
    });
    void now;

    return {
      total: inRange.length,
      byStatus,
      series,
      today,
      upcoming,
      pendingCount: byStatus.PENDING,
      amountPaid,
      amountDue,
      amountTotalBilled,
      currency,
    };
  }, [appointments, range]);

  const branchName = useMemo(() => {
    const map = new Map(branches.map((b) => [b.id, b.name] as const));
    return (id?: string | null) => (id ? map.get(id) ?? "Sucursal" : "Sin sucursal");
  }, [branches]);

  // Datos para las graficas.
  const donutSegments: DonutSegment[] = useMemo(
    () =>
      metrics
        ? STATUS_ORDER.map((s) => ({
            label: STATUS_LABELS[s],
            value: metrics.byStatus[s],
            color: STATUS_COLOR[s],
          }))
        : [],
    [metrics]
  );

  const dayBars: Bar[] = useMemo(
    () => (metrics ? metrics.series.map((p) => ({ label: p.dayLabel, value: p.total })) : []),
    [metrics]
  );

  return (
    <div>
      <BrandHeader branding={branding} userName={user?.name} userEmail={user?.email} isPremium={isPremium} />

      {/* Accesos rapidos */}
      <div style={styles.quickActions}>
        <button style={btn("primary")} onClick={() => navigate("/appointments")}>
          Agendar cita
        </button>
        <button style={btn("secondary")} onClick={() => navigate("/appointments")}>
          Ver citas
        </button>
        <button style={btn("secondary")} onClick={() => navigate("/customers")}>
          Clientes
        </button>
      </div>

      {/* Filtros: sucursal + rango temporal */}
      <div style={styles.filtersRow}>
        <div style={styles.selectorGroup}>
          <span style={styles.selectorLabel}>Sucursal</span>
          <select
            style={styles.select}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            aria-label="Filtrar dashboard por sucursal"
          >
            <option value={ALL_BRANCHES}>Todas las sucursales</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.status !== "active" ? " (inactiva)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div style={styles.selectorGroup}>
          <span style={styles.selectorLabel}>Rango</span>
          <div style={styles.rangeTabs} role="group" aria-label="Filtrar dashboard por rango de tiempo">
            {RANGE_OPTIONS.map((opt) => {
              const active = range === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setRange(opt.key)}
                  aria-pressed={active}
                  style={{ ...styles.rangeTab, ...(active ? styles.rangeTabActive : null) }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {loading && (
        <div style={styles.loading} role="status" aria-live="polite">
          <Spinner /> Cargando metricas...
        </div>
      )}

      {error && (
        <div style={styles.errorBox} role="alert" aria-live="assertive">
          <p style={{ color: "var(--danger)", marginBottom: 12 }}>{error}</p>
          <button onClick={load} style={btn("secondary")}>
            Reintentar
          </button>
        </div>
      )}

      {!loading && !error && metrics && (
        <>
          {/* ---------- FINANZAS (destacada) ---------- */}
          <h2 style={styles.sectionTitle}>Finanzas</h2>
          <FinanceCard
            paid={metrics.amountPaid}
            due={metrics.amountDue}
            total={metrics.amountTotalBilled}
            currency={metrics.currency}
          />

          {/* ---------- KPIs operativos ---------- */}
          <h2 style={styles.sectionTitle}>Resumen</h2>
          <div style={styles.grid}>
            <MetricCard
              label="Citas de hoy"
              value={String(metrics.today.length)}
              caption="Programadas para el dia de hoy"
              accent="var(--brand)"
            />
            <MetricCard
              label="Proximas"
              value={String(metrics.upcoming.length)}
              caption="Citas activas a futuro"
              accent="var(--info)"
            />
            <MetricCard
              label="Por confirmar"
              value={String(metrics.pendingCount)}
              caption="Pendientes en el rango"
              accent="var(--warning)"
            />
          </div>

          {/* ---------- GRAFICAS ---------- */}
          <h2 style={styles.sectionTitle}>Graficas</h2>
          <div style={styles.chartsGrid}>
            <div style={{ ...card, ...styles.chartCard }}>
              <h3 style={styles.chartTitle}>Distribucion por estado</h3>
              <DonutChart segments={donutSegments} />
            </div>

            {range !== "today" && (
              <div style={{ ...card, ...styles.chartCard }}>
                <h3 style={styles.chartTitle}>Citas por dia</h3>
                <DayBarChart bars={dayBars} />
              </div>
            )}
          </div>

          {/* ---------- HOY ---------- */}
          <div style={styles.sectionHeader}>
            <h2 style={styles.sectionTitleInline}>Citas de hoy</h2>
            <span style={badge("success")}>{metrics.today.length}</span>
          </div>
          {metrics.today.length === 0 ? (
            <div style={{ ...card, ...styles.emptyBox }}>No hay citas para hoy.</div>
          ) : (
            <div style={styles.list}>
              {metrics.today.map((a) => (
                <AppointmentRow
                  key={a.id}
                  appt={a}
                  timeText={formatTime(a.start_time)}
                  showBranch={selected === ALL_BRANCHES}
                  branchName={branchName}
                />
              ))}
            </div>
          )}

          {/* ---------- PROXIMAS (solo premium) ---------- */}
          {isPremium ? (
            <>
              <div style={styles.sectionHeader}>
                <h2 style={styles.sectionTitleInline}>Proximas citas</h2>
                <span style={badge("info")}>{metrics.upcoming.length}</span>
              </div>
              {metrics.upcoming.length === 0 ? (
                <div style={{ ...card, ...styles.emptyBox }}>No hay citas proximas.</div>
              ) : (
                <div style={styles.list}>
                  {metrics.upcoming.map((a) => (
                    <AppointmentRow
                      key={a.id}
                      appt={a}
                      timeText={formatDate(a.start_time)}
                      showBranch={selected === ALL_BRANCHES}
                      branchName={branchName}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div style={styles.sectionHeader}>
                <h2 style={styles.sectionTitleInline}>Proximas citas</h2>
                <span style={badge("warning")}>Solo premium</span>
              </div>
              <div style={{ ...card, ...styles.emptyBox }}>
                Ver las proximas citas es solo para premium. Activa premium para ver tu agenda a futuro.
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function AppointmentRow({
  appt,
  timeText,
  showBranch,
  branchName,
}: {
  appt: Appointment;
  timeText: string;
  showBranch: boolean;
  branchName: (id?: string | null) => string;
}) {
  return (
    <div style={{ ...card, ...styles.listItem }}>
      <div>
        <div style={styles.itemTitle}>
          <strong>{appt.customer_name || appt.customer_id}</strong>
          <span style={styles.itemMuted}> - {appt.service_name || appt.service_id}</span>
        </div>
        <div style={styles.itemSub}>{timeText}</div>
        {showBranch && appt.branch_id && <div style={styles.itemSub}>{branchName(appt.branch_id)}</div>}
      </div>
      <span style={badge(STATUS_BADGE[appt.status])}>{STATUS_LABELS[appt.status]}</span>
    </div>
  );
}

// Encabezado del panel del emprendedor. Cuando hay personalizacion configurada
// (logo / titulo de bienvenida / color de marca) la refleja aqui, en su propia
// vista interna. Es independiente de la suscripcion premium (esa solo controla
// lo que ve el cliente en el portal publico). Sin branding, cae al saludo normal.
function BrandHeader({
  branding,
  userName,
  userEmail,
  isPremium,
}: {
  branding: Branding | null;
  userName?: string;
  userEmail?: string;
  isPremium?: boolean;
}) {
  const accent = branding?.brand_color && branding.brand_color.trim() ? branding.brand_color : null;
  const logo = branding?.logo_url && branding.logo_url.trim() ? branding.logo_url : null;
  const title = branding?.banner_title && branding.banner_title.trim() ? branding.banner_title : null;

  return (
    <div
      style={{
        ...styles.brandHeader,
        ...(accent ? { borderLeft: `4px solid ${accent}` } : null),
      }}
    >
      {logo && (
        <img src={logo} alt={title || userName || "Logo"} style={styles.brandLogo} loading="lazy" />
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{ ...pageTitle, ...(accent ? { color: accent } : null) }}>
            {title || `Hola, ${userName || "usuario"}`}
          </h1>
          {isPremium && <span style={badge("success")}>⭐ Premium</span>}
        </div>
        <p style={{ ...subtitle, marginTop: 4 }}>
          {title ? `Hola, ${userName || "usuario"}` : userEmail}
        </p>
      </div>
    </div>
  );
}

// Tarjeta de finanzas destacada: cobrado, por cobrar y total facturado, con una
// barra de progreso de cobro. Los montos consideran TODAS las citas activas del
// negocio (no solo el rango), para reflejar el saldo real.
function FinanceCard({
  paid,
  due,
  total,
  currency,
}: {
  paid: number;
  due: number;
  total: number;
  currency: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  return (
    <div style={{ ...card, ...styles.financeCard }}>
      <div style={styles.financeRow}>
        <div style={styles.financeItem}>
          <div style={styles.financeLabel}>Cobrado</div>
          <div style={{ ...styles.financeValue, color: "var(--success)" }}>{formatMoney(paid, currency)}</div>
        </div>
        <div style={styles.financeDivider} />
        <div style={styles.financeItem}>
          <div style={styles.financeLabel}>Por cobrar</div>
          <div style={{ ...styles.financeValue, color: "var(--danger)" }}>{formatMoney(due, currency)}</div>
        </div>
        <div style={styles.financeDivider} />
        <div style={styles.financeItem}>
          <div style={styles.financeLabel}>Total facturado</div>
          <div style={{ ...styles.financeValue, color: "var(--text)" }}>{formatMoney(total, currency)}</div>
        </div>
      </div>
      <div style={styles.financeBarTrack} aria-hidden="true">
        <div style={{ ...styles.financeBarFill, width: `${pct}%` }} />
      </div>
      <div style={styles.financeFooter}>
        <span>{pct}% cobrado</span>
        <span style={styles.financeHint}>Saldo total del negocio (todas las citas activas)</span>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  caption,
  accent,
}: {
  label: string;
  value: string;
  caption?: string;
  accent: string;
}) {
  return (
    <div style={{ ...card, ...styles.metricCard, borderTop: `3px solid ${accent}` }}>
      <div style={{ ...styles.metricValue, color: accent }}>{value}</div>
      <div style={styles.metricLabel}>{label}</div>
      {caption && <div style={styles.metricCaption}>{caption}</div>}
    </div>
  );
}

function formatMoney(amount: number, currency: string): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `${currency} ${safe.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-ES");
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

const styles: Record<string, CSSProperties> = {
  loading: { display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)", marginTop: 24 },
  errorBox: { marginTop: 24 },
  brandHeader: { display: "flex", alignItems: "center", gap: 14, marginBottom: 4, paddingLeft: 0 },
  brandLogo: { height: 52, width: "auto", maxWidth: 160, objectFit: "contain", borderRadius: "var(--radius-sm)", flexShrink: 0 },
  quickActions: { display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" },
  filtersRow: { display: "flex", alignItems: "flex-end", gap: 24, marginTop: 20, flexWrap: "wrap" },
  selectorGroup: { display: "flex", flexDirection: "column", gap: 6 },
  selectorLabel: {
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
    minWidth: 220,
  },
  rangeTabs: {
    display: "inline-flex",
    padding: 3,
    gap: 3,
    background: "var(--surface-hover)",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border)",
  },
  rangeTab: {
    padding: "6px 14px",
    fontSize: 14,
    fontWeight: 600,
    borderRadius: "var(--radius-sm)",
    background: "transparent",
    color: "var(--text-muted)",
    border: "none",
    cursor: "pointer",
  },
  rangeTabActive: {
    background: "var(--surface)",
    color: "var(--text)",
    boxShadow: "var(--shadow-sm)",
  },
  sectionTitle: { fontSize: 18, fontWeight: 700, color: "var(--text)", marginTop: 32, marginBottom: 14 },
  sectionHeader: { display: "flex", alignItems: "center", gap: 10, marginTop: 32, marginBottom: 14 },
  sectionTitleInline: { fontSize: 18, fontWeight: 700, color: "var(--text)", margin: 0 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 16, marginTop: 14 },
  chartsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginTop: 14 },
  chartCard: { padding: 20, display: "flex", flexDirection: "column", gap: 14 },
  chartTitle: { fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 },
  metricCard: { padding: 20, display: "flex", flexDirection: "column", gap: 6 },
  metricValue: { fontSize: 30, fontWeight: 700, lineHeight: 1.1 },
  metricLabel: { color: "var(--text)", fontSize: 14, fontWeight: 700 },
  metricCaption: { color: "var(--text-muted)", fontSize: 12 },
  list: { display: "flex", flexDirection: "column", gap: 12 },
  listItem: { padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  itemTitle: { color: "var(--text)", fontSize: 15 },
  itemMuted: { color: "var(--text-muted)" },
  itemSub: { color: "var(--text-muted)", fontSize: 14, marginTop: 4 },
  financeCard: { padding: 22, display: "flex", flexDirection: "column", gap: 16 },
  financeRow: { display: "flex", alignItems: "stretch", gap: 8, flexWrap: "wrap" },
  financeItem: { flex: "1 1 140px", display: "flex", flexDirection: "column", gap: 6, minWidth: 120 },
  financeDivider: { width: 1, background: "var(--border)", alignSelf: "stretch" },
  financeLabel: { fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)" },
  financeValue: { fontSize: 26, fontWeight: 700, lineHeight: 1.1 },
  financeBarTrack: { height: 10, borderRadius: 999, background: "var(--surface-hover)", border: "1px solid var(--border)", overflow: "hidden" },
  financeBarFill: { height: "100%", background: "var(--success)", borderRadius: 999, transition: "width 0.25s ease" },
  financeFooter: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 13, fontWeight: 700, color: "var(--text)", flexWrap: "wrap" },
  financeHint: { fontSize: 12, fontWeight: 500, color: "var(--text-muted)" },
  emptyBox: { padding: 18, color: "var(--text-muted)" },
};
