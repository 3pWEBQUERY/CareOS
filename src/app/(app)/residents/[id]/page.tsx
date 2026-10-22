import Link from 'next/link'
import { db } from '@/lib/db'
import { aiConfigured } from '@/lib/env'
import { OPEN_STATUSES, taskView } from '@/lib/tasks'
import { taskTitle } from '@/lib/task-title'
import { addDays, fmtDayMonth, fmtDbDate, fmtNum, fmtRel, hm, startOfDay } from '@/lib/time'
import { abnormalKeys, mergeLimits, VITALS } from '@/lib/vitals'
import { Spark } from '../_components/Spark'
import { pageResident, userNames, residentTitle } from '../_lib/resident'
import { AiSummary } from './AiSummary'
import { VisitCard } from './VisitCard'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return residentTitle((await params).id)
}

/** Resident 360 (PRD §47): aktueller Zustand, Veränderungen, Anstehendes, Trends. */
export default async function ResidentOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { ctx, r, can } = await pageResident(id)
  const { t, locale } = ctx
  const now = new Date()
  const since48 = addDays(now, -2)
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now)
  const canMeds = can('resident.medication.read')

  const [nurse, plan, domains, importantObs, recentObs, vitals30, weights, limitRows, incidents48, falls90, medChanges, refusals, appts, assessments, defs, tasksToday, intake] = await Promise.all([
    r.primaryNurseId ? db.user.findFirst({ where: { id: r.primaryNurseId, orgId: ctx.org.id }, select: { firstName: true, lastName: true, jobTitle: true } }) : null,
    db.carePlan.findFirst({ where: { residentId: r.id, status: 'active' }, orderBy: { version: 'desc' }, include: { areas: true } }),
    db.careDomain.findMany({ where: { orgId: ctx.org.id }, select: { key: true, name: true } }),
    db.observation.findMany({ where: { residentId: r.id, important: true, at: { gte: addDays(now, -7) }, correctedBy: { none: {} } }, orderBy: { at: 'desc' }, take: 4 }),
    db.observation.findMany({ where: { residentId: r.id, at: { gte: since48 }, correctedBy: { none: {} } }, orderBy: { at: 'desc' }, take: 12 }),
    db.vitalSign.findMany({ where: { residentId: r.id, at: { gte: addDays(now, -30) } }, orderBy: { at: 'asc' } }),
    db.vitalSign.findMany({ where: { residentId: r.id, weight: { not: null }, at: { gte: addDays(now, -180) } }, orderBy: { at: 'asc' }, select: { at: true, weight: true } }),
    db.vitalThreshold.findMany({ where: { orgId: ctx.org.id, OR: [{ residentId: null }, { residentId: r.id }] } }),
    db.incident.findMany({ where: { residentId: r.id, orgId: ctx.org.id, occurredAt: { gte: since48 } }, include: { type: true }, orderBy: { occurredAt: 'desc' } }),
    db.incident.count({ where: { residentId: r.id, orgId: ctx.org.id, occurredAt: { gte: addDays(now, -90) }, type: { key: 'fall' } } }),
    canMeds ? db.medication.findMany({ where: { residentId: r.id, OR: [{ createdAt: { gte: since48 } }, { stoppedAt: { gte: since48 } }] } }) : [],
    canMeds ? db.medicationAdministration.findMany({ where: { residentId: r.id, status: { not: 'given' }, at: { gte: since48 }, voidedAt: null }, include: { medication: { select: { name: true } } } }) : [],
    db.appointment.findMany({ where: { residentId: r.id, done: false, at: { gte: startOfDay(now), lt: addDays(now, 21) } }, orderBy: { at: 'asc' }, take: 6 }),
    db.assessment.findMany({ where: { residentId: r.id }, orderBy: { at: 'desc' }, select: { key: true, at: true, nextDue: true, result: true, score: true } }),
    db.assessmentDefinition.findMany({ where: { orgId: ctx.org.id }, select: { key: true, name: true } }),
    can('task.read') ? db.task.findMany({ where: { residentId: r.id, status: { in: [...OPEN_STATUSES] }, dueAt: { gte: startOfDay(now), lt: addDays(startOfDay(now), 1) } }, orderBy: { dueAt: 'asc' } }) : [],
    db.intakeLog.findMany({ where: { residentId: r.id, at: { gte: startOfDay(addDays(now, -6)) } }, select: { at: true, kind: true, amountMl: true, portion: true } }),
  ])
  const limits = mergeLimits(limitRows, r.id)
  const names = await userNames(ctx, recentObs.map((o) => o.authorId))
  const domainName = new Map(domains.map((d) => [d.key, d.name]))
  const defName = new Map(defs.map((d) => [d.key, d.name]))

  // Aktueller Zustand
  const needs = (plan?.areas ?? []).filter((a) => a.needs || a.risks).slice(0, 6)

  // Veränderungen (48 h)
  type Change = { key: string; at: Date; tone: string; tag: string; text: string; href: string }
  const changes: Change[] = []
  for (const o of recentObs) changes.push({ key: 'o' + o.id, at: o.at, tone: o.category === 'incident' ? 'crit' : o.important ? 'warn' : 'accent', tag: t('chart.cat.' + o.category), text: `${o.text}${names.get(o.authorId) ? ' — ' + names.get(o.authorId)!.short : ''}`, href: `/residents/${r.id}/notes` })
  for (const v of vitals30.filter((v) => v.at >= since48)) {
    const ab = abnormalKeys(v, limits)
    if (ab.length) changes.push({ key: 'v' + v.id, at: v.at, tone: 'crit', tag: t('chart.timeline.kinds.vitals'), text: ab.map((k) => `${t('common.vitals.' + k)} ${fmtNum(v[k] as number, VITALS[k].dec, locale)} ${VITALS[k].unit}`).join(', '), href: `/residents/${r.id}/vitals` })
  }
  for (const i of incidents48) changes.push({ key: 'i' + i.id, at: i.occurredAt, tone: 'crit', tag: t('chart.timeline.kinds.incident'), text: `${i.type.name}: ${i.description}`, href: `/quality/${i.id}` })
  for (const m of medChanges) changes.push({ key: 'm' + m.id, at: m.stoppedAt ?? m.createdAt, tone: 'violet', tag: t('chart.timeline.kinds.medication'), text: t(m.stoppedAt ? 'residents.overview.medStopped' : 'residents.overview.medStarted', { name: m.name }), href: `/residents/${r.id}/meds` })
  for (const a of refusals) changes.push({ key: 'a' + a.id, at: a.at, tone: 'warn', tag: t('chart.timeline.kinds.medication'), text: `${a.medication.name} · ${t('chart.timeline.admin.' + a.status)}`, href: `/residents/${r.id}/meds` })
  changes.sort((a, b) => b.at.getTime() - a.at.getTime())

  // Anstehendes
  type Up = { key: string; at: Date; tag: string; tone: string; text: string; over?: boolean; href: string }
  const upcoming: Up[] = []
  for (const a of appts) upcoming.push({ key: 'p' + a.id, at: a.at, tag: t('residents.appointments.kinds.' + (['physician', 'therapy', 'hospital', 'relatives'].includes(a.kind) ? a.kind : 'other')), tone: 'violet', text: a.title + (a.place ? ' · ' + a.place : ''), href: `/residents/${r.id}/appointments` })
  const seen = new Set<string>()
  for (const a of assessments) {
    if (seen.has(a.key)) continue
    seen.add(a.key)
    if (a.nextDue && a.nextDue < addDays(now, 14)) upcoming.push({ key: 'a' + a.key, at: a.nextDue, tag: t('chart.timeline.kinds.assessment'), tone: 'accent', text: defName.get(a.key) ?? a.key, over: a.nextDue < startOfDay(now), href: `/residents/${r.id}/assessments` })
  }
  if (plan?.nextEvaluation && plan.nextEvaluation < addDays(now, 21)) upcoming.push({ key: 'cp', at: plan.nextEvaluation, tag: t('residents.overview.evaluation'), tone: 'warn', text: t('residents.overview.carePlanEval', { v: plan.version }), over: plan.nextEvaluation < now, href: `/residents/${r.id}/careplan` })
  for (const a of plan?.areas ?? []) if (a.evaluateBy && a.evaluateBy < addDays(now, 14)) upcoming.push({ key: 'ar' + a.id, at: a.evaluateBy, tag: t('residents.overview.evaluation'), tone: 'warn', text: domainName.get(a.domain) ?? a.domain, over: a.evaluateBy < now, href: `/residents/${r.id}/careplan` })
  upcoming.sort((a, b) => a.at.getTime() - b.at.getTime())
  const nextTasks = tasksToday.slice(0, 5)
  const overdue = tasksToday.filter((k) => taskView(k, now) === 'over').length

  // Trends
  const days = Array.from({ length: 7 }, (_, i) => startOfDay(addDays(now, i - 6)))
  const fluid = days.map((d) => intake.filter((x) => x.kind === 'drink' && startOfDay(x.at).getTime() === d.getTime()).reduce((s, x) => s + (x.amountMl ?? 0), 0))
  const mealDays = days.map((d) => {
    const m = intake.filter((x) => x.kind === 'meal' && x.portion != null && startOfDay(x.at).getTime() === d.getTime())
    return m.length ? m.reduce((s, x) => s + (x.portion ?? 0), 0) / m.length : null
  })
  const series = (k: 'sys' | 'pulse' | 'pain' | 'glucose' | 'temp') => vitals30.filter((v) => v[k] != null).map((v) => v[k] as number)
  const lastOf = (k: 'sys' | 'pain' | 'glucose') => [...vitals30].reverse().find((v) => v[k] != null)
  const bpLast = lastOf('sys')
  const painLast = lastOf('pain')
  const bgLast = lastOf('glucose')
  const wLast = weights[weights.length - 1]
  const w30 = weights.filter((w) => w.at <= addDays(now, -25)).pop()
  const wDelta = wLast?.weight != null && w30?.weight != null ? wLast.weight - w30.weight : null
  const showGlucose = series('glucose').length > 0
  const fluidToday = fluid[6]
  const nutrition = await db.nutritionProfile.findUnique({ where: { residentId: r.id }, select: { fluidTargetMl: true } })

  const aiOn = aiConfigured() && can('ai.use')
  const flagText = t('residents.overview.abnormal')

  return (
    <>
      <div className="row-between">
        <h2 className="sec">{t('residents.overview.title')}</h2>
        {aiOn && <AiSummary residentId={r.id} />}
      </div>

      <div className="grid-2">
        <section className="card" aria-labelledby="ov-state">
          <div className="card-head"><h2 id="ov-state">{t('residents.overview.current')}</h2></div>
          <div className="card-body stack-sm">
            {/* Risiken, Allergien, Mobilität, Kostform und kurze Hinweise stehen bereits im Kopfbereich (keine Doppelanzeige) */}
            <dl className="kv">
              {r.importantNotes && r.importantNotes.length > 160 && <><dt>{t('residents.overview.notes')}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{r.importantNotes}</dd></>}
              {r.careLevel != null && <><dt>{t('residents.banner.careLevel')}</dt><dd className="mono">{r.careLevel}</dd></>}
              <dt>{t('residents.banner.born')}</dt><dd className="mono">{fmtDbDate(r.birthDate, locale)}</dd>
              <dt>{t('residents.banner.physician')}</dt><dd>{r.physician || <span className="muted">–</span>}</dd>
              <dt>{t('residents.banner.primaryNurse')}</dt><dd>{nurse ? `${nurse.firstName.charAt(0)}. ${nurse.lastName}${nurse.jobTitle ? ', ' + nurse.jobTitle : ''}` : <span className="muted">–</span>}</dd>
            </dl>
            {needs.length > 0 && (
              <>
                <span className="lbl" style={{ marginTop: 6 }}>{t('residents.overview.needs')}</span>
                <ul className="list">
                  {needs.map((a) => (
                    <li key={a.id} className="li" style={{ padding: '6px 0' }}>
                      <span className="tag" style={{ flex: 'none' }}>{domainName.get(a.domain) ?? a.domain}</span>
                      <span className="grow small fg2">{a.needs || a.risks}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {importantObs.length > 0 && (
              <>
                <span className="lbl" style={{ marginTop: 6 }}>{t('residents.overview.important')}</span>
                <ul className="list">
                  {importantObs.map((o) => (
                    <li key={o.id} className="li" style={{ padding: '6px 0' }}>
                      <time className="small muted mono nowrap">{rel(o.at)}</time>
                      <span className="grow small">{o.text}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>

        <section className="card" aria-labelledby="ov-chg">
          <div className="card-head">
            <h2 id="ov-chg">{t('residents.overview.recent')}</h2>
            <Link className="linkbtn small" href={`/residents/${r.id}/timeline`}>{t('residents.tabs.timeline')} →</Link>
          </div>
          {changes.length ? (
            <ul className="list">
              {changes.slice(0, 8).map((c) => (
                <li key={c.key}>
                  <Link className="li" href={c.href} style={{ flexWrap: 'wrap', rowGap: 4 }}>
                    <time className="small muted mono nowrap" style={{ minWidth: 86 }}>{rel(c.at)}</time>
                    <span className={'tag ' + c.tone} style={{ flex: 'none' }}>{c.tag}</span>
                    <span className="grow small fg2" style={{ flexBasis: 180, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{c.text}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <div className="card-body small muted">{t('residents.overview.noRecent')}</div>}
        </section>
      </div>

      <VisitCard ctx={ctx} r={r} canWrite={can('resident.chart.write')} />

      <div className="grid-2">
        <section className="card" aria-labelledby="ov-up">
          <div className="card-head"><h2 id="ov-up">{t('residents.overview.upcoming')}</h2></div>
          {upcoming.length ? (
            <ul className="list">
              {upcoming.slice(0, 8).map((u) => (
                <li key={u.key}>
                  <Link className="li" href={u.href}>
                    <time className={'small mono nowrap ' + (u.over ? 'crit-text' : 'muted')} style={{ minWidth: 86 }}>{fmtDayMonth(u.at)}{u.at.getHours() || u.at.getMinutes() ? ' ' + hm(u.at) : ''}</time>
                    <span className={'tag ' + u.tone} style={{ flex: 'none' }}>{u.tag}</span>
                    <span className="grow small">{u.text}{u.over && <span className="crit-text"> · {t('residents.overview.overdue')}</span>}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <div className="card-body small muted">{t('residents.overview.noUpcoming')}</div>}
          <div className="card-foot stack-sm">
            <div className="row-between">
              <span className="lbl">{t('residents.overview.nextTasks')}</span>
              <Link className="linkbtn small" href={`/residents/${r.id}/day`}>{t('residents.tabs.day')} →</Link>
            </div>
            {nextTasks.length ? (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {nextTasks.map((k) => {
                  const v = taskView(k, now)
                  return <li key={k.id} className="small row" style={{ gap: 8, flexWrap: 'nowrap' }}><span className={'mono ' + (v === 'over' ? 'crit-text' : v === 'due' ? 'warn-text' : 'muted')}>{hm(k.dueAt)}</span><span className="ellipsis">{taskTitle(t, k)}</span>{v === 'over' && <span className="crit-text nowrap">{t('residents.list.overdue')}</span>}</li>
                })}
              </ul>
            ) : <span className="small muted">{t('residents.overview.noTasks')}</span>}
            {overdue > 5 && <span className="small crit-text">{t('residents.overview.moreOverdue', { n: overdue })}</span>}
          </div>
        </section>

        <section className="card" aria-labelledby="ov-tr">
          <div className="card-head"><h2 id="ov-tr">{t('residents.overview.trends')}</h2><Link className="linkbtn small" href={`/residents/${r.id}/vitals`}>{t('residents.tabs.vitals')} →</Link></div>
          <div className="trend-grid">
            <Trend flagText={flagText} label={`${t('common.vitals.bp')} · 30 ${t('residents.overview.days')}`} value={bpLast ? `${bpLast.sys}/${bpLast.dia}` : '–'} unit="mmHg" values={series('sys')} alarm={!!bpLast && abnormalKeys({ sys: bpLast.sys, dia: bpLast.dia }, limits).length > 0} />
            <Trend flagText={flagText} label={`${t('common.vitals.weight')} · 180 ${t('residents.overview.days')}`} value={wLast?.weight != null ? fmtNum(wLast.weight, 1, locale) : '–'} unit="kg" values={weights.map((w) => w.weight)} sub={wDelta != null ? `${wDelta > 0 ? '+' : ''}${fmtNum(wDelta, 1, locale)} kg / 30 ${t('residents.overview.days')}` : undefined} alarm={wDelta != null && Math.abs(wDelta) >= 2} />
            <Trend flagText={flagText} label={`${t('common.vitals.pain')} · 30 ${t('residents.overview.days')}`} value={painLast?.pain != null ? String(painLast.pain) : '–'} unit="NRS" values={series('pain')} alarm={painLast?.pain != null && painLast.pain > limits.pain.hi} />
            {showGlucose && <Trend flagText={flagText} label={`${t('common.vitals.glucose')} · 30 ${t('residents.overview.days')}`} value={bgLast?.glucose != null ? fmtNum(bgLast.glucose, 1, locale) : '–'} unit="mmol/l" values={series('glucose')} alarm={bgLast?.glucose != null && (bgLast.glucose < limits.glucose.lo || bgLast.glucose > limits.glucose.hi)} />}
            <Trend flagText={flagText} label={`${t('residents.overview.fluid')} · 7 ${t('residents.overview.days')}`} value={String(fluidToday)} unit={nutrition?.fluidTargetMl ? `/ ${nutrition.fluidTargetMl} ml` : 'ml'} values={fluid} sub={t('residents.overview.today')} />
            {mealDays.some((m) => m != null) && <Trend flagText={flagText} label={`${t('residents.overview.meals')} · 7 ${t('residents.overview.days')}`} value={(() => { const v = mealDays.filter((m): m is number => m != null); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) + '' : '–' })()} unit="%" values={mealDays} sub={t('residents.overview.avgPortion')} />}
            <Trend flagText={flagText} label={`${t('residents.overview.falls')} · 90 ${t('residents.overview.days')}`} value={String(falls90)} unit="" alarm={falls90 > 0} sub={falls90 ? t('residents.overview.fallsHint') : t('residents.overview.noFalls')} />
          </div>
        </section>
      </div>
    </>
  )
}

function Trend({ label, value, unit, values, sub, alarm, flagText }: { label: string; value: string; unit: string; values?: (number | null)[]; sub?: string; alarm?: boolean; flagText: string }) {
  return (
    <div className="trend">
      <span className="lbl">{label}</span>
      <span className={'val mono' + (alarm ? ' crit-text' : '')}>{value} <small className="muted">{unit}</small>{alarm && <span className="tag crit" style={{ marginLeft: 6, verticalAlign: 2 }}>{flagText}</span>}</span>
      {values ? <Spark values={values} label={label} /> : <span style={{ height: 28 }} />}
      {sub && <span className="small muted">{sub}</span>}
    </div>
  )
}
