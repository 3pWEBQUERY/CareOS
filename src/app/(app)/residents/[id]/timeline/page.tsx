import Link from 'next/link'
import { db } from '@/lib/db'
import { taskTitle } from '@/lib/task-title'
import { OPEN_STATUSES, taskView } from '@/lib/tasks'
import { lastShiftEnd } from '@/lib/shift'
import { addDays, fmtDate, fmtNum, fmtRel, hm, sameDay, startOfDay } from '@/lib/time'
import { flag, mergeLimits, VITALS, type VitalKey } from '@/lib/vitals'
import { OBS_TONE, pageResident, userNames } from '../../_lib/resident'

const KINDS = ['observation', 'vitals', 'medication', 'task', 'assessment', 'wound', 'intake', 'incident', 'appointment'] as const
type Kind = (typeof KINDS)[number]
const RANGES = { '24h': 1, '7d': 7, '30d': 30 } as const
type Range = keyof typeof RANGES
const DOT: Record<Kind, string> = { observation: 'accent', vitals: '', medication: 'violet', task: 'ok', assessment: 'accent', wound: 'warn', intake: '', incident: 'crit', appointment: 'violet' }

type Ev = { id: string; at: Date; kind: Kind; tone: string; dot: string; tag: string; title: React.ReactNode; text?: string | null; by?: string | null; strike?: boolean }

