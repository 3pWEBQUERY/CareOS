import Link from 'next/link'
import type { Ctx } from '@/lib/context'
import { shiftName } from '@/lib/shift-name'
import { fmtRel } from '@/lib/time'
import type { HomeView } from '@/lib/home-view'
import { HomeHead } from './Head'
import { ForYou } from './ForYou'
import { UnitOpen } from './UnitOpen'
import { leadDecisions, unitOverview } from './overview'

/**
 * Leitungsansicht (PRD §4.6, §7): Stationsleitung und PDL sehen alle ihre Bereiche auf einen Blick –
 * kritische Punkte, Überfälliges, Übergabe, Zuteilung und Besetzung – und können in jede Station wechseln.
 */
export async function LeadHome({ ctx, now, greet, view, views }: { ctx: Ctx; now: Date; greet: string; view: HomeView; views: HomeView[] }) {
  const { t, locale } = ctx
  const scope = (id: string) => ({ unitId: id, locationId: ctx.units.find((u) => u.id === id)?.locationId })
  const unitIds = ctx.units.filter((u) => ctx.can('resident.read', scope(u.id)) && ctx.can('task.read', scope(u.id))).map((u) => u.id)
  const [{ rows, critical, openIncidents }, decisions] = await Promise.all([unitOverview(ctx, unitIds, now), leadDecisions(ctx, unitIds, now)])
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now, locale)
  const sum = (k: 'residents' | 'critical' | 'overdue' | 'incidentsOpen') => rows.reduce((s, r) => s + r[k], 0)
  const canQuality = ctx.can('quality.manage')
  const running = rows.find((r) => r.assigned)?.assigned?.shift
  const decide = [
    decisions.canSchedule && { n: decisions.absences, text: t('home.lead.absences', { n: decisions.absences }), href: '/schedule?view=absences' },
    decisions.canSchedule && { n: decisions.swaps, text: t('home.lead.swaps', { n: decisions.swaps }), href: '/schedule?view=swaps' },
    decisions.canApprove && { n: decisions.plans, text: t('home.lead.plans', { n: decisions.plans }), href: '/residents' },
    canQuality && { n: openIncidents.filter((i) => i.stage === 'reported').length, text: t('home.lead.incidentsNew', { n: openIncidents.filter((i) => i.stage === 'reported').length }), href: '/quality' },
  ].filter((x): x is { n: number; text: string; href: string } => !!x)

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <HomeHead t={t} view={view} views={views} greet={greet} label={ctx.org.name}
        sub={[t('home.lead.sub', { n: rows.length }), running ? `${t('home.stationShift')}: ${shiftName(t, running)} · ${running.start}–${running.end}` : null].filter(Boolean).join(' · ')} />
      <div className="scroll">
        <div className="tabpanel">
          <div className="metrics" aria-label={t('home.lead.title')}>
            <div className="metric"><span className="lbl">{t('home.residentsLabel')}</span><span className="val">{sum('residents')}</span></div>
            <a className="metric" href="#lead-crit"><span className="lbl">{t('home.critical')}</span><span className={'val' + (critical.length ? ' crit' : '')}>{critical.length}</span></a>
            <div className="metric"><span className="lbl">{t('home.overdue')}</span><span className={'val' + (sum('overdue') ? ' crit' : '')}>{sum('overdue')}</span></div>
            {canQuality
              ? <Link className="metric" href="/quality"><span className="lbl">{t('home.lead.incidentsOpen')}</span><span className={'val' + (sum('incidentsOpen') ? ' warn' : '')}>{sum('incidentsOpen')}</span></Link>
              : <div className="metric"><span className="lbl">{t('home.lead.incidentsOpen')}</span><span className="val">{sum('incidentsOpen')}</span></div>}
          </div>

          <section className="stack-sm" aria-labelledby="units">
            <div className="sec-head"><h2 className="sec" id="units">{t('home.lead.units')}</h2></div>
            <div className="home-units">
              {rows.map((r) => (
                <section key={r.unit.id} className={'card' + (r.critical ? ' crit' : '')} aria-labelledby={'u-' + r.unit.id}>
                  <div className="card-head">
                    <h3 id={'u-' + r.unit.id}>{r.unit.name} <span className="small muted">{r.unit.location}</span></h3>
                    <UnitOpen unitId={r.unit.id} current={ctx.unit?.id === r.unit.id} label={t('home.lead.open')} aria={t('home.lead.openAria', { unit: r.unit.name })} />
                  </div>
                  <dl className="home-facts">
                    <div><dt className="lbl">{t('home.critical')}</dt><dd>{r.critical ? <span className="tag crit">{r.critical}</span> : <span className="muted">0</span>}</dd></div>
                    <div><dt className="lbl">{t('home.overdue')}</dt><dd>{r.overdue ? <span className="tag crit">{r.overdue} {t('tasks.view.over')}</span> : <span className="muted">0</span>}</dd></div>
                    <div><dt className="lbl">{t('home.residentsLabel')}</dt><dd className="mono">{r.residents}</dd></div>
                    {r.handover && r.residents > 0 && (
                      <div><dt className="lbl">{t('home.lead.handover', { shift: shiftName(t, r.handover.shift, { short: true }) })}</dt>
                        <dd>{r.handover.submittedAt ? <span className="small">✓ {t('home.lead.handoverDone', { at: rel(r.handover.submittedAt) })}</span> : <span className="tag warn">{t('home.lead.handoverOpen')}</span>}</dd></div>
                    )}
                    {r.assigned && r.residents > 0 && (
                      <div><dt className="lbl">{t('home.lead.assigned', { shift: shiftName(t, r.assigned.shift, { short: true }) })}</dt>
                        <dd>{r.assigned.n ? <span className={'mono' + (r.assigned.n < r.assigned.total ? ' warn-text' : '')}>{r.assigned.n}/{r.assigned.total}</span> : <span className="tag">{t('home.lead.assignedNone')}</span>}</dd></div>
                    )}
                    <div><dt className="lbl">{t('home.lead.staffing')}</dt>
                      <dd className="small">
                        {r.staffing.byCode.length ? <span className="mono">{r.staffing.byCode.map((c) => `${c.code} ${c.n}`).join(' · ')}</span> : <span className="muted">–</span>}
                        {r.staffing.openWeek > 0 && <> <span className="tag warn">{t('home.lead.openShifts', { n: r.staffing.openWeek })}</span></>}
                      </dd></div>
                  </dl>
                </section>
              ))}
            </div>
          </section>

          <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' }}>
            <div className="stack">
              <section className={'card' + (critical.length ? ' crit' : '')} aria-labelledby="lead-crit">
                <div className="card-head"><h2 id="lead-crit"><span className="tag crit">{t('home.critical')}</span></h2><span className={'pill ' + (critical.length ? 'crit' : '')}>{critical.length}</span></div>
                {critical.length ? (
                  <ul className="list">
                    {critical.slice(0, 10).map((c, i) => (
                      <li key={c.href + i}>
                        <Link className="li" href={c.href}>
                          <div className="grow">
                            <div>{c.who || rows.find((r) => r.unit.id === c.unitId)?.unit.name}</div>
                            <div className="small crit-text">{c.text}</div>
                          </div>
                          <span className="small muted nowrap">{rows.find((r) => r.unit.id === c.unitId)?.unit.name}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : <div className="card-body small muted">{t('home.criticalNone')}</div>}
              </section>

              {decide.length > 0 && (
                <section className="card" aria-labelledby="lead-dec">
                  <div className="card-head"><h2 id="lead-dec">{t('home.lead.decide')}</h2></div>
                  <ul className="list">
                    {decide.map((d) => (
                      <li key={d.href + d.text}>
                        <Link className="li" href={d.href}>
                          <span className={'grow' + (d.n ? '' : ' muted')}>{d.text}</span>
                          <span className="muted" aria-hidden="true">→</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {canQuality && openIncidents.length > 0 && (
                <section className="card" aria-labelledby="lead-inc">
                  <div className="card-head"><h2 id="lead-inc">{t('home.lead.incidentsOpen')}</h2><Link className="linkbtn small" href="/quality">{t('nav.quality')} →</Link></div>
                  <ul className="list">
                    {openIncidents.slice(0, 5).map((i) => (
                      <li key={i.id}>
                        <Link className="li" href={`/quality/${i.id}`}>
                          <span className="grow">{i.type.name} <span className="small muted">· {rows.find((r) => r.unit.id === i.unitId)?.unit.name}</span></span>
                          <span className="tag">{t('quality.stages.' + i.stage)}</span>
                          <span className="small muted nowrap">{rel(i.occurredAt)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
            <div className="stack">
              <ForYou ctx={ctx} now={now} unitId={ctx.unit?.id} />
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
