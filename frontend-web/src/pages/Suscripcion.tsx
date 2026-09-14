import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { card, pageTitle, subtitle, btn, badge } from "../ui/ui";
import Spinner from "../components/Spinner";
import { mySubscriptionService, type MySubscriptionStatus } from "../services/subscription.service";

const PRICE_LABEL = "$299 MXN/mes";

// Beneficios del plan premium mostrados al emprendedor.
const BENEFITS: string[] = [
  "Personalizacion y marca (logo, colores, banner) en tu portal publico",
  "Anuncios destacados para tus clientes",
  "Promociones y cupones ilimitados",
  "Reportes y graficas avanzadas del negocio",
  "Codigo QR con tu logo",
  "Ver todas tus citas a futuro (no solo las de hoy)",
  "Sucursales y colaboradores adicionales",
];

// Pantalla de gestion de la suscripcion premium del emprendedor. Muestra el plan,
// el estado actual (GET /me/subscription) y acciones para suscribirse (redirige a
// Mercado Pago) o cancelar la suscripcion activa.
export default function Suscripcion() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<MySubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [redirecting, setRedirecting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [info, setInfo] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    mySubscriptionService
      .getStatus()
      .then((s) => setStatus(s))
      .catch((err) =>
        setError(
          err?.response?.data?.error?.message || err?.message || "No se pudo cargar el estado de tu suscripcion"
        )
      )
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleSubscribe = async () => {
    setActionError("");
    setInfo("");
    setRedirecting(true);
    try {
      const { init_point } = await mySubscriptionService.create();
      window.location.href = init_point;
    } catch (err: any) {
      const code = err?.response?.data?.error?.code;
      if (err?.response?.status === 503 || code === "PAYMENTS_NOT_CONFIGURED") {
        setActionError("Los pagos aun no estan configurados. Intentalo mas tarde.");
      } else {
        setActionError(
          err?.response?.data?.error?.message || err?.message || "No se pudo iniciar la suscripcion. Intentalo de nuevo."
        );
      }
      setRedirecting(false);
    }
  };

  const handleCancel = async () => {
    const ok = window.confirm(
      "Vas a cancelar tu suscripcion premium. Conservaras el acceso hasta el fin del periodo pagado. Deseas continuar?"
    );
    if (!ok) return;
    setActionError("");
    setInfo("");
    setCancelling(true);
    try {
      await mySubscriptionService.cancel();
      setInfo("Tu suscripcion fue cancelada. Mantendras el acceso hasta el fin del periodo actual.");
      load();
    } catch (err: any) {
      setActionError(
        err?.response?.data?.error?.message || err?.message || "No se pudo cancelar la suscripcion. Intentalo de nuevo."
      );
    } finally {
      setCancelling(false);
    }
  };

  const isPremium = !!status?.is_premium;
  const daysLeft = status?.days_left ?? null;
  const hasActiveSubscription = !!status?.subscription;

  return (
    <div>
      <h1 style={pageTitle}>Suscripcion premium</h1>
      <p style={{ ...subtitle, marginTop: 4 }}>
        Activa premium para desbloquear todas las funciones de tu negocio.
      </p>

      {/* Estado actual */}
      {loading ? (
        <div style={styles.loading} role="status" aria-live="polite">
          <Spinner /> Cargando estado...
        </div>
      ) : error ? (
        <div style={{ ...card, padding: 20, marginTop: 20 }} role="alert">
          <p style={{ color: "var(--danger)", marginBottom: 12 }}>{error}</p>
          <button type="button" style={btn("secondary")} onClick={load}>
            Reintentar
          </button>
        </div>
      ) : (
        <div style={{ ...card, ...styles.statusCard }}>
          <div style={styles.statusRow}>
            <div>
              <div style={styles.statusLabel}>Estado</div>
              <div style={{ marginTop: 6 }}>
                {isPremium ? (
                  <span style={badge("success")}>⭐ Premium activo</span>
                ) : (
                  <span style={badge("muted")}>Sin premium</span>
                )}
              </div>
            </div>
            {isPremium && daysLeft != null && (
              <div>
                <div style={styles.statusLabel}>Dias restantes</div>
                <div style={styles.statusValue}>{Math.max(0, daysLeft)}</div>
              </div>
            )}
          </div>
          {isPremium && daysLeft == null && (
            <p style={{ ...subtitle, marginTop: 12 }}>Tu premium esta activo.</p>
          )}
          {!isPremium && (
            <p style={{ ...subtitle, marginTop: 12 }}>
              Tu prueba termino o aun no tienes premium. Suscribete para reactivarlo.
            </p>
          )}
        </div>
      )}

      {/* Plan */}
      <div style={{ ...card, ...styles.planCard }}>
        <div style={styles.planHeader}>
          <div>
            <h2 style={{ ...pageTitle, fontSize: 20 }}>Plan Premium</h2>
            <p style={{ ...subtitle, marginTop: 4 }}>Todo lo que necesitas para hacer crecer tu negocio.</p>
          </div>
          <div style={styles.priceBox}>
            <span style={styles.priceValue}>$299</span>
            <span style={styles.priceUnit}>MXN / mes</span>
          </div>
        </div>

        <ul style={styles.benefits}>
          {BENEFITS.map((b) => (
            <li key={b} style={styles.benefitItem}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--success)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                style={{ flexShrink: 0, marginTop: 2 }}
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
              <span>{b}</span>
            </li>
          ))}
        </ul>

        {actionError && (
          <div style={styles.alert} role="alert">
            {actionError}
          </div>
        )}
        {info && (
          <div style={styles.success} role="status" aria-live="polite">
            {info}
          </div>
        )}

        <div style={styles.actions}>
          <button type="button" style={btn("primary")} onClick={handleSubscribe} disabled={redirecting}>
            {redirecting ? "Redirigiendo..." : isPremium ? `Renovar (${PRICE_LABEL})` : `Suscribirme (${PRICE_LABEL})`}
          </button>
          {hasActiveSubscription && (
            <button type="button" style={btn("danger")} onClick={handleCancel} disabled={cancelling}>
              {cancelling ? "Cancelando..." : "Cancelar suscripcion"}
            </button>
          )}
          <button type="button" style={btn("ghost")} onClick={() => navigate("/")}>
            Volver al panel
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  loading: { display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)", marginTop: 24 },
  statusCard: { padding: 20, marginTop: 20 },
  statusRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24, flexWrap: "wrap" },
  statusLabel: {
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
  },
  statusValue: { fontSize: 28, fontWeight: 700, color: "var(--text)", lineHeight: 1.1, marginTop: 6 },
  planCard: { padding: 24, marginTop: 20 },
  planHeader: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" },
  priceBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    padding: "10px 16px",
    borderRadius: "var(--radius)",
    background: "var(--brand-soft)",
  },
  priceValue: { fontSize: 30, fontWeight: 800, color: "var(--brand)", lineHeight: 1 },
  priceUnit: { fontSize: 13, fontWeight: 600, color: "var(--brand)" },
  benefits: { listStyle: "none", padding: 0, margin: "20px 0", display: "flex", flexDirection: "column", gap: 10 },
  benefitItem: { display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14, color: "var(--text)" },
  actions: { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 },
  alert: {
    background: "var(--danger-soft)",
    color: "var(--danger)",
    borderRadius: "var(--radius-sm)",
    padding: "10px 12px",
    marginBottom: 14,
    fontSize: 14,
  },
  success: {
    background: "var(--success-soft)",
    color: "var(--success)",
    borderRadius: "var(--radius-sm)",
    padding: "10px 12px",
    marginBottom: 14,
    fontSize: 14,
  },
};
