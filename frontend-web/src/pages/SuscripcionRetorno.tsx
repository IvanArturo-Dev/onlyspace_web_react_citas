import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { card, pageTitle, subtitle, btn, badge } from "../ui/ui";
import Spinner from "../components/Spinner";
import { mySubscriptionService } from "../services/subscription.service";
import { usePremiumStore } from "../store/usePremium";

// Numero de reintentos y espera entre ellos (el webhook de Mercado Pago puede tardar
// unos segundos en confirmar el pago y activar el premium).
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 3000;

type Phase = "checking" | "premium" | "pending" | "error";

// Pagina de retorno tras el pago en Mercado Pago (back_url = /suscripcion/retorno).
// Consulta GET /me/subscription con reintentos porque la activacion depende del
// webhook. Si detecta premium, muestra exito; si no, explica que puede tardar.
export default function SuscripcionRetorno() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("checking");
  const [daysLeft, setDaysLeft] = useState<number | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;

    const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    const run = async () => {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (cancelled.current) return;
        try {
          const status = await mySubscriptionService.getStatus();
          if (cancelled.current) return;
          if (status.is_premium) {
            setDaysLeft(status.days_left ?? null);
            setPhase("premium");
            // Refresca el estado premium compartido para que el resto de la app lo vea.
            usePremiumStore.getState().refresh();
            return;
          }
        } catch {
          // Ignoramos errores puntuales y seguimos reintentando; solo fallamos al final.
        }
        if (attempt < MAX_ATTEMPTS) {
          await wait(RETRY_DELAY_MS);
        }
      }
      if (!cancelled.current) setPhase("pending");
    };

    void run();

    return () => {
      cancelled.current = true;
    };
  }, []);

  return (
    <div>
      <h1 style={pageTitle}>Suscripcion</h1>

      <div style={{ ...card, ...styles.box }}>
        {phase === "checking" && (
          <div style={styles.center} role="status" aria-live="polite">
            <Spinner size={32} thickness={3} />
            <h2 style={styles.heading}>Estamos confirmando tu pago...</h2>
            <p style={subtitle}>
              Esto puede tardar unos segundos. No cierres esta ventana.
            </p>
          </div>
        )}

        {phase === "premium" && (
          <div style={styles.center}>
            <div style={styles.iconOk} aria-hidden="true">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <h2 style={styles.heading}>Tu premium esta activo</h2>
            <div style={{ marginTop: 4 }}>
              <span style={badge("success")}>⭐ Premium activo</span>
            </div>
            {daysLeft != null && (
              <p style={{ ...subtitle, marginTop: 10 }}>
                Te quedan {Math.max(0, daysLeft)} {Math.max(0, daysLeft) === 1 ? "dia" : "dias"}.
              </p>
            )}
            <div style={styles.actions}>
              <button type="button" style={btn("primary")} onClick={() => navigate("/")}>
                Ir al panel
              </button>
              <button type="button" style={btn("secondary")} onClick={() => navigate("/suscripcion")}>
                Ver mi suscripcion
              </button>
            </div>
          </div>
        )}

        {phase === "pending" && (
          <div style={styles.center}>
            <div style={styles.iconPending} aria-hidden="true">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z" />
                <path d="M12 6v6l4 2" />
              </svg>
            </div>
            <h2 style={styles.heading}>Tu pago se esta procesando</h2>
            <p style={{ ...subtitle, marginTop: 8, maxWidth: 460 }}>
              La confirmacion puede tardar unos minutos. Si ya autorizaste el pago en Mercado Pago,
              tu premium se activara automaticamente. Puedes volver al panel y revisar mas tarde.
            </p>
            <div style={styles.actions}>
              <button type="button" style={btn("primary")} onClick={() => navigate("/suscripcion")}>
                Revisar estado
              </button>
              <button type="button" style={btn("secondary")} onClick={() => navigate("/")}>
                Volver al panel
              </button>
            </div>
          </div>
        )}

        {phase === "error" && (
          <div style={styles.center} role="alert">
            <h2 style={styles.heading}>No pudimos confirmar tu pago</h2>
            <p style={{ ...subtitle, marginTop: 8 }}>Intenta revisar tu estado desde la pantalla de suscripcion.</p>
            <div style={styles.actions}>
              <button type="button" style={btn("primary")} onClick={() => navigate("/suscripcion")}>
                Ir a suscripcion
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  box: { padding: 32, marginTop: 20 },
  center: { display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 8 },
  heading: { fontSize: 20, fontWeight: 700, color: "var(--text)", margin: "8px 0 0" },
  iconOk: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 64,
    height: 64,
    borderRadius: "50%",
    background: "var(--success-soft)",
  },
  iconPending: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 64,
    height: 64,
    borderRadius: "50%",
    background: "var(--warning-soft)",
  },
  actions: { display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", marginTop: 20 },
};
