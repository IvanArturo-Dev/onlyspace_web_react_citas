import type { CSSProperties } from "react";

interface SpinnerProps {
  size?: number;
  color?: string;
  thickness?: number;
  style?: CSSProperties;
}

// Spinner CSS puro. Inyecta la keyframe "spin" una sola vez.
let injected = false;
function ensureKeyframes() {
  if (injected) return;
  injected = true;
  const el = document.createElement("style");
  el.textContent = "@keyframes spin { to { transform: rotate(360deg); } }";
  document.head.appendChild(el);
}

export default function Spinner({ size = 20, color = "var(--brand)", thickness = 2, style }: SpinnerProps) {
  ensureKeyframes();
  return (
    <span
      aria-label="Cargando"
      role="status"
      style={{
        display: "inline-block",
        width: size,
        height: size,
        border: `${thickness}px solid var(--border)`,
        borderTopColor: color,
        borderRadius: "50%",
        animation: "spin 0.7s linear infinite",
        ...style,
      }}
    />
  );
}

// Estado de carga centrado a pantalla completa, usando tokens.
export function FullScreenLoader({ message = "Cargando..." }: { message?: string }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        background: "var(--bg)",
        color: "var(--text-muted)",
      }}
    >
      <Spinner size={32} thickness={3} />
      <span style={{ fontSize: 14 }}>{message}</span>
    </div>
  );
}
