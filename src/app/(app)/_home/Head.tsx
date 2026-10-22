import Link from 'next/link'
import type { HomeView } from '@/lib/home-view'

type T = (key: string, vars?: Record<string, string | number>) => string

/** Kopf der Startseite: Ort, Begrüssung, Dienst/Bereich, Kurzfassung und – bei mehreren Ansichten – die Umschaltung. */
export function HomeHead({ t, label, greet, sub, summary, view, views, actions }: {
  t: T
  label: string
  greet: string
  sub: string
  summary?: React.ReactNode
  view: HomeView
  views: HomeView[]
  actions?: React.ReactNode
}) {
  return (
    <div className="view-head">
      <div>
        <span className="lbl">{label}</span>
        <h1>{greet}</h1>
        <p className="sub">{sub}</p>
        {summary && <p className="home-summary">{summary}</p>}
      </div>
      {(views.length > 1 || actions) && (
        <div className="row home-head-acts">
          {views.length > 1 && (
            <nav className="seg seg-x" aria-label={t('home.view.label')}>
              {views.map((v) => <Link key={v} href={`/?view=${v}`} aria-current={v === view ? 'page' : undefined} scroll={false}>{t('home.view.' + v)}</Link>)}
            </nav>
          )}
          {actions}
        </div>
      )}
    </div>
  )
}
