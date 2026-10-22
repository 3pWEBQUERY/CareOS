/**
 * Kleine, serverseitig gerenderte Diagramme für CareOS Insights (SVG, keine Bibliothek).
 * Regeln (dataviz): eine Achse, dünne Balken (≤ 24 px) mit 4 px gerundetem Ende an der Basislinie,
 * 2 px Abstand zwischen benachbarten Balken, zurückhaltendes Raster, sparsame Direktbeschriftung,
 * Legende ab zwei Reihen, Tabellenansicht für jeden Wert.
 */
import { CsvButton } from './CsvButton'

export type Tone = 'accent' | 'muted' | 'crit'
export type ColDatum = { label: string; title: string; values: number[] }

/** Runde Achsenschritte (1, 2, 5 × 10^k), höchstens fünf Linien. */
export function niceTicks(max: number, integer = false) {
  if (max <= 0) return [0, 1]
  const raw = integer ? Math.max(1, max / 4) : max / 4
  const p = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? p * 10
  const top = Math.ceil(max / step) * step
  const out: number[] = []
  for (let v = 0; v <= top + 1e-9; v += step) out.push(+v.toFixed(6))
  return out
}

const compact = (v: number) => (v >= 10_000 ? Math.round(v / 1000) + 'K' : v >= 1000 ? (v / 1000).toFixed(1).replace('.0', '') + 'K' : String(Math.round(v * 10) / 10))

function topRounded(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h)
  return `M${x.toFixed(1)},${(y + h).toFixed(1)}V${(y + r).toFixed(1)}Q${x.toFixed(1)},${y.toFixed(1)} ${(x + r).toFixed(1)},${y.toFixed(1)}H${(x + w - r).toFixed(1)}Q${(x + w).toFixed(1)},${y.toFixed(1)} ${(x + w).toFixed(1)},${(y + r).toFixed(1)}V${(y + h).toFixed(1)}Z`
}

/** Säulendiagramm, optional gruppiert (max. 2–3 Reihen) und mit Ziellinie. */
export function Columns({ data, tones, ariaLabel, width = 340, height = 132, target, fmt = compact, labelLast = true, integer = false, yUnit, xPrefix = '' }: {
  data: ColDatum[]
  tones: Tone[]
  ariaLabel: string
  width?: number
  height?: number
  target?: number | null
  fmt?: (v: number) => string
  labelLast?: boolean
  /** Ganzzahlige Achse (Zählungen). */
  integer?: boolean
  /** Einheit der y-Achse, erscheint über der Achse (z. B. «Anzahl», «Min.»). */
  yUnit?: string
  /** Vorsatz der x-Beschriftung, z. B. «KW». */
  xPrefix?: string
}) {
  const W = width, H = height, L = 30, R = 8, T = yUnit ? 20 : 12, B = 20
  const k = tones.length
  const max = Math.max(1, ...data.flatMap((d) => d.values), target ?? 0)
  const ticks = niceTicks(max, integer)
  const top = ticks[ticks.length - 1]
  const plotW = W - L - R
  const plotH = H - T - B
  const y = (v: number) => T + plotH * (1 - v / top)
  const n = Math.max(1, data.length)
  const band = plotW / n
  const gap = 2
  const barW = Math.max(2, Math.min(24, (band * 0.74 - gap * (k - 1)) / k))
  const groupW = barW * k + gap * (k - 1)
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 34))))
  // Direktbeschriftung: letzter Wert und Maximum der ersten Reihe
  const first = data.map((d) => d.values[0] ?? 0)
  const maxIdx = first.indexOf(Math.max(...first))
  const labelled = new Set(labelLast ? [n - 1, maxIdx] : [maxIdx])
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
      {yUnit && <text className="ax ins-unit" x={0} y={8}>{yUnit}</text>}
      {ticks.map((v) => (
        <g key={v}>
          <line className="grid" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
          <text className="ax" x={L - 5} y={y(v) + 3.5} textAnchor="end">{fmt(v)}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const x0 = L + i * band + (band - groupW) / 2
        return (
          <g key={i} className="ins-col">
            <title>{d.title}</title>
            <rect className="ins-hit" x={L + i * band} y={T} width={band} height={plotH} />
            {d.values.map((v, j) => {
              const h = Math.max(0, y(0) - y(v))
              return h > 0 ? <path key={j} className={'barfill' + (tones[j] === 'accent' ? '' : ' ' + tones[j])} d={topRounded(x0 + j * (barW + gap), y(v), barW, h)} /> : null
            })}
            {labelled.has(i) && first[i] > 0 && (
              <text className="barval" x={x0 + barW / 2} y={y(first[i]) - 3} textAnchor="middle">{fmt(first[i])}</text>
            )}
            {i % every === (n - 1) % every && <text className="ax" x={L + i * band + band / 2} y={H - 6} textAnchor="middle">{xPrefix}{d.label}</text>}
          </g>
        )
      })}
      {target != null && target > 0 && <line className="target" x1={L} x2={W - R} y1={y(target)} y2={y(target)} />}
      <line className="ins-base" x1={L} x2={W - R} y1={y(0)} y2={y(0)} />
    </svg>
  )
}

