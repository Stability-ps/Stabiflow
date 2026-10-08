// Single-series daily column chart. One series -> no legend (the title names
// it). Thin columns with a 4px rounded top, square baseline, 2px gap, hairline
// grid, per-column hover/focus tooltip, and a table view for screen readers
// and exact values. Colour: --admin-chart (validated #2a7de1 light /
// #3b8ae6 dark against the card surface).
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type ColumnPoint = { date: string; value: number };

function niceMax(v: number) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function shortDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

export function ColumnChart({ title, points, format = (v) => v.toLocaleString("en-US"), height = 160, className }: {
  title: string; points: ColumnPoint[]; format?: (v: number) => string; height?: number; className?: string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the real pixel width so text and marks keep their specified sizes.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(Math.round(e.contentRect.width), 200)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const max = useMemo(() => niceMax(Math.max(0, ...points.map((p) => p.value))), [points]);
  const total = points.reduce((a, p) => a + p.value, 0);
  const n = Math.max(points.length, 1);
  const H = height;
  const padTop = 8, padBottom = 20, padLeft = 36;
  const plotW = W - padLeft;
  const plotH = H - padTop - padBottom;
  const slot = plotW / n;
  const barW = Math.max(Math.min(slot - 2, 24), 1);
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(n / Math.max(Math.floor(plotW / 70), 2));
  const active = hover !== null ? points[hover] : null;

  return (
    <figure className={cn("relative", className)} aria-labelledby={`${id}-t`}>
      <figcaption id={`${id}-t`} className="sr-only">{title}, total {format(total)}</figcaption>
      <div ref={box} className="w-full">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block max-w-full overflow-visible" role="img" aria-hidden="true" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => {
          const y = padTop + plotH - (t / max) * plotH;
          return (
            <g key={t}>
              <line x1={padLeft} x2={W} y1={y} y2={y} className="stroke-border" strokeWidth={1} />
              <text x={padLeft - 6} y={y + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">{format(Math.round(t))}</text>
            </g>
          );
        })}
        {points.map((p, i) => {
          const h = (p.value / max) * plotH;
          const x = padLeft + i * slot + (slot - barW) / 2;
          const y = padTop + plotH - h;
          const r = Math.min(4, barW / 2, h);
          return (
            <g key={p.date}>
              {h > 0 ? (
                <path
                  d={`M${x},${padTop + plotH} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${padTop + plotH} Z`}
                  className={cn("fill-[hsl(var(--admin-chart))] transition-opacity", hover !== null && hover !== i && "opacity-40")}
                />
              ) : null}
              {i % labelEvery === 0 ? (
                <text x={padLeft + i * slot + slot / 2} y={H - 4} textAnchor="middle" className="fill-muted-foreground text-[10px]">{shortDate(p.date)}</text>
              ) : null}
              {/* Hit target: the whole slot, taller than the mark. */}
              <rect x={padLeft + i * slot} y={padTop} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      </div>
      {active ? (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-xs shadow-sm"
          style={{ left: `${((padLeft + (hover! + 0.5) * slot) / W) * 100}%` }}
        >
          <div className="text-muted-foreground">{shortDate(active.date)}</div>
          <div className="font-medium tabular-nums">{format(active.value)}</div>
        </div>
      ) : null}
      <details className="mt-1 text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Show as table</summary>
        <div className="mt-2 max-h-48 overflow-auto">
          <table className="w-full">
            <thead><tr><th scope="col" className="text-left font-medium">Date</th><th scope="col" className="text-right font-medium">{title}</th></tr></thead>
            <tbody>{points.map((p) => <tr key={p.date}><td>{p.date}</td><td className="text-right tabular-nums">{format(p.value)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
