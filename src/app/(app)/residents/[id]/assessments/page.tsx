import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { getCtx, residentInScope } from '@/lib/context'
import { addDays, fmtDate, fmtDayMonth, startOfDay } from '@/lib/time'
import { assessmentLabel, levelFor } from '@/lib/care'
import { LineChart } from '@/components/ui/LineChart'
import { Empty } from '@/components/ui/Empty'
import { loadAssessmentDefs } from './defs'
import { PerformAssessment } from './AssessClient'

export async function generateMetadata() {
  return { title: (await getCtx()).t('residents.tabs.assessments') }
}

export default async function AssessmentsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ k?: string }> }) {
  const { id } = await params
  const sp = await searchParams
  const ctx = await getCtx()
  const { t, locale } = ctx
  const r = await residentInScope(ctx, id)
  if (!r) notFound()
  const canWrite = ctx.can('resident.assessment.write', { unitId: r.unitId, locationId: r.unit.locationId })
  const now = new Date()
  const today = startOfDay(now)
  const [defs, all] = await Promise.all([
    loadAssessmentDefs(ctx.org.id),
    db.assessment.findMany({ where: { residentId: r.id }, orderBy: { at: 'desc' }, take: 300 }),
  ])
  const authors = new Map(
    (await db.user.findMany({ where: { orgId: ctx.org.id, id: { in: [...new Set(all.map((a) => a.authorId))] } }, select: { id: true, firstName: true, lastName: true } }))
      .map((u) => [u.id, `${u.firstName.charAt(0)}. ${u.lastName}`]),
  )
  const byKey = new Map<string, typeof all>()
  for (const a of all) byKey.set(a.key, [...(byKey.get(a.key) ?? []), a])
  const contextLabel = `${r.lastName} ${r.firstName}${r.room ? ' · ' + t('care.roomShort', { room: r.room.number }) : ''}`
  const planHref = `/residents/${r.id}/careplan#suggestions`
  const withHistory = defs.filter((d) => byKey.get(d.key)?.length)
  const sel = defs.find((d) => d.key === sp.k) ?? withHistory[0] ?? null
  const selList = sel ? byKey.get(sel.key) ?? [] : []

  const dueLabel = (d: Date | null) => {
    if (!d) return { text: t('care.assessments.noInterval'), cls: 'muted' }
    if (d < today) return { text: '▲ ' + t('care.assessments.overdueSince', { date: fmtDate(d, locale) }), cls: 'crit-text' }
    if (d < addDays(today, 1)) return { text: t('care.assessments.dueToday'), cls: 'warn-text' }
    return { text: fmtDate(d, locale), cls: '' }
  }

  return (
    <>
      <div className="sec-head">
        <div>
          <h2 className="sec">{t('care.assessments.title')}</h2>
          <span className="small muted">{t('care.assessments.subtitle')}</span>
        </div>
      </div>

      <div className="tablewrap">
        <table className="stable">
          <thead>
            <tr>
              <th>{t('care.assessments.colType')}</th>
              <th>{t('care.assessments.colLast')}</th>
              <th className="as-date">{t('care.assessments.colDate')}</th>
              <th>{t('care.assessments.colNext')}</th>
              <th className="as-trend">{t('care.assessments.colTrend')}</th>
              <th className="care-act-col"><span className="sr-only">{t('care.plan.colActions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {defs.map((d) => {
              const list = byKey.get(d.key) ?? []
              const last = list[0]
              const level = last ? levelFor(d, last.score) : null
              const due = last ? dueLabel(last.nextDue) : null
              const name = assessmentLabel(t, d.key, d.name)
              const trend = list.slice(0, 8).reverse().map((a) => a.score).filter((v): v is number => v != null)
              const perform = canWrite ? (
                <PerformAssessment
                  residentId={r.id} def={d} name={name} contextLabel={contextLabel} planHref={planHref}
                  nextDueLabel={d.intervalDays ? t('care.assessments.nextDueHint', { date: fmtDate(addDays(now, d.intervalDays), locale) }) : null}
                />
              ) : null
              return (
                <tr key={d.key} className={due?.cls === 'crit-text' ? 'over' : undefined}>
                  <td>
                    <Link href={`/residents/${r.id}/assessments?k=${d.key}`} scroll={false} style={{ fontWeight: 500, color: 'inherit' }}>{name}</Link>
                    <div className="small muted">{d.description}</div>
                    {perform && <div className="care-act-inline" style={{ marginTop: 6 }}>{perform}</div>}
                  </td>
                  <td>
                    {last ? (
                      <div className="stack-sm" style={{ gap: 3 }}>
                        <span className="row" style={{ gap: 8 }}>
                          <span className="mono">{t('care.assessments.points', { n: last.score ?? '–' })}</span>
                          {last.result && <span className={'tag ' + (level ?? '')}>{last.result}</span>}
                        </span>
                        {level === 'crit' && <Link className="linkbtn small" href={planHref}>{t('care.assessments.toPlan')} →</Link>}
                      </div>
                    ) : <span className="muted">{t('care.assessments.never')}</span>}
                  </td>
                  <td className="num nowrap as-date">{last ? fmtDate(last.at, locale) : '–'}</td>
                  <td className={'nowrap ' + (due?.cls ?? '')}>{due ? due.text : '–'}</td>
                  <td className="as-trend" style={{ width: 110 }}>{trend.length > 1 ? <Spark values={trend} label={t('care.assessments.chartAria', { name })} /> : <span className="muted">–</span>}</td>
                  <td className="care-act-col">{perform && <div className="row" style={{ justifyContent: 'flex-end' }}>{perform}</div>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <section className="stack-sm" aria-labelledby="hist-h">
        <div className="sec-head">
          <h2 className="sec" id="hist-h">{t('care.assessments.history')}{sel ? ': ' + assessmentLabel(t, sel.key, sel.name) : ''}</h2>
          <div className="chips">
            {defs.map((d) => (
              <Link key={d.key} className="chip" href={`/residents/${r.id}/assessments?k=${d.key}`} scroll={false} aria-current={sel?.key === d.key ? 'page' : undefined}>
                {assessmentLabel(t, d.key, d.name)} <span className="mono muted">{byKey.get(d.key)?.length ?? 0}</span>
              </Link>
            ))}
          </div>
        </div>
        {!sel || !selList.length ? (
          <Empty title={t('care.assessments.historyEmpty')} />
        ) : (
          <div className="grid-2">
            {(() => {
              const ok = sel.items.ranges.filter((x) => x.level === 'ok')
              const lo = ok.length ? Math.min(...ok.map((x) => x.min)) : 0
              const hi = ok.length ? Math.max(...ok.map((x) => x.max)) : 0
              const pts = selList.slice(0, 12).reverse()
              const last = selList[0]
              const name = assessmentLabel(t, sel.key, sel.name)
              return (
                <LineChart
                  title={name}
                  unit={t('care.assessments.colScore')}
                  points={pts.map((a) => ({ label: fmtDayMonth(a.at), title: `${fmtDate(a.at, locale)}: ${a.score ?? '–'} · ${a.result ?? ''}`, v: a.score }))}
                  lo={lo} hi={hi}
                  current={String(last.score ?? '–')}
                  alarm={levelFor(sel, last.score) === 'crit'}
                  legend={{ band: `${t('care.assessments.bandOk')} ${lo}–${hi}` }}
                  ariaLabel={t('care.assessments.chartAria', { name })}
                />
              )
            })()}
            <div className="tablewrap">
              <table className="stable">
                <thead>
                  <tr>
                    <th>{t('care.assessments.colDate')}</th>
                    <th className="right">{t('care.assessments.colScore')}</th>
                    <th>{t('care.assessments.colResult')}</th>
                    <th>{t('care.assessments.colBy')}</th>
                  </tr>
                </thead>
                <tbody>
                  {selList.map((a) => {
                    const level = levelFor(sel, a.score)
                    return (
                      <tr key={a.id}>
                        <td className="num nowrap">{fmtDate(a.at, locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                        <td className="num right">{a.score ?? '–'}</td>
                        <td>{a.result ? <span className={'tag ' + (level ?? '')}>{a.result}</span> : '–'}</td>
                        <td className="nowrap">{authors.get(a.authorId) ?? '–'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </>
  )
}

function Spark({ values, label }: { values: number[]; label: string }) {
  const mn = Math.min(...values)
  const mx = Math.max(...values)
  const W = 100, H = 28
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (W - 4) + 2).toFixed(1)},${(H - 3 - ((v - mn) / (mx - mn || 1)) * (H - 6)).toFixed(1)}`).join(' ')
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label + ': ' + values.join(' → ')}>
      <polyline points={pts} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
