import type { CSSProperties } from "react";
import { card } from "../../ui/ui";

interface PromoCardProps {
  title: string;
  body?: string;
  imageUrl?: string;
  linkUrl?: string;
  /** Color de acento de la marca del emprendedor. Fallback a var(--brand). */
  brandColor?: string;
}

/**
 * Anuncio propio del emprendedor (Req 4.1). Usa los tokens del diseno,
 * se etiqueta como "Promocion" y respeta el tema claro/oscuro.
 * Si hay linkUrl, toda la tarjeta es un enlace externo seguro (_blank + noopener).
 * brandColor se usa como acento (borde izquierdo + fondo de la etiqueta) con
 * un fallback sensato a var(--brand).
 */
export default function PromoCard({ title, body, imageUrl, linkUrl, brandColor }: PromoCardProps) {
  const accent = brandColor || "var(--brand)";

  const content = (
    <>
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          style={styles.image}
          loading="lazy"
        />
      )}
      <div style={styles.body}>
        <span style={{ ...styles.tag, background: accent }}>Promocion</span>
        <div style={styles.title}>{title}</div>
        {body && <p style={styles.text}>{body}</p>}
      </div>
    </>
  );

  const containerStyle: CSSProperties = {
    ...card,
    ...styles.container,
    borderLeft: `3px solid ${accent}`,
  };

  if (linkUrl) {
    return (
      <a
        href={linkUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{ ...containerStyle, ...styles.link }}
      >
        {content}
      </a>
    );
  }

  return <div style={containerStyle}>{content}</div>;
}

const styles: Record<string, CSSProperties> = {
  container: {
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  link: {
    textDecoration: "none",
    color: "inherit",
    cursor: "pointer",
    display: "block",
  },
  image: {
    width: "100%",
    height: 140,
    objectFit: "cover",
    display: "block",
  },
  body: {
    padding: 16,
  },
  tag: {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "#fff",
    marginBottom: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    color: "var(--text)",
  },
  text: {
    fontSize: 14,
    color: "var(--text-muted)",
    marginTop: 6,
    lineHeight: 1.5,
  },
};
