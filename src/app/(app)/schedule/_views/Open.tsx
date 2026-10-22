import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { addDays, dbDate, fmtDayMonth, fromDbDate, weekdayShort } from '@/lib/time'
import { Empty } from '@/components/ui/Empty'
import { ActButton } from '../../team/_ui/ActButton'
import { applyOpenShiftAction, cancelSwapAction, decideSwapAction } from '../actions'
import { dbKey, unitStaff } from '../lib'
import { OpenShiftCreate } from '../_ui/OpenShiftCreate'

/** Offene Dienste im gewählten Bereich: übernehmen (Mitarbeitende), bestätigen (Leitung). */
export async function OpenView({ ctx, now, canManage }: { ctx: Ctx; now: Date; canManage: boolean }) {
  const { t, user, unit, locale } = ctx
  if (!unit) return <Empty title={t('schedule.noUnit')} />
  const until = addDays(now, 90)
  const [shifts, myQuals, types, quals] = await Promise.all([
    db.shift.findMany({
      where: { unitId: unit.id, status: 'open', userId: null, date: { gte: dbDate(now), lte: dbDate(until) } },
      include: { shiftType: true, swaps: { where: { status: 'requested' }, orderBy: { createdAt: 'asc' } } },
      orderBy: [{ date: 'asc' }, { shiftType: { start: 'asc' } }],
    }),
    db.userQualification.findMany({ where: { userId: user.id }, include: { qualification: true } }),
    db.shiftType.findMany({ where: { orgId: ctx.org.id }, orderBy: { start: 'asc' } }),
    db.qualification.findMany({ where: { orgId: ctx.org.id }, orderBy: { level: 'desc' } }),
  ])
  const myBooked = await db.shift.findMany({ where: { userId: user.id, date: { in: shifts.map((s) => s.date) }, status: { not: 'cancelled' } }, select: { date: true } })
  const booked = new Set(myBooked.map((b) => dbKey(b.date)))
  const myQualNames = new Set(myQuals.filter((q) => !q.validUntil || q.validUntil >= now).map((q) => q.qualification.name))
  const applicantIds = [...new Set(shifts.flatMap((s) => s.swaps.map((x) => x.requesterId)))]
  const applicants = applicantIds.length
    ? await db.user.findMany({ where: { id: { in: applicantIds } }, select: { id: true, firstName: true, lastName: true, qualifications: { select: { qualification: { select: { name: true } } } } } })
    : []
  const who = new Map(applicants.map((a) => [a.id, a]))
  const staff = canManage ? await unitStaff(ctx.org.id, unit.id, now, until) : []

  return (
    <>
      <div className="sec-head">
        <h2 className="sec">{t('schedule.open.title')} · {unit.name}</h2>
        {canManage && <OpenShiftCreate unitId={unit.id} types={types.map((x) => ({ id: x.id, code: x.code, name: x.name, start: x.start, end: x.end }))} staff={staff.map((s) => ({ id: s.id, name: s.name, qual: s.qual }))} quals={quals.map((q) => q.name)} />}
      </div>
      {!shifts.length ? (
        <Empty title={t('schedule.open.none')} />
      ) : (
        <div className="tablewrap rwrap">
          <table className="stable rtable">
            <thead>
              <tr>
                <th>{t('schedule.cols.date')}</th><th>{t('schedule.cols.shift')}</th><th>{t('schedule.cols.time')}</th><th>{t('schedule.cols.qual')}</th>
                <th>{t('schedule.open.applicants')}</th><th className="right"><span className="sr-only">{t('schedule.cols.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => {
                const d = fromDbDate(s.date)
                const mine = s.swaps.find((x) => x.requesterId === user.id)
                const lacks = s.requiredQualification && !myQualNames.has(s.requiredQualification)
                const isBooked = booked.has(dbKey(s.date))
                return (
                  <tr key={s.id}>
                    <th scope="row" className="nowrap mono">{weekdayShort(d, locale)} {fmtDayMonth(d)}</th>
                    <td><span className="sh open">{s.shiftType.code}</span> {s.shiftType.name} <span className="r-only mono">{s.shiftType.start}–{s.shiftType.end}</span>{s.note && <div className="small muted">{s.note}</div>}</td>
                    <td className="num nowrap r-desk">{s.shiftType.start}–{s.shiftType.end}</td>
                    <td data-label={t('schedule.cols.qual')}>{s.requiredQualification ? <span className={'tag ' + (lacks ? 'warn' : 'outline')}>{s.requiredQualification}</span> : <span className="muted">–</span>}</td>
                    <td data-label={t('schedule.open.applicants')}>
                      {s.swaps.length ? (
                        <ul className="stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                          {s.swaps.map((x) => {
                            const a = who.get(x.requesterId)
                            const aq = a?.qualifications.map((q) => q.qualification.name) ?? []
                            const fits = !s.requiredQualification || aq.includes(s.requiredQualification)
                            return (
                              <li key={x.id} className="row" style={{ gap: 6 }}>
                                <span>{a ? `${a.firstName} ${a.lastName}` : '–'}</span>
                                {canManage && <span className={'small ' + (fits ? 'muted' : 'warn-text')}>{aq[0] ?? ''}{!fits ? ` · ${t('schedule.open.missingQual', { qual: s.requiredQualification })}` : ''}</span>}
                                {canManage && (
                                  <>
                                    <ActButton action={decideSwapAction.bind(null, x.id, true)} className="btn sm primary">{t('schedule.open.confirm')}</ActButton>
                                    <ActButton action={decideSwapAction.bind(null, x.id, false)} className="btn sm ghost">{t('schedule.swap.reject')}</ActButton>
                                  </>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      ) : <span className="muted small">{t('schedule.open.noApplicants')}</span>}
                    </td>
                    <td className="right r-act">
                      {mine ? (
                        <div className="stack-sm" style={{ alignItems: 'flex-end' }}>
                          <span className="tag violet">{t('schedule.open.applied')}</span>
                          <ActButton action={cancelSwapAction.bind(null, mine.id)} className="btn sm ghost">{t('schedule.swap.cancel')}</ActButton>
                        </div>
                      ) : isBooked ? (
                        <span className="small muted">{t('schedule.open.booked')}</span>
                      ) : (
                        <div className="stack-sm" style={{ alignItems: 'flex-end' }}>
                          <ActButton action={applyOpenShiftAction.bind(null, s.id)} className="btn sm primary">{t('schedule.open.apply')}</ActButton>
                          {lacks && <span className="small warn-text">{t('schedule.open.missingQual', { qual: s.requiredQualification })}</span>}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted" style={{ margin: 0 }}>{t('schedule.open.hint')}</p>
    </>
  )
}
