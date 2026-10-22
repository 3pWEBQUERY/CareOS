'use client'

import { useT } from '@/i18n/client'

/**
 * Skeleton-Bausteine für loading.tsx (PRD §31: Skeleton States statt blockierender Ladeanzeigen).
 * Platzhalter sitzen in den echten Typografie-Elementen (.lbl, h1, .sub, .val …), damit Zeilenhöhen
 * und Abstände dem fertigen Inhalt entsprechen und beim Austausch nichts springt.
 */

type Size = number | string

/** Ein Platzhalter-Balken innerhalb einer Textzeile (übernimmt deren Zeilenhöhe). */
export function Bar({ w = '60%', h = '0.8em', style }: { w?: Size; h?: Size; style?: React.CSSProperties }) {
  return <span className="skel" aria-hidden="true" style={{ display: 'inline-block', width: w, maxWidth: '100%', height: h, minHeight: 0, verticalAlign: 'middle', ...style }} />
}

/** Platzhalter-Block mit fester Höhe (Buttons, Diagramme, Karteninhalte). */
export function Block({ w = '100%', h = 34, style }: { w?: Size; h?: Size; style?: React.CSSProperties }) {
  return <div className="skel" aria-hidden="true" style={{ width: w, maxWidth: '100%', height: h, ...style }} />
}

/** Unsichtbarer Hinweis für Screenreader, dass Inhalte geladen werden. */
export function Busy() {
  const t = useT()
  return <span className="sr-only" role="status">{t('common.loading')}</span>
}

/** Kopfzeile wie .view-head: Label, Titel, Untertitel und optionale Aktionen. */
export function SkelHead({ actions = 1, sub = true, title = 240 }: { actions?: number; sub?: boolean; title?: Size }) {
  return (
    <div className="view-head" aria-hidden="true">
      <div style={{ minWidth: 0, flex: 1 }}>
        <span className="lbl" style={{ display: 'block' }}><Bar w={120} /></span>
        <h1><Bar w={title} /></h1>
        {sub && <p className="sub"><Bar w={180} /></p>}
      </div>
      {actions > 0 && (
        <div className="row">
          {Array.from({ length: actions }, (_, i) => <Block key={i} w={i === 0 ? 180 : 96} h={34} />)}
        </div>
      )}
    </div>
  )
}

/** Register (.tabs) mit n Einträgen. */
export function SkelTabs({ n = 5 }: { n?: number }) {
  return (
    <nav className="tabs" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => <span key={i} style={{ padding: '10px 12px 9px', borderBottom: '2px solid transparent' }}><Bar w={56 + ((i * 23) % 40)} /></span>)}
    </nav>
  )
}

/** Kennzahlenleiste (.metrics). */
export function SkelMetrics({ n = 4, bar }: { n?: number; bar?: boolean }) {
  return (
    <div className="metrics" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <div className="metric" key={i}>
          <span className="lbl"><Bar w={90} /></span>
          <span className="val"><Bar w={44} /></span>
          {bar && i === n - 1 && <div className="bar" />}
        </div>
      ))}
    </div>
  )
}

/** Tabelle (.tablewrap > table.stable) mit Kopfzeile. */
export function SkelTable({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  const widths = ['70%', '45%', '55%', '35%', '60%', '40%']
  return (
    <div className="tablewrap" aria-hidden="true">
      <table className="stable">
        <thead><tr>{Array.from({ length: cols }, (_, c) => <th key={c}><Bar w={c === 0 ? 90 : 60} /></th>)}</tr></thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>{Array.from({ length: cols }, (_, c) => <td key={c}><Bar w={widths[(r + c) % widths.length]} /></td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Liste (ul.list > li > .li) in einer Karte. */
export function SkelList({ n = 5, head = true, meta = true }: { n?: number; head?: boolean; meta?: boolean }) {
  return (
    <section className="card" aria-hidden="true">
      {head && <div className="card-head"><h2><Bar w={140} /></h2></div>}
      <ul className="list">
        {Array.from({ length: n }, (_, i) => (
          <li key={i}>
            <div className="li">
              <div className="grow">
                <div><Bar w={['62%', '48%', '70%', '40%', '55%'][i % 5]} /></div>
                {meta && <div className="small"><Bar w={['30%', '22%', '36%'][i % 3]} /></div>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Abschnittsüberschrift (.sec-head > h2.sec). */
export function SkelSec({ w = 160, action }: { w?: Size; action?: boolean }) {
  return (
    <div className="sec-head" aria-hidden="true">
      <h2 className="sec"><Bar w={w} /></h2>
      {action && <Block w={120} h={28} />}
    </div>
  )
}

/** Vollständige Ansicht: Panel mit Kopf und Inhalt im .tabpanel. */
export function SkelView({ children, actions, tabs, sub }: { children: React.ReactNode; actions?: number; tabs?: number; sub?: boolean }) {
  return (
    <main className="panel main" style={{ flex: 1 }} aria-busy="true">
      <Busy />
      <SkelHead actions={actions} sub={sub} />
      {tabs ? <SkelTabs n={tabs} /> : null}
      <div className="scroll">
        <div className="tabpanel">{children}</div>
      </div>
    </main>
  )
}
