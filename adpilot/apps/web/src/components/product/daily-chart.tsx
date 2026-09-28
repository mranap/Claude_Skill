'use client';

import { format } from 'date-fns';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils/cn';

export interface DailyPoint {
  /** YYYY-MM-DD (a local date of the ad accounts, not a timestamp). */
  date: string;
  /** Chart geometry only; `display` is what the user reads. */
  value: number | null;
  display: string;
}

function parseDay(date: string): Date {
  return new Date(`${date}T00:00:00`);
}

export function formatDay(date: string, pattern = 'MMM d'): string {
  const d = parseDay(date);
  return Number.isNaN(d.getTime()) ? date : format(d, pattern);
}

/** 0 → max rounded to a 1/2/2.5/5 × 10ⁿ step. */
function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Number(v.toFixed(10)));
  if (ticks[ticks.length - 1]! < max) ticks.push(Number((ticks[ticks.length - 1]! + step).toFixed(10)));
  return ticks;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => setWidth(Math.floor(entries[0]?.contentRect.width ?? 0)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const PAD = { top: 12, right: 8, bottom: 26, left: 52 };

/**
 * Single-series daily column chart (SVG). Hover or tap shows the exact value; the axis uses compact labels.
 * The parent keeps the chart mounted while refetching so the frame does not jump.
 */
export function DailyChart({
  points,
  axisLabel,
  height = 220,
  ariaLabel,
  emptyText = 'No data in this period',
  className,
}: {
  points: DailyPoint[];
  /** Compact axis label for a value (e.g. "$1.2K"). */
  axisLabel: (value: number) => string;
  height?: number;
  ariaLabel: string;
  emptyText?: string;
  className?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(0, ...points.map((p) => p.value ?? 0));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const slot = points.length ? innerW / points.length : 0;
  const barW = Math.max(2, Math.min(40, slot * 0.64));
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(innerW / 56))));
  const empty = points.every((p) => !p.value);
  const activePoint = active !== null ? points[active] : null;

  const pick = (clientX: number, rect: DOMRect) => {
    if (!slot) return;
    const index = Math.floor((clientX - rect.left - PAD.left) / slot);
    setActive(index >= 0 && index < points.length ? index : null);
  };

  return (
    <div ref={ref} className={cn('relative w-full select-none', className)} style={{ height }}>
      {width > 0 ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          className="block touch-pan-y"
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className="stroke-border" strokeDasharray={t === 0 ? undefined : '3 3'} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                {axisLabel(t)}
              </text>
            </g>
          ))}
          {points.map((p, i) => {
            const x = PAD.left + i * slot + (slot - barW) / 2;
            const v = p.value ?? 0;
            const h = Math.max(v > 0 ? 1.5 : 0, (v / top) * innerH);
            return (
              <g key={p.date}>
                {active === i ? <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={innerH} className="fill-muted/70" /> : null}
                <rect
                  x={x}
                  y={PAD.top + innerH - h}
                  width={barW}
                  height={h}
                  rx={Math.min(3, barW / 3)}
                  style={{ fill: 'var(--viz-series-1)' }}
                  opacity={active === null || active === i ? 1 : 0.55}
                />
                {i % labelEvery === 0 ? (
                  <text x={PAD.left + i * slot + slot / 2} y={height - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                    {formatDay(p.date)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      ) : null}
      {empty && width > 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-6 pl-12 text-sm text-muted-foreground">{emptyText}</div>
      ) : null}
      {activePoint && width > 0 ? (
        <div
          role="status"
          className="pointer-events-none absolute top-1 z-10 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{
            left: Math.min(Math.max(PAD.left + (active ?? 0) * slot + slot / 2 - 60, 0), Math.max(0, width - 124)),
            width: 120,
          }}
        >
          <div className="text-muted-foreground">{formatDay(activePoint.date, 'EEE, MMM d')}</div>
          <div className="font-medium tabular-nums text-popover-foreground">{activePoint.display}</div>
        </div>
      ) : null}
    </div>
  );
}
