import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { card, pageTitle, subtitle, btn, badge } from "../ui/ui";
import Spinner from "../components/Spinner";
import { trackEvent } from "../lib/firebase";
import { dataService, type SetupProgress } from "../services/data.service";

// Lee un mensaje de error legible del backend con un fallback en espanol.
function readError(err: any, fallback: string): string {
  return err?.response?.data?.error?.message || err?.message || fallback;
}

// Mapeo de cada paso de la guia (key del backend) a la seccion de gestion donde
// se configura ese aspecto del negocio (Requirement 4.4). Si un key no esta
// mapeado, el CTA no navega (fallback defensivo).
const STEP_ROUTE: Record<string, string> = {
  branch: "/sucursales",
  service: "/services",
  schedule: "/horarios",
  modality: "/profile",
  whatsapp: "/mi-codigo",
  branding: "/marketing",
  share: "/mi-codigo",
};

// Guia de uso para el emprendedor: muestra el progreso de configuracion del
// negocio (GET /me/setup-progress), una barra con el porcentaje de pasos
// obligatorios y la lista de pasos con un CTA que lleva a cada seccion
// (Requirements 4.1-4.5). Vive dentro del Layout de gestion.
export default function GuiaUso() {
  const navigate = useNavigate();
  const [progress, setProgress] = useState<SetupProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    dataService
      .getSetupProgress()
      .then((data) => setProgress(data))
      .catch((err) => setError(readError(err, "No se pudo cargar el progreso de configuracion")))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Guia de uso" });
    load();
  }, []);

  const percent = progress?.percent ?? 0;
  const requiredDone = progress?.required_done ?? 0;
  const requiredTotal = progress?.required_total ?? 0;
  const ready = progress?.ready ?? false;

  return (
    <div>
      <h1 style={pageTitle}>Guia de uso</h1>
      <p style={{ ...subtitle, marginTop: 4 }}>
        Sigue estos pasos para dejar tu negocio listo y empezar a recibir reservas.
      </p>

      {loading ? (
        <div style={styles.loading} role="status" aria-live="polite">
          <Spinner /> Cargando progreso...
        </div>
      ) : error ? (
        <div style={{ ...card, padding: 20, marginTop: 20 }} role="alert">
          <p style={{ color: "var(--danger)", marginBottom: 12 }}>{error}</p>
          <button type="button" style={btn("secondary")} onClick={load}>
            Reintentar
          </button>
        </div>
      ) : (
        <>
          {/* Barra de progreso de los pasos obligatorios (los opcionales no penalizan). */}
          <div style={{ ...card, ...styles.progressCard }}>
            <div style={styles.progressHead}>
              <span style={styles.progressLabel}>Progreso de configuracion</span>
              <span style={styles.progressPercent}>{percent}%</span>
            </div>
            <div
              style={styles.progressBarTrack}
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Progreso de configuracion: ${percent} por ciento`}
            >
              <div style={{ ...styles.progressBarFill, width: `${percent}%` }} />
            </div>
            <span style={styles.progressMeta}>
              {requiredDone} de {requiredTotal} pasos obligatorios completados
            </span>

            {ready && (
              <div style={styles.readyRow}>
                <span style={badge("success")}>✓ ¡Tu negocio esta listo para recibir reservas!</span>
              </div>
            )}
          </div>

          {/* Lista de pasos: check/estado + label + CTA hacia cada seccion. */}
          <div style={styles.stepList}>
            {(progress?.steps ?? []).map((step) => {
              const route = STEP_ROUTE[step.key];
              const ctaLabel = step.done ? "Revisar" : "Configurar";
              return (
                <div key={step.key} style={{ ...card, ...styles.stepRow }}>
                  <span
                    style={{ ...styles.check, ...(step.done ? styles.checkDone : styles.checkPending) }}
                    aria-hidden="true"
                  >
                    {step.done ? "✓" : ""}
                  </span>
                  <div style={styles.stepInfo}>
                    <span style={styles.stepLabel}>{step.label}</span>
                    {step.optional && <span style={badge("muted")}>Opcional</span>}
                  </div>
                  <button
                    type="button"
                    style={btn(step.done ? "secondary" : "primary")}
                    onClick={() => route && navigate(route)}
                    disabled={!route}
                    aria-label={`${ctaLabel}: ${step.label}`}
                  >
                    {ctaLabel}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  loading: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    color: "var(--text-muted)",
    marginTop: 20,
  },
  progressCard: {
    padding: 20,
    marginTop: 20,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  progressHead: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
  },
  progressLabel: { fontSize: 14, fontWeight: 700, color: "var(--text)" },
  progressPercent: { fontSize: 20, fontWeight: 700, color: "var(--brand)" },
  progressBarTrack: {
    height: 10,
    borderRadius: 999,
    background: "var(--surface-hover)",
    border: "1px solid var(--border)",
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    background: "linear-gradient(90deg, var(--brand), var(--info))",
    borderRadius: 999,
    transition: "width 0.4s cubic-bezier(0.22, 1, 0.36, 1)",
  },
  progressMeta: { fontSize: 13, color: "var(--text-muted)" },
  readyRow: { marginTop: 4 },
  stepList: {
    marginTop: 16,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  stepRow: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "14px 16px",
    flexWrap: "wrap",
  },
  check: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 26,
    height: 26,
    borderRadius: "50%",
    fontSize: 15,
    fontWeight: 700,
    flexShrink: 0,
  },
  checkDone: { background: "var(--success-soft)", color: "var(--success)", border: "1px solid var(--success)" },
  checkPending: { background: "var(--surface-hover)", border: "1px solid var(--border-strong)" },
  stepInfo: { display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, flexWrap: "wrap" },
  stepLabel: { fontSize: 15, fontWeight: 600, color: "var(--text)" },
};
