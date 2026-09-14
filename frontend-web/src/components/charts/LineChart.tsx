import type { CSSProperties } from "react";

export interface LinePoint {
  /** Etiqueta legible del bucket (eje X). */
  label: string;
  value: number;
}

export interface LineSeries {
  name: string;
  color: string; // CSS color / var(--...)
  points: LinePoint[];
}

interface LineChartProps {
  series: LineSeries[];
  height?: number;
  /** Numero de etiquetas del eje X a mostrar (se muestrean uniformemente). */
  maxXLabels?: number;
}

// Grafico de lineas puramente en SVG. Theme-aware via CSS vars.
// Soporta varias series superpuestas (p. ej. reservaciones y cancelaciones).
export default function LineChart({ series, height = 220, maxXLabels = 6 }: LineChartProps) {
  const width = 720; // viewBox width; el SVG escala al contenedor.
  const padL = 40;
  const padR = 16;
  const padT = 16;
  const padB = 34;

  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const length = Math.max(...series.map((s) => s.points.length), 0);
  const allValues = series.flatMap((s) => s.points.map((p) => p.value));
  const maxValue = Math.max(1, ...allValues);

  // Escalas
  const xFor = (i: number) => (length <= 1 ? padL + plotW / 2 : padL + (i / (length - 1)) * plotW);
  const yFor = (v: number) => padT + plotH - (v / maxValue) * plotH;

  // Lineas de referencia horizontales (grid) con etiquetas del eje Y.
  const yTicks = 4;
  const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) => Math.round((maxValue / yTicks) * i));

  // Etiquetas del eje X (muestreadas).
  const baseLabels = series[0]?.points ?? [];
  const step = Math.max(1, Math.ceil(length / maxXLabels));

  const hasData = length > 0 && allValues.some((v) => v > 0);

  return (
    <div style={styles.wrap}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        preserveAspectRatio="none"
        style={{ display: "block" }}
      >
        {/* Grid horizontal + etiquetas Y */}
        {yTickValues.map((tv) => {
          const y = yFor(tv);
          return (
            <g key={tv}>
              <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="var(--border)" strokeWidth={1} />
              <text x={padL - 6} y={y + 4} textAnchor="end" fontSize={10} fill="var(--text-muted)">
                {tv}
              </text>
            </g>
          );
        })}

        {/* Etiquetas eje X */}
        {baseLabels.map((p, i) =>
          i % step === 0 || i === length - 1 ? (
            <text key={i} x={xFor(i)} y={height - 12} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
              {p.label}
            </text>
          ) : null
        )}

        {/* Series */}
        {series.map((s) => {
          const pts = s.points.map((p, i) => `${xFor(i)},${yFor(p.value)}`).join(" ");
          return (
            <g key={s.name}>
              {s.points.length > 1 && (
                <polyline points={pts} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              )}
              {s.points.map((p, i) => (
                <circle key={i} cx={xFor(i)} cy={yFor(p.value)} r={3} fill={s.color}>
                  <title>{`${s.name} · ${p.label}: ${p.value}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>

      {/* Leyenda */}
      <div style={styles.legend}>
        {series.map((s) => (
          <span key={s.name} style={styles.legendItem}>
            <span style={{ ...styles.legendDot, background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>

      {!hasData && <div style={styles.empty}>Sin actividad en el rango seleccionado.</div>}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: { width: "100%", position: "relative" },
  legend: { display: "flex", gap: 16, flexWrap: "wrap", marginTop: 4, paddingLeft: 40 },
  legendItem: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)", fontWeight: 600 },
  legendDot: { width: 10, height: 10, borderRadius: 999, display: "inline-block" },
  empty: { fontSize: 13, color: "var(--text-muted)", textAlign: "center", marginTop: 8 },
};
