/**
 * Inline SVG charts.
 *
 * Hand-rolled rather than pulled from a charting library: the same component
 * has to render in the artifact, in the PDF, and inside the standalone JSX
 * file the build emits, and a self-contained SVG is the only version of that
 * which survives all three. Deterministic — the path strings are a pure
 * function of the data.
 */

interface ClimbPoint {
  mile: number;
  elevation_ft: number | null;
  temp_f: number | null;
  precip_pct: number | null;
}

const W = 390;
const H = 150;
const PAD_L = 34;
const PAD_R = 30;
const PAD_T = 10;
const PAD_B = 22;

function round(n: number): number {
  // Two decimals keeps the path string stable across platforms.
  return Math.round(n * 100) / 100;
}

function scale(value: number, min: number, max: number, lo: number, hi: number): number {
  if (max === min) return (lo + hi) / 2;
  return lo + ((value - min) / (max - min)) * (hi - lo);
}

function pathFrom(points: Array<[number, number]>): string {
  return points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${round(x)} ${round(y)}`)
    .join(" ");
}

/**
 * Elevation profile with the along-route temperature overlaid. Both series
 * come from the same trip-mcp pull the prose is written from, so the chart
 * cannot disagree with the text next to it.
 */
export function ClimbChart({ series }: { series: ClimbPoint[] }) {
  const elevationPoints = series.filter(
    (p): p is ClimbPoint & { elevation_ft: number } => p.elevation_ft != null,
  );
  if (elevationPoints.length < 2) return null;

  const miles = elevationPoints.map((p) => p.mile);
  const elevations = elevationPoints.map((p) => p.elevation_ft);
  const minMile = Math.min(...miles);
  const maxMile = Math.max(...miles);
  const minElev = Math.min(...elevations);
  const maxElev = Math.max(...elevations);

  const x = (mile: number) => scale(mile, minMile, maxMile, PAD_L, W - PAD_R);
  const yElev = (ft: number) => scale(ft, minElev, maxElev, H - PAD_B, PAD_T);

  const elevPath = pathFrom(elevationPoints.map((p) => [x(p.mile), yElev(p.elevation_ft)]));
  const areaPath = `${elevPath} L${round(x(maxMile))} ${H - PAD_B} L${round(x(minMile))} ${H - PAD_B} Z`;

  const tempPoints = series.filter(
    (p): p is ClimbPoint & { temp_f: number } => p.temp_f != null,
  );
  const temps = tempPoints.map((p) => p.temp_f);
  const minTemp = temps.length ? Math.min(...temps) : 0;
  const maxTemp = temps.length ? Math.max(...temps) : 1;
  const yTemp = (f: number) => scale(f, minTemp, maxTemp, H - PAD_B, PAD_T);
  const tempPath = tempPoints.length >= 2
    ? pathFrom(tempPoints.map((p) => [x(p.mile), yTemp(p.temp_f)]))
    : null;

  return (
    <>
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Elevation profile with temperature along the route"
      >
        <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="#dcdfe4" />
        <path d={areaPath} fill="#1f4f7a" fillOpacity="0.10" />
        <path d={elevPath} fill="none" stroke="#1f4f7a" strokeWidth="1.8" />
        {tempPath ? (
          <path
            d={tempPath}
            fill="none"
            stroke="#b4571f"
            strokeWidth="1.4"
            strokeDasharray="3 2.5"
          />
        ) : null}

        <text x={2} y={PAD_T + 4} fontSize="9" fill="#757d87">
          {Math.round(maxElev).toLocaleString("en-US")}
        </text>
        <text x={2} y={H - PAD_B} fontSize="9" fill="#757d87">
          {Math.round(minElev).toLocaleString("en-US")}
        </text>
        <text x={PAD_L} y={H - 6} fontSize="9" fill="#757d87">
          mi {minMile.toFixed(1)}
        </text>
        <text x={W - PAD_R} y={H - 6} fontSize="9" fill="#757d87" textAnchor="end">
          mi {maxMile.toFixed(1)}
        </text>
        {temps.length ? (
          <>
            <text x={W - 2} y={PAD_T + 4} fontSize="9" fill="#b4571f" textAnchor="end">
              {Math.round(maxTemp)}°
            </text>
            <text x={W - 2} y={H - PAD_B} fontSize="9" fill="#b4571f" textAnchor="end">
              {Math.round(minTemp)}°
            </text>
          </>
        ) : null}
      </svg>
      <div className="chart-caption">
        Solid: elevation (ft). {tempPath ? "Dashed: temperature (°F) along the route." : null}
      </div>
    </>
  );
}

/**
 * Precipitation probability by day. A bar per trip day, labeled — the group
 * reads this before they read anything else.
 */
export function PrecipBars({
  days,
  limitPct,
}: {
  days: Array<{ short_weekday: string; precip_pct: number | null }>;
  limitPct?: number;
}) {
  const usable = days.filter((d) => d.precip_pct != null);
  if (!usable.length) return null;

  // Fixed 0–100% scale, not fitted to the data: the point of the options card
  // is that two candidates' bars mean the same thing side by side. That leaves
  // headroom on a dry forecast, so the plot is kept short.
  const barW = 46;
  const gap = 12;
  const chartH = 56;
  const width = usable.length * barW + (usable.length - 1) * gap;

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${Math.max(width, 100)} ${chartH + 20}`}
      role="img"
      aria-label="Precipitation probability by day"
      style={{ maxWidth: `${Math.max(width, 100)}px` }}
    >
      {limitPct != null ? (
        <line
          x1={0}
          y1={chartH - (limitPct / 100) * chartH}
          x2={width}
          y2={chartH - (limitPct / 100) * chartH}
          stroke="#d9a49c"
          strokeWidth="1"
          strokeDasharray="3 2"
        />
      ) : null}
      {usable.map((d, i) => {
        const pctValue = d.precip_pct!;
        const h = Math.max(2, (pctValue / 100) * chartH);
        const x = i * (barW + gap);
        const over = limitPct != null && pctValue > limitPct;
        return (
          <g key={d.short_weekday}>
            <rect
              x={x}
              y={chartH - h}
              width={barW}
              height={h}
              rx="2"
              fill={over ? "#c2705f" : "#1f4f7a"}
              fillOpacity={over ? 0.85 : 0.7}
            />
            <text x={x + barW / 2} y={chartH - h - 3} fontSize="9" fill="#4a5058" textAnchor="middle">
              {Math.round(pctValue)}%
            </text>
            <text x={x + barW / 2} y={chartH + 12} fontSize="9.5" fill="#757d87" textAnchor="middle">
              {d.short_weekday}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
