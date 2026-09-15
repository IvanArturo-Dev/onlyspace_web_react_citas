import type { CSSProperties, ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import ThemeToggle from "../../components/ThemeToggle";

/**
 * Layout compartido para las paginas legales publicas (Terminos, Privacidad).
 * Encabezado con marca + volver, contenido en tarjeta legible y pie con enlaces
 * cruzados entre ambas paginas. Publico: no requiere sesion.
 */
export default function LegalPage({
  title,
  updatedAt,
  children,
}: {
  title: string;
  updatedAt: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/inicio");
  };

  return (
    <div style={styles.root}>
      <header style={styles.topBar}>
        <button
          type="button"
          onClick={() => navigate("/inicio")}
          style={styles.brandBtn}
          aria-label="Ir al inicio"
        >
          <img src="/onlyspace.png" alt="onlyspace" style={styles.brandLogo} />
          <span style={styles.brandName}>onlyspace</span>
        </button>
        <div style={styles.topActions}>
          <ThemeToggle />
          <button type="button" style={styles.backBtn} onClick={goBack}>
            ← Volver
          </button>
        </div>
      </header>

      <main style={styles.main}>
        <article style={styles.card}>
          <h1 style={styles.title}>{title}</h1>
          <p style={styles.updated}>Ultima actualizacion: {updatedAt}</p>
          <div style={styles.content}>{children}</div>
        </article>

        <nav style={styles.crossLinks} aria-label="Documentos legales">
          <Link to="/terminos" style={styles.crossLink}>
            Terminos y Condiciones
          </Link>
          <span aria-hidden style={styles.dot}>
            ·
          </span>
          <Link to="/privacidad" style={styles.crossLink}>
            Aviso de Privacidad
          </Link>
        </nav>
      </main>

      <footer style={styles.footer}>
        <p style={styles.footerText}>
          © {new Date().getFullYear()} onlyspace · Reserva tu cita en linea.
        </p>
      </footer>
    </div>
  );
}

/** Encabezado de seccion reutilizable dentro del contenido legal. */
export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section style={styles.section}>
      <h2 style={styles.h2}>{heading}</h2>
      {children}
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  root: { minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)" },
  topBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "16px 20px",
    maxWidth: 860,
    width: "100%",
    margin: "0 auto",
  },
  brandBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 0,
  },
  brandLogo: { width: 26, height: 26, objectFit: "contain", borderRadius: 6 },
  brandName: { fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--brand)" },
  topActions: { display: "flex", alignItems: "center", gap: 10 },
  backBtn: {
    padding: "8px 14px",
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text)",
    background: "var(--surface)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
  },
  main: { flex: 1, width: "100%", maxWidth: 860, margin: "0 auto", padding: "8px 20px 40px" },
  card: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    boxShadow: "var(--shadow-sm)",
    padding: "32px clamp(20px, 5vw, 44px)",
  },
  title: { fontSize: "clamp(24px, 5vw, 32px)", fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em", marginBottom: 6 },
  updated: { fontSize: 13, color: "var(--text-muted)", marginBottom: 24 },
  content: { display: "flex", flexDirection: "column", gap: 4 },
  section: { marginBottom: 22 },
  h2: { fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 8, marginTop: 4 },
  crossLinks: { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 24 },
  crossLink: { color: "var(--brand)", fontSize: 14, fontWeight: 600, textDecoration: "none" },
  dot: { color: "var(--text-subtle)" },
  footer: {
    borderTop: "1px solid var(--border)",
    padding: "20px",
    textAlign: "center",
    marginTop: 8,
  },
  footerText: { fontSize: 13, color: "var(--text-muted)" },
};

/** Estilos de texto reutilizables para parrafos y listas del contenido legal. */
export const legalText: Record<string, CSSProperties> = {
  p: { fontSize: 15, lineHeight: 1.7, color: "var(--text)", margin: "0 0 10px" },
  ul: { margin: "0 0 10px", paddingLeft: 22, display: "flex", flexDirection: "column", gap: 6 },
  li: { fontSize: 15, lineHeight: 1.6, color: "var(--text)" },
  strong: { fontWeight: 700, color: "var(--text)" },
  a: { color: "var(--brand)", fontWeight: 600 },
};