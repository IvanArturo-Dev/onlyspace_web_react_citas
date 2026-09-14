import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import Spinner from "../components/Spinner";
import { trackEvent } from "../lib/firebase";
import { useAuthStore } from "../store/useAuthStore";
import { googleService, type GoogleStatus } from "../services/google.service";
import { card, pageTitle, subtitle, btn } from "../ui/ui";

/**
 * Pantalla de ajustes de integracion con Google Workspace (SOLO ADMIN/emprendedor).
 *
 * FLUJO OAUTH — ruta de redirect del frontend
 * -------------------------------------------
 * Esta MISMA pantalla (`/integraciones`) actua como pagina de retorno del OAuth:
 * al conectar, el navegador va a Google y Google redirige de vuelta a
 * `GOOGLE_CONNECT_REDIRECT_URI` con `?code=...&state=...`. Esa env var del backend
 * DEBE apuntar a esta ruta del frontend y el MISMO valor debe registrarse en Google
 * Cloud Console (Authorized redirect URIs).
 *
 *   Desarrollo:  GOOGLE_CONNECT_REDIRECT_URI = http://localhost:5173/integraciones
 *   Produccion:  GOOGLE_CONNECT_REDIRECT_URI = https://TU_DOMINIO/integraciones
 *
 * Al montar, si la URL trae `code` y `state`, validamos el `state` guardado en
 * sessionStorage al iniciar la conexion y llamamos a submitCallback(code, state)
 * para que el backend intercambie el code y guarde los tokens cifrados.
 */

const STATE_KEY = "google_connect_state";

