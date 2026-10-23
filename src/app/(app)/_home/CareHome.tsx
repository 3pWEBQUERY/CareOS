import { Fragment } from 'react'
import Link from 'next/link'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { ensureTasksForDay, taskView, OPEN_STATUSES } from '@/lib/tasks'
import { lastShiftEnd, myShiftNow, runningShift } from '@/lib/shift'
import { shiftName } from '@/lib/shift-name'
import { addDays, dateKey, dbDate, fmtDayMonth, fmtNum, fmtRel, fromDbDate, hm, startOfDay } from '@/lib/time'
import { abnormalKeys, LIVE, mergeLimits, VITALS } from '@/lib/vitals'
import { taskTitle } from '@/lib/task-title'
import { isOverdue } from '@/lib/task-backlog'
import { observationsToAck } from '@/lib/acks-server'
import { assignmentBoard, assignmentShift } from '@/lib/assignment'
import { roomRanges } from '@/lib/assignment-plan'
import type { HomeView } from '@/lib/home-view'
import { ShiftSnapshot } from '@/components/offline/ShiftSnapshot'
import { AcceptSuggestion, AssignmentButton, type AssignmentBoardDto } from '@/components/handover/Assignment'
import { userNames } from '../residents/_lib/resident'
import { orderAndPlanChanges } from '../handover/changes'
import { HomeHead } from './Head'
import { ForYou } from './ForYou'
import { PriorityBlock, type PrioGroup } from './Priority'

type T = (key: string, vars?: Record<string, string | number>) => string

/**
 * Pflegeansicht (PRD §7.1): Meine Schicht, Prioritäten, Veränderungen seit dem letzten Dienst, Ablauf der Schicht.
 * Mit Bewohnerzuordnung (§7, §70) zeigt sie standardmässig «Meine» {residents}; «Alle» zeigt den ganzen Bereich.
 */
