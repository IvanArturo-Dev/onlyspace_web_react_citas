import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { tenantService, type MyTenant } from "../services/tenant.service";
import { mySubscriptionService } from "../services/subscription.service";

// Precio del plan premium a mostrar en toda la UI de suscripcion.
const PRICE_LABEL = "$299 MXN/mes";

// Umbral (en dias) por debajo del cual avisamos que la prueba/suscripcion esta por vencer.
const SOON_THRESHOLD_DAYS = 7;

// Aviso de prueba / suscripcion para el emprendedor (ADMIN). Es autonomo: carga
// GET /me/tenant por su cuenta (best-effort) y decide que mostrar segun el estado:
//   - Premium con vencimiento cercano (<= 7 dias): aviso ambar recordando renovar.
//   - Sin premium (prueba vencida): aviso mas marcado invitando a suscribirse.
//   - Premium con holgura (> 7 dias): no molesta (no renderiza nada).
// El boton "Suscribirme" crea la suscripcion (POST /me/subscription) y redirige al
// checkout de Mercado Pago. Maneja el caso 503 (pagos no configurados) con un
// mensaje claro.
export default function TrialBanner() {
  const navigate = useNavigate();
  const [tenant, setTenant] = useState<MyTenant | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    tenantService
      .getMine()
      .then((t) => {
        if (alive) setTenant(t);
      })
      .catch(() => {
        // Best-effort: si falla, no mostramos el aviso (no bloqueamos la UI).
        if (alive) setTenant(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleSubscribe = async () => {
    setError("");
    setRedirecting(true);
    try {
      const { init_point } = await mySubscriptionService.create();
      // Redirige el navegador al checkout de Mercado Pago.
      window.location.href = init_point;
    } catch (err: any) {
      const code = err?.response?.data?.error?.code;
      if (err?.response?.status === 503 || code === "PAYMENTS_NOT_CONFIGURED") {
        setError("Los pagos aun no estan configurados. Intentalo mas tarde.");
      } else {
        setError(
          err?.response?.data?.error?.message ||
            err?.message ||
            "No se pudo iniciar la suscripcion. Intentalo de nuevo."
        );
      }
      setRedirecting(false);
    }
  };

  if (!tenant) return null;

  const isPremium = !!tenant.is_premium;
  const active = tenant.subscription_status === "active";
  const daysLeft = tenant.days_left ?? null;

  // Premium con holgura: no molestamos (Req: no seas intrusivo cuando todo esta bien).
  if (isPremium && active && daysLeft != null && daysLeft > SOON_THRESHOLD_DAYS) {
    return null;
  }
  // Premium sin dato de dias (o sin vencimiento cercano) tampoco molesta.
  if (isPremium && daysLeft == null) {
    return null;
  }

  // Decide el tono y el mensaje.
  const expiring = isPremium && active && daysLeft != null && daysLeft <= SOON_THRESHOLD_DAYS;

  let message: string;
  let tone: "warning" | "danger";
  if (expiring) {
    tone = "warning";
    const n = Math.max(0, daysLeft ?? 0);
    message = `Tu prueba/suscripcion vence en ${n} ${n === 1 ? "dia" : "dias"}.`;
  } else if (!isPremium) {
    tone = "danger";
    message = "Tu prueba termino. Suscribete para reactivar tu premium.";
  } else {
    // Cae aqui cuando is_premium pero no active (estado raro): tratamos como aviso suave.
    tone = "warning";
    message = "Tu premium requiere atencion. Renueva tu suscripcion para no perder acceso.";
  }

  const palette =
    tone === "danger"
      ? { bg: "var(--danger-soft)", fg: "var(--danger)", border: "var(--danger)" }
      : { bg: "var(--warning-soft)", fg: "var(--warning)", border: "var(--warning)" };

  return (
    <div
      role="alert"
      style={{
        ...styles.banner,
        background: palette.bg,
        color: palette.fg,
        borderColor: palette.border,
      }}
    >
      <div style={styles.left}>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
        <div style={{ minWidth: 0 }}>
          <span style={styles.message}>{message}</span>{" "}
          <span style={styles.price}>Premium {PRICE_LABEL}.</span>
          {error && (
            <div style={styles.errorText} role="alert">
              {error}
            </div>
          )}
        </div>
      </div>

      <div style={styles.actions}>
        <button
          type="button"
          onClick={() => navigate("/suscripcion")}
          style={{ ...styles.detailsBtn, borderColor: palette.border, color: palette.fg }}
        >
          Ver detalles
        </button>
        <button
          type="button"
          onClick={handleSubscribe}
          disabled={redirecting}
          style={{
            ...styles.subscribeBtn,
            background: palette.border,
            opacity: redirecting ? 0.7 : 1,
            cursor: redirecting ? "default" : "pointer",
          }}
        >
          {redirecting ? "Redirigiendo..." : "Suscribirme"}
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  banner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "12px 16px",
    marginBottom: 20,
    borderRadius: "var(--radius)",
    border: "1px solid",
    fontSize: 14,
    fontWeight: 600,
    flexWrap: "wrap",
  },
  left: { display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: "1 1 260px" },
  message: { fontWeight: 700 },
  price: { fontWeight: 600, opacity: 0.9 },
  errorText: { marginTop: 6, fontSize: 13, fontWeight: 600 },
  actions: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 },
  detailsBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "8px 14px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid",
    background: "transparent",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  subscribeBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "8px 16px",
    borderRadius: "var(--radius-sm)",
    color: "var(--brand-contrast)",
    fontWeight: 700,
    fontSize: 13,
    border: "none",
    whiteSpace: "nowrap",
  },
};
