import type { CSSProperties } from "react";

export interface BarDatum {
  label: string;
  value: number;
  color?: string; // CSS color / var(--...)
}

interface BarChartProps {
  data: BarDatum[];
  height?: number;
  /** Orientacion: barras horizontales (default) o verticales. */
  orientation?: "horizontal" | "vertical";
}

// Grafico de barras puramente en SVG. Theme-aware via CSS vars.
export default function BarChart({ data, height = 220, orientation = "horizontal" }: BarChartProps) {
  const maxValue = Math.max(1, ...data.map((d) => d.value));
  const hasData = data.some((d) => d.value > 0);

  if (orientation === "horizontal") {
    return (
      <div style={styles.wrap}>
        <div style={styles.hRows}>
          {data.map((d) => {
            const pct = (d.value / maxValue) * 100;
            const color = d.color || "var(--brand)";
            return (
              <div key={d.label} style={styles.hRow} title={`${d.label}: ${d.value}`}>
                <span style={styles.hLabel}>{d.label}</span>
                <div style={styles.hTrack}>
                  <div style={{ ...styles.hFill, width: `${pct}%`, background: color }} />
                </div>
                <span style={styles.hValue}>{d.value}</span>
              </div>
            );
          })}
        </div>
        {!hasData && <div style={styles.empty}>Sin datos.</div>}
      </div>
    );
  }

  // Vertical
  const width = 720;
  const padL = 32;
  const padR = 16;
  const padT = 16;
  const padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const n = Math.max(1, data.length);
  const gap = 14;
  const barW = Math.max(6, (plotW - gap * (n - 1)) / n);
  const yFor = (v: number) => padT + plotH - (v / maxValue) * plotH;

  return (
    <div style={styles.wrap}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" style={{ display: "block" }}>
        <line x1={padL} y1={padT + plotH} x2={width - padR} y2={padT + plotH} stroke="var(--border)" strokeWidth={1} />
        {data.map((d, i) => {
          const x = padL + i * (barW + gap);
          const y = yFor(d.value);
          const h = padT + plotH - y;
          const color = d.color || "var(--brand)";
          return (
            <g key={d.label}>
              <rect x={x} y={y} width={barW} height={h} rx={4} fill={color}>
                <title>{`${d.label}: ${d.value}`}</title>
              </rect>
              <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--text)">
                {d.value}
              </text>
              <text x={x + barW / 2} y={height - 12} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {!hasData && <div style={styles.empty}>Sin datos.</div>}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: { width: "100%", position: "relative" },
  hRows: { display: "flex", flexDirection: "column", gap: 10 },
  hRow: { display: "grid", gridTemplateColumns: "130px 1fr 40px", alignItems: "center", gap: 10 },
  hLabel: { fontSize: 13, color: "var(--text)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  hTrack: { height: 14, background: "var(--surface-hover)", borderRadius: 999, overflow: "hidden" },
  hFill: { height: "100%", borderRadius: 999, transition: "width 0.3s ease", minWidth: 2 },
  hValue: { fontSize: 13, color: "var(--text-muted)", fontWeight: 700, textAlign: "right" },
  empty: { fontSize: 13, color: "var(--text-muted)", textAlign: "center", marginTop: 8 },
};
