import { useEffect, useRef, useState } from "react";
import { shortDate } from "../lib/format";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

export interface Series {
  key: string;
  label: string;
  color: string; // CSS var
  values: number[];
}

interface Props {
  title: string;
  dates: string[];
  series: Series[];
  kind: "bar" | "line";
  fmt: (n: number) => string;
}

const H = 200;
const PAD = { l: 52, r: 12, t: 12, b: 26 };

export function DailyChart({ title, dates, series, kind, fmt }: Props) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = dates.length;
  const iw = w - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const step = n > 0 ? iw / n : iw;
  const x = (i: number) => PAD.l + step * i + step / 2;
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const labelEvery = Math.max(1, Math.ceil(n / Math.floor(iw / 48)));
  const barW = Math.max(2, Math.min(28, step - 2));

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left - PAD.l) / step);
    setHover(i >= 0 && i < n ? i : null);
  };

  return (
    <figure className="chart" ref={ref}>
      <figcaption>
        <span className="chart-title">{title}</span>
        {series.length > 1 && (
          <span className="legend">
            {series.map((s) => (
              <span key={s.key} className="legend-item">
                <i style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </span>
        )}
      </figcaption>
      <svg width={w} height={H} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={title}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} className={t === 0 ? "axis" : "grid"} />
            <text x={PAD.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tick">
              {fmt(t)}
            </text>
          </g>
        ))}
        {dates.map((d, i) =>
          i % labelEvery === 0 ? (
            <text key={d} x={x(i)} y={H - 8} textAnchor="middle" className="tick">
              {shortDate(d)}
            </text>
          ) : null,
        )}
        {hover != null && kind === "line" && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} className="crosshair" />}
        {kind === "bar" &&
          series[0].values.map((v, i) => {
            const top = y(v);
            const h = PAD.t + ih - top;
            if (h <= 0) return null;
            const r = Math.min(4, barW / 2, h);
            const x0 = x(i) - barW / 2;
            return (
              <path
                key={i}
                d={`M${x0},${PAD.t + ih}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + barW - r}Q${x0 + barW},${top} ${x0 + barW},${top + r}V${PAD.t + ih}Z`}
                fill={series[0].color}
                opacity={hover == null || hover === i ? 1 : 0.55}
              />
            );
          })}
        {kind === "line" &&
          series.map((s) => (
            <g key={s.key}>
              <polyline fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
              {hover != null && <circle cx={x(hover)} cy={y(s.values[hover])} r={4.5} fill={s.color} className="dot" />}
            </g>
          ))}
      </svg>
      {hover != null && (
        <div className="tooltip" style={{ left: Math.min(Math.max(x(hover), 90), w - 90) }}>
          <strong>{shortDate(dates[hover])}</strong>
          {series.map((s) => (
            <div key={s.key} className="tt-row">
              <i style={{ background: s.color }} />
              <span>{s.label}</span>
              <b>{fmt(s.values[hover])}</b>
            </div>
          ))}
        </div>
      )}
    </figure>
  );
}
