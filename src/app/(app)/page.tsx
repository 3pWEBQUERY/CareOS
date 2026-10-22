import { Fragment } from 'react'
import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { ensureTasksForDay, taskView, OPEN_STATUSES } from '@/lib/tasks'
import { lastShiftEnd, myShiftNow, runningShift } from '@/lib/shift'
import { addDays, dbDate, fmtDayMonth, fmtNum, fmtRel, fromDbDate, hm, startOfDay } from '@/lib/time'
import { abnormalKeys, mergeLimits, VITALS } from '@/lib/vitals'
import { taskTitle } from '@/lib/task-title'
import { ShiftSnapshot } from '@/components/offline/ShiftSnapshot'
import { observationsToAck } from '@/lib/acks-server'
import { userNames } from './residents/_lib/resident'
import { AutoRefresh } from './_home/AutoRefresh'

export async function generateMetadata() {
  return { title: (await getCtx()).t('nav.home') }
}

export default async function HomePage() {
  const ctx = await getCtx()
  const { t, user, unit, locale } = ctx
  const now = new Date()
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now)
  const h = now.getHours()
  const greet = t(h < 5 || h >= 22 ? 'home.night' : h < 11 ? 'home.morning' : h < 18 ? 'home.day' : 'home.evening', { name: user.firstName })

  const mine = await myShiftNow(user.id, ctx.org.id, now)
  const station = await runningShift(ctx.org.id, now)
  const window = mine ? mine.bounds : station ? { start: station.from, end: station.to } : { start: startOfDay(now), end: addDays(startOfDay(now), 1) }
  const shiftLabel = mine ? `${mine.running ? '' : t('home.laterToday') + ': '}${mine.shiftType.name} · ${mine.shiftType.start}–${mine.shiftType.end}` : station ? `${t('home.stationShift')}: ${station.name} · ${station.start}–${station.end}` : null

  const canClinical = unit && ctx.canHere('resident.read')
  if (unit && ctx.canHere('task.read')) {
    await ensureTasksForDay(unit.id, window.start)
    if (window.end.getDate() !== window.start.getDate()) await ensureTasksForDay(unit.id, window.end)
  }
  const last = await lastShiftEnd(user.id, ctx.sessionId, now)

  const residents = canClinical
    ? await db.resident.findMany({ where: { unitId: unit!.id, status: 'active' }, include: { room: true }, orderBy: [{ room: { number: 'asc' } }, { lastName: 'asc' }] })
    : []
  const rIds = residents.map((r) => r.id)
  const rById = new Map(residents.map((r) => [r.id, r]))

  const [tasks, newNotes, vitals, limits, medChanges, incidents, refused, handover, posts, docs, enrollments, nextShifts, openShifts] = await Promise.all([
    unit && ctx.canHere('task.read')
      ? db.task.findMany({ where: { unitId: unit.id, dueAt: { gte: window.start, lt: window.end } }, orderBy: { dueAt: 'asc' } })
      : [],
    canClinical
      ? db.observation.findMany({ where: { residentId: { in: rIds }, at: { gte: last.at }, authorId: { not: user.id }, correctedBy: { none: {} } }, orderBy: { at: 'desc' } })
      : [],
    canClinical ? db.vitalSign.findMany({ where: { residentId: { in: rIds }, at: { gte: addDays(now, -1) } }, orderBy: { at: 'desc' } }) : [],
    db.vitalThreshold.findMany({ where: { orgId: ctx.org.id } }),
    canClinical
      ? db.medication.findMany({ where: { residentId: { in: rIds }, OR: [{ createdAt: { gte: last.at } }, { stoppedAt: { gte: last.at } }] } })
      : [],
    canClinical
      ? db.incident.findMany({ where: { unitId: unit!.id, occurredAt: { gte: addDays(now, -1) } }, include: { type: true }, orderBy: { occurredAt: 'desc' } })
      : [],
    canClinical
      ? db.medicationAdministration.findMany({ where: { residentId: { in: rIds }, status: 'refused', at: { gte: startOfDay(now) }, voidedAt: null }, include: { medication: true } })
      : [],
    unit && ctx.canHere('handover.read')
      ? db.handover.findFirst({ where: { unitId: unit.id, submittedAt: { not: null }, date: { gte: dbDate(addDays(now, -1)) } }, orderBy: { submittedAt: 'desc' }, include: { entries: true } })
      : null,
    ctx.can('team.read')
      ? db.post.findMany({ where: { requireAck: true, channel: { orgId: ctx.org.id, archived: false, OR: [{ unitId: null }, { unitId: { in: ctx.unitIds } }] }, publishedAt: { gte: addDays(now, -60) } }, orderBy: { publishedAt: 'desc' } })
      : [],
    ctx.can('docs.read') ? db.document.findMany({ where: { orgId: ctx.org.id, status: 'approved', requireAck: true } }) : [],
    ctx.can('learn.read')
      ? db.enrollment.findMany({ where: { userId: user.id, status: { in: ['assigned', 'in_progress', 'expired'] } }, include: { course: true }, orderBy: { dueAt: 'asc' } })
      : [],
    db.shift.findMany({ where: { userId: user.id, date: { gte: dbDate(now), lte: dbDate(addDays(now, 14)) }, status: { not: 'cancelled' } }, include: { shiftType: true }, orderBy: { date: 'asc' }, take: 5 }),
    unit ? db.shift.count({ where: { unitId: unit.id, status: 'open', date: { gte: dbDate(now) } } }) : 0,
  ])

  const acks = await db.acknowledgement.findMany({
    where: { userId: user.id, OR: [{ subjectType: 'post', subjectId: { in: posts.map((p) => p.id) } }, { subjectType: 'document', subjectId: { in: docs.map((d) => d.id) } }, ...(handover ? [{ subjectType: 'handover', subjectId: handover.id }] : [])] },
  })
  const acked = new Set(acks.map((a) => `${a.subjectType}:${a.subjectId}:${a.version}`))
  const postsToAck = posts.filter((p) => !acked.has(`post:${p.id}:`))
  const docsToAck = docs.filter((d) => !acked.has(`document:${d.id}:${d.currentVersion ?? ''}`))
  const handoverOpen = handover && !acked.has(`handover:${handover.id}:`) && handover.authorId !== user.id ? handover : null
  const notesToAck = canClinical ? await observationsToAck(ctx, rIds, now) : []

  // Prioritäten (PRD §7.1): Kritisch = unmittelbarer Handlungsbedarf, Wichtig = zeitkritisch/relevant, Routine = geplant.
  // Pro Person gebündelt, damit dieselbe Person nicht mehrfach untereinander steht. Verlaufseinträge erscheinen nur
  // unter «Seit deinem letzten Dienst» (keine Doppelanzeige).
  type PItem = { key: string; rid: string | null; text: string; href: string }
  const critical: PItem[] = []
  const important: PItem[] = []
  const name = (id: string | null | undefined) => {
    const r = id ? rById.get(id) : null
    return r ? `${r.lastName} ${r.firstName}${r.room ? ' · ' + r.room.number : ''}` : undefined
  }
  const taskHref = (k: (typeof tasks)[number]) =>
    !k.residentId ? '/tasks' : k.source === 'medication' ? `/residents/${k.residentId}/meds` : `/residents/${k.residentId}/day#task-${k.id}`
  const isOpen = (k: (typeof tasks)[number]) => OPEN_STATUSES.includes(k.status as (typeof OPEN_STATUSES)[number])
  for (const k of tasks) {
    if (!isOpen(k)) continue
    const v = taskView(k, now)
    if (v === 'over') critical.push({ key: 'task' + k.id, rid: k.residentId, text: t('home.overdueTask', { title: taskTitle(t, k), time: hm(k.dueAt) }), href: taskHref(k) })
    else if (v === 'due' && (k.priority === 'critical' || k.priority === 'important')) important.push({ key: 'task' + k.id, rid: k.residentId, text: t('home.dueSoon', { title: taskTitle(t, k), time: hm(k.dueAt) }), href: taskHref(k) })
  }
  const latest = new Map<string, (typeof vitals)[number]>()
  for (const v of vitals) if (!latest.has(v.residentId)) latest.set(v.residentId, v)
  for (const [rid, v] of latest) {
    const ab = abnormalKeys(v, mergeLimits(limits, rid))
    if (ab.length)
      critical.push({
        key: 'vit' + rid, rid,
        text: ab.map((k) => t('home.abnormalVital', { label: t('common.vitals.' + k), value: fmtNum(v[k] as number, VITALS[k].dec, locale) + ' ' + VITALS[k].unit })).join(' · ') + ' · ' + hm(v.at),
        href: `/residents/${rid}/vitals`,
      })
  }
  for (const i of incidents) (i.severity === 'severe' || i.severity === 'moderate' || i.stage === 'reported' ? critical : important).push({ key: 'inc' + i.id, rid: i.residentId, text: t('home.incidentToday', { type: i.type.name }) + ' · ' + rel(i.occurredAt), href: `/quality/${i.id}` })
  for (const a of refused) important.push({ key: 'ref' + a.id, rid: a.residentId, text: t('home.refused', { drug: a.medication.name, time: hm(a.scheduledFor ?? a.at) }), href: `/residents/${a.residentId}/meds` })
  for (const e of handoverOpen?.entries.filter((e) => e.important) ?? []) important.push({ key: 'ho' + e.id, rid: e.residentId, text: e.watch ?? e.open ?? '', href: '/handover' })

  // Veränderungen seit letztem Dienst, pro Person gruppiert. «Relevant» = Ereignis, wichtiger Eintrag, Beobachtung,
  // ärztliche Information, auffälliger Vitalwert, Medikationsänderung, Verweigerung. Routineeinträge zählen nicht als Veränderung.
  const authors = await userNames(ctx, newNotes.map((n) => n.authorId))
  type Change = { key: string; at: Date; kind: string; text: string; rel: number; important?: boolean; by?: string; href: string }
  const changes = new Map<string, Change[]>()
  const push = (rid: string, c: Change) => changes.set(rid, [...(changes.get(rid) ?? []), c])
  for (const n of newNotes) {
    const incident = n.category === 'incident'
    const rel = incident ? 5 : n.important ? 4 : n.category === 'observation' || n.category === 'physician' ? 2 : 0
    push(n.residentId, { key: 'o' + n.id, at: n.at, kind: incident ? 'incident' : 'observation', text: n.text, rel, important: n.important, by: authors.get(n.authorId)?.short, href: `/residents/${n.residentId}/notes` })
  }
  for (const m of medChanges) push(m.residentId, { key: 'm' + m.id, at: m.stoppedAt ?? m.createdAt, kind: 'medication', text: m.stoppedAt ? t('home.medStopped', { name: m.name }) : t('home.medStarted', { name: m.name }), rel: 3, href: `/residents/${m.residentId}/meds` })
  for (const a of refused.filter((a) => a.at >= last.at)) push(a.residentId, { key: 'a' + a.id, at: a.at, kind: 'medication', text: t('home.refused', { drug: a.medication.name, time: hm(a.scheduledFor ?? a.at) }), rel: 3, href: `/residents/${a.residentId}/meds` })
  for (const v of vitals.filter((v) => v.at >= last.at)) {
    const ab = abnormalKeys(v, mergeLimits(limits, v.residentId))
    if (ab.length) push(v.residentId, { key: 'v' + v.id, at: v.at, kind: 'vitals', text: ab.map((k) => `${t('common.vitals.' + k)} ${fmtNum(v[k] as number, VITALS[k].dec, locale)} ${VITALS[k].unit}`).join(', '), rel: 4, href: `/residents/${v.residentId}/vitals` })
  }
  const changeList = [...changes.entries()]
    .map(([rid, list]) => {
      const sorted = list.sort((a, b) => b.at.getTime() - a.at.getTime())
      const relevant = sorted.filter((c) => c.rel > 0)
      const head = [...relevant].sort((a, b) => b.rel - a.rel || b.at.getTime() - a.at.getTime())[0]
      return { rid, list: sorted, relevant, head, maxRel: head?.rel ?? 0 }
    })
    .sort((a, b) => b.maxRel - a.maxRel || b.list[0].at.getTime() - a.list[0].at.getTime())
  const relevantChanges = changeList.filter((c) => c.relevant.length)
  const routineChanges = changeList.filter((c) => !c.relevant.length)
  const relevantCount = relevantChanges.reduce((s, c) => s + c.relevant.length, 0)

  // Timeline: Aufgaben nach Zeit und Titel zusammengefasst; jede Zeile führt zu den offenen Aufgaben dieser Zeit.
  type Group = { time: string; due: Date; title: string; category: string; total: number; open: number; over: boolean; med: boolean; who: { rid: string; label: string; href: string }[] }
  const groups = new Map<string, Group>()
  for (const k of tasks) {
    const title = taskTitle(t, k)
    const key = hm(k.dueAt) + '|' + title
    const g = groups.get(key) ?? { time: hm(k.dueAt), due: k.dueAt, title, category: k.category, total: 0, open: 0, over: false, med: k.source === 'medication', who: [] }
    g.total++
    if (isOpen(k)) {
      g.open++
      if (taskView(k, now) === 'over') g.over = true
      const r = k.residentId ? rById.get(k.residentId) : null
      if (r) g.who.push({ rid: r.id, label: `${r.room?.number ? r.room.number + ' ' : ''}${r.lastName}`, href: taskHref(k) })
    }
    groups.set(key, g)
  }
  const timeline = [...groups.values()].sort((a, b) => a.due.getTime() - b.due.getTime())
  // Bereits vollständig erledigte Zeitpunkte vor «Jetzt» werden zu einer aufklappbaren Zeile zusammengefasst.
  let doneLead = 0
  while (doneLead < timeline.length && timeline[doneLead].open === 0 && timeline[doneLead].due <= now) doneLead++
  const openTasks = tasks.filter(isOpen).length
  const overdueCount = tasks.filter((k) => isOpen(k) && taskView(k, now) === 'over').length
  const nextGroup = timeline.find((g) => g.open > 0 && g.due > now) ?? timeline.find((g) => g.open > 0)
  const canRound = !!unit && ctx.canHere('resident.medication.administer')

  const trainingsOpen = enrollments.filter((e) => e.course.mandatory || e.dueAt)
  let nowPlaced = false
  const nowLabel = t('common.now') + ' ' + hm(now)
  const residentWord = t('home.residentCount', { n: residents.length })

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <ShiftSnapshot />
      <AutoRefresh />
      <div className="view-head">
        <div>
          <span className="lbl">{unit ? unit.location.name : ctx.org.name}</span>
          <h1>{greet}</h1>
          <p className="sub">{[shiftLabel ?? t('home.noShift'), unit?.name].filter(Boolean).join(' · ')}</p>
          {canClinical && (
            <p className="home-summary">
              {residentWord} · <a href="#changes">{t('home.changesSince', { n: relevantCount })}</a>
            </p>
          )}
        </div>
        {unit && ctx.canHere('handover.read') && (
          <Link className="btn home-ho-btn" href="/handover">{t('nav.handover')}</Link>
        )}
      </div>
      <div className="scroll">
        <div className="tabpanel">
          <div className="metrics res-metrics" aria-label={t('home.myShift')}>
            <Link className="metric" href="/tasks"><span className="lbl">{t('home.plannedTasks')}</span><span className="val">{openTasks} <small>{t('home.openOfTotal', { total: tasks.length })}</small></span><div className="bar"><i style={{ width: `${tasks.length ? Math.round(((tasks.length - openTasks) / tasks.length) * 100) : 0}%` }} /></div></Link>
            <Link className="metric" href="/tasks?f=over"><span className="lbl">{t('home.overdue')}</span><span className={'val' + (overdueCount ? ' crit' : '')}>{overdueCount}</span></Link>
            <Link className="metric" href="/handover"><span className="lbl">{t('home.openHandover')}</span><span className={'val' + (handoverOpen ? ' warn' : '')}>{handoverOpen ? 1 : 0}</span></Link>
          </div>

          <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' }}>
            <div className="stack">
              <section className="stack-sm" aria-labelledby="prio">
                <div className="sec-head"><h2 className="sec" id="prio">{t('home.priorities')}</h2></div>
                <PriorityBlock title={t('home.critical')} tone="crit" items={critical} name={name} empty={t('home.criticalNone')} />
                <PriorityBlock title={t('home.important')} tone="warn" items={important} name={name} empty={t('home.importantNone')} />
                <Link className="card home-routine" href="/tasks">
                  <span className="tag">{t('home.routine')}</span>
                  <span className="grow fg2">
                    {nextGroup
                      ? t('home.routineNext', { open: openTasks, time: nextGroup.time, title: nextGroup.title })
                      : t(tasks.length ? 'home.routineAllDone' : 'home.timelineEmpty')}
                  </span>
                  <span className="linkbtn small nowrap">{t('nav.tasks')} →</span>
                </Link>
              </section>

              <section className="stack-sm" id="changes" aria-labelledby="chg">
                <div className="sec-head">
                  <h2 className="sec" id="chg">{t('home.sinceLast')}</h2>
                  <span className="small muted">{t(last.source === 'shift' ? 'home.sinceLastHint' : 'home.sinceLastHintSession', { at: rel(last.at) })}</span>
                </div>
                {changeList.length ? (
                  <ul className="list card home-chg">
                    {relevantChanges.map((c) => <ChangeRow key={c.rid} c={c} r={rById.get(c.rid)} t={t} rel={rel} />)}
                    {routineChanges.length > 0 && (
                      <li className="home-chg-sep"><span className="lbl">{t('home.onlyRoutine')}</span></li>
                    )}
                    {routineChanges.map((c) => <ChangeRow key={c.rid} c={c} r={rById.get(c.rid)} t={t} rel={rel} />)}
                  </ul>
                ) : (
                  <p className="empty">{t('home.noChanges')}</p>
                )}
              </section>
            </div>

            <div className="stack">
              <section className="stack-sm" aria-labelledby="tl">
                <div className="sec-head"><h2 className="sec" id="tl">{t('home.timeline')}</h2>{unit && <span className="small muted">{t('home.timelineHint', { unit: unit.name })}</span>}</div>
                {timeline.length ? (
                  <ol className="timeline home-tl">
                    {doneLead > 0 && (
                      <li className="tl-done">
                        <details>
                          <summary>
                            <span className="mono">{timeline[0].time}–{timeline[doneLead - 1].time}</span>
                            <span className="grow">{t('home.doneLead', { n: doneLead })}</span>
                            <span className="tag ok">✓ {t('home.allDone')}</span>
                          </summary>
                          <ol className="timeline">
                            {timeline.slice(0, doneLead).map((g) => <TimelineGroup key={g.time + g.title} g={g} state="done" t={t} canRound={false} />)}
                          </ol>
                        </details>
                      </li>
                    )}
                    {timeline.slice(doneLead).map((g) => {
                      const before = !nowPlaced && g.due > now
                      if (before) nowPlaced = true
                      const state = g.open === 0 ? 'done' : g.over ? 'over' : (g.due.getTime() - now.getTime()) / 60000 <= 30 ? 'due' : 'up'
                      return (
                        <Fragment key={g.time + g.title}>
                          {before && <li className="now" aria-label={nowLabel}><span>{nowLabel}</span><i /></li>}
                          <TimelineGroup g={g} state={state} t={t} canRound={canRound} />
                        </Fragment>
                      )
                    })}
                    {!nowPlaced && <li className="now" aria-label={nowLabel}><span>{nowLabel}</span><i /></li>}
                  </ol>
                ) : (
                  <p className="empty">{t('home.timelineEmpty')}</p>
                )}
              </section>

              <section className="card" aria-labelledby="foryou">
                <div className="card-head"><h2 id="foryou">{t('home.team')}</h2></div>
                <div className="card-body stack-sm">
                  <span className="lbl">{t('home.toAck')}</span>
                  {postsToAck.length + docsToAck.length + notesToAck.length + (handoverOpen ? 1 : 0) ? (
                    <ul className="list">
                      {handoverOpen && <li><Link className="li" href="/handover"><span className="tag warn">{t('nav.handover')}</span><span className="grow">{handoverOpen.shiftCode} · {fmtDayMonth(fromDbDate(handoverOpen.date))}</span></Link></li>}
                      {postsToAck.map((p) => <li key={p.id}><Link className="li" href={`/team/post/${p.id}`}><span className="tag accent">{t('nav.team')}</span><span className="grow">{p.title}</span></Link></li>)}
                      {notesToAck.map((o) => <li key={o.id}><Link className="li" href={`/residents/${o.residentId}/notes`}><span className="tag crit">{t('residents.tabs.notes')}</span><span className="grow" style={{ minWidth: 0 }}><span style={{ display: 'block' }}>{name(o.residentId)}</span><span className="small muted ellipsis" style={{ display: 'block' }}>{o.text}</span></span><span className="small muted nowrap">{rel(o.at)}</span></Link></li>)}
                      {docsToAck.map((d) => <li key={d.id}><Link className="li" href={`/docs/${d.id}`}><span className="tag violet">{t('nav.docs')}</span><span className="grow">{d.title} <span className="muted mono small">v{d.currentVersion}</span></span></Link></li>)}
                    </ul>
                  ) : <p className="small muted" style={{ margin: 0 }}>{t('home.ackNone')}</p>}

                  <span className="lbl" style={{ marginTop: 6 }}>{t('home.trainings')}</span>
                  {trainingsOpen.length ? (
                    <ul className="list">
                      {trainingsOpen.map((e) => {
                        const over = e.dueAt && e.dueAt < now
                        return (
                          <li key={e.id}><Link className="li" href={`/learn/${e.courseId}`}><span className="grow">{e.course.title}{e.course.mandatory && <span className="tag outline" style={{ marginLeft: 6 }}>{t('learn.mandatory')}</span>}</span>{e.dueAt && <span className={'small nowrap ' + (over ? 'crit-text' : 'muted')}>{t(over ? 'home.overdueSince' : 'home.dueIn', { date: fmtDayMonth(e.dueAt) })}</span>}</Link></li>
                        )
                      })}
                    </ul>
                  ) : <p className="small muted" style={{ margin: 0 }}>{t('home.trainingsNone')}</p>}

                  <span className="lbl" style={{ marginTop: 6 }}>{t('home.nextShifts')}</span>
                  {nextShifts.length ? (
                    <div className="chips">
                      {nextShifts.map((s) => {
                        const d = fromDbDate(s.date)
                        return <Link key={s.id} href="/schedule" className="chip"><span className={'sh ' + s.shiftType.code} style={{ marginRight: 6 }}>{s.shiftType.code}</span>{new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d)} {fmtDayMonth(d)}</Link>
                      })}
                    </div>
                  ) : <p className="small muted" style={{ margin: 0 }}>{t('home.nextShiftsNone')}</p>}
                  {openShifts > 0 && <Link className="linkbtn small" href="/schedule?view=open">{t('home.openShifts', { n: openShifts })}</Link>}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

