import Link from 'next/link'
import type { Ctx } from '@/lib/context'
import { fmtDate, hm, sameDay } from '@/lib/time'
import type { HomeView } from '@/lib/home-view'
import { reviewDue } from '@/lib/therapy'
import { therapyBoard, therapyUnitIds } from '@/lib/therapy-data'
import { HomeHead } from './Head'
import { ForYou } from './ForYou'

/** Therapie-Startseite (PRD §4.6, §60): Behandlungen heute, fällige Evaluationen, Verlauf der Therapieberichte. */
export async function TherapyHome({ ctx, now, greet, view, views }: { ctx: Ctx; now: Date; greet: string; view: HomeView; views: HomeView[] }) {
  const { t, locale } = ctx
  const unitIds = therapyUnitIds(ctx)
  const b = await therapyBoard(ctx, unitIds, now)
  const label = (id: string) => { const r = b.rOf(id); return r ? [r.room?.number, `${r.lastName} ${r.firstName}`].filter(Boolean).join(' ') : '–' }
  const due = b.plans.filter((p) => reviewDue(p, now))
  const doneToday = b.reports.filter((o) => sameDay(o.at, now) && (o.structured as { kind?: string } | null)?.kind === 'therapy').length
  const where = unitIds.length > 1 ? t('therapy.allUnits') : ctx.units.find((u) => u.id === unitIds[0])?.name ?? ''

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <HomeHead t={t} view={view} views={views} greet={greet} label={ctx.org.name} sub={t('home.therapy.sub', { where })}
        actions={<Link className="btn primary" href="/therapy">{t('home.therapy.toList')}</Link>} />
      <div className="scroll">
        <div className="tabpanel">
          <div className="metrics" aria-label={t('home.view.therapy')}>
            <a className="metric" href="#th-h-today"><span className="lbl">{t('home.therapy.metricToday')}</span><span className="val">{b.today.length}</span></a>
            <div className="metric"><span className="lbl">{t('home.therapy.metricDone')}</span><span className="val">{doneToday}</span></div>
            <Link className="metric" href="/therapy"><span className="lbl">{t('home.therapy.metricPlans')}</span><span className="val">{b.plans.length}</span></Link>
            <a className="metric" href="#th-h-review"><span className="lbl">{t('home.therapy.metricReview')}</span><span className={'val' + (due.length ? ' warn' : '')}>{due.length}</span></a>
          </div>
          <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' }}>
            <div className="stack">
              <section className="card" aria-labelledby="th-h-today">
                <div className="card-head"><h2 id="th-h-today">{t('home.therapy.today')}</h2><Link className="linkbtn small" href="/therapy">{t('therapy.title')} →</Link></div>
                {b.today.length ? (
                  <ul className="list">
                    {b.today.map((a) => (
                      <li key={a.id}>
                        <Link className="li" href="/therapy">
                          <time className="mono small nowrap" style={{ minWidth: 48 }}>{hm(a.at)}</time>
                          <span className="grow">{label(a.residentId)}<span className="small muted"> · {a.title}</span></span>
                          {a.done ? <span className="tag ok"><span aria-hidden="true">✓ </span>{t('therapy.done')}</span> : <span className="tag outline">{t('visit.list.open')}</span>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : <div className="card-body small muted">{t('home.therapy.todayNone')}</div>}
              </section>
              <section className="card" aria-labelledby="th-h-recent">
                <div className="card-head"><h2 id="th-h-recent">{t('home.therapy.recent')}</h2></div>
                {b.reports.length ? (
                  <ul className="list">
                    {b.reports.slice(0, 10).map((o) => (
                      <li key={o.id}>
                        <Link className="li visit-note" href={`/residents/${o.residentId}/notes`}>
                          <time className="small muted mono nowrap">{sameDay(o.at, now) ? hm(o.at) : fmtDate(o.at, locale, { day: '2-digit', month: '2-digit' })}</time>
                          <span className="grow small"><span>{label(o.residentId)}</span><span className="fg2 visit-note-text" style={{ display: 'block' }}>{o.text}</span></span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : <div className="card-body small muted">{t('home.therapy.recentNone')}</div>}
              </section>
            </div>
            <div className="stack">
              <section className="card" aria-labelledby="th-h-review">
                <div className="card-head"><h2 id="th-h-review">{t('home.therapy.review')}</h2></div>
                {due.length ? (
                  <ul className="list">
                    {due.map((p) => (
                      <li key={p.id}>
                        <Link className="li" href="/therapy">
                          <span className="grow">{label(p.residentId)}<span className="small muted" style={{ display: 'block' }}>{t('therapy.disciplines.' + p.discipline)} · {p.goal}</span></span>
                          <span className="tag warn">{fmtDate(p.reviewAt!, locale)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : <div className="card-body small muted">{t('home.therapy.reviewNone')}</div>}
              </section>
              <ForYou ctx={ctx} now={now} unitId={null} />
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
