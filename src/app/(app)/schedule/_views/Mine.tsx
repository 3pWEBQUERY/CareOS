import Link from 'next/link'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { addDays, dateKey, dbDate, fmtDayMonth, fmtNum, fromDbDate, sameDay, shiftBounds, weekdayShort } from '@/lib/time'
import { absencesIn, dbKey, unitStaff, weekStart } from '../lib'
import { SwapButton } from '../_ui/SwapButton'
import { shiftName } from '@/lib/shift-name'

const hours = (s: { code: string; name: string; start: string; end: string }, day: Date) => {
  const b = shiftBounds(s, day)
  return (b.end.getTime() - b.start.getTime()) / 3600000
}

/** Meine Dienste – Woche als Liste (PRD §19 Mitarbeitende). */
export async function MineView({ ctx, week, now }: { ctx: Ctx; week: Date; now: Date }) {
  const { t, user, locale } = ctx
  const end = addDays(week, 6)
  const [shifts, absences, openCount] = await Promise.all([
    db.shift.findMany({
      where: { userId: user.id, date: { gte: dbDate(week), lte: dbDate(end) }, status: { not: 'cancelled' } },
      include: { shiftType: true, unit: { select: { id: true, name: true } }, swaps: { where: { status: 'requested' } } },
      orderBy: { date: 'asc' },
    }),
    absencesIn([user.id], week, end),
    ctx.unit ? db.shift.count({ where: { unitId: ctx.unit.id, status: 'open', date: { gte: dbDate(now) } } }) : 0,
  ])

  // Kolleginnen und Kollegen für den Tausch (je Bereich), belegt = hat am Tag schon Dienst.
  const unitIds = [...new Set(shifts.map((s) => s.unitId))]
  const staffBy = new Map<string, Awaited<ReturnType<typeof unitStaff>>>()
  for (const u of unitIds) staffBy.set(u, (await unitStaff(ctx.org.id, u, week, end)).filter((x) => x.id !== user.id))
  const allIds = [...new Set([...staffBy.values()].flat().map((x) => x.id))]
  const busy = allIds.length ? await db.shift.findMany({ where: { userId: { in: allIds }, date: { in: shifts.map((s) => s.date) }, status: { not: 'cancelled' } }, select: { userId: true, date: true } }) : []
  const busySet = new Set(busy.map((b) => `${b.userId}|${dbKey(b.date)}`))

  const total = shifts.reduce((s, x) => s + hours(x.shiftType, fromDbDate(x.date)), 0)
  const next = await db.shift.findFirst({ where: { userId: user.id, date: { gte: dbDate(now) }, status: { not: 'cancelled' } }, include: { shiftType: true }, orderBy: { date: 'asc' } })
  const pendingSwaps = shifts.filter((s) => s.swaps.length).length
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i))

  return (
    <>
      <div className="metrics metrics-sm2">
        <div className="metric"><span className="lbl">{t('schedule.mine.shifts')}</span><span className="val">{shifts.length}</span></div>
        <div className="metric"><span className="lbl">{t('schedule.mine.hours')}</span><span className="val">{fmtNum(total, total % 1 ? 1 : 0, locale)} <small>h</small></span></div>
        <div className="metric">
          <span className="lbl">{t('schedule.mine.next')}</span>
          <span className="val" style={{ fontSize: '1rem' }}>{next ? <><span className={'sh ' + next.shiftType.code}>{next.shiftType.code}</span> {weekdayShort(fromDbDate(next.date), locale)} {fmtDayMonth(fromDbDate(next.date))} <small>{next.shiftType.start}</small></> : '–'}</span>
        </div>
        <Link className="metric" href="/schedule?view=open"><span className="lbl">{t('schedule.tabs.open')}</span><span className={'val' + (openCount ? ' warn' : '')}>{openCount}</span></Link>
        {pendingSwaps > 0 && <Link className="metric" href="/schedule?view=swaps"><span className="lbl">{t('schedule.mine.pendingSwaps')}</span><span className="val warn">{pendingSwaps}</span></Link>}
      </div>

      <div className="tablewrap rwrap">
        <table className="stable rtable">
          <thead>
            <tr><th>{t('schedule.cols.date')}</th><th>{t('schedule.cols.shift')}</th><th>{t('schedule.cols.time')}</th><th>{t('schedule.cols.unit')}</th><th>{t('schedule.cols.status')}</th><th className="right"><span className="sr-only">{t('schedule.cols.actions')}</span></th></tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const list = shifts.filter((s) => dbKey(s.date) === dateKey(d))
              const abs = absences.find((a) => a.from <= dbDate(d) && a.to >= dbDate(d))
              const today = sameDay(d, now)
              const dayCell = (
                <th scope="row" className="nowrap" style={today ? { color: 'var(--accent)' } : undefined}>
                  <span className="mono">{weekdayShort(d, locale)} {fmtDayMonth(d)}</span>{today && <span className="tag accent" style={{ marginLeft: 6 }}>{t('common.today')}</span>}
                </th>
              )
              if (!list.length)
                return (
                  <tr key={d.toISOString()} className="r-free">
                    {dayCell}
                    <td colSpan={5}>{abs ? <span className="sh abs">{t('schedule.absence.kinds.' + abs.kind)}{abs.status === 'requested' ? ` · ${t('schedule.approval.requested')}` : ''}</span> : <span className="muted">{t('schedule.mine.free')}</span>}</td>
                  </tr>
                )
              return list.map((s, i) => {
                const past = fromDbDate(s.date) < addDays(now, -1) || shiftBounds(s.shiftType, fromDbDate(s.date)).start < now
                const swap = s.swaps[0]
                return (
                  <tr key={s.id}>
                    {i === 0 ? dayCell : <th />}
                    <td><span className={'sh ' + s.shiftType.code}>{s.shiftType.code}</span> {shiftName(t, s.shiftType)} <span className="r-only mono">{s.shiftType.start}–{s.shiftType.end}</span></td>
                    <td className="num nowrap r-desk">{s.shiftType.start}–{s.shiftType.end}</td>
                    <td data-label={t('schedule.cols.unit')}>{s.unit.name}</td>
                    <td data-label={t('schedule.cols.status')}>
                      {abs && <span className="tag warn" style={{ marginRight: 6 }}>{t('schedule.absence.kinds.' + abs.kind)}</span>}
                      {swap ? <span className="tag violet">{t(swap.acceptedAt ? 'schedule.swap.waitingLead' : 'schedule.swap.waitingTaker')}</span> : <span className="muted small">{t('schedule.status.' + s.status)}</span>}
                      {s.note && <div className="small muted">{s.note}</div>}
                    </td>
                    <td className="right r-act">
                      {!past && s.status === 'planned' && !swap && (
                        <SwapButton
                          shiftId={s.id}
                          label={`${shiftName(t, s.shiftType)} · ${weekdayShort(d, locale)} ${fmtDayMonth(d)} · ${s.shiftType.start}–${s.shiftType.end}`}
                          colleagues={(staffBy.get(s.unitId) ?? []).map((c) => ({ id: c.id, name: c.name, qual: c.qual, busy: busySet.has(`${c.id}|${dbKey(s.date)}`) }))}
                        />
                      )}
                      {swap && <Link className="linkbtn small" href="/schedule?view=swaps">{t('schedule.tabs.swaps')} →</Link>}
                    </td>
                  </tr>
                )
              })
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ margin: 0 }}>{t('schedule.mine.hoursHint')}</p>
    </>
  )
}