type T = (key: string, vars?: Record<string, string | number>) => string

function PriorityBlock({ title, tone, items, name, empty }: { title: string; tone: 'crit' | 'warn'; items: { key: string; rid: string | null; text: string; href: string }[]; name: (id: string | null) => string | undefined; empty: string }) {
  // Pro Person bündeln; der Link führt zum ersten (dringendsten) Punkt.
  const grouped: { key: string; who?: string; href: string; lines: string[] }[] = []
  for (const i of items) {
    const g = i.rid ? grouped.find((x) => x.key === i.rid) : null
    if (g) g.lines.push(i.text)
    else grouped.push({ key: i.rid ?? i.key, who: name(i.rid), href: i.href, lines: [i.text] })
  }
  return (
    <div className={'card' + (items.length ? ' ' + tone : '')}>
      <div className="card-head">
        <h3><span className={'tag ' + tone}>{title}</span></h3>
        <span className={'pill ' + (items.length ? tone : '')}>{items.length}</span>
      </div>
      {items.length ? (
        <ul className="list">
          {grouped.slice(0, 8).map((i) => (
            <li key={i.key}>
              <Link className="li" href={i.href}>
                <div className="grow">
                  {i.who && <div>{i.who}</div>}
                  {i.lines.map((l, n) => <div key={n} className={'small ' + (tone === 'crit' ? 'crit-text' : 'warn-text')}>{l}</div>)}
                </div>
                <span className="muted" aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="card-body small muted">{empty}</div>
      )}
    </div>
  )
}

const KIND_TONE: Record<string, string> = { incident: 'crit', vitals: 'warn', medication: 'violet', observation: 'accent' }

function ChangeRow({ c, r, t, rel }: {
  c: { rid: string; list: { key: string; at: Date; kind: string; text: string; rel: number; important?: boolean; by?: string; href: string }[]; relevant: { kind: string }[]; head?: { text: string } }
  r: { lastName: string; firstName: string; room: { number: string } | null } | undefined
  t: T
  rel: (d: Date) => string
}) {
  const kinds = [...new Set(c.relevant.map((x) => x.kind))]
  const routine = c.list.length - c.relevant.length
  return (
    <li>
      <details className="home-chg-item">
        <summary className="li">
          <span className="roomtag">{r?.room?.number ?? '–'}</span>
          <span className="grow">
            <span className="home-chg-name">{r ? `${r.lastName} ${r.firstName}` : '–'}</span>
            {kinds.map((k) => <span key={k} className={'tag ' + KIND_TONE[k]}>{t('home.changeKinds.' + k)}</span>)}
            <span className={'home-chg-head small ' + (c.head ? 'fg2' : 'muted')}>
              {c.head ? c.head.text : t('home.moreEntries', { n: routine })}
            </span>
          </span>
          <time className="small muted mono nowrap">{hm(c.list[0].at)}</time>
        </summary>
        <div className="home-chg-body">
          <ol>
            {c.list.map((x) => (
              <li key={x.key}>
                <time className="small muted mono nowrap">{rel(x.at)}</time>
                <span className={'tag ' + KIND_TONE[x.kind]}>{t('home.changeKinds.' + x.kind)}</span>
                {x.important && <span className="tag crit">{t('chart.notes.importantTag')}</span>}
                <span className="grow small">{x.text}{x.by && <span className="muted"> — {x.by}</span>}</span>
              </li>
            ))}
          </ol>
          <div className="row">
            <Link className="btn sm primary" href={`/residents/${c.rid}/timeline`}>{t('home.openTimeline')}</Link>
            <Link className="btn sm" href={`/residents/${c.rid}/notes`}>{t('residents.tabs.notes')}</Link>
            <Link className="btn sm" href={`/residents/${c.rid}/day`}>{t('residents.tabs.day')}</Link>
          </div>
        </div>
      </details>
    </li>
  )
}

function TimelineGroup({ g, state, t, canRound }: {
  g: { time: string; title: string; category: string; total: number; open: number; med: boolean; who: { rid: string; label: string; href: string }[] }
  state: string; t: T; canRound: boolean
}) {
  const row = (
    <>
      <span className="t mono">{g.time}</span>
      <div style={{ minWidth: 0 }}>
        <div className="ttl">{g.title}</div>
        <div className="sub">
          {t('home.nResidents', { n: g.total })} · {g.open ? t('home.openOf', { open: g.open, total: g.total }) : t('home.allDone')}
          {g.open > 0 && g.open <= 3 && ' · ' + g.who.map((w) => w.label.replace(/^\S+ /, '')).join(', ')}
        </div>
      </div>
      <span className="tag">{g.category}</span>
    </>
  )
  if (!g.open) return <li className={'trow is-' + state}>{row}</li>
  // Genau eine offene Aufgabe: direkt dorthin (ein Klick), sonst aufklappen und Person wählen.
  if (g.who.length === 1 && !(g.med && canRound)) return <li className={'is-' + state}><Link className={'trow tl-link is-' + state} href={g.who[0].href}>{row}</Link></li>
  return (
    <li className={'is-' + state}>
      <details className="tl-group">
        <summary className={'trow is-' + state}>{row}</summary>
        <div className="tl-who">
          {g.med && canRound && <Link className="btn sm primary" href="/tasks/medround">{t('tasks.medround')}</Link>}
          {g.who.map((w, i) => <Link key={w.rid + i} className="chip" href={w.href}>{w.label}</Link>)}
        </div>
      </details>
    </li>
  )
}
