/**
 * Verlaufsdiagramm im Stil des Stationsarbeitsplatzes: Referenzband, Linie, auffällige Punkte rot.
 * Rein serverseitig renderbar (SVG), keine Bibliothek.
 */
export type Point = { label: string; title: string; v: number | null; v2?: number | null }

export function LineChart({ title, unit, points, lo, hi, lo2, dec = 0, current, alarm, legend, ariaLabel, formatValue }: {
  title: string
  unit: string
  points: Point[]
  lo: number
  hi: number
  lo2?: number
  dec?: number
  current: string
  alarm?: boolean
  legend: { primary?: string; secondary?: string; band: string }
  ariaLabel: string
  formatValue?: (v: number) => string
}) {
  const W = 340, H = 128, L = 36, Rr = 10, T = 10, B = 22
  const has2 = points.some((p) => p.v2 != null)
  const vals = points.flatMap((p) => [p.v, p.v2]).filter((v): v is number => v != null)
  const bandLo = has2 && lo2 != null ? lo2 : lo
  let mn = Math.min(...vals, bandLo)
  let mx = Math.max(...vals, hi)
  const pad = (mx - mn) * 0.12 || 1
  mn -= pad
  mx += pad
  const x = (i: number) => L + (W - L - Rr) * (points.length === 1 ? 0.5 : i / (points.length - 1))
  const y = (v: number) => T + (H - T - B) * (1 - (v - mn) / (mx - mn))
  const fmt = formatValue ?? ((v: number) => v.toFixed(dec))
  const line = (k: 'v' | 'v2', cls: string) => {
    const d = points.map((p, i) => (p[k] == null ? null : `${x(i).toFixed(1)},${y(p[k] as number).toFixed(1)}`)).filter(Boolean)
    return d.length ? <polyline className={cls} points={d.join(' ')} /> : null
  }
  const out = (v: number, isSecond: boolean) => v > hi || v < (isSecond && lo2 != null ? lo2 : lo)
  const ticks = has2 && lo2 != null ? [hi, lo, lo2] : [hi, lo]
  return (
    <div className="chart">
      <div className="chart-head">
        <strong>{title}</strong>
        <span className={'cur' + (alarm ? ' alarm' : '')}>{current} <span className="small muted">{unit}</span></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
        <rect className="band" x={L} y={y(hi)} width={W - L - Rr} height={Math.max(0, y(bandLo) - y(hi))} />
        {ticks.map((v) => (
          <g key={v}>
            <line className="grid" x1={L} x2={W - Rr} y1={y(v)} y2={y(v)} />
            <text className="ax" x={L - 5} y={y(v) + 3.5} textAnchor="end">{fmt(v)}</text>
          </g>
        ))}
        {points.map((p, i) => <text key={i} className="ax" x={x(i)} y={H - 6} textAnchor="middle">{p.label}</text>)}
        {has2 && line('v2', 's2')}
        {line('v', 's1')}
        {has2 && points.map((p, i) => p.v2 == null ? null : (
          <circle key={'b' + i} className={out(p.v2, true) ? 'pa' : 'p2'} cx={x(i).toFixed(1)} cy={y(p.v2).toFixed(1)} r={i === points.length - 1 ? 4 : 2.8}><title>{p.title}</title></circle>
        ))}
        {points.map((p, i) => p.v == null ? null : (
          <circle key={'a' + i} className={out(p.v, false) ? 'pa' : i === points.length - 1 ? 'pend' : 'p1'} cx={x(i).toFixed(1)} cy={y(p.v).toFixed(1)} r={i === points.length - 1 ? 4 : 2.8}><title>{p.title}</title></circle>
        ))}
      </svg>
      <div className="legend">
        {legend.primary && <span><i />{legend.primary}</span>}
        {legend.secondary && <span><i className="d" />{legend.secondary}</span>}
        <span><i className="b" />{legend.band}</span>
      </div>
    </div>
  )
}
