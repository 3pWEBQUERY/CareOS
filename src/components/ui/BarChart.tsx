/**
 * Balkendiagramm im Stil des Stationsarbeitsplatzes (z. B. Trinkmenge pro Tag gegen Trinkziel).
 * Rein serverseitig renderbar (SVG). Werte stehen zusätzlich als Zahl über den Balken (Status nie nur über Farbe).
 */
export type Bar = { label: string; title: string; v: number | null; tone?: '' | 'muted' | 'crit' }

export function BarChart({ title, unit, bars, target, current, alarm, legend, ariaLabel, formatValue }: {
  title: string
  unit: string
  bars: Bar[]
  target?: number | null
  current: string
  alarm?: boolean
  legend: { bar: string; crit?: string; muted?: string; target?: string }
  ariaLabel: string
  formatValue?: (v: number) => string
}) {
  const W = 340, H = 140, L = 36, Rr = 10, T = 14, B = 22
  const vals = bars.map((b) => b.v ?? 0)
  const mx = Math.max(...vals, target ?? 0, 1) * 1.12
  const y = (v: number) => T + (H - T - B) * (1 - v / mx)
  const slot = (W - L - Rr) / Math.max(bars.length, 1)
  const bw = Math.min(28, slot * 0.6)
  const fmt = formatValue ?? ((v: number) => String(Math.round(v)))
  const ticks = target ? [0, target] : [0, Math.round(mx / 1.12)]
  return (
    <div className="chart">
      <div className="chart-head">
        <strong>{title}</strong>
        <span className={'cur' + (alarm ? ' alarm' : '')}>{current} <span className="small muted">{unit}</span></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
        {ticks.map((v, i) => (
          <g key={i}>
            <line className="grid" x1={L} x2={W - Rr} y1={y(v)} y2={y(v)} />
            <text className="ax" x={L - 5} y={y(v) + 3.5} textAnchor="end">{fmt(v)}</text>
          </g>
        ))}
        {bars.map((b, i) => {
          const cx = L + slot * i + slot / 2
          const v = b.v ?? 0
          return (
            <g key={i}>
              <rect className={'barfill' + (b.tone ? ' ' + b.tone : '')} x={(cx - bw / 2).toFixed(1)} y={y(v).toFixed(1)} width={bw.toFixed(1)} height={Math.max(0, y(0) - y(v)).toFixed(1)} rx="1.5">
                <title>{b.title}</title>
              </rect>
              {b.v != null && <text className={'barval' + (b.tone === 'crit' ? ' crit' : '')} x={cx.toFixed(1)} y={(y(v) - 3).toFixed(1)} textAnchor="middle">{fmt(v)}</text>}
              <text className="ax" x={cx.toFixed(1)} y={H - 6} textAnchor="middle">{b.label}</text>
            </g>
          )
        })}
        {target ? <line className="target" x1={L} x2={W - Rr} y1={y(target)} y2={y(target)} /> : null}
      </svg>
      <div className="legend">
        <span><i className="bar" />{legend.bar}</span>
        {legend.crit && <span><i className="bar crit" />{legend.crit}</span>}
        {legend.muted && <span><i className="bar muted" />{legend.muted}</span>}
        {target && legend.target ? <span><i className="tg" />{legend.target}</span> : null}
      </div>
    </div>
  )
}
