import type { CSSProperties } from "react";

export interface DonutSegment {
  label: string;
  value: number;
  color: string; // CSS color / var(--...)
}

interface DonutChartProps {
  segments: DonutSegment[];
  /** Diametro del viewBox (el SVG escala al ancho del contenedor). */
  size?: number;
  /** Grosor del anillo. */
  thickness?: number;
}

// Grafica de dona (anillo) puramente en SVG, theme-aware via CSS vars.
// Muestra una leyenda textual con label + valor (no depende solo del color,
// por accesibilidad). Si todos los valores son 0, muestra "Sin datos".
export default function DonutChart({ segments, size = 200, thickness = 26 }: DonutChartProps) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const hasData = total > 0;

  const radius = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;

  // Acumulador para calcular el offset de cada arco.
  let acc = 0;

  const ariaLabel = hasData
    ? `Distribucion por estado: ${segments
        .filter((s) => s.value > 0)
        .map((s) => `${s.label} ${s.value}`)
        .join(", ")}`
    : "Distribucion por estado: sin datos";

  return (
    <div style={styles.wrap}>
      <div style={styles.svgBox}>
        <svg
          viewBox={`0 0 ${size} ${size}`}
          width="100%"
          height="100%"
          role="img"
          aria-label={ariaLabel}
          style={{ display: "block", maxWidth: size }}
        >
          {/* Anillo de fondo */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="var(--surface-hover)"
            strokeWidth={thickness}
          />

          {hasData ? (
            segments.map((s) => {
              const value = Math.max(0, s.value);
              if (value === 0) return null;
              const fraction = value / total;
              const dash = fraction * circumference;
              const gap = circumference - dash;
              // Offset negativo para empezar el arco donde termino el anterior.
              const offset = -acc * circumference;
              acc += fraction;
              return (
                <circle
                  key={s.label}
                  cx={cx}
                  cy={cy}
                  r={radius}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={thickness}
                  strokeDasharray={`${dash} ${gap}`}
                  strokeDashoffset={offset}
                  // Rotar -90deg para empezar arriba (12 en punto).
                  transform={`rotate(-90 ${cx} ${cy})`}
                >
                  <title>{`${s.label}: ${value}`}</title>
                </circle>
              );
            })
          ) : (
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={14}
              fill="var(--text-muted)"
            >
              Sin datos
            </text>
          )}

          {/* Total en el centro cuando hay datos */}
          {hasData && (
            <>
              <text
                x={cx}
                y={cy - 6}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={26}
                fontWeight={700}
                fill="var(--text)"
              >
                {total}
              </text>
              <text
                x={cx}
                y={cy + 16}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={11}
                fill="var(--text-muted)"
              >
                citas
              </text>
            </>
          )}
        </svg>
      </div>

      {/* Leyenda textual: cuadrito de color + label + valor */}
      <ul style={styles.legend}>
        {segments.map((s) => (
          <li key={s.label} style={styles.legendItem}>
            <span style={{ ...styles.legendSwatch, background: s.color }} aria-hidden="true" />
            <span style={styles.legendLabel}>{s.label}</span>
            <span style={styles.legendValue}>{Math.max(0, s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: { display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" },
  svgBox: { flex: "0 0 auto", width: 180, maxWidth: "100%" },
  legend: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8, flex: "1 1 160px", minWidth: 140 },
  legendItem: { display: "flex", alignItems: "center", gap: 8, fontSize: 13 },
  legendSwatch: { width: 12, height: 12, borderRadius: 3, flexShrink: 0, display: "inline-block" },
  legendLabel: { color: "var(--text)", flex: 1 },
  legendValue: { color: "var(--text-muted)", fontWeight: 700, minWidth: 24, textAlign: "right" },
};
