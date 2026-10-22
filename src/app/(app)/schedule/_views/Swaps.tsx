import Link from 'next/link'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { addDays, dbDate, fmtDayMonth, fmtRel, fromDbDate, weekdayShort } from '@/lib/time'
import { ActButton } from '../../team/_ui/ActButton'
import { acceptSwapAction, cancelSwapAction, declineSwapAction, decideSwapAction } from '../actions'
import { hasQualOn, keyQualification, qualifiedUserIds } from '../lib'

/** Schichttausch: Anfragen an mich, meine Anfragen, Freigabe durch die Leitung (PRD §19). */
export async function SwapsView({ ctx, now, canManage }: { ctx: Ctx; now: Date; canManage: boolean }) {
  const { t, user, unit, locale } = ctx
  const include = { shift: { include: { shiftType: true, unit: { select: { name: true } } } } } as const
  const [incoming, mineAll, approvals] = await Promise.all([
    db.swapRequest.findMany({
      where: { status: 'requested', acceptedAt: null, requesterId: { not: user.id }, OR: [{ takerId: user.id }, { takerId: null }], shift: { unitId: { in: ctx.unitIds }, status: 'swap_requested', date: { gte: dbDate(now) } } },
      include, orderBy: { shift: { date: 'asc' } },
    }),
    db.swapRequest.findMany({ where: { requesterId: user.id, createdAt: { gte: addDays(now, -30) } }, include, orderBy: { createdAt: 'desc' } }),
    canManage && unit
      ? db.swapRequest.findMany({ where: { status: 'requested', acceptedAt: { not: null }, shift: { unitId: unit.id, status: 'swap_requested' } }, include, orderBy: { shift: { date: 'asc' } } })
      : Promise.resolve([]),
  ])
  const mine = mineAll.filter((r) => r.takerId !== r.requesterId) // ohne Bewerbungen auf offene Dienste
  const ids = [...new Set([...incoming, ...mine, ...approvals].flatMap((r) => [r.requesterId, r.takerId]).filter((x): x is string => !!x))]
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } })
  const name = (id: string | null) => {
    const u = users.find((x) => x.id === id)
    return u ? `${u.firstName} ${u.lastName}` : '–'
  }
  const when = (s: { date: Date; shiftType: { code: string; name: string; start: string; end: string } }) => {
    const d = fromDbDate(s.date)
    return (
      <span className="nowrap"><span className={'sh ' + s.shiftType.code}>{s.shiftType.code}</span> <span className="mono">{weekdayShort(d, locale)} {fmtDayMonth(d, locale)}</span> <span className="small muted mono">{s.shiftType.start}–{s.shiftType.end}</span></span>
    )
  }
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now, locale)

  // Qualifikationsabdeckung nach dem Tausch (mindestens eine Person der höchsten Qualifikation pro Dienst).
  const key = canManage && approvals.length ? await keyQualification(ctx.org.id) : null
  const qualLoss = new Map<string, boolean>()
  if (key) {
    for (const r of approvals) {
      const others = await db.shift.findMany({ where: { unitId: r.shift.unitId, date: r.shift.date, shiftTypeId: r.shift.shiftTypeId, userId: { not: null }, id: { not: r.shiftId } }, select: { userId: true } })
      const q = await qualifiedUserIds(key.id, [...others.map((o) => o.userId!), r.takerId!].filter(Boolean))
      const day = fromDbDate(r.shift.date)
      qualLoss.set(r.id, !others.some((o) => hasQualOn(q, o.userId!, day)) && !hasQualOn(q, r.takerId!, day))
    }
  }

  const statusOf = (r: (typeof mine)[number]) =>
    r.status === 'approved' ? <span className="tag ok">{t('schedule.approval.approved')}</span>
    : r.status === 'rejected' ? <span className="tag crit">{t('schedule.approval.rejected')}</span>
    : r.acceptedAt ? <span className="tag violet">{t('schedule.swap.waitingLead')}</span>
    : <span className="tag warn">{t('schedule.swap.waitingTaker')}</span>

  return (
    <>
      {canManage && (
        <section className="stack-sm" aria-labelledby="ap">
          <div className="sec-head"><h2 className="sec" id="ap">{t('schedule.swap.approvals')}</h2><span className={'pill' + (approvals.length ? ' warn' : '')}>{approvals.length}</span></div>
          {approvals.length ? (
            <div className="tablewrap rwrap">
              <table className="stable rtable">
                <thead><tr><th>{t('schedule.cols.shift')}</th><th>{t('schedule.cols.requester')}</th><th>{t('schedule.cols.taker')}</th><th>{t('schedule.swap.note')}</th><th className="right"><span className="sr-only">{t('schedule.cols.actions')}</span></th></tr></thead>
                <tbody>
                  {approvals.map((r) => (
                    <tr key={r.id}>
                      <td>{when(r.shift)}</td>
                      <td data-label={t('schedule.cols.requester')}>{name(r.requesterId)}</td>
                      <td data-label={t('schedule.cols.taker')}>{name(r.takerId)}{qualLoss.get(r.id) && key && <div><span className="tag warn">{t('schedule.swap.qualLoss', { qual: key.name })}</span></div>}</td>
                      <td className="small fg2">{r.note}</td>
                      <td className="right nowrap r-act">
                        <ActButton action={decideSwapAction.bind(null, r.id, true)} className="btn sm primary">{t('schedule.swap.approve')}</ActButton>{' '}
                        <ActButton action={decideSwapAction.bind(null, r.id, false)} className="btn sm ghost">{t('schedule.swap.reject')}</ActButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="empty" style={{ margin: 0 }}>{t('schedule.swap.approvalsNone')}</p>}
        </section>
      )}

      <section className="stack-sm" aria-labelledby="in">
        <div className="sec-head"><h2 className="sec" id="in">{t('schedule.swap.incoming')}</h2><span className={'pill' + (incoming.length ? ' accent' : '')}>{incoming.length}</span></div>
        {incoming.length ? (
          <ul className="list card">
            {incoming.map((r) => (
              <li key={r.id} className="li" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <div className="grow">
                  <div>{name(r.requesterId)} <span className="small muted" style={{ fontWeight: 400 }}>· {r.shift.unit.name} · {rel(r.createdAt)}</span></div>
                  <div className="small" style={{ marginTop: 2 }}>{when(r.shift)} {r.takerId ? <span className="tag accent">{t('schedule.swap.toYou')}</span> : <span className="tag">{t('schedule.swap.open')}</span>}</div>
                  {r.note && <div className="small fg2" style={{ marginTop: 2 }}>{r.note}</div>}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <ActButton action={acceptSwapAction.bind(null, r.id)} className="btn sm primary">{t('schedule.swap.accept')}</ActButton>
                  {r.takerId === user.id && <ActButton action={declineSwapAction.bind(null, r.id)} className="btn sm ghost">{t('schedule.swap.decline')}</ActButton>}
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="empty" style={{ margin: 0 }}>{t('schedule.swap.incomingNone')}</p>}
      </section>

      <section className="stack-sm" aria-labelledby="my">
        <h2 className="sec" id="my">{t('schedule.swap.mine')}</h2>
        {mine.length ? (
          <div className="tablewrap rwrap">
            <table className="stable rtable">
              <thead><tr><th>{t('schedule.cols.shift')}</th><th>{t('schedule.cols.taker')}</th><th>{t('schedule.cols.status')}</th><th>{t('schedule.swap.note')}</th><th className="right"><span className="sr-only">{t('schedule.cols.actions')}</span></th></tr></thead>
              <tbody>
                {mine.map((r) => (
                  <tr key={r.id}>
                    <td>{when(r.shift)}</td>
                    <td data-label={t('schedule.cols.taker')}>{r.takerId ? name(r.takerId) : <span className="muted">{t('schedule.swap.anyone')}</span>}</td>
                    <td>{statusOf(r)}</td>
                    <td className="small fg2">{r.note}</td>
                    <td className="right r-act">{r.status === 'requested' && <ActButton action={cancelSwapAction.bind(null, r.id)} className="btn sm ghost" confirm="schedule.swap.cancelConfirm" context={when(r.shift)}>{t('schedule.swap.cancel')}</ActButton>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty"><span>{t('schedule.swap.mineNone')}</span><Link className="btn sm" href="/schedule">{t('schedule.ux.swapHow')}</Link></div>
        )}
        <p className="small muted" style={{ margin: 0 }}>{t('schedule.swap.flow')}</p>
      </section>
    </>
  )
}
