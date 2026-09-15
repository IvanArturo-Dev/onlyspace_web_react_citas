import type { CSSProperties } from "react";

export interface MonthlyPoint {
  month: string; // 'YYYY-MM'
  attended: number;
  cancelled: number;
  no_show: number;
}

interface MiniMonthlyChartProps {
  data: MonthlyPoint[];
  /** Altura del SVG (compacta por defecto). */
  height?: number;
}

// Series con su color (tokens del tema) y etiqueta para la leyenda.
const SERIES: { key: keyof Omit<MonthlyPoint, "month">; label: string; color: string }[] = [
  { key: "attended", label: "Asistio", color: "var(--success)" },
  { key: "cancelled", label: "Cancelo", color: "var(--danger)" },
  { key: "no_show", label: "No asistio", color: "var(--text-muted)" },
];

/** 'YYYY-MM' -> 'MM/YY' compacto para el eje X. */
function shortMonth(month: string): string {
  const parts = month.split("-");
  if (parts.length !== 2) return month;
  return `${parts[1]}/${parts[0].slice(2)}`;
}

// Mini grafica de barras agrupadas (asistencias/cancelaciones/inasistencias por
// mes), puramente en SVG y theme-aware via CSS vars. Pensada para vivir en una
// chartCard compacta del dashboard: baja altura y leyenda breve. Si no hay datos
// muestra "Sin datos aun" discreto.
export default function MiniMonthlyChart({ data, height = 160 }: MiniMonthlyChartProps) {
  const hasData = data.some((d) => d.attended > 0 || d.cancelled > 0 || d.no_show > 0);
  const maxValue = Math.max(
    1,
    ...data.map((d) => Math.max(d.attended, d.cancelled, d.no_show))
  );

  const n = Math.max(1, data.length);
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 22;
  // Ancho por grupo (mes); crece con la cantidad de meses para que respire.
  const groupSlot = 54;
  const width = Math.max(300, padL + padR + groupSlot * n);
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const step = plotW / n;
  const groupGapRatio = 0.28; // espacio entre grupos
  const groupW = step * (1 - groupGapRatio);
  const barW = groupW / SERIES.length;
  const yFor = (v: number) => padT + plotH - (Math.max(0, v) / maxValue) * plotH;

  const ariaLabel = hasData
    ? `Comportamiento por mes: ${data
        .map(
          (d) =>
            `${shortMonth(d.month)} asistio ${d.attended}, cancelo ${d.cancelled}, no asistio ${d.no_show}`
        )
        .join("; ")}`
    : "Comportamiento por mes: sin datos aun";

  return (
    <div style={styles.wrap}>
      {hasData ? (
        <>
          <div style={styles.svgBox}>
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
              {data.map((d, i) => {
                const groupX = padL + i * step + (step - groupW) / 2;
                const cx = groupX + groupW / 2;
                return (
                  <g key={`${d.month}-${i}`}>
                    {SERIES.map((s, j) => {
                      const value = Math.max(0, d[s.key]);
                      const x = groupX + j * barW;
                      const y = yFor(value);
                      const h = padT + plotH - y;
                      return (
                        <rect
                          key={s.key}
                          x={x}
                          y={y}
                          width={Math.max(0, barW - 1.5)}
                          height={Math.max(0, h)}
                          rx={2}
                          fill={s.color}
                        >
                          <title>{`${shortMonth(d.month)} — ${s.label}: ${value}`}</title>
                        </rect>
                      );
                    })}
                    <text
                      x={cx}
                      y={height - 7}
                      textAnchor="middle"
                      fontSize={10}
                      fill="var(--text-muted)"
                    >
                      {shortMonth(d.month)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Leyenda breve */}
          <ul style={styles.legend}>
            {SERIES.map((s) => (
              <li key={s.key} style={styles.legendItem}>
                <span style={{ ...styles.legendSwatch, background: s.color }} aria-hidden="true" />
                <span style={styles.legendLabel}>{s.label}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div style={styles.empty}>Sin datos aun</div>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: { width: "100%", display: "flex", flexDirection: "column", gap: 8 },
  svgBox: { width: "100%", overflowX: "auto" },
  legend: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexWrap: "wrap",
    gap: 12,
  },
  legendItem: { display: "flex", alignItems: "center", gap: 6, fontSize: 12 },
  legendSwatch: { width: 10, height: 10, borderRadius: 2, flexShrink: 0, display: "inline-block" },
  legendLabel: { color: "var(--text-muted)" },
  empty: { fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "28px 0" },
};
