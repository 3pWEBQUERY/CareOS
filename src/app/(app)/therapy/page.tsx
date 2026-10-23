import Link from 'next/link'
import { getCtx } from '@/lib/context'
import { addDays, dateKey, fmtDate, fmtDayMonth, hm, sameDay, startOfDay } from '@/lib/time'
import { reviewDue, weekProgress } from '@/lib/therapy'
import { therapyBoard, therapyUnitIds } from '@/lib/therapy-data'
import { Empty, Forbidden } from '@/components/ui/Empty'
import { DocumentButton, PlanButton, ReviewButton, ScheduleButton, type PlanCtxDto } from './TherapyClient'

export async function generateMetadata() {
  return { title: (await getCtx()).t('therapy.title') }
}

/**
 * Arbeitsliste Therapie (PRD §60): Behandlungen heute, Aufträge aus der Visite, aktive Pläne mit Wochenstand und
 * Zielevaluation, Berichte der letzten 7 Tage. Bereich der Topbar; «alle» zeigt alle Bereiche mit Therapierecht.
 */
export default async function TherapyPage({ searchParams }: { searchParams: Promise<{ u?: string }> }) {
  const sp = await searchParams
  const ctx = await getCtx()
  const { t, locale } = ctx
  const allowed = therapyUnitIds(ctx)
  if (!allowed.length) return <Forbidden text={t('common.notAllowed')} />
  const all = sp.u === 'all' || !ctx.unit || !allowed.includes(ctx.unit.id)
  const unitIds = all ? allowed : [ctx.unit!.id]
  const now = new Date()
  const b = await therapyBoard(ctx, unitIds, now)
  const canManage = ctx.units.some((u) => unitIds.includes(u.id) && ctx.can('therapy.manage', { unitId: u.id, locationId: u.locationId }))
  const canDoc = ctx.units.some((u) => unitIds.includes(u.id) && ctx.can('therapy.document', { unitId: u.id, locationId: u.locationId }))
  const todayKey = dateKey(now)
  const reviewKey = dateKey(addDays(startOfDay(now), 28))
  const label = (id: string) => { const r = b.rOf(id); return r ? [r.room?.number, `${r.lastName} ${r.firstName}`].filter(Boolean).join(' ') : '–' }
  const ctxOf = (id: string) => { const r = b.rOf(id)!; return { id: r.id, name: `${r.lastName} ${r.firstName}`, room: r.room?.number ?? null, allergies: r.allergies } }
  const planDto = (p: (typeof b.plans)[number]): PlanCtxDto => ({ id: p.id, discipline: p.discipline, goal: p.goal, sessionMin: p.sessionMin, resident: ctxOf(p.residentId) })
  const residentOpts = b.residents.map((r) => ({ id: r.id, name: `${r.lastName} ${r.firstName}`, hint: [r.room?.number, r.unit.name].filter(Boolean).join(' · ') }))
  const where = all ? t('therapy.allUnits') : ctx.unit!.name
  const when = (d: Date) => (sameDay(d, now) ? `${t('common.today')} ${hm(d)}` : `${fmtDayMonth(d, locale)} ${hm(d)}`)

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">
        <div>
          <span className="lbl">{t('therapy.label', { where })}</span>
          <h1>{t('therapy.title')}</h1>
        </div>
        <div className="row head-actions">
          {ctx.unit && allowed.includes(ctx.unit.id) && allowed.length > 1 && (
            <nav className="seg seg-x" aria-label={t('home.scope.label')}>
              <Link href="/therapy" aria-current={!all ? 'page' : undefined}>{ctx.unit.name}</Link>
              <Link href="/therapy?u=all" aria-current={all ? 'page' : undefined}>{t('therapy.allUnits')}</Link>
            </nav>
          )}
          {canManage && <PlanButton residents={residentOpts} todayKey={todayKey} reviewKey={reviewKey} />}
        </div>
      </div>
      <div className="scroll">
        <div className="tabpanel">
          <section className="card" aria-labelledby="th-today">
            <div className="card-head"><h2 id="th-today">{t('therapy.today')}</h2><span className="small muted">{b.today.length}</span></div>
            {b.today.length ? (
              <ul className="list">
                {b.today.map((a) => {
                  const plan = b.plans.find((p) => p.id === a.therapyPlanId)
                  return (
                    <li key={a.id} className="li th-row">
                      <time className="mono small nowrap" style={{ minWidth: 48 }}>{hm(a.at)}</time>
                      <span className="grow"><Link className="linkbtn" href={`/residents/${a.residentId}`}>{label(a.residentId)}</Link><span className="small muted"> · {a.title}</span></span>
                      {a.done ? <span className="tag ok"><span aria-hidden="true">✓ </span>{t('therapy.done')}</span>
                        : plan && canDoc ? <DocumentButton plan={planDto(plan)} appointmentId={a.id} /> : <span className="tag outline">{t('visit.list.open')}</span>}
                    </li>
                  )
                })}
              </ul>
            ) : <div className="card-body small muted">{t('therapy.todayNone')}</div>}
          </section>

          {b.orders.length > 0 && (
            <section className="card" aria-labelledby="th-orders">
              <div className="card-head"><h2 id="th-orders">{t('therapy.orders')}</h2></div>
              <ul className="list">
                {b.orders.map((o) => (
                  <li key={o.id} className="li th-row">
                    <span className="grow">{label(o.residentId)}<span className="small muted" style={{ display: 'block' }}>{o.text} · {fmtDate(o.createdAt, locale)}</span></span>
                    {canManage && <PlanButton residents={residentOpts} todayKey={todayKey} reviewKey={reviewKey} order={{ id: o.id, residentId: o.residentId, text: o.text }} className="btn sm" />}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="stack-sm" aria-labelledby="th-plans">
            <h2 className="sec" id="th-plans">{t('therapy.plans')}</h2>
            {b.plans.length ? (
              <div className="tablewrap">
                <table className="stable">
                  <thead>
                    <tr>
                      <th>{t('therapy.col.resident')}</th>
                      <th>{t('therapy.col.plan')}</th>
                      <th>{t('therapy.col.week')}</th>
                      <th>{t('therapy.col.next')}</th>
                      <th>{t('therapy.col.review')}</th>
                      {(canDoc || canManage) && <th className="right"><span className="sr-only">{t('therapy.col.actions')}</span></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {b.plans.map((p) => {
                      const wk = weekProgress(p.perWeek, b.sessionsOf(p.id), now)
                      const next = b.upcoming.find((a) => a.therapyPlanId === p.id)
                      const due = reviewDue(p, now)
                      return (
                        <tr key={p.id}>
                          <td><Link className="linkbtn" href={`/residents/${p.residentId}`}>{label(p.residentId)}</Link></td>
                          <td>
                            <div><span className="tag accent">{t('therapy.disciplines.' + p.discipline)}</span></div>
                            <div className="small">{p.goal}</div>
                            <div className="small muted">{t('therapy.frequency', { n: p.perWeek, min: p.sessionMin })}{p.careInstructions ? ` · ${t('therapy.form.careInstructions')}: ${p.careInstructions}` : ''}</div>
                          </td>
                          <td className="small nowrap"><span className="mono">{t('therapy.week', { done: wk.done, target: wk.target })}</span>{wk.behind && <div><span className="tag warn">{t('therapy.behind')}</span></div>}</td>
                          <td className="small nowrap">{next ? when(next.at) : <span className="muted">{t('therapy.noNext')}</span>}</td>
                          <td className="small nowrap">{p.reviewAt ? <>{fmtDate(p.reviewAt, locale)}{due && <div><span className="tag warn">{t('therapy.reviewDue')}</span></div>}</> : '–'}</td>
                          {(canDoc || canManage) && (
                            <td className="right nowrap">
                              <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                                {canDoc && <ScheduleButton plan={planDto(p)} todayKey={todayKey} />}
                                {canDoc && <DocumentButton plan={planDto(p)} className="btn sm" />}
                                {canManage && <ReviewButton plan={planDto(p)} nextKey={reviewKey} todayKey={todayKey} />}
                              </div>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : <Empty title={t('therapy.plansNone')} />}
          </section>

          <section className="card" aria-labelledby="th-reports">
            <div className="card-head"><h2 id="th-reports">{t('therapy.reports')}</h2></div>
            {b.reports.length ? (
              <ul className="list">
                {b.reports.map((o) => (
                  <li key={o.id} className="li visit-note">
                    <time className="small muted mono nowrap">{when(o.at)}</time>
                    <span className="grow small"><Link className="linkbtn small" href={`/residents/${o.residentId}/notes`}>{label(o.residentId)}</Link><span className="fg2 visit-note-text" style={{ display: 'block' }}>{o.text}</span></span>
                  </li>
                ))}
              </ul>
            ) : <div className="card-body small muted">{t('therapy.reportsNone')}</div>}
          </section>
        </div>
      </div>
    </main>
  )
}