export async function CareHome({ ctx, now, greet, view, views, scopeParam }: { ctx: Ctx; now: Date; greet: string; view: HomeView; views: HomeView[]; scopeParam?: string }) {
  const { t, user, locale } = ctx
  const unit = ctx.unit!
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now, locale)

  const mine = await myShiftNow(user.id, ctx.org.id, now)
  const station = await runningShift(ctx.org.id, now)
  const window = mine ? mine.bounds : station ? { start: station.from, end: station.to } : { start: startOfDay(now), end: addDays(startOfDay(now), 1) }
  const shiftDef = mine ? mine.shiftType : station
  const shiftLabel = mine ? `${mine.running ? '' : t('home.laterToday') + ': '}${shiftName(t, mine.shiftType)} · ${mine.shiftType.start}–${mine.shiftType.end}` : station ? `${t('home.stationShift')}: ${shiftName(t, station)} · ${station.start}–${station.end}` : null

  const canTasks = ctx.canHere('task.read')
  const canHandover = ctx.canHere('handover.read')
  const canMeds = ctx.canHere('resident.medication.read')
  const canManage = ctx.canHere('task.manage')
  if (canTasks) {
    await ensureTasksForDay(unit.id, window.start)
    if (window.end.getDate() !== window.start.getDate()) await ensureTasksForDay(unit.id, window.end)
  }
  const last = await lastShiftEnd(user.id, ctx.sessionId, now)

  const allResidents = await db.resident.findMany({ where: { unitId: unit.id, status: 'active' }, include: { room: true }, orderBy: [{ room: { number: 'asc' } }, { lastName: 'asc' }] })
  const rIds = allResidents.map((r) => r.id)
  const rById = new Map(allResidents.map((r) => [r.id, r]))

  // Bewohnerzuordnung der massgeblichen Schicht
  const ref = await assignmentShift(ctx, unit.id, now)
  const board = ref ? await assignmentBoard(ctx, unit.id, ref, shiftName(t, ref.def)) : null
  const myIds = board ? board.pairs.filter((p) => p.userId === user.id).map((p) => p.residentId).filter((id) => rById.has(id)) : []
  const scoped = myIds.length > 0 && scopeParam !== 'all'
  const mineSet = new Set(myIds)
  const inScope = (rid: string | null | undefined) => !scoped || !rid || mineSet.has(rid)
  const residents = scoped ? allResidents.filter((r) => mineSet.has(r.id)) : allResidents

  const day = startOfDay(now)
  const [tasks, newNotes, vitals, limits, incidents, refused, handover, orderChanges, appointments, visitsToday, ownHandover] = await Promise.all([
    canTasks ? db.task.findMany({ where: { unitId: unit.id, dueAt: { gte: window.start, lt: window.end } }, orderBy: { dueAt: 'asc' } }) : [],
    db.observation.findMany({ where: { residentId: { in: rIds }, at: { gte: last.at }, authorId: { not: user.id }, correctedBy: { none: {} } }, orderBy: { at: 'desc' } }),
    db.vitalSign.findMany({ where: { residentId: { in: rIds }, at: { gte: addDays(now, -1) }, ...LIVE }, orderBy: { at: 'desc' } }),
    db.vitalThreshold.findMany({ where: { orgId: ctx.org.id } }),
    db.incident.findMany({ where: { unitId: unit.id, occurredAt: { gte: addDays(now, -1) } }, include: { type: true }, orderBy: { occurredAt: 'desc' } }),
    canMeds ? db.medicationAdministration.findMany({ where: { residentId: { in: rIds }, status: 'refused', at: { gte: day }, voidedAt: null }, include: { medication: true } }) : [],
    canHandover ? db.handover.findFirst({ where: { unitId: unit.id, submittedAt: { not: null }, date: { gte: dbDate(addDays(now, -1)) } }, orderBy: { submittedAt: 'desc' }, include: { entries: true } }) : null,
    orderAndPlanChanges(ctx, rIds, last.at, now, { meds: canMeds }),
    db.appointment.findMany({ where: { residentId: { in: rIds }, at: { gte: window.start, lt: window.end } }, orderBy: { at: 'asc' } }),
    db.visit.findMany({ where: { orgId: ctx.org.id, unitId: unit.id, at: { gte: day, lt: addDays(day, 1) } }, select: { residentId: true } }),
    // Übergabe der eigenen Schicht (am Ende abzuschliessen)
    canHandover && shiftDef ? db.handover.findUnique({ where: { unitId_shiftCode_date: { unitId: unit.id, shiftCode: shiftDef.code, date: dbDate(startOfDay(window.start)) } }, select: { submittedAt: true } }) : null,
  ])
  const reviewers = await userNames(ctx, [...newNotes.map((n) => n.authorId), ...vitals.map((v) => v.reviewedById).filter((x): x is string => !!x)])

  const hoAcks = handover ? await db.acknowledgement.findMany({ where: { userId: user.id, subjectType: 'handover', subjectId: handover.id }, select: { version: true } }) : []
  const hoAcked = new Set(hoAcks.map((a) => a.version))
  // Übergabe gilt als übernommen: Gesamtbestätigung oder – mit Zuteilung – alle eigenen {residents}
  const handoverOpen = handover && handover.authorId !== user.id && !hoAcked.has('') && !(myIds.length && myIds.every((id) => hoAcked.has(id))) ? handover : null
  const notesToAck = await observationsToAck(ctx, rIds, now)
  // Direkt zur zu übernehmenden Übergabe (die Übergabeseite zeigt nach 2 Stunden sonst die laufende Schicht)
  const hoHref = handover ? `/handover?s=${encodeURIComponent(handover.shiftCode)}&d=${dateKey(fromDbDate(handover.date))}` : '/handover'

  // Prioritäten (PRD §7.1): pro Person gebündelt; Verlaufseinträge nur unter «Seit deinem letzten Dienst».
  type PItem = { rid: string | null; text: string; href: string; vitalId?: string }
  const critical: PItem[] = []
  const important: PItem[] = []
  const taskHref = (k: (typeof tasks)[number]) =>
    !k.residentId ? '/tasks' : k.source === 'medication' ? `/residents/${k.residentId}/meds` : `/residents/${k.residentId}/day#task-${k.id}`
  const isOpen = (k: (typeof tasks)[number]) => OPEN_STATUSES.includes(k.status as (typeof OPEN_STATUSES)[number])
  for (const k of tasks) {
    if (!isOpen(k)) continue
    const v = taskView(k, now)
    // «überfällig» nach einer Regel für alle Zähler (offen inkl. eskaliert, > 15 Min. nach Fälligkeit)
    if (isOverdue(k, now)) critical.push({ rid: k.residentId, text: t('home.overdueTask', { title: taskTitle(t, k), time: hm(k.dueAt) }), href: taskHref(k) })
    else if (v === 'due' && (k.priority === 'critical' || k.priority === 'important')) important.push({ rid: k.residentId, text: t('home.dueSoon', { title: taskTitle(t, k), time: hm(k.dueAt) }), href: taskHref(k) })
  }
  const vitalText = (v: (typeof vitals)[number], ab: ReturnType<typeof abnormalKeys>) => ab.map((k) => `${t('common.vitals.' + k)} ${fmtNum(v[k] as number, VITALS[k].dec, locale)} ${VITALS[k].unit}`).join(', ')
  const latest = new Map<string, (typeof vitals)[number]>()
  for (const v of vitals) if (!latest.has(v.residentId)) latest.set(v.residentId, v)
  for (const [rid, v] of latest) {
    const ab = abnormalKeys(v, mergeLimits(limits, rid))
    // Gesehen / Massnahme eingeleitet: nicht mehr kritisch (PRD §14 ohne Alarmflut)
    if (ab.length && !v.reviewedAt) critical.push({ rid, vitalId: v.id, text: ab.map((k) => t('home.abnormalVital', { label: t('common.vitals.' + k), value: fmtNum(v[k] as number, VITALS[k].dec, locale) + ' ' + VITALS[k].unit })).join(' · ') + ' · ' + hm(v.at), href: `/residents/${rid}/vitals` })
  }
  for (const i of incidents) (i.severity === 'severe' || i.severity === 'moderate' || i.stage === 'reported' ? critical : important).push({ rid: i.residentId, text: t('home.incidentToday', { type: i.type.name }) + ' · ' + rel(i.occurredAt), href: ctx.can('quality.report') ? `/quality/${i.id}` : i.residentId ? `/residents/${i.residentId}` : '/' })
  for (const a of refused) important.push({ rid: a.residentId, text: t('home.refused', { drug: a.medication.name, time: hm(a.scheduledFor ?? a.at) }), href: `/residents/${a.residentId}/meds` })
  for (const e of handoverOpen?.entries.filter((e) => e.important) ?? []) important.push({ rid: e.residentId, text: e.watch ?? e.open ?? '', href: '/handover' + (handover ? `?s=${encodeURIComponent(handover.shiftCode)}&d=${dateKey(fromDbDate(handover.date))}` : '') })

  const name = (id: string | null | undefined) => {
    const r = id ? rById.get(id) : null
    return r ? `${r.lastName} ${r.firstName}${r.room ? ' · ' + r.room.number : ''}` : undefined
  }
  const group = (items: PItem[]): PrioGroup[] => {
    const out: PrioGroup[] = []
    for (const i of items) {
      const g = i.rid ? out.find((x) => x.key === i.rid) : null
      if (g) g.lines.push({ text: i.text, vitalId: i.vitalId })
      else out.push({ key: i.rid ?? i.text + i.href, who: name(i.rid), href: i.href, lines: [{ text: i.text, vitalId: i.vitalId }] })
    }
    return out
  }
  const othersCritical = critical.filter((i) => !inScope(i.rid)).length
  const othersImportant = important.filter((i) => !inScope(i.rid)).length

  // Veränderungen seit dem letzten Dienst, pro Person gruppiert. «Relevant» = Ereignis, wichtiger Eintrag, Beobachtung,
  // ärztliche Information, auffälliger Vitalwert, Verordnungs- oder Pflegeplanänderung, Verweigerung.
  type Change = { key: string; at: Date; kind: string; text: string; rel: number; important?: boolean; by?: string; href: string }
  const changes = new Map<string, Change[]>()
  const push = (rid: string, c: Change) => { if (inScope(rid)) changes.set(rid, [...(changes.get(rid) ?? []), c]) }
  for (const n of newNotes) {
    const incident = n.category === 'incident'
    const r = incident ? 5 : n.important ? 4 : n.category === 'observation' || n.category === 'physician' ? 2 : 0
    push(n.residentId, { key: 'o' + n.id, at: n.at, kind: incident ? 'incident' : 'observation', text: n.text, rel: r, important: n.important, by: reviewers.get(n.authorId)?.short, href: `/residents/${n.residentId}/notes` })
  }
  for (const c of orderChanges) push(c.residentId, { key: c.kind + c.residentId + c.at.getTime() + c.text.length, at: c.at, kind: c.kind, text: c.text, rel: 3, by: c.by ?? undefined, href: `/residents/${c.residentId}/${c.kind === 'medication' ? 'meds' : 'careplan'}` })
  for (const a of refused.filter((a) => a.at >= last.at)) push(a.residentId, { key: 'a' + a.id, at: a.at, kind: 'medication', text: t('home.refused', { drug: a.medication.name, time: hm(a.scheduledFor ?? a.at) }), rel: 3, href: `/residents/${a.residentId}/meds` })
  for (const v of vitals.filter((v) => v.at >= last.at)) {
    const ab = abnormalKeys(v, mergeLimits(limits, v.residentId))
    if (!ab.length) continue
    const by = v.reviewedById ? reviewers.get(v.reviewedById)?.short ?? '' : ''
    const review = v.reviewedAt ? ' · ' + (v.reviewKind === 'action' && v.reviewNote ? t('home.review.inHandoverAction', { by, note: v.reviewNote }) : t('home.review.inHandoverSeen', { by })) : ''
    push(v.residentId, { key: 'v' + v.id, at: v.at, kind: 'vitals', text: vitalText(v, ab) + review, rel: 4, href: `/residents/${v.residentId}/vitals` })
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

  // Ablauf (PRD §7.1 Timeline): Übergabe, Aufgaben nach Zeit und Titel, Arztvisite, Termine.
  type Who = { rid: string; label: string; href: string }
  type Group = { time: string; due: Date; title: string; tag: string; total: number; open: number; over: boolean; med: boolean; who: Who[]; href?: string; sub?: string }
  const groups = new Map<string, Group>()
  const whoOf = (rid: string, href: string): Who | null => {
    const r = rById.get(rid)
    return r ? { rid: r.id, label: `${r.room?.number ? r.room.number + ' ' : ''}${r.lastName}`, href } : null
  }
  const scopedTasks = tasks.filter((k) => inScope(k.residentId))
  for (const k of scopedTasks) {
    const title = taskTitle(t, k)
    const key = hm(k.dueAt) + '|' + title
    const g = groups.get(key) ?? { time: hm(k.dueAt), due: k.dueAt, title, tag: k.category, total: 0, open: 0, over: false, med: k.source === 'medication', who: [] }
    g.total++
    if (isOpen(k)) {
      g.open++
      if (taskView(k, now) === 'over') g.over = true
      const w = k.residentId ? whoOf(k.residentId, taskHref(k)) : null
      if (w) g.who.push(w)
    }
    groups.set(key, g)
  }
  const visitAppts = appointments.filter((a) => a.kind === 'physician' && inScope(a.residentId))
  if (visitAppts.length) {
    const done = (a: (typeof appointments)[number]) => a.done || visitsToday.some((v) => v.residentId === a.residentId)
    const open = visitAppts.filter((a) => !done(a))
    groups.set('visit', {
      time: hm(visitAppts[0].at), due: visitAppts[0].at, title: t('home.tl.visit'), tag: t('home.tl.kinds.visit'), total: visitAppts.length, open: open.length,
      over: false, med: false, who: open.map((a) => whoOf(a.residentId, `/tasks/visit?r=${a.residentId}`)).filter((w): w is Who => !!w), href: '/tasks/visit',
    })
  }
  for (const a of appointments.filter((a) => a.kind !== 'physician' && inScope(a.residentId))) {
    const key = hm(a.at) + '|appt|' + a.title
    const g = groups.get(key) ?? { time: hm(a.at), due: a.at, title: t('home.tl.appointment', { title: a.title }), tag: t('home.tl.kinds.appointment'), total: 0, open: 0, over: false, med: false, who: [] }
    g.total++
    if (!a.done) {
      g.open++
      const w = whoOf(a.residentId, `/residents/${a.residentId}/appointments`)
      if (w) g.who.push(w)
    }
    groups.set(key, g)
  }
  if (canHandover && shiftDef) {
    // Übergabe zu Dienstbeginn (übernehmen) und am Dienstende (abschliessen)
    const startDone = !!handover && !handoverOpen
    groups.set('ho-in', {
      time: hm(window.start), due: window.start, title: t('home.tl.handover'), tag: t('home.tl.kinds.handover'), total: 1, open: startDone ? 0 : 1, over: false, med: false, who: [], href: hoHref,
      sub: handover ? (startDone ? t('home.tl.handoverAcked') : t('home.tl.handoverToAck', { at: hm(handover.submittedAt!) })) : t('home.tl.handoverNone'),
    })
    if (ctx.canHere('handover.write')) {
      const submitted = !!ownHandover?.submittedAt
      const endAt = new Date(window.end.getTime() - 1)
      groups.set('ho-out', {
        time: hm(window.end), due: endAt, title: t('home.tl.handoverOut'), tag: t('home.tl.kinds.handover'), total: 1, open: submitted ? 0 : 1, over: false, med: false, who: [], href: '/handover?s=' + shiftDef.code,
        sub: submitted ? t('home.tl.handoverSubmitted', { at: hm(ownHandover!.submittedAt!) }) : t('home.tl.handoverOutHint'),
      })
    }
  }
  const timeline = [...groups.values()].sort((a, b) => a.due.getTime() - b.due.getTime())
  // Bereits vollständig erledigte Zeitpunkte vor «Jetzt» werden zu einer aufklappbaren Zeile zusammengefasst.
  let doneLead = 0
  while (doneLead < timeline.length && timeline[doneLead].open === 0 && timeline[doneLead].due <= now) doneLead++
  const openTasks = scopedTasks.filter(isOpen).length
  const overdueCount = scopedTasks.filter((k) => isOverdue(k, now)).length
  const nextGroup = timeline.find((g) => g.open > 0 && g.due > now && !g.href?.startsWith('/handover')) ?? timeline.find((g) => g.open > 0 && !g.href?.startsWith('/handover'))
  const canRound = ctx.canHere('resident.medication.administer')

  let nowPlaced = false
  const nowLabel = t('common.now') + ' ' + hm(now)
  const boardDto: AssignmentBoardDto | null = board ? { shift: board.shift, residents: board.residents, staff: board.staff, pairs: board.pairs, suggestion: board.suggestion } : null
  const staffName = new Map(board?.staff.map((s) => [s.id, s.initials]) ?? [])
  // «AM 201–203 · JF 204–208»: Zuteilung bzw. Vorschlag kompakt nach Person
  const byStaff = (pairs: { residentId: string; userId: string }[]) =>
    [...new Set(pairs.map((p) => p.userId))].map((u) => `${staffName.get(u) ?? ''} ${roomRanges(pairs.filter((p) => p.userId === u).map((p) => board!.residents.find((r) => r.id === p.residentId)?.room ?? '–'))}`).join(' · ')
  const suggestionText = board ? byStaff(board.suggestion) : ''

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <ShiftSnapshot />
      <HomeHead
        t={t} view={view} views={views} greet={greet}
        label={unit.location.name}
        sub={[shiftLabel ?? t('home.noShift'), unit.name].filter(Boolean).join(' · ')}
        summary={<>{scoped ? t('home.mine.count', { n: residents.length }) : t('home.residentCount', { n: residents.length })} · <a href="#changes">{t('home.changesSince', { n: relevantCount })}</a></>}
        actions={canHandover ? <Link className="btn home-ho-btn" href="/handover">{t('nav.handover')}</Link> : undefined}
      />
      <div className="scroll">
        <div className="tabpanel">
          {boardDto && (
            <section className="card home-mine" aria-labelledby="mine">
              <div className="card-head">
                <h2 id="mine">{t('home.mine.title')} <span className="small muted home-mine-shift">{board!.shift.name}</span></h2>
                <div className="row" style={{ gap: 8 }}>
                  {myIds.length > 0 && (
                    <nav className="seg" aria-label={t('home.scope.label')}>
                      <Link href="/?view=care" aria-current={scoped ? 'page' : undefined} scroll={false}>{t('home.scope.mine')}</Link>
                      <Link href="/?view=care&scope=all" aria-current={!scoped ? 'page' : undefined} scroll={false}>{t('home.scope.all')}</Link>
                    </nav>
                  )}
                  {canManage && (board!.pairs.length > 0 || !board!.suggestion.length) && <AssignmentButton board={boardDto} className="btn sm" />}
                </div>
              </div>
              <div className="card-body">
                {myIds.length ? (
                  <ul className="home-mine-list">
                    {myIds.map((id) => rById.get(id)).filter((r): r is NonNullable<typeof r> => !!r).map((r) => (
                      <li key={r.id}>
                        <Link className="chip home-mine-chip" href={`/residents/${r.id}/day`}>
                          <span className="mono">{r.room?.number ?? '–'}</span> {r.lastName} {r.firstName}
                          {r.allergies.length > 0 && <span className="tag crit">{t('home.mine.allergy')}</span>}
                          {r.rea === 'no' && <span className="tag">{t('residents.banner.reaNo')}</span>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : board!.pairs.length ? (
                  <div className="stack-sm">
                    {ref?.mine && <p className="small" style={{ margin: 0 }}>{t('home.assign.noneForMe')}{!canManage && ' ' + t('home.assign.byLead')}</p>}
                    <p className="small muted" style={{ margin: 0 }}><span className="lbl">{t('home.assign.edit')}</span> <span className="mono">{byStaff(board!.pairs)}</span></p>
                  </div>
                ) : (
                  <div className="stack-sm">
                    <p className="small" style={{ margin: 0 }}>{t('home.assign.none', { shift: board!.shift.name })}</p>
                    {board!.suggestion.length > 0 ? (
                      <>
                        <p className="small muted" style={{ margin: 0 }}><span className="lbl">{t('home.assign.suggestion')}</span> <span className="mono">{suggestionText}</span></p>
                        {canManage ? (
                          <div className="row" style={{ gap: 8 }}>
                            <AcceptSuggestion board={boardDto} />
                            <AssignmentButton board={boardDto} label={t('home.assign.adjust')} />
                          </div>
                        ) : <p className="small muted" style={{ margin: 0 }}>{t('home.assign.byLead')}</p>}
                      </>
                    ) : <p className="small muted" style={{ margin: 0 }}>{t('home.assign.noStaff')}</p>}
                  </div>
                )}
              </div>
            </section>
          )}

          <div className="metrics res-metrics" aria-label={t('home.myShift')}>
            {canTasks ? (
              <>
                <Link className="metric" href={scoped ? '/tasks?f=mine' : '/tasks'}><span className="lbl">{t('home.plannedTasks')}</span><span className="val">{openTasks} <small>{t('home.openOfTotal', { total: scopedTasks.length })}</small></span><div className="bar"><i style={{ width: `${scopedTasks.length ? Math.round(((scopedTasks.length - openTasks) / scopedTasks.length) * 100) : 0}%` }} /></div></Link>
                <Link className="metric" href="/tasks?f=over"><span className="lbl">{t('home.overdue')}</span><span className={'val' + (overdueCount ? ' crit' : '')}>{overdueCount}</span></Link>
              </>
            ) : (
              <div className="metric"><span className="lbl">{t('home.residentsLabel')}</span><span className="val">{residents.length}</span></div>
            )}
            {canHandover ? (
              <Link className="metric" href={handoverOpen ? hoHref : '/handover'}><span className="lbl">{t('home.openHandover')}</span><span className={'val' + (handoverOpen ? ' warn' : '')}>{handoverOpen ? 1 : 0}{handoverOpen && <small> {t('home.toAckShort')}</small>}</span></Link>
            ) : (
              <a className="metric" href="#changes"><span className="lbl">{t('home.changes')}</span><span className="val">{relevantCount}</span></a>
            )}
          </div>

          <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' }}>
            <div className="stack">
              <section className="stack-sm" aria-labelledby="prio">
                <div className="sec-head"><h2 className="sec" id="prio">{t('home.priorities')}</h2></div>
                <PriorityBlock title={t('home.critical')} tone="crit" groups={group(critical.filter((i) => inScope(i.rid)))} empty={t('home.criticalNone')} canReview={ctx.canHere('resident.vitals.write')}
                  more={othersCritical ? { text: t('home.othersCritical', { n: othersCritical }), href: '/?view=care&scope=all' } : null} />
                <PriorityBlock title={t('home.important')} tone="warn" groups={group(important.filter((i) => inScope(i.rid)))} empty={t('home.importantNone')}
                  more={othersImportant ? { text: t('home.othersImportant', { n: othersImportant }), href: '/?view=care&scope=all' } : null} />
                {canTasks && (
                  <Link className="card home-routine" href="/tasks">
                    <span className="tag">{t('home.routine')}</span>
                    <span className="grow fg2">
                      {nextGroup
                        ? t('home.routineNext', { open: openTasks, time: nextGroup.time, title: nextGroup.title })
                        : t(scopedTasks.length ? 'home.routineAllDone' : 'home.timelineEmpty')}
                    </span>
                    <span className="linkbtn small nowrap">{t('nav.tasks')} →</span>
                  </Link>
                )}
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
                <div className="sec-head"><h2 className="sec" id="tl">{t('home.timeline')}</h2><span className="small muted">{t(scoped ? 'home.timelineHintMine' : 'home.timelineHint', { unit: unit.name })}</span></div>
                {timeline.length ? (
                  <ol className="timeline home-tl">
                    {doneLead > 0 && (
                      <li className="tl-done">
                        <details>
                          <summary>
                            <span className="mono">{timeline[0].time === timeline[doneLead - 1].time ? timeline[0].time : `${timeline[0].time}–${timeline[doneLead - 1].time}`}</span>
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

              <ForYou ctx={ctx} now={now} unitId={unit.id}
                extraCount={notesToAck.length + (handoverOpen ? 1 : 0)}
                extra={<>
                  {handoverOpen && <li><Link className="li" href={hoHref}><span className="tag warn">{t('nav.handover')}</span><span className="grow">{handoverOpen.shiftCode} · {fmtDayMonth(fromDbDate(handoverOpen.date), locale)}</span></Link></li>}
                  {notesToAck.map((o) => <li key={o.id}><Link className="li" href={`/residents/${o.residentId}/notes`}><span className="tag crit">{t('residents.tabs.notes')}</span><span className="grow" style={{ minWidth: 0 }}><span style={{ display: 'block' }}>{name(o.residentId)}</span><span className="small muted ellipsis" style={{ display: 'block' }}>{o.text}</span></span><span className="small muted nowrap">{rel(o.at)}</span></Link></li>)}
                </>}
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

const KIND_TONE: Record<string, string> = { incident: 'crit', vitals: 'warn', medication: 'violet', observation: 'accent', careplan: 'ok' }

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
  g: { time: string; title: string; tag: string; total: number; open: number; med: boolean; who: { rid: string; label: string; href: string }[]; href?: string; sub?: string }
  state: string; t: T; canRound: boolean
}) {
  const row = (
    <>
      <span className="t mono">{g.time}</span>
      <div style={{ minWidth: 0 }}>
        <div className="ttl">{g.title}</div>
        <div className="sub">
          {g.sub ?? (
            <>
              {t('home.nResidents', { n: g.total })} · {g.open ? t('home.openOf', { open: g.open, total: g.total }) : t('home.allDone')}
              {g.open > 0 && g.open <= 3 && ' · ' + g.who.map((w) => w.label.replace(/^\S+ /, '')).join(', ')}
            </>
          )}
          {state === 'over' && <> · <span className="tag crit">{t('tasks.view.over')}</span></>}
        </div>
      </div>
      <span className="tag">{g.tag}</span>
    </>
  )
  if (!g.open) return <li className={'trow is-' + state}>{row}</li>
  // Übergabe, Visite: direkt zur Ansicht. Genau eine offene Aufgabe: direkt dorthin (ein Klick), sonst aufklappen und Person wählen.
  if (g.href && !g.who.length) return <li className={'is-' + state}><Link className={'trow tl-link is-' + state} href={g.href}>{row}</Link></li>
  if (g.who.length === 1 && !g.href && !(g.med && canRound)) return <li className={'is-' + state}><Link className={'trow tl-link is-' + state} href={g.who[0].href}>{row}</Link></li>
  return (
    <li className={'is-' + state}>
      <details className="tl-group">
        <summary className={'trow is-' + state}>{row}</summary>
        <div className="tl-who">
          {g.med && canRound && <Link className="btn sm primary" href="/tasks/medround">{t('tasks.medround')}</Link>}
          {g.href && <Link className="btn sm primary" href={g.href}>{g.title}</Link>}
          {g.who.map((w, i) => <Link key={w.rid + i} className="chip" href={w.href}>{w.label}</Link>)}
        </div>
      </details>
    </li>
  )
}
