import Link from 'next/link'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { addDays, fmtDayMonth, fmtRel } from '@/lib/time'
import type { HomeView } from '@/lib/home-view'
import { HomeHead } from './Head'
import { ForYou } from './ForYou'

/** Qualitätsansicht (PRD §4.6, §22): offene Ereignisse, überfällige Massnahmen, Dokumente zur Freigabe. */
export async function QualityHome({ ctx, now, greet, view, views }: { ctx: Ctx; now: Date; greet: string; view: HomeView; views: HomeView[] }) {
  const { t, locale } = ctx
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now, locale)
  const inUnits = { orgId: ctx.org.id, unitId: { in: ctx.unitIds } }
  const canDocs = ctx.can('docs.approve')
  const [open, last30, overdueActions, docs] = await Promise.all([
    db.incident.findMany({ where: { ...inUnits, stage: { not: 'closed' } }, include: { type: true }, orderBy: { occurredAt: 'desc' } }),
    db.incident.count({ where: { ...inUnits, occurredAt: { gte: addDays(now, -30) } } }),
    db.incidentAction.findMany({ where: { doneAt: null, dueAt: { lt: now }, incident: inUnits }, include: { incident: { include: { type: true } } }, orderBy: { dueAt: 'asc' }, take: 10 }),
    canDocs ? db.document.findMany({ where: { orgId: ctx.org.id, status: 'review' }, orderBy: { updatedAt: 'desc' }, take: 8 }) : [],
  ])
  const unitName = (id: string) => ctx.units.find((u) => u.id === id)?.name ?? ''
  const reported = open.filter((i) => i.stage === 'reported').length

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <HomeHead t={t} view={view} views={views} greet={greet} label={ctx.org.name} sub={t('home.quality.sub')} />
      <div className="scroll">
        <div className="tabpanel">
          <div className="metrics" aria-label={t('home.view.quality')}>
            <Link className="metric" href="/quality"><span className="lbl">{t('home.lead.incidentsOpen')}</span><span className={'val' + (open.length ? ' warn' : '')}>{open.length}</span></Link>
            <Link className="metric" href="/quality"><span className="lbl">{t('home.quality.reported')}</span><span className={'val' + (reported ? ' crit' : '')}>{reported}</span></Link>
            <a className="metric" href="#q-actions"><span className="lbl">{t('home.quality.actionsOverdue')}</span><span className={'val' + (overdueActions.length ? ' crit' : '')}>{overdueActions.length}</span></a>
            {ctx.can('insights.view')
              ? <Link className="metric" href="/insights"><span className="lbl">{t('home.quality.last30')}</span><span className="val">{last30}</span></Link>
              : <div className="metric"><span className="lbl">{t('home.quality.last30')}</span><span className="val">{last30}</span></div>}
          </div>
          <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' }}>
            <div className="stack">
              <section className="card" aria-labelledby="q-open">
                <div className="card-head"><h2 id="q-open">{t('home.lead.incidentsOpen')}</h2><Link className="linkbtn small" href="/quality">{t('nav.quality')} →</Link></div>
                {open.length ? (
                  <ul className="list">
                    {open.slice(0, 10).map((i) => (
                      <li key={i.id}>
                        <Link className="li" href={`/quality/${i.id}`}>
                          <span className="grow">{i.type.name}{i.nearMiss && <span className="small muted"> · {t('home.quality.nearMiss')}</span>} <span className="small muted">· {unitName(i.unitId)}</span></span>
                          <span className={'tag' + (i.stage === 'reported' ? ' crit' : '')}>{t('quality.stages.' + i.stage)}</span>
                          <span className="small muted nowrap">{rel(i.occurredAt)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : <div className="card-body small muted">{t('home.quality.noneOpen')}</div>}
              </section>
              <section className="card" aria-labelledby="q-actions">
                <div className="card-head"><h2 id="q-actions">{t('home.quality.actionsOverdue')}</h2></div>
                {overdueActions.length ? (
                  <ul className="list">
                    {overdueActions.map((a) => (
                      <li key={a.id}>
                        <Link className="li" href={`/quality/${a.incidentId}`}>
                          <span className="grow">{a.title} <span className="small muted">· {a.incident.type.name}</span></span>
                          <span className="tag crit">{t('home.quality.overdueSince', { date: fmtDayMonth(a.dueAt!, locale) })}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : <div className="card-body small muted">{t('home.quality.actionsNone')}</div>}
              </section>
            </div>
            <div className="stack">
              {canDocs && (
                <section className="card" aria-labelledby="q-docs">
                  <div className="card-head"><h2 id="q-docs">{t('home.quality.docsReview')}</h2></div>
                  {docs.length ? (
                    <ul className="list">
                      {docs.map((d) => <li key={d.id}><Link className="li" href={`/docs/${d.id}`}><span className="grow">{d.title}</span><span className="small muted nowrap">{rel(d.updatedAt)}</span></Link></li>)}
                    </ul>
                  ) : <div className="card-body small muted">{t('home.quality.docsNone')}</div>}
                </section>
              )}
              <ForYou ctx={ctx} now={now} unitId={null} />
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
