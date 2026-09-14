import type { CSSProperties } from "react";

export interface Bar {
  label: string;
  value: number;
  color?: string; // CSS color / var(--...)
}

interface DayBarChartProps {
  bars: Bar[];
  height?: number;
}

// Grafica de barras verticales puramente en SVG, theme-aware via CSS vars.
// Cada barra muestra su valor encima y su etiqueta debajo (eje X). Responsiva
// via viewBox + width 100%. Si no hay datos, muestra "Sin datos" centrado.
export default function DayBarChart({ bars, height = 220 }: DayBarChartProps) {
  const maxValue = Math.max(1, ...bars.map((b) => Math.max(0, b.value)));
  const hasData = bars.some((b) => b.value > 0);

  const n = Math.max(1, bars.length);
  const padL = 12;
  const padR = 12;
  const padT = 22;
  const padB = 30;
  // Ancho dinamico segun cantidad de barras para que respiren.
  const slot = 44;
  const width = Math.max(320, padL + padR + slot * n);
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const gapRatio = 0.35;
  const step = plotW / n;
  const barW = step * (1 - gapRatio);
  const yFor = (v: number) => padT + plotH - (Math.max(0, v) / maxValue) * plotH;

  const ariaLabel = hasData
    ? `Citas por dia: ${bars.map((b) => `${b.label} ${b.value}`).join(", ")}`
    : "Citas por dia: sin datos";

  return (
    <div style={styles.wrap}>
      {hasData ? (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={ariaLabel}
          preserveAspectRatio="none"
          style={{ display: "block" }}
        >
          {/* Eje base */}
          <line
            x1={padL}
            y1={padT + plotH}
            x2={width - padR}
            y2={padT + plotH}
            stroke="var(--border)"
            strokeWidth={1}
          />
          {bars.map((b, i) => {
            const x = padL + i * step + (step - barW) / 2;
            const y = yFor(b.value);
            const h = padT + plotH - y;
            const color = b.color || "var(--brand)";
            const cx = x + barW / 2;
            return (
              <g key={`${b.label}-${i}`}>
                <rect x={x} y={y} width={barW} height={Math.max(0, h)} rx={4} fill={color}>
                  <title>{`${b.label}: ${b.value}`}</title>
                </rect>
                <text
                  x={cx}
                  y={y - 6}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={700}
                  fill="var(--text)"
                >
                  {b.value}
                </text>
                <text
                  x={cx}
                  y={height - 10}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--text-muted)"
                >
                  {b.label}
                </text>
              </g>
            );
          })}
        </svg>
      ) : (
        <div style={styles.empty}>Sin datos</div>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: { width: "100%", overflowX: "auto" },
  empty: { fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "40px 0" },
};