/** Monatsübersicht: eigene Dienste, Abwesenheiten und offene Dienste im Bereich. */
export async function MonthView({ ctx, month, now }: { ctx: Ctx; month: Date; now: Date }) {
  const { t, user, locale } = ctx
  const first = weekStart(month)
  const last = addDays(weekStart(new Date(month.getFullYear(), month.getMonth() + 1, 0)), 6)
  const [shifts, absences, open] = await Promise.all([
    db.shift.findMany({ where: { userId: user.id, date: { gte: dbDate(first), lte: dbDate(last) }, status: { not: 'cancelled' } }, include: { shiftType: true } }),
    absencesIn([user.id], first, last),
    ctx.unit ? db.shift.findMany({ where: { unitId: ctx.unit.id, status: 'open', date: { gte: dbDate(first), lte: dbDate(last) } }, include: { shiftType: true } }) : [],
  ])
  const count = Math.round((last.getTime() - first.getTime()) / 864e5) + 1
  const days = Array.from({ length: count }, (_, i) => addDays(first, i))
  const inMonth = shifts.filter((s) => fromDbDate(s.date).getMonth() === month.getMonth())
  const total = inMonth.reduce((s, x) => s + hours(x.shiftType, fromDbDate(x.date)), 0)

  return (
    <>
      <div className="metrics metrics-sm2">
        <div className="metric"><span className="lbl">{t('schedule.mine.shifts')}</span><span className="val">{inMonth.length}</span></div>
        <div className="metric"><span className="lbl">{t('schedule.mine.hours')}</span><span className="val">{fmtNum(total, total % 1 ? 1 : 0, locale)} <small>h</small></span></div>
        <div className="metric"><span className="lbl">{t('schedule.mine.nights')}</span><span className="val">{inMonth.filter((s) => s.shiftType.code === 'N').length}</span></div>
        <div className="metric"><span className="lbl">{t('schedule.tabs.absences')}</span><span className="val">{days.filter((d) => d.getMonth() === month.getMonth() && absences.some((a) => a.status === 'approved' && a.from <= dbDate(d) && a.to >= dbDate(d))).length} <small>{t('schedule.mine.daysUnit')}</small></span></div>
      </div>
      <div>
        <div className="month-head" aria-hidden="true">{days.slice(0, 7).map((d) => <span key={d.getDay()} className="lbl">{weekdayShort(d, locale)}</span>)}</div>
        <div className="month">
          {days.map((d) => {
            const k = dateKey(d)
            const mine = shifts.filter((s) => dbKey(s.date) === k)
            const abs = absences.find((a) => a.from <= dbDate(d) && a.to >= dbDate(d))
            const op = open.filter((s) => dbKey(s.date) === k)
            const cls = [d.getMonth() !== month.getMonth() && 'out', sameDay(d, now) && 'today'].filter(Boolean).join(' ')
            return (
              <div key={k} className={cls || undefined}>
                <span className="dn"><span className="sr-only">{weekdayShort(d, locale)} </span>{d.getDate()}<span className="sr-only">.{d.getMonth() + 1}.</span></span>
                {mine.map((s) => <span key={s.id} className={'sh ' + s.shiftType.code} title={`${shiftName(t, s.shiftType)} ${s.shiftType.start}–${s.shiftType.end}`}>{s.shiftType.code} <span className="month-time">{s.shiftType.start}</span><span className="sr-only"> {shiftName(t, s.shiftType)} {s.shiftType.start}–{s.shiftType.end}</span></span>)}
                {abs && <span className="sh abs" title={t('schedule.absence.kinds.' + abs.kind)}>{t('schedule.absence.short.' + abs.kind)}{abs.status === 'requested' ? ' ?' : ''}</span>}
                {op.length > 0 && <Link className="sh open" href="/schedule?view=open" title={t('schedule.open.title')}>{op.map((s) => s.shiftType.code).join(' ')} {t('schedule.open.short')}</Link>}
              </div>
            )
          })}
        </div>
      </div>
      <div className="mlegend">
        <span><span className="sh F">F</span> <span className="sh S">S</span> <span className="sh N">N</span> {t('schedule.monthView.legendMine')}</span>
        <span><span className="sh abs">{t('schedule.absence.short.vacation')}</span> {t('schedule.plan.legendAbsence')}</span>
        <span><span className="sh open">S</span> {t('schedule.monthView.legendOpen')}</span>
      </div>
    </>
  )
}