export default function Integraciones() {
  const isAdmin = useAuthStore((s) => s.user?.role === "ADMIN");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [savingToggle, setSavingToggle] = useState<"online_sessions" | "save_contacts" | null>(null);
  // Procesando el retorno del OAuth (code/state en la URL).
  const [processingCallback, setProcessingCallback] = useState(false);
  const [notice, setNotice] = useState("");

  const readError = (err: any, fallback: string): string =>
    err?.response?.data?.error?.message || err?.message || fallback;

  const loadStatus = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await googleService.getStatus();
      setStatus(data);
    } catch (err) {
      setError(readError(err, "No se pudo cargar el estado de Google"));
    } finally {
      setLoading(false);
    }
  };

  // Al montar: procesar retorno del OAuth si aplica, si no, cargar estado.
  useEffect(() => {
    if (!isAdmin) return;
    trackEvent("screen_view", { screen_name: "Integraciones" });

    const code = searchParams.get("code");
    const state = searchParams.get("state");

    if (code && state) {
      handleCallback(code, state);
    } else {
      loadStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const handleCallback = async (code: string, state: string) => {
    setProcessingCallback(true);
    setError("");
    setNotice("");
    // Validar el state contra el que guardamos al iniciar la conexion (CSRF).
    const savedState = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
    // Limpiar los query params de la URL para evitar reprocesar al recargar.
    navigate("/integraciones", { replace: true });

    if (savedState && savedState !== state) {
      setProcessingCallback(false);
      setError("La validacion de seguridad fallo. Intenta conectar de nuevo.");
      await loadStatus();
      return;
    }

    try {
      const updated = await googleService.submitCallback(code, state);
      setStatus(updated);
      setNotice("Tu cuenta de Google quedo conectada.");
      trackEvent("google_connected", {});
    } catch (err) {
      setError(readError(err, "No se pudo completar la conexion con Google"));
      await loadStatus();
    } finally {
      setProcessingCallback(false);
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    setError("");
    setNotice("");
    try {
      const { auth_url, state } = await googleService.getConnectUrl();
      // Guardamos el state para validarlo al volver del callback.
      sessionStorage.setItem(STATE_KEY, state);
      // Redirigimos el navegador al consentimiento de Google.
      window.location.href = auth_url;
    } catch (err) {
      setError(readError(err, "No se pudo iniciar la conexion con Google"));
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm("Desconectar tu cuenta de Google? Se dejaran de sincronizar citas, Meet y contactos.")) {
      return;
    }
    setDisconnecting(true);
    setError("");
    setNotice("");
    try {
      await googleService.disconnect();
      setStatus({ connected: false, google_email: null, online_sessions: false, save_contacts: false });
      setNotice("Tu cuenta de Google fue desconectada.");
      trackEvent("google_disconnected", {});
    } catch (err) {
      setError(readError(err, "No se pudo desconectar la cuenta de Google"));
    } finally {
      setDisconnecting(false);
    }
  };

  const handleToggle = async (key: "online_sessions" | "save_contacts", value: boolean) => {
    if (!status) return;
    setSavingToggle(key);
    setError("");
    setNotice("");
    // Optimista: reflejamos el cambio y revertimos si falla.
    const previous = status;
    setStatus({ ...status, [key]: value });
    try {
      const updated = await googleService.updateSettings({ [key]: value });
      setStatus(updated);
    } catch (err) {
      setStatus(previous);
      setError(readError(err, "No se pudo actualizar el ajuste"));
    } finally {
      setSavingToggle(null);
    }
  };

  // Guard de rol: solo el emprendedor (ADMIN) ve esta pantalla. Un ASSISTANT/CLIENT
  // que llegue por URL directa es redirigido al inicio del area de gestion.
  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  const busy = loading || processingCallback;
  const connected = Boolean(status?.connected);

  return (
    <div>
      <h1 style={pageTitle}>Integraciones</h1>
      <p style={{ ...subtitle, marginTop: 6 }}>
        Conecta tu cuenta de Google para sincronizar tus citas con Google Calendar,
        generar enlaces de Google Meet para citas en linea y guardar tus clientes en
        Google Contacts.
      </p>

      {error && <div style={styles.errorBox}>{error}</div>}
      {notice && <div style={styles.noticeBox}>{notice}</div>}

      <div style={{ ...card, padding: 24, maxWidth: 560, marginTop: 20 }}>
        {busy ? (
          <div style={styles.loadingRow}>
            <Spinner /> {processingCallback ? "Conectando con Google..." : "Cargando..."}
          </div>
        ) : (
          <>
            <div style={styles.statusRow}>
              <div style={styles.googleMark} aria-hidden="true">G</div>
              <div style={{ flex: 1 }}>
                <div style={styles.statusTitle}>Google Workspace</div>
                {connected ? (
                  <div style={styles.statusConnected}>
                    Conectado{status?.google_email ? ` · ${status.google_email}` : ""}
                  </div>
                ) : (
                  <div style={subtitle}>No conectado</div>
                )}
              </div>
              {connected ? (
                <button
                  type="button"
                  style={btn("danger")}
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                >
                  {disconnecting ? "Desconectando..." : "Desconectar"}
                </button>
              ) : (
                <button
                  type="button"
                  style={btn("primary")}
                  onClick={handleConnect}
                  disabled={connecting}
                >
                  {connecting ? "Redirigiendo..." : "Conectar Google"}
                </button>
              )}
            </div>

            {connected && (
              <div style={styles.togglesBlock}>
                <ToggleRow
                  label="Sesiones en linea"
                  hint="Permite que tus clientes elijan cita en linea y genera un Google Meet al confirmar."
                  checked={Boolean(status?.online_sessions)}
                  saving={savingToggle === "online_sessions"}
                  onChange={(v) => handleToggle("online_sessions", v)}
                />
                <ToggleRow
                  label="Guardar clientes en mis contactos"
                  hint="Guarda o actualiza los datos del cliente en tus Google Contacts al agendar."
                  checked={Boolean(status?.save_contacts)}
                  saving={savingToggle === "save_contacts"}
                  onChange={(v) => handleToggle("save_contacts", v)}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  hint: string;
  checked: boolean;
  saving: boolean;
  onChange: (value: boolean) => void;
}

function ToggleRow({ label, hint, checked, saving, onChange }: ToggleRowProps) {
  return (
    <div style={styles.toggleRow}>
      <div style={{ flex: 1 }}>
        <div style={styles.toggleLabel}>{label}</div>
        <div style={subtitle}>{hint}</div>
      </div>
      <label style={styles.switch} title={label}>
        <input
          type="checkbox"
          checked={checked}
          disabled={saving}
          onChange={(e) => onChange(e.target.checked)}
          style={styles.switchInput}
          aria-label={label}
        />
        <span
          style={{
            ...styles.switchTrack,
            background: checked ? "var(--brand)" : "var(--border-strong)",
            opacity: saving ? 0.6 : 1,
          }}
        >
          <span
            style={{
              ...styles.switchThumb,
              transform: checked ? "translateX(18px)" : "translateX(0)",
            }}
          />
        </span>
      </label>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  errorBox: {
    background: "var(--danger-soft)",
    color: "var(--danger)",
    padding: 12,
    borderRadius: "var(--radius-sm)",
    marginTop: 16,
    fontSize: 14,
    maxWidth: 560,
  },
  noticeBox: {
    background: "var(--success-soft)",
    color: "var(--success)",
    padding: 12,
    borderRadius: "var(--radius-sm)",
    marginTop: 16,
    fontSize: 14,
    maxWidth: 560,
  },
  loadingRow: { display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)" },
  statusRow: { display: "flex", alignItems: "center", gap: 14 },
  googleMark: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
    borderRadius: "50%",
    background: "var(--brand-soft)",
    color: "var(--brand)",
    fontWeight: 700,
    fontSize: 20,
    flexShrink: 0,
  },
  statusTitle: { fontSize: 16, fontWeight: 700, color: "var(--text)" },
  statusConnected: { fontSize: 14, color: "var(--success)", fontWeight: 600, marginTop: 2, wordBreak: "break-all" },
  togglesBlock: { marginTop: 22, borderTop: "1px solid var(--border)", paddingTop: 6 },
  toggleRow: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "14px 0",
    borderBottom: "1px solid var(--border)",
  },
  toggleLabel: { fontSize: 15, fontWeight: 600, color: "var(--text)" },
  switch: { position: "relative", display: "inline-flex", alignItems: "center", cursor: "pointer", flexShrink: 0 },
  switchInput: { position: "absolute", opacity: 0, width: 0, height: 0 },
  switchTrack: {
    display: "inline-flex",
    alignItems: "center",
    width: 40,
    height: 22,
    borderRadius: 999,
    padding: 2,
    transition: "background-color 0.15s ease",
  },
  switchThumb: {
    display: "inline-block",
    width: 18,
    height: 18,
    borderRadius: "50%",
    background: "#fff",
    boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
    transition: "transform 0.15s ease",
  },
};