/** Diagramm-Karte: Titel, Kennwert, Legende, Diagramm und Tabellenansicht mit CSV-Export. */
export function ChartCard({ title, sub, current, legend, children, table, csvName, labels, wide }: {
  title: string
  sub?: string
  current?: React.ReactNode
  legend?: { label: string; kind: 'bar' | 'bar muted' | 'bar crit' | 'tg' }[]
  children: React.ReactNode
  table: { head: string[]; rows: (string | number)[][] }
  csvName: string
  labels: { table: string; csv: string }
  wide?: boolean
}) {
  return (
    <figure className={'chart ins-card' + (wide ? ' ins-span' : '')}>
      <figcaption className="chart-head">
        <span className="stack-sm" style={{ gap: 0 }}>
          <strong>{title}</strong>
          {sub && <span className="small muted">{sub}</span>}
        </span>
        {current != null && <span className="cur nowrap">{current}</span>}
      </figcaption>
      {children}
      {legend && legend.length > 0 && (
        <div className="legend">{legend.map((l) => <span key={l.label}><i className={l.kind} />{l.label}</span>)}</div>
      )}
      <DataTable table={table} csvName={csvName} labels={labels} />
    </figure>
  )
}

export function DataTable({ table, csvName, labels, open }: { table: { head: string[]; rows: (string | number)[][] }; csvName: string; labels: { table: string; csv: string }; open?: boolean }) {
  return (
    <details className="ins-table" open={open}>
      <summary className="linkbtn small">{labels.table}</summary>
      <div className="tablewrap" style={{ marginTop: 6 }}>
        <table className="stable">
          <thead><tr>{table.head.map((h, i) => <th key={i} className={i ? 'right' : undefined}>{h}</th>)}</tr></thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i}>{r.map((c, j) => (j ? <td key={j} className="num right">{c}</td> : <th key={j} scope="row">{c}</th>))}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 6 }}><CsvButton name={csvName} head={table.head} rows={table.rows} label={labels.csv} /></div>
    </details>
  )
}

/** Horizontale Balkenliste (Kategorien, Quoten) als HTML – gut lesbar auf schmalen Geräten. */
export function MeterList({ rows, ariaLabel, max }: {
  rows: { label: string; value: number; text: string; tone?: 'ok' | 'warn' | 'crit' | '' ; hint?: string }[]
  ariaLabel: string
  max?: number
}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="ins-meters" aria-label={ariaLabel}>
      {rows.map((r) => (
        <li key={r.label}>
          <span className="ins-ml ellipsis" title={r.label}>{r.label}</span>
          <span className="bar" aria-hidden="true"><i className={r.tone || undefined} style={{ width: `${Math.min(100, (r.value / top) * 100)}%` }} /></span>
          <span className="mono small ins-mv">{r.text}{r.hint && <span className="muted"> {r.hint}</span>}</span>
        </li>
      ))}
    </ul>
  )
}

/** Gestapelter Statusbalken (Teil vom Ganzen), Segmente mit 2 px Abstand. */
export function StatusBar({ parts, ariaLabel }: { parts: { label: string; n: number; tone: 'ok' | 'accent' | 'warn' | 'crit' | 'none' }[]; ariaLabel: string }) {
  const total = parts.reduce((s, p) => s + p.n, 0)
  return (
    <div className="ins-stack" role="img" aria-label={ariaLabel + ': ' + parts.map((p) => `${p.label} ${p.n}`).join(', ')}>
      {parts.filter((p) => p.n > 0).map((p) => (
        <i key={p.label} className={p.tone} style={{ flexGrow: p.n }} title={`${p.label}: ${p.n}`} />
      ))}
      {total === 0 && <i className="none" style={{ flexGrow: 1 }} />}
    </div>
  )
}
