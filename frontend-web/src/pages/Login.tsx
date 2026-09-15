import { useState } from "react";
import type { CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/useAuthStore";
import { trackEvent } from "../lib/firebase";
import ThemeToggle from "../components/ThemeToggle";
import Spinner from "../components/Spinner";
import { card } from "../ui/ui";

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a11 11 0 0 0-9.82 6.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#1877F2"
        d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z"
      />
    </svg>
  );
}

export default function Login() {
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");
  const [btnHover, setBtnHover] = useState(false);
  const { loginWithGoogle } = useAuthStore();
  const navigate = useNavigate();

  const handleGoogle = async () => {
    setGoogleLoading(true);
    setError("");
    try {
      await loginWithGoogle();
      trackEvent("login", { method: "google" });
      navigate("/");
    } catch (err: any) {
      // Registramos el detalle tecnico en consola para depurar, pero al usuario
      // le mostramos un mensaje claro en espanol (nunca el objeto/codigo crudo).
      console.error("Google Sign-In error (full):", err);
      const backendMsg = err?.response?.data?.error?.message;
      const msg =
        typeof backendMsg === "string" && backendMsg.trim()
          ? backendMsg
          : "No pudimos iniciar sesion con Google. Intentalo de nuevo.";
      setError(msg);
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.themeCorner}>
        <ThemeToggle />
      </div>

      <div style={styles.stack}>
        <div style={{ ...card, ...styles.card }} className="fade-in">
          <div style={styles.logo}>
            <img src="/onlyspace.png" alt="onlyspace" style={{ width: 44, height: 44, objectFit: "contain" }} />
          </div>
          <h1 style={styles.title}>onlyspace</h1>
          <p style={styles.subtitle}>Inicia sesion para continuar</p>

          {error && (
            <div style={styles.error} role="alert">
              {error}
            </div>
          )}

          <button
            style={{
              ...styles.providerBtn,
              ...(btnHover ? styles.providerBtnHover : {}),
              ...(googleLoading ? styles.providerBtnDisabled : {}),
            }}
            type="button"
            onClick={handleGoogle}
            disabled={googleLoading}
            aria-busy={googleLoading}
            onMouseEnter={() => setBtnHover(true)}
            onMouseLeave={() => setBtnHover(false)}
          >
            {googleLoading ? (
              <>
                <Spinner size={18} /> Conectando...
              </>
            ) : (
              <>
                <GoogleIcon /> Continuar con Google
              </>
            )}
          </button>

          {/* Facebook: preparado, deshabilitado hasta configurar credenciales. */}
          <button
            style={{ ...styles.providerBtn, ...styles.providerBtnDisabled }}
            type="button"
            disabled
            title="Disponible proximamente"
            aria-disabled="true"
          >
            <FacebookIcon /> Continuar con Facebook
            <span style={styles.soonTag}>Proximamente</span>
          </button>

          <p style={styles.legal}>
            Al continuar aceptas nuestros{" "}
            <Link to="/terminos" style={styles.legalLink}>Terminos y Condiciones</Link>{" "}y el{" "}
            <Link to="/privacidad" style={styles.legalLink}>Aviso de Privacidad</Link>.
          </p>

          {/* Acceso para visitantes: reservar sin iniciar sesion (descubrimiento / busqueda). */}
          <div style={styles.explore}>
            <span style={styles.exploreLabel}>Solo quieres reservar?</span>
            <div style={styles.exploreActions}>
              <button
                type="button"
                style={styles.exploreBtn}
                onClick={() => {
                  trackEvent("login_explore", { target: "descubrimiento" });
                  navigate("/inicio");
                }}
              >
                Explorar sucursales
              </button>
              <button
                type="button"
                style={styles.exploreBtn}
                onClick={() => {
                  trackEvent("login_explore", { target: "buscar" });
                  navigate("/buscar");
                }}
              >
                Buscar por codigo o nombre
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    background: "var(--bg)",
    position: "relative",
  },
  themeCorner: { position: "absolute", top: 20, right: 20 },
  stack: { width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", gap: 18 },
  card: { padding: 36, width: "100%", boxShadow: "var(--shadow-lg)", textAlign: "center" },
  logo: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 56,
    height: 56,
    borderRadius: 16,
    background: "var(--brand-soft)",
    fontSize: 28,
    marginBottom: 16,
  },
  title: { fontSize: 28, fontWeight: 700, color: "var(--text)", marginBottom: 4, letterSpacing: "-0.01em" },
  subtitle: { fontSize: 15, color: "var(--text-muted)", marginBottom: 28 },
  providerBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    width: "100%",
    padding: 13,
    fontSize: 15,
    fontWeight: 600,
    color: "var(--text)",
    background: "var(--surface)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-sm)",
    transition: "background-color 0.15s ease",
    marginBottom: 12,
    position: "relative",
  },
  providerBtnHover: { background: "var(--surface-hover)" },
  providerBtnDisabled: { opacity: 0.55, cursor: "not-allowed" },
  soonTag: {
    position: "absolute",
    right: 10,
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--text-subtle)",
    background: "var(--surface-hover)",
    borderRadius: 999,
    padding: "2px 8px",
  },
  legal: { fontSize: 12, color: "var(--text-subtle)", marginTop: 8, marginBottom: 0, lineHeight: 1.5 },
  legalLink: { color: "var(--brand)", fontWeight: 600, textDecoration: "none" },
  error: {
    background: "var(--danger-soft)",
    color: "var(--danger)",
    padding: 12,
    borderRadius: "var(--radius-sm)",
    marginBottom: 16,
    fontSize: 14,
    textAlign: "left",
  },
  explore: {
    marginTop: 20,
    paddingTop: 18,
    borderTop: "1px solid var(--border)",
  },
  exploreLabel: {
    display: "block",
    fontSize: 13,
    color: "var(--text-muted)",
    marginBottom: 10,
  },
  exploreActions: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  exploreBtn: {
    width: "100%",
    padding: 11,
    fontSize: 14,
    fontWeight: 600,
    color: "var(--brand)",
    background: "var(--brand-soft)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
    transition: "background-color 0.15s ease",
  },
};
