/**
 * Minimal, dependency-free SVG charts following the project's data-viz rules:
 *  - series colours from CSS tokens (--series-1, --series-2; validated for CVD in light and dark),
 *  - thin marks (bars <= 24px with a 4px rounded data end, 2px lines, 10% area wash),
 *  - text in text tokens (never the series colour), recessive hairline grid, one y-axis,
 *  - hover/focus tooltip on every chart; values are also available in the adjacent tables.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/** Width of the chart container in CSS pixels, so SVG text renders at its true size. */
function useWidth(fallback: number): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export const SERIES = ["var(--series-1)", "var(--series-2)"] as const;

/** 1,284 / 12.9K / 4.2M / 1.1B */
export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${trim(n / 1e9)}B`;
  if (abs >= 1e6) return `${trim(n / 1e6)}M`;
  if (abs >= 1e3) return `${trim(n / 1e3)}K`;
  return trim(n);
}

const trim = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2)).replace(/\.0+$|(\.\d*?)0+$/, "$1");

/** Clean axis ticks ("nice numbers") from 0 to >= max. */
export function niceTicks(max: number, count = 4): number[] {
  return niceRange(0, max, count);
}

/** Clean ticks covering [min, max]; always includes 0 when the range spans it. */
export function niceRange(min: number, max: number, count = 4): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  if (!(hi - lo > 0)) return [0, 1];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.999; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

// ------------------------------------------------------------------ horizontal bars

export interface BarDatum {
  label: string;
  value: number;
}

/** Single-series horizontal bar chart (no legend: the heading names the series). */
export function BarChartH({ data, format, ariaLabel }: { data: BarDatum[]; format: (v: number) => string; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useWidth(480);
  const labelWidth = 96;
  const valueWidth = 64;
  const band = 30;
  const bar = 20;
  const plot = width - labelWidth - valueWidth;
  const max = Math.max(0, ...data.map((d) => d.value));
  const scale = (v: number) => (max > 0 ? (v / max) * plot : 0);

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={data.length * band + 4} viewBox={`0 0 ${width} ${data.length * band + 4}`} role="img" aria-label={ariaLabel} className="chart-svg">
        {data.map((d, i) => {
          const y = i * band + (band - bar) / 2;
          const w = Math.max(scale(d.value), d.value > 0 ? 2 : 0);
          return (
            <g
              key={d.label}
              tabIndex={0}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              className="chart-hit"
            >
              <rect x={0} y={i * band} width={width} height={band} fill="transparent" />
              <text x={labelWidth - 8} y={y + bar / 2} className="chart-label" textAnchor="end" dominantBaseline="central">
                {d.label}
              </text>
              <path d={barPath(labelWidth, y, w, bar)} fill={SERIES[0]} opacity={hover === null || hover === i ? 1 : 0.55} />
              <text x={labelWidth + w + 6} y={y + bar / 2} className="chart-value" dominantBaseline="central">
                {format(d.value)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Bar from the baseline with a 4px rounded data end, square at the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h / 2);
  if (w <= 0) return "";
  return `M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x} Z`;
}

// ------------------------------------------------------------------ lines

export interface LineSeries {
  name: string;
  points: Array<{ x: number; y: number }>;
}

interface LineChartProps {
  series: LineSeries[];
  formatX: (x: number) => string;
  formatY: (y: number) => string;
  ariaLabel: string;
  /** Draws a 10% wash under the first series. */
  area?: boolean;
  /** Optional vertical marker (e.g. the 4D playback date). */
  marker?: number | null;
  height?: number;
}

/** Line chart with a crosshair tooltip that lists every series at the nearest x. */
export function LineChart({ series, formatX, formatY, ariaLabel, area, marker, height = 240 }: LineChartProps) {
  const id = useId();
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [ref, width] = useWidth(640);
  const pad = { left: 56, right: 16, top: 12, bottom: 28 };
  const all = series.flatMap((s) => s.points);
  const xs = useMemo(() => [...new Set(all.map((p) => p.x))].sort((a, b) => a - b), [all]);
  const minX = xs[0] ?? 0;
  const maxX = xs[xs.length - 1] ?? 1;
  const ticks = niceRange(Math.min(0, ...all.map((p) => p.y)), Math.max(0, ...all.map((p) => p.y)));
  const minY = ticks[0] ?? 0;
  const maxY = ticks[ticks.length - 1] ?? 1;
  const sx = (x: number) => pad.left + ((x - minX) / Math.max(1e-9, maxX - minX)) * (width - pad.left - pad.right);
  const sy = (y: number) => pad.top + (1 - (y - minY) / Math.max(1e-12, maxY - minY)) * (height - pad.top - pad.bottom);

  const nearest = (px: number) => xs.reduce((best, x) => (Math.abs(sx(x) - px) < Math.abs(sx(best) - px) ? x : best), xs[0] ?? 0);
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    setHoverX(nearest(((e.clientX - box.left) / box.width) * width));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!xs.length) return;
    const i = hoverX === null ? 0 : xs.indexOf(hoverX);
    if (e.key === "ArrowRight") setHoverX(xs[Math.min(xs.length - 1, i + 1)] ?? null);
    if (e.key === "ArrowLeft") setHoverX(xs[Math.max(0, i - 1)] ?? null);
  };
  const valueAt = (s: LineSeries, x: number) => {
    // Step-wise: last point at or before x.
    let v: number | null = null;
    for (const p of s.points) if (p.x <= x) v = p.y;
    return v;
  };
  const xTicks = xs.length > 1 ? [minX, minX + (maxX - minX) / 3, minX + (2 * (maxX - minX)) / 3, maxX] : xs;

  return (
    <div className="chart" ref={ref}>
      {series.length > 1 && (
        <div className="chart-legend">
          {series.map((s, i) => (
            <span key={s.name} className="legend-item">
              <span className="line-key" style={{ background: SERIES[i % SERIES.length] }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} className="chart-svg" tabIndex={0} onKeyDown={onKey} onBlur={() => setHoverX(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={sy(t)} y2={sy(t)} className="chart-grid" />
            <text x={pad.left - 6} y={sy(t)} className="chart-axis" textAnchor="end" dominantBaseline="central">
              {formatY(t)}
            </text>
          </g>
        ))}
        {xTicks.map((x, i) => (
          <text key={i} x={sx(x)} y={height - 8} className="chart-axis" textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}>
            {formatX(x)}
          </text>
        ))}
        {area && series[0] && series[0].points.length > 1 && (
          <path
            d={`M${sx(series[0].points[0]!.x)},${sy(0)} ${series[0].points.map((p) => `L${sx(p.x)},${sy(p.y)}`).join(" ")} L${sx(series[0].points[series[0].points.length - 1]!.x)},${sy(0)} Z`}
            fill={SERIES[0]}
            opacity={0.1}
          />
        )}
        {series.map((s, i) => (
          <path
            key={s.name}
            d={s.points.map((p, j) => `${j ? "L" : "M"}${sx(p.x)},${sy(p.y)}`).join(" ")}
            fill="none"
            stroke={SERIES[i % SERIES.length]}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {marker !== null && marker !== undefined && marker >= minX && marker <= maxX && (
          <line x1={sx(marker)} x2={sx(marker)} y1={pad.top} y2={height - pad.bottom} className="chart-marker" />
        )}
        {hoverX !== null && (
          <g pointerEvents="none">
            <line x1={sx(hoverX)} x2={sx(hoverX)} y1={pad.top} y2={height - pad.bottom} className="chart-crosshair" />
            {series.map((s, i) => {
              const v = valueAt(s, hoverX);
              return v === null ? null : <circle key={s.name} cx={sx(hoverX)} cy={sy(v)} r={4} fill={SERIES[i % SERIES.length]} className="chart-dot" />;
            })}
          </g>
        )}
        <rect
          id={id}
          x={pad.left}
          y={pad.top}
          width={width - pad.left - pad.right}
          height={height - pad.top - pad.bottom}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHoverX(null)}
        />
      </svg>
      {hoverX !== null && (
        <div className="chart-tooltip" role="status" style={{ left: `${(sx(hoverX) / width) * 100}%` }}>
          <div className="muted small">{formatX(hoverX)}</div>
          {series.map((s, i) => {
            const v = valueAt(s, hoverX);
            return (
              <div key={s.name} className="tooltip-row">
                <span className="line-key" style={{ background: SERIES[i % SERIES.length] }} />
                <strong>{v === null ? "—" : formatY(v)}</strong>
                <span className="muted">{s.name}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Gantt

export interface GanttTask {
  id: string;
  label: string;
  /** Series index (0 or 1) for the bar colour. */
  series: number;
  start: number; // UTC ms, inclusive
  finish: number; // UTC ms, inclusive
  detail: string;
}

const DAY_MS = 86_400_000;

/** Task bars on a date axis; series names form the legend; `marker` draws the playback date. */
export function GanttChart({
  tasks,
  seriesNames,
  marker,
  formatDate,
  ariaLabel,
}: {
  tasks: GanttTask[];
  seriesNames: [string, string];
  marker: number | null;
  formatDate: (t: number) => string;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useWidth(720);
  const labelWidth = 150;
  const row = 22;
  const bar = 14;
  const top = 4;
  const axis = 22;
  const height = top + tasks.length * row + axis;
  const min = Math.min(...tasks.map((t) => t.start));
  const max = Math.max(...tasks.map((t) => t.finish)) + DAY_MS;
  const sx = (t: number) => labelWidth + ((t - min) / Math.max(DAY_MS, max - min)) * (width - labelWidth - 8);
  const ticks = [0, 1, 2, 3, 4].map((i) => min + ((max - min) * i) / 4);
  const hovered = hover === null ? null : tasks[hover];

  return (
    <div className="chart" ref={ref}>
      <div className="chart-legend">
        {seriesNames.map((n, i) => (
          <span key={n} className="legend-item">
            <span className="swatch area" style={{ background: SERIES[i] }} />
            {n}
          </span>
        ))}
      </div>
      <div className="chart-plot">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} className="chart-svg">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={sx(t)} x2={sx(t)} y1={top} y2={height - axis} className="chart-grid" />
            <text x={sx(t)} y={height - 6} className="chart-axis" textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"}>
              {formatDate(t)}
            </text>
          </g>
        ))}
        {tasks.map((t, i) => {
          const y = top + i * row;
          const x = sx(t.start);
          const w = Math.max(3, sx(t.finish + DAY_MS) - x);
          return (
            <g
              key={t.id}
              tabIndex={0}
              className="chart-hit"
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              <rect x={0} y={y} width={width} height={row} fill="transparent" />
              <text x={labelWidth - 8} y={y + row / 2} className="chart-label" textAnchor="end" dominantBaseline="central">
                {t.label}
              </text>
              <rect x={x} y={y + (row - bar) / 2} width={w} height={bar} rx={3} fill={SERIES[t.series % SERIES.length]} opacity={hover === null || hover === i ? 1 : 0.55} />
            </g>
          );
        })}
        {marker !== null && marker >= min && marker <= max && <line x1={sx(marker)} x2={sx(marker)} y1={top} y2={height - axis} className="chart-marker" />}
      </svg>
      {hovered && (
        <div
          className="chart-tooltip"
          role="status"
          style={{ left: Math.min(Math.max(sx(hovered.start), 160), width - 160), top: top + ((hover ?? 0) + 1) * row + 2 }}
        >
          <strong>{hovered.label}</strong>
          <div className="muted small">{hovered.detail}</div>
        </div>
      )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ drift profile

export interface ProfileRow {
  label: string;
  values: Array<number | null>;
}

/**
 * Vertical profile (e.g. story drift): rows bottom-to-top on the y axis, value on the x axis, one 2px line
 * with >= 8px markers per series, an optional limit line, and a per-row hover tooltip listing every series.
 */
export function ProfileChart({
  rows,
  seriesNames,
  format,
  limit,
  ariaLabel,
}: {
  rows: ProfileRow[];
  seriesNames: string[];
  format: (v: number) => string;
  limit?: { value: number; label: string } | null;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useWidth(520);
  const pad = { left: 80, right: 16, top: 8, bottom: 26 };
  const band = 32;
  const height = pad.top + rows.length * band + pad.bottom;
  const max = Math.max(limit?.value ?? 0, ...rows.flatMap((r) => r.values.filter((v): v is number => v !== null)));
  const ticks = niceTicks(max * 1.05);
  const top = ticks[ticks.length - 1] ?? 1;
  const sx = (v: number) => pad.left + (v / top) * (width - pad.left - pad.right);
  // Bottom story at the bottom.
  const sy = (i: number) => pad.top + (rows.length - 1 - i) * band + band / 2;

  return (
    <div className="chart" ref={ref}>
      {seriesNames.length > 1 && (
        <div className="chart-legend">
          {seriesNames.map((n, i) => (
            <span key={n} className="legend-item">
              <span className="line-key" style={{ background: SERIES[i % SERIES.length] }} />
              {n}
            </span>
          ))}
          {limit && (
            <span className="legend-item">
              <span className="line-key" style={{ background: "var(--text)" }} />
              {limit.label}
            </span>
          )}
        </div>
      )}
      <div className="chart-plot">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} className="chart-svg">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={sx(t)} x2={sx(t)} y1={pad.top} y2={height - pad.bottom} className="chart-grid" />
              <text x={sx(t)} y={height - 8} className="chart-axis" textAnchor="middle">
                {format(t)}
              </text>
            </g>
          ))}
          {limit && <line x1={sx(limit.value)} x2={sx(limit.value)} y1={pad.top} y2={height - pad.bottom} className="chart-marker" />}
          {seriesNames.map((name, s) => {
            const pts = rows.map((r, i) => (r.values[s] === null || r.values[s] === undefined ? null : { x: sx(r.values[s]!), y: sy(i) }));
            const d = pts.reduce((acc, p) => (p ? `${acc}${acc ? " L" : "M"}${p.x},${p.y}` : acc), "");
            return (
              <g key={name}>
                <path d={d} fill="none" stroke={SERIES[s % SERIES.length]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {pts.map((p, i) => p && <circle key={i} cx={p.x} cy={p.y} r={4} fill={SERIES[s % SERIES.length]} className="chart-dot" />)}
              </g>
            );
          })}
          {rows.map((r, i) => (
            <g
              key={r.label}
              tabIndex={0}
              className="chart-hit"
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              <rect x={0} y={sy(i) - band / 2} width={width} height={band} fill={hover === i ? "var(--chart-grid)" : "transparent"} opacity={0.35} />
              <text x={pad.left - 8} y={sy(i)} className="chart-label" textAnchor="end" dominantBaseline="central">
                {r.label}
              </text>
            </g>
          ))}
        </svg>
        {hover !== null && rows[hover] && (
          <div className="chart-tooltip" role="status" style={{ left: Math.min(Math.max(sx(Math.max(0, ...rows[hover]!.values.map((v) => v ?? 0))), 120), width - 120), top: sy(hover) + 14 }}>
            <div className="muted small">{rows[hover]!.label}</div>
            {seriesNames.map((n, s) => (
              <div key={n} className="tooltip-row">
                <span className="line-key" style={{ background: SERIES[s % SERIES.length] }} />
                <strong>{rows[hover]!.values[s] === null ? "—" : format(rows[hover]!.values[s]!)}</strong>
                <span className="muted">{n}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