export default async function TimelinePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ k?: string; range?: string }> }) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, r, can } = await pageResident(id)
  const { t, locale } = ctx
  const range: Range = sp.range && sp.range in RANGES ? (sp.range as Range) : '7d'
  const kind: Kind | null = sp.k && (KINDS as readonly string[]).includes(sp.k) ? (sp.k as Kind) : null
  const now = new Date()
  const from = range === '24h' ? addDays(now, -1) : startOfDay(addDays(now, -(RANGES[range] - 1)))
  const to = addDays(startOfDay(now), 1)
  const want = (k: Kind) => !kind || kind === k
  const canMeds = can('resident.medication.read')
  const at = { gte: from, lt: to }

  const [obs, vitals, admins, tasks, assessments, defs, woundEntries, intake, incidents, appts, limitRows] = await Promise.all([
    want('observation') ? db.observation.findMany({ where: { residentId: r.id, at }, include: { correctedBy: { select: { id: true } } } }) : [],
    want('vitals') ? db.vitalSign.findMany({ where: { residentId: r.id, at } }) : [],
    want('medication') && canMeds ? db.medicationAdministration.findMany({ where: { residentId: r.id, at }, include: { medication: { select: { name: true, kind: true } } } }) : [],
    want('task') ? db.task.findMany({ where: { residentId: r.id, completedAt: at, status: { in: ['done', 'partial', 'skipped'] }, source: { not: 'medication' } } }) : [],
    want('assessment') ? db.assessment.findMany({ where: { residentId: r.id, at } }) : [],
    want('assessment') ? db.assessmentDefinition.findMany({ where: { orgId: ctx.org.id }, select: { key: true, name: true } }) : [],
    want('wound') ? db.woundAssessment.findMany({ where: { at, wound: { residentId: r.id } }, include: { wound: { select: { bodySite: true, kind: true } } } }) : [],
    want('intake') ? db.intakeLog.findMany({ where: { residentId: r.id, at } }) : [],
    want('incident') ? db.incident.findMany({ where: { residentId: r.id, orgId: ctx.org.id, occurredAt: at }, include: { type: { select: { name: true } } } }) : [],
    want('appointment') ? db.appointment.findMany({ where: { residentId: r.id, at } }) : [],
    db.vitalThreshold.findMany({ where: { orgId: ctx.org.id, OR: [{ residentId: null }, { residentId: r.id }] } }),
  ])
  // PRD §71: Ereignis, Kontrollen, offene Beobachtungen und nächste Aufgaben auf einer Timeline.
  const [openToday, last] = await Promise.all([
    can('task.read') && (!kind || kind === 'task')
      ? db.task.findMany({ where: { residentId: r.id, status: { in: [...OPEN_STATUSES] }, dueAt: { gte: startOfDay(now), lt: addDays(startOfDay(now), 1) } }, orderBy: { dueAt: 'asc' } })
      : [],
    lastShiftEnd(ctx.user.id, ctx.sessionId, now),
  ])
  const limits = mergeLimits(limitRows, r.id)
  const names = await userNames(ctx, [
    ...obs.map((o) => o.authorId), ...vitals.map((v) => v.recordedById), ...admins.map((a) => a.byId), ...tasks.map((k) => k.completedById),
    ...assessments.map((a) => a.authorId), ...woundEntries.map((w) => w.authorId), ...intake.map((i) => i.authorId), ...incidents.map((i) => i.reportedById),
  ])
  const by = (uid: string | null | undefined) => (uid ? names.get(uid)?.short ?? null : null)
  const defName = new Map(defs.map((d) => [d.key, d.name]))
  const f = (k: VitalKey, v: number | null | undefined) => fmtNum(v, VITALS[k].dec, locale)

  const events: Ev[] = []
  for (const o of obs) {
    events.push({
      id: 'o' + o.id, at: o.at, kind: 'observation', tone: OBS_TONE[o.category] ?? '', dot: o.category === 'incident' ? 'crit' : o.important ? 'warn' : 'accent',
      tag: t('chart.cat.' + o.category), title: null, text: o.text, by: by(o.authorId), strike: o.correctedBy.length > 0,
    })
  }
  for (const v of vitals) {
    const parts: React.ReactNode[] = []
    let abn = false
    const add = (key: string, label: string, value: string, unit: string, fl: string) => {
      if (fl) abn = true
      parts.push(<span key={key} className={fl ? 'crit-text' : undefined}>{label} <span className="mono">{value}</span> {unit}{fl === 'hi' ? ' ▲' : fl === 'lo' ? ' ▼' : ''}</span>)
    }
    if (v.sys != null) add('bp', t('chart.vitals.bpShort'), `${f('sys', v.sys)}/${f('dia', v.dia)}`, 'mmHg', flag('sys', v.sys, limits) || flag('dia', v.dia, limits))
    for (const k of ['pulse', 'temp', 'spo2', 'glucose', 'respRate', 'pain', 'weight'] as VitalKey[]) {
      if (v[k] == null) continue
      add(k, t('common.vitals.' + k), f(k, v[k]), VITALS[k].unit, k === 'weight' ? '' : flag(k, v[k], limits))
    }
    events.push({
      id: 'v' + v.id, at: v.at, kind: 'vitals', tone: abn ? 'crit' : '', dot: abn ? 'crit' : '', tag: t('chart.timeline.kinds.vitals'),
      title: <span className="row" style={{ gap: '2px 14px' }}>{parts}</span>, text: v.note, by: by(v.recordedById),
    })
  }
  for (const a of admins) {
    const prn = a.medication.kind === 'prn'
    const bad = a.status !== 'given'
    events.push({
      id: 'm' + a.id, at: a.at, kind: 'medication', tone: bad ? 'warn' : 'violet', dot: bad ? 'warn' : 'violet',
      tag: prn ? t('chart.timeline.prn') : t('chart.timeline.kinds.medication'),
      title: <>{a.medication.name}{a.dose ? <span className="mono"> {a.dose}</span> : null} · {t('chart.timeline.admin.' + a.status)}{a.scheduledFor ? <span className="muted"> ({t('chart.timeline.planned', { time: hm(a.scheduledFor) })})</span> : null}</>,
      text: [a.note, a.effectNote ? t('chart.timeline.effect', { text: a.effectNote }) : null].filter(Boolean).join(' · ') || null,
      by: by(a.byId), strike: !!a.voidedAt,
    })
  }
  for (const k of tasks) {
    events.push({
      id: 't' + k.id, at: k.completedAt!, kind: 'task', tone: k.status === 'done' ? 'ok' : 'warn', dot: k.status === 'done' ? 'ok' : 'warn', tag: t('chart.timeline.kinds.task'),
      title: <>{taskTitle(t, k)} · {t('chart.day.statusText.' + k.status)}</>, text: k.note, by: by(k.completedById),
    })
  }
  for (const a of assessments) {
    events.push({
      id: 'a' + a.id, at: a.at, kind: 'assessment', tone: 'accent', dot: 'accent', tag: t('chart.timeline.kinds.assessment'),
      title: <>{defName.get(a.key) ?? a.key}{a.score != null ? <> · <span className="mono">{fmtNum(a.score, Number.isInteger(a.score) ? 0 : 1, locale)}</span></> : null}{a.result ? ' · ' + a.result : ''}</>,
      by: by(a.authorId),
    })
  }
  for (const w of woundEntries) {
    const size = w.lengthMm != null && w.widthMm != null ? `${fmtNum(w.lengthMm, 0, locale)} × ${fmtNum(w.widthMm, 0, locale)} mm` : null
    events.push({
      id: 'w' + w.id, at: w.at, kind: 'wound', tone: 'warn', dot: 'warn', tag: t('chart.timeline.kinds.wound'),
      title: <>{w.wound.bodySite} · {w.wound.kind}{size ? <> · <span className="mono">{size}</span></> : null}</>,
      text: [w.description, w.treatment].filter(Boolean).join(' · ') || null, by: by(w.authorId),
    })
  }
  for (const i of intake) {
    events.push({
      id: 'i' + i.id, at: i.at, kind: 'intake', tone: '', dot: '', tag: t('chart.timeline.kinds.intake'),
      title: <>{t(i.kind === 'drink' ? 'chart.timeline.drink' : 'chart.timeline.meal')}{i.item ? ': ' + i.item : ''}{i.amountMl != null ? <> · <span className="mono">{i.amountMl} ml</span></> : null}{i.portion != null ? <> · <span className="mono">{Math.round(i.portion * 100)} %</span></> : null}</>,
      by: by(i.authorId),
    })
  }
  for (const i of incidents) {
    events.push({
      id: 'x' + i.id, at: i.occurredAt, kind: 'incident', tone: 'crit', dot: 'crit', tag: t('chart.timeline.kinds.incident'),
      title: can('quality.report') ? <Link href={`/quality/${i.id}`}>{i.type.name}</Link> : i.type.name, text: i.description, by: by(i.reportedById),
    })
  }
  for (const a of appts) {
    events.push({
      id: 'p' + a.id, at: a.at, kind: 'appointment', tone: 'violet', dot: 'violet', tag: t('chart.timeline.kinds.appointment'),
      title: <>{a.title}{a.place ? ' · ' + a.place : ''}{a.done ? ' · ' + t('residents.appointments.doneTag') : a.at > now ? ' · ' + t('chart.timeline.upcoming') : ''}</>, text: a.notes,
    })
  }
  events.sort((a, b) => b.at.getTime() - a.at.getTime())

  // Nach Tag gruppieren
  const days: { key: string; label: string; items: Ev[] }[] = []
  for (const e of events) {
    const key = startOfDay(e.at).toISOString()
    let d = days.find((x) => x.key === key)
    if (!d) {
      const label = sameDay(e.at, now) ? t('common.today') : sameDay(e.at, addDays(now, -1)) ? t('common.yesterday') : sameDay(e.at, addDays(now, 1)) ? t('common.tomorrow') : ''
      d = { key, label: [label, fmtDate(e.at, locale, { weekday: 'short', day: '2-digit', month: '2-digit' })].filter(Boolean).join(' · '), items: [] }
      days.push(d)
    }
    d.items.push(e)
  }

  const href = (p: { k?: string | null; range?: string }) => {
    const q = new URLSearchParams()
    const k = p.k === undefined ? kind : p.k
    const rg = p.range ?? range
    if (k) q.set('k', k)
    if (rg !== '7d') q.set('range', rg)
    const s = q.toString()
    return `/residents/${r.id}/timeline${s ? '?' + s : ''}`
  }
  const isNew = (e: Ev) => e.at >= last.at && e.at <= now
  const newCount = events.filter(isNew).length
  const nextOpen = openToday.slice(0, 6)
  const overdueN = openToday.filter((k) => taskView(k, now) === 'over').length
  const visibleKinds = KINDS.filter((k) => k !== 'medication' || canMeds)

  return (
    <>
      <div className="sec-head">
        <h2 className="sec">{t('chart.timeline.title')}</h2>
        <nav className="seg" aria-label={t('chart.timeline.range')}>
          {(Object.keys(RANGES) as Range[]).map((k) => (
            <Link key={k} href={href({ range: k })} aria-current={range === k ? 'page' : undefined} scroll={false}>{t('chart.timeline.ranges.' + k)}</Link>
          ))}
        </nav>
      </div>
      <nav className="chips" aria-label={t('common.filter')}>
        <Link className="chip" href={href({ k: null })} aria-current={!kind ? 'page' : undefined} scroll={false}>{t('common.all')}</Link>
        {visibleKinds.map((k) => (
          <Link key={k} className="chip" href={href({ k })} aria-current={kind === k ? 'page' : undefined} scroll={false}>{t('chart.timeline.kinds.' + k)}</Link>
        ))}
      </nav>
      {(!kind || kind === 'task') && can('task.read') && (
        <section className="card" aria-labelledby="tl-next">
          <div className="card-head">
            <h3 id="tl-next">{t('residents.rec.nextTitle')}{overdueN > 0 && <span className="tag crit" style={{ marginLeft: 8 }}>{t('residents.rec.overdueN', { n: overdueN })}</span>}</h3>
            <Link className="linkbtn small" href={`/residents/${r.id}/day`}>{t('residents.tabs.day')} →</Link>
          </div>
          {nextOpen.length ? (
            <ul className="list">
              {nextOpen.map((k) => {
                const v = taskView(k, now)
                return (
                  <li key={k.id}>
                    <Link className="li" href={k.source === 'medication' ? `/residents/${r.id}/meds` : `/residents/${r.id}/day#task-${k.id}`} style={{ alignItems: 'center', paddingBlock: 7 }}>
                      <time className={'mono small nowrap ' + (v === 'over' ? 'crit-text' : v === 'due' ? 'warn-text' : 'muted')}>{hm(k.dueAt)}</time>
                      <span className="grow">{taskTitle(t, k)}</span>
                      {v === 'over' && <span className="small crit-text nowrap">{t('residents.list.overdue')}</span>}
                      <span className="muted" aria-hidden="true">→</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : <div className="card-body small muted">{t('residents.rec.nextNone')}</div>}
        </section>
      )}
      {newCount > 0 && <p className="small muted" style={{ margin: 0 }}><span className="tag accent">{t('residents.rec.newTag')}</span> {t('residents.rec.newHint', { n: newCount, at: fmtRel(last.at, { today: t('common.today'), yesterday: t('common.yesterday') }, now) })}</p>}
      {events.length ? (
        <ol className="events" aria-label={t('chart.timeline.title')}>
          {days.flatMap((d) => [
            <li key={d.key} className="day-sep">{d.label}</li>,
            ...d.items.map((e) => (
              <li key={e.id} className="event">
                <time className="mono" dateTime={e.at.toISOString()}>{hm(e.at)}</time>
                <span className={'dot ' + e.dot} aria-hidden="true" />
                <div className="body">
                  <div className="row" style={{ gap: 8 }}>
                    {isNew(e) && <span className="tag accent">{t('residents.rec.newTag')}</span>}
                    <span className={'tag ' + e.tone}>{e.tag}</span>
                    {e.title && <span style={{ minWidth: 0, ...(e.strike ? { textDecoration: 'line-through', color: 'var(--fg-3)' } : {}) }}>{e.title}</span>}
                    {e.by && <span className="small muted">{e.by}</span>}
                    {e.strike && <span className="small muted">{t('chart.timeline.corrected')}</span>}
                  </div>
                  {e.text && <p className={e.strike ? 'muted' : undefined} style={e.strike ? { textDecoration: 'line-through' } : undefined}>{e.text}</p>}
                </div>
              </li>
            )),
          ])}
        </ol>
      ) : (
        <p className="empty">{t('chart.timeline.empty')}</p>
      )}
    </>
  )
}
