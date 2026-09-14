import type React from "react";

// Reusable inline-style building blocks that reference the CSS theme variables.
// Because they use var(--token), they automatically adapt to light/dark mode.

export const card: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  boxShadow: "var(--shadow-sm)",
};

export const pageTitle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 700,
  color: "var(--text)",
  letterSpacing: "-0.01em",
};

export const subtitle: React.CSSProperties = {
  fontSize: 14,
  color: "var(--text-muted)",
};

export function btn(variant: "primary" | "secondary" | "danger" | "ghost" = "primary"): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "10px 16px",
    fontSize: 14,
    fontWeight: 600,
    borderRadius: "var(--radius-sm)",
    transition: "background-color 0.15s ease, opacity 0.15s ease, border-color 0.15s ease",
    whiteSpace: "nowrap",
  };
  switch (variant) {
    case "primary":
      return { ...base, background: "var(--brand)", color: "var(--brand-contrast)" };
    case "secondary":
      return { ...base, background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border-strong)" };
    case "danger":
      return { ...base, background: "var(--danger)", color: "#fff" };
    case "ghost":
      return { ...base, background: "transparent", color: "var(--text-muted)" };
  }
}

export const field: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  marginBottom: 14,
};

export const table: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  overflow: "hidden",
};

export const th: React.CSSProperties = {
  textAlign: "left",
  padding: "12px 14px",
  background: "var(--surface-hover)",
  fontSize: 12,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--text-muted)",
  borderBottom: "1px solid var(--border)",
};

export const td: React.CSSProperties = {
  padding: "12px 14px",
  fontSize: 14,
  color: "var(--text)",
  borderBottom: "1px solid var(--border)",
};

export function badge(kind: "success" | "warning" | "danger" | "info" | "muted"): React.CSSProperties {
  const map: Record<string, { bg: string; fg: string }> = {
    success: { bg: "var(--success-soft)", fg: "var(--success)" },
    warning: { bg: "var(--warning-soft)", fg: "var(--warning)" },
    danger: { bg: "var(--danger-soft)", fg: "var(--danger)" },
    info: { bg: "var(--info-soft)", fg: "var(--info)" },
    muted: { bg: "var(--surface-hover)", fg: "var(--text-muted)" },
  };
  const c = map[kind];
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    background: c.bg,
    color: c.fg,
  };
}

export const emptyState: React.CSSProperties = {
  ...card,
  padding: 40,
  textAlign: "center",
  color: "var(--text-muted)",
};
