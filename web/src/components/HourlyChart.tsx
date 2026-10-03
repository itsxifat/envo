import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';

export interface HourPoint {
  hour: string; // "YYYY-MM-DDTHH" in the SIP server's timezone
  answered: number;
  missed: number;
}

// Categorical slots 1 and 2 of the reference palette, validated on the white card surface.
const SERIES = [
  { key: 'answered', label: 'Answered', color: '#2a78d6' },
  { key: 'missed', label: 'Missed', color: '#eb6834' },
] as const;

const INK = { primary: '#0b0b0b', secondary: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7' };
const PLOT_H = 190;
const AXIS_H = 26;
const PAD_TOP = 22;
const PAD_LEFT = 34;

function niceMax(value: number): { max: number; step: number } {
  if (value <= 4) return { max: 4, step: 1 };
  const raw = value / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  return { max: Math.ceil(value / step) * step, step };
}

/** Column path with a 4px rounded data-end on top and a square base. */
function column(x: number, y: number, w: number, h: number, rounded: boolean): string {
  if (h <= 0) return '';
  const r = rounded ? Math.min(4, h, w / 2) : 0;
  return `M${x},${y + h}L${x},${y + r}Q${x},${y} ${x + r},${y}L${x + w - r},${y}Q${x + w},${y} ${x + w},${y + r}L${x + w},${y + h}Z`;
}

export function HourlyChart({ data }: { data: HourPoint[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [table]);

  const totals = data.map((d) => d.answered + d.missed);
  const peak = Math.max(0, ...totals);
  const peakIndex = peak > 0 ? totals.indexOf(peak) : -1;
  const { max, step } = niceMax(peak);
  const ticks = useMemo(() => Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step), [max, step]);

  const plotW = width - PAD_LEFT - 8;
  const band = plotW / Math.max(1, data.length);
  const colW = Math.min(24, band * 0.62);
  const y = (v: number) => PAD_TOP + PLOT_H - (v / max) * PLOT_H;
  const hourLabel = (h: string) => `${h.slice(11, 13)}:00`;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-xs" style={{ color: INK.secondary }}>
          {SERIES.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-[3px]" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
        <button type="button" onClick={() => setTable(!table)} className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline">
          {table ? 'View as chart' : 'View as table'}
        </button>
      </div>

      {table ? (
        <div className="max-h-[260px] overflow-y-auto rounded-lg border border-slate-100">
          <table className="table-base">
            <thead>
              <tr>
                <th>Hour</th>
                <th className="text-right">Answered</th>
                <th className="text-right">Missed</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.hour}>
                  <td className="tabular-nums">{hourLabel(d.hour)}</td>
                  <td className="text-right tabular-nums">{d.answered}</td>
                  <td className="text-right tabular-nums">{d.missed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={wrap} className="relative">
          <svg width={width} height={PAD_TOP + PLOT_H + AXIS_H} role="img" aria-label="Calls per hour over the last 24 hours">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD_LEFT} x2={width - 8} y1={y(t)} y2={y(t)} stroke={t === 0 ? INK.axis : INK.grid} strokeWidth={1} shapeRendering="crispEdges" />
                <text x={PAD_LEFT - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={INK.muted} className="tabular-nums">
                  {t.toLocaleString()}
                </text>
              </g>
            ))}
            {active !== null && (
              <rect x={PAD_LEFT + active * band} y={PAD_TOP} width={band} height={PLOT_H} fill="#0b1220" opacity={0.045} rx={4} />
            )}
            {data.map((d, i) => {
              const x = PAD_LEFT + i * band + (band - colW) / 2;
              const aTop = y(d.answered);
              const aH = PAD_TOP + PLOT_H - aTop;
              const mH = (d.missed / max) * PLOT_H;
              const gap = aH > 0 && mH > 0 ? 2 : 0;
              const mTop = aTop - gap - mH;
              const dim = active !== null && active !== i;
              return (
                <g key={d.hour} opacity={dim ? 0.45 : 1} style={{ transition: 'opacity 120ms' }}>
                  <path d={column(x, aTop, colW, aH, mH === 0)} fill={SERIES[0].color} />
                  <path d={column(x, mTop, colW, mH, true)} fill={SERIES[1].color} />
                  {i === peakIndex && (
                    <text x={x + colW / 2} y={Math.min(aTop, mTop) - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill={INK.primary}>
                      {totals[i]}
                    </text>
                  )}
                  {i % 3 === 0 && (
                    <text x={x + colW / 2} y={PAD_TOP + PLOT_H + 17} textAnchor="middle" fontSize={11} fill={INK.muted} className="tabular-nums">
                      {hourLabel(d.hour)}
                    </text>
                  )}
                  <rect
                    x={PAD_LEFT + i * band}
                    y={PAD_TOP}
                    width={band}
                    height={PLOT_H}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${hourLabel(d.hour)}: ${d.answered} answered, ${d.missed} missed`}
                    onPointerEnter={() => setActive(i)}
                    onPointerLeave={() => setActive(null)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    className="outline-none"
                  />
                </g>
              );
            })}
          </svg>
          {active !== null && data[active] && (
            <div
              className={clsx('pointer-events-none absolute z-10 min-w-32 rounded-lg bg-white px-3 py-2 text-xs shadow-lg ring-1 ring-slate-200')}
              style={{
                left: Math.min(Math.max(PAD_LEFT + active * band + band / 2 - 64, 0), width - 136),
                top: 0,
              }}
            >
              <div className="mb-1 font-medium" style={{ color: INK.secondary }}>
                {hourLabel(data[active].hour)} – {String((Number(data[active].hour.slice(11, 13)) + 1) % 24).padStart(2, '0')}:00
              </div>
              {SERIES.map((s) => (
                <div key={s.key} className="flex items-center gap-2 py-0.5">
                  <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: s.color }} />
                  <span className="font-semibold tabular-nums" style={{ color: INK.primary }}>
                    {data[active]![s.key]}
                  </span>
                  <span style={{ color: INK.secondary }}>{s.label.toLowerCase()}</span>
                </div>
              ))}
              {totals[active]! > 0 && (
                <div className="mt-1 border-t pt-1 tabular-nums" style={{ borderColor: INK.grid, color: INK.secondary }}>
                  {totals[active]} call{totals[active] === 1 ? '' : 's'} total
                </div>
              )}
            </div>
          )}
          {peak === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="rounded-lg bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-500">No calls in the last 24 hours</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
