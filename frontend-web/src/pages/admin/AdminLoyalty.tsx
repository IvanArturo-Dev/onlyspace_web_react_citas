import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { loyaltyService } from "../../services/loyalty.service";
import type { LoyaltyGlobalStats } from "../../services/loyalty.service";
import { trackEvent } from "../../lib/firebase";
import { card, pageTitle, subtitle, btn } from "../../ui/ui";
import Spinner from "../../components/Spinner";
import BarChart from "../../components/charts/BarChart";
import type { BarDatum } from "../../components/charts/BarChart";

export default function AdminLoyalty() {
  const [stats, setStats] = useState<LoyaltyGlobalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    loyaltyService
      .getGlobalStats()
      .then((data) => setStats(data))
      .catch((err) => setError(err?.response?.data?.error?.message || "Error al cargar las metricas de lealtad"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Admin Loyalty" });
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Grafica de recompensas por estado (reutiliza BarChart SVG, theme-aware).
  const rewardData: BarDatum[] = stats
    ? [
        { label: "Ganadas", value: stats.rewardsEarned, color: "var(--info)" },
        { label: "Canjeadas", value: stats.rewardsRedeemed, color: "var(--success)" },
        { label: "Expiradas", value: stats.rewardsExpired, color: "var(--danger)" },
      ]
    : [];
  const hasAnyData = stats
    ? stats.totalPrograms > 0 || stats.totalRewards > 0
    : false;

  return (
    <div>
      <h1 style={pageTitle}>Lealtad</h1>
      <p style={{ ...subtitle, marginTop: 4 }}>
        Metricas agregadas de los programas de lealtad de toda la plataforma: cuantos programas
        existen y como se distribuyen las recompensas ganadas, canjeadas y expiradas.
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

      {!loading && !error && stats && (
        <>
          {/* Grupo: Programas */}
          <h2 style={styles.subtitle}>Programas</h2>
          <p style={styles.helper}>Programas de lealtad configurados en la plataforma.</p>
          <div style={styles.cards}>
            <Card label="Programas" value={stats.totalPrograms} caption="Programas totales" />
            <Card label="Programas activos" value={stats.activePrograms} caption="Actualmente vigentes" />
          </div>

          {/* Grupo: Recompensas */}
          <h2 style={styles.subtitle}>Recompensas</h2>
          <p style={styles.helper}>
            {stats.totalRewards > 0
              ? `${stats.totalRewards} recompensas en total, distribuidas por estado.`
              : "Aun no se han otorgado recompensas."}
          </p>
          <div style={styles.cards}>
            <Card label="Recompensas totales" value={stats.totalRewards} caption="Otorgadas en total" />
            <Card label="Ganadas" value={stats.rewardsEarned} caption="Pendientes de canjear" />
            <Card label="Canjeadas" value={stats.rewardsRedeemed} caption="Ya utilizadas" />
            <Card label="Expiradas" value={stats.rewardsExpired} caption="Vencidas sin canjear" />
          </div>

          {/* Grafica de recompensas por estado */}
          <h2 style={styles.subtitle}>Recompensas por estado</h2>
          <div style={{ ...card, padding: 18 }}>
            {hasAnyData ? (
              <BarChart data={rewardData} orientation="horizontal" />
            ) : (
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 14 }}>
                Aun no hay actividad de lealtad para mostrar.
              </p>
            )}
          </div>
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
};
