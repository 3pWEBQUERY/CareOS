import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { ensureTasksForDay, taskView, OPEN_STATUSES } from '@/lib/tasks'
import { lastShiftEnd, myShiftNow, runningShift } from '@/lib/shift'
import { addDays, dbDate, fmtDayMonth, fmtNum, fmtRel, fromDbDate, hm, startOfDay } from '@/lib/time'
import { abnormalKeys, mergeLimits, VITALS } from '@/lib/vitals'
import { taskTitle } from '@/lib/task-title'

export const metadata = { title: 'Home' }

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

  // Kritisch / Wichtig
  const critical: { key: string; text: string; who?: string; href: string }[] = []
  const important: { key: string; text: string; who?: string; href: string }[] = []
  const name = (id: string | null | undefined) => {
    const r = id ? rById.get(id) : null
    return r ? `${r.lastName} ${r.firstName}${r.room ? ' · ' + r.room.number : ''}` : undefined
  }
  for (const k of tasks) {
    if (!OPEN_STATUSES.includes(k.status as (typeof OPEN_STATUSES)[number])) continue
    if (taskView(k, now) === 'over') critical.push({ key: 'task' + k.id, text: t('home.overdueTask', { title: taskTitle(t, k), time: hm(k.dueAt) }), who: name(k.residentId), href: k.residentId ? `/residents/${k.residentId}` : '/tasks' })
  }
  const latest = new Map<string, (typeof vitals)[number]>()
  for (const v of vitals) if (!latest.has(v.residentId)) latest.set(v.residentId, v)
  for (const [rid, v] of latest) {
    const lim = mergeLimits(limits, rid)
    const ab = abnormalKeys(v, lim)
    if (ab.length)
      critical.push({
        key: 'vit' + rid,
        text: ab.map((k) => t('home.abnormalVital', { label: t('common.vitals.' + k), value: fmtNum(v[k] as number, VITALS[k].dec, locale) + ' ' + VITALS[k].unit })).join(' · '),
        who: name(rid),
        href: `/residents/${rid}/vitals`,
      })
  }
  for (const i of incidents) (i.severity === 'severe' || i.severity === 'moderate' || i.stage === 'reported' ? critical : important).push({ key: 'inc' + i.id, text: t('home.incidentToday', { type: i.type.name }) + ' · ' + rel(i.occurredAt), who: name(i.residentId), href: `/quality/${i.id}` })
  for (const a of refused) important.push({ key: 'ref' + a.id, text: t('home.refused', { drug: a.medication.name, time: hm(a.scheduledFor ?? a.at) }), who: name(a.residentId), href: `/residents/${a.residentId}/meds` })
  for (const n of newNotes.filter((n) => n.important || n.category === 'incident').slice(0, 6)) important.push({ key: 'obs' + n.id, text: n.text.length > 120 ? n.text.slice(0, 118) + ' …' : n.text, who: name(n.residentId), href: `/residents/${n.residentId}/notes` })
  for (const e of handoverOpen?.entries.filter((e) => e.important) ?? []) important.push({ key: 'ho' + e.id, text: e.watch ?? e.open ?? '', who: name(e.residentId), href: '/handover' })

  // Veränderungen seit letztem Dienst, pro Person gruppiert
  type Change = { at: Date; kind: string; text: string }
  const changes = new Map<string, Change[]>()
  const push = (rid: string, c: Change) => changes.set(rid, [...(changes.get(rid) ?? []), c])
  for (const n of newNotes) push(n.residentId, { at: n.at, kind: n.category === 'incident' ? 'incident' : 'observation', text: n.text })
  for (const m of medChanges) push(m.residentId, { at: m.stoppedAt ?? m.createdAt, kind: 'medication', text: m.stoppedAt ? t('home.medStopped', { name: m.name }) : t('home.medStarted', { name: m.name }) })
  for (const v of vitals.filter((v) => v.at >= last.at)) {
    const ab = abnormalKeys(v, mergeLimits(limits, v.residentId))
    if (ab.length) push(v.residentId, { at: v.at, kind: 'vitals', text: ab.map((k) => `${t('common.vitals.' + k)} ${fmtNum(v[k] as number, VITALS[k].dec, locale)} ${VITALS[k].unit}`).join(', ') })
  }
  const changeList = [...changes.entries()].map(([rid, list]) => ({ rid, list: list.sort((a, b) => b.at.getTime() - a.at.getTime()) })).sort((a, b) => b.list[0].at.getTime() - a.list[0].at.getTime())

  // Timeline: Aufgaben nach Zeit und Titel zusammengefasst
  type Group = { time: string; due: Date; title: string; category: string; total: number; open: number; over: boolean; residents: string[] }
  const groups = new Map<string, Group>()
  for (const k of tasks) {
    const title = taskTitle(t, k)
    const key = hm(k.dueAt) + '|' + title
    const g = groups.get(key) ?? { time: hm(k.dueAt), due: k.dueAt, title, category: k.category, total: 0, open: 0, over: false, residents: [] }
    g.total++
    const v = taskView(k, now)
    if (OPEN_STATUSES.includes(k.status as (typeof OPEN_STATUSES)[number])) {
      g.open++
      if (v === 'over') g.over = true
      if (k.residentId) g.residents.push(rById.get(k.residentId)?.lastName ?? '')
    }
    groups.set(key, g)
  }
  const timeline = [...groups.values()].sort((a, b) => a.due.getTime() - b.due.getTime())
  const openTasks = tasks.filter((k) => OPEN_STATUSES.includes(k.status as (typeof OPEN_STATUSES)[number])).length
  const routineCount = tasks.length

  const trainingsOpen = enrollments.filter((e) => e.course.mandatory || e.dueAt)
  let nowPlaced = false

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">
        <div>
          <span className="lbl">{unit ? `${unit.location.name} · ${unit.name}` : ctx.org.name}</span>
          <h1>{greet}</h1>
          <p className="sub">{shiftLabel ?? t('home.noShift')}</p>
        </div>
        {unit && ctx.canHere('handover.read') && (
          <Link className="btn" href="/handover">{t('nav.handover')}</Link>
        )}
      </div>
      <div className="scroll">
        <div className="tabpanel">
          <div className="metrics" aria-label={t('home.myShift')}>
            <Link className="metric" href="/residents"><span className="lbl">{t('home.residentsLabel')}</span><span className="val">{residents.length}</span></Link>
            <Link className="metric" href="/tasks"><span className="lbl">{t('home.plannedTasks')}</span><span className="val">{openTasks} <small>/ {tasks.length}</small></span><div className="bar"><i style={{ width: `${tasks.length ? Math.round(((tasks.length - openTasks) / tasks.length) * 100) : 0}%` }} /></div></Link>
            <a className="metric" href="#changes"><span className="lbl">{t('home.changes')}</span><span className={'val' + (changeList.length ? ' warn' : '')}>{changeList.reduce((s, c) => s + c.list.length, 0)}</span></a>
            <Link className="metric" href="/handover"><span className="lbl">{t('home.openHandover')}</span><span className={'val' + (handoverOpen ? ' warn' : '')}>{handoverOpen ? 1 : 0}</span></Link>
          </div>

          <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' }}>
            <div className="stack">
              <section className="stack-sm" aria-labelledby="prio">
                <div className="sec-head"><h2 className="sec" id="prio">{t('home.priorities')}</h2></div>
                <PriorityBlock title={t('home.critical')} tone="crit" items={critical} empty={t('home.criticalNone')} />
                <PriorityBlock title={t('home.important')} tone="warn" items={important} empty={t('home.importantNone')} />
                <div className="card"><div className="card-body row-between"><span><span className="tag">{t('home.routine')}</span> <span className="fg2">{t('home.routineSummary', { n: routineCount })}</span></span><Link className="linkbtn small" href="/tasks">{t('nav.tasks')} →</Link></div></div>
              </section>

              <section className="stack-sm" id="changes" aria-labelledby="chg">
                <div className="sec-head">
                  <h2 className="sec" id="chg">{t('home.sinceLast')}</h2>
                  <span className="small muted">{t(last.source === 'shift' ? 'home.sinceLastHint' : 'home.sinceLastHintSession', { at: rel(last.at) })}</span>
                </div>
                {changeList.length ? (
                  <ul className="list card">
                    {changeList.map(({ rid, list }) => (
                      <li key={rid}>
                        <Link className="li" href={`/residents/${rid}/timeline`}>
                          <span className="roomtag">{rById.get(rid)?.room?.number ?? '–'}</span>
                          <div className="grow">
                            <div>{name(rid)?.split(' · ')[0]}</div>
                            <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0 0', display: 'flex', flexDirection: 'column', gap: 3 }}>
                              {list.slice(0, 3).map((c, i) => (
                                <li key={i} className="small" style={{ display: 'flex', gap: 8 }}>
                                  <span className={'tag ' + (c.kind === 'incident' ? 'crit' : c.kind === 'vitals' ? 'warn' : c.kind === 'medication' ? 'violet' : 'accent')}>{t('home.changeKinds.' + c.kind)}</span>
                                  <span className="fg2" style={{ minWidth: 0 }}>{c.text.length > 140 ? c.text.slice(0, 138) + ' …' : c.text}</span>
                                </li>
                              ))}
                              {list.length > 3 && <li className="small muted">{t('common.notifications.more', { n: list.length - 3 })}</li>}
                            </ul>
                          </div>
                          <time className="small muted mono nowrap">{hm(list[0].at)}</time>
                        </Link>
                      </li>
                    ))}
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
                  <ol className="timeline">
                    {timeline.map((g) => {
                      const before = !nowPlaced && g.due > now
                      if (before) nowPlaced = true
                      const state = g.open === 0 ? 'done' : g.over ? 'over' : (g.due.getTime() - now.getTime()) / 60000 <= 30 ? 'due' : 'up'
                      return (
                        <TimelineRow key={g.time + g.title} before={before} nowLabel={t('common.now') + ' ' + hm(now)} state={state}>
                          <span className="t mono">{g.time}</span>
                          <div style={{ minWidth: 0 }}>
                            <div className="ttl">{g.title}</div>
                            <div className="sub">
                              {t('home.nResidents', { n: g.total })} · {g.open ? t('home.openOf', { open: g.open, total: g.total }) : t('home.allDone')}
                              {g.open > 0 && g.open <= 3 && ' · ' + g.residents.join(', ')}
                            </div>
                          </div>
                          <span className="tag">{g.category}</span>
                        </TimelineRow>
                      )
                    })}
                    {!nowPlaced && <li className="now" aria-label={t('common.now')}><span>{t('common.now')} {hm(now)}</span><i /></li>}
                  </ol>
                ) : (
                  <p className="empty">{t('home.timelineEmpty')}</p>
                )}
              </section>

              <section className="card" aria-labelledby="foryou">
                <div className="card-head"><h2 id="foryou">{t('home.team')}</h2></div>
                <div className="card-body stack-sm">
                  <span className="lbl">{t('home.toAck')}</span>
                  {postsToAck.length + docsToAck.length + (handoverOpen ? 1 : 0) ? (
                    <ul className="list">
                      {handoverOpen && <li><Link className="li" href="/handover"><span className="tag warn">{t('nav.handover')}</span><span className="grow">{handoverOpen.shiftCode} · {fmtDayMonth(fromDbDate(handoverOpen.date))}</span></Link></li>}
                      {postsToAck.map((p) => <li key={p.id}><Link className="li" href={`/team/post/${p.id}`}><span className="tag accent">{t('nav.team')}</span><span className="grow">{p.title}</span></Link></li>)}
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

function PriorityBlock({ title, tone, items, empty }: { title: string; tone: 'crit' | 'warn'; items: { key: string; text: string; who?: string; href: string }[]; empty: string }) {
  return (
    <div className={'card' + (items.length ? ' ' + tone : '')}>
      <div className="card-head">
        <h3><span className={'tag ' + tone}>{title}</span></h3>
        <span className={'pill ' + (items.length ? tone : '')}>{items.length}</span>
      </div>
      {items.length ? (
        <ul className="list">
          {items.slice(0, 8).map((i) => (
            <li key={i.key}>
              <Link className="li" href={i.href}>
                <div className="grow">
                  {i.who && <div>{i.who}</div>}
                  <div className={'small ' + (tone === 'crit' ? 'crit-text' : 'warn-text')}>{i.text}</div>
                </div>
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

function TimelineRow({ before, nowLabel, state, children }: { before: boolean; nowLabel: string; state: string; children: React.ReactNode }) {
  return (
    <>
      {before && <li className="now" aria-label={nowLabel}><span>{nowLabel}</span><i /></li>}
      <li className={'trow is-' + state} style={{ gridTemplateColumns: '52px minmax(0,1fr) auto' }}>{children}</li>
    </>
  )
}
