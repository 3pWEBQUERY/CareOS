import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { addDays, dateKey, dbDate, fmtDbDate, startOfDay } from '@/lib/time'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { ActButton } from '../../team/_ui/ActButton'
import { decideAbsenceAction, requestAbsenceAction, withdrawAbsenceAction } from '../actions'
import { unitStaff } from '../lib'
import { DateField, Select, TextField } from '@/components/ui/fields'

const dayCount = (a: { from: Date; to: Date }) => Math.round((a.to.getTime() - a.from.getTime()) / 864e5) + 1
const tone = (s: string) => (s === 'approved' ? 'ok' : s === 'rejected' ? 'crit' : 'warn')

/** Abwesenheiten: Ferien und andere beantragen, Krankheit melden; Leitung genehmigt (PRD §19). */
export async function AbsencesView({ ctx, now, canManage }: { ctx: Ctx; now: Date; canManage: boolean }) {
  const { t, user, unit, locale } = ctx
  const today = dateKey(now)
  const mine = await db.absence.findMany({ where: { userId: user.id, to: { gte: dbDate(addDays(now, -90)) } }, orderBy: { from: 'desc' } })

  let team: { pending: Awaited<ReturnType<typeof db.absence.findMany>>; upcoming: Awaited<ReturnType<typeof db.absence.findMany>>; names: Map<string, string>; conflicts: Map<string, number> } | null = null
  if (canManage && unit) {
    const staff = (await unitStaff(ctx.org.id, unit.id, addDays(now, -30), addDays(now, 60))).filter((s) => s.id !== user.id)
    const ids = staff.map((s) => s.id)
    const [pending, upcoming] = await Promise.all([
      db.absence.findMany({ where: { userId: { in: ids }, status: 'requested' }, orderBy: { from: 'asc' } }),
      db.absence.findMany({ where: { userId: { in: ids }, status: 'approved', to: { gte: dbDate(now) }, from: { lte: dbDate(addDays(now, 42)) } }, orderBy: { from: 'asc' } }),
    ])
    const conflicts = new Map<string, number>()
    for (const a of [...pending, ...upcoming]) conflicts.set(a.id, await db.shift.count({ where: { userId: a.userId, status: { not: 'cancelled' }, date: { gte: a.from, lte: a.to } } }))
    team = { pending, upcoming, names: new Map(staff.map((s) => [s.id, s.name])), conflicts }
  }

  return (
    <>
      <section className="stack-sm" aria-labelledby="mine">
        <h2 className="sec" id="mine">{t('schedule.absence.mine')}</h2>
        {mine.length ? (
          <div className="tablewrap rwrap">
            <table className="stable rtable">
              <thead><tr><th>{t('schedule.cols.kind')}</th><th>{t('schedule.cols.period')}</th><th className="right">{t('schedule.cols.days')}</th><th>{t('schedule.cols.status')}</th><th>{t('schedule.absence.note')}</th><th className="right"><span className="sr-only">{t('schedule.cols.actions')}</span></th></tr></thead>
              <tbody>
                {mine.map((a) => (
                  <tr key={a.id}>
                    <td><span className="sh abs">{t('schedule.absence.short.' + a.kind)}</span> {t('schedule.absence.kinds.' + a.kind)}</td>
                    <td className="num nowrap" data-label={t('schedule.cols.period')}>{fmtDbDate(a.from, locale)} – {fmtDbDate(a.to, locale)}</td>
                    <td className="num right" data-label={t('schedule.cols.days')}>{dayCount(a)}</td>
                    <td><span className={'tag ' + tone(a.status)}>{t('schedule.approval.' + a.status)}</span></td>
                    <td className="small fg2">{a.note}</td>
                    <td className="right r-act">
                      {(a.status === 'requested' || a.from >= dbDate(startOfDay(now))) && (
                        <ActButton action={withdrawAbsenceAction.bind(null, a.id)} className="btn sm ghost" confirm="schedule.absence.withdrawConfirm" context={<span><strong>{t('schedule.absence.kinds.' + a.kind)}</strong> · {fmtDbDate(a.from, locale)} – {fmtDbDate(a.to, locale)}</span>}>{t('schedule.absence.withdraw')}</ActButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="empty" style={{ margin: 0 }}>{t('schedule.absence.none')}</p>}
      </section>

      <div className="grid-2">
        <section className="card" aria-labelledby="req">
          <div className="card-head"><h2 id="req">{t('schedule.absence.request')}</h2></div>
          <div className="card-body">
            <ActionForm action={requestAbsenceAction} success="schedule.absence.saved">
              <div className="form-grid">
                <Select label={t('schedule.cols.kind')} wrapClassName="span-all" name="kind" defaultValue="vacation">
                    {(['vacation', 'training', 'compensation', 'other'] as const).map((k) => <option key={k} value={k}>{t('schedule.absence.kinds.' + k)}</option>)}
                  </Select>
                <DateField label={t('schedule.absence.from')} name="from" min={today} required />
                <DateField label={t('schedule.absence.to')} name="to" min={today} required />
                <TextField label={t('schedule.absence.note')} optional wrapClassName="span-all" name="note" maxLength={500} />
              </div>
              <div className="form-actions"><Submit>{t('schedule.absence.submit')}</Submit></div>
            </ActionForm>
          </div>
        </section>
        <section className="card" aria-labelledby="sick">
          <div className="card-head"><h2 id="sick">{t('schedule.absence.sick')}</h2></div>
          <div className="card-body stack-sm">
            <p className="small muted" style={{ margin: 0 }}>{t('schedule.absence.sickHint')}</p>
            <ActionForm action={requestAbsenceAction} success="schedule.absence.sickSaved" confirm="schedule.absence.sickConfirm">
              <input type="hidden" name="kind" value="sick" />
              <div className="form-grid">
                <DateField label={t('schedule.absence.from')} name="from" defaultValue={today} required />
                <DateField label={t('schedule.absence.toExpected')} name="to" defaultValue={today} required />
                <TextField label={t('schedule.absence.note')} optional wrapClassName="span-all" name="note" maxLength={500} />
              </div>
              <div className="form-actions"><Submit className="btn danger">{t('schedule.absence.reportSick')}</Submit></div>
            </ActionForm>
          </div>
        </section>
      </div>

      {team && (
        <>
          <section className="stack-sm" aria-labelledby="tp">
            <div className="sec-head"><h2 className="sec" id="tp">{t('schedule.absence.team')}</h2><span className={'pill' + (team.pending.length ? ' warn' : '')}>{team.pending.length}</span></div>
            {team.pending.length ? (
              <div className="tablewrap rwrap">
                <table className="stable rtable">
                  <thead><tr><th>{t('schedule.cols.person')}</th><th>{t('schedule.cols.kind')}</th><th>{t('schedule.cols.period')}</th><th className="right">{t('schedule.cols.days')}</th><th>{t('schedule.absence.conflicts')}</th><th className="right"><span className="sr-only">{t('schedule.cols.actions')}</span></th></tr></thead>
                  <tbody>
                    {team.pending.map((a) => {
                      const c = team!.conflicts.get(a.id) ?? 0
                      return (
                        <tr key={a.id}>
                          <th scope="row">{team!.names.get(a.userId)}{a.note && <div className="small muted" style={{ fontWeight: 400 }}>{a.note}</div>}</th>
                          <td>{t('schedule.absence.kinds.' + a.kind)}</td>
                          <td className="num nowrap" data-label={t('schedule.cols.period')}>{fmtDbDate(a.from, locale)} – {fmtDbDate(a.to, locale)}</td>
                          <td className="num right" data-label={t('schedule.cols.days')}>{dayCount(a)}</td>
                          <td>{c ? <span className="tag warn">{t('schedule.absence.conflict', { n: c })}</span> : <span className="muted small">–</span>}</td>
                          <td className="right nowrap r-act">
                            <ActButton action={decideAbsenceAction.bind(null, a.id, true)} className="btn sm primary">{t('schedule.absence.approve')}</ActButton>{' '}
                            <ActButton action={decideAbsenceAction.bind(null, a.id, false)} className="btn sm ghost">{t('schedule.absence.reject')}</ActButton>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : <p className="empty" style={{ margin: 0 }}>{t('schedule.absence.teamNone')}</p>}
          </section>
          <section className="stack-sm" aria-labelledby="tu">
            <h2 className="sec" id="tu">{t('schedule.absence.upcoming')}</h2>
            {team.upcoming.length ? (
              <ul className="list card">
                {team.upcoming.map((a) => {
                  const c = team!.conflicts.get(a.id) ?? 0
                  return (
                    <li key={a.id} className="li" style={{ alignItems: 'center' }}>
                      <span className="sh abs">{t('schedule.absence.short.' + a.kind)}</span>
                      <span className="grow">{team!.names.get(a.userId)} <span className="small muted" style={{ fontWeight: 400 }}>{t('schedule.absence.kinds.' + a.kind)}</span></span>
                      {c > 0 && <span className="tag crit">{t('schedule.absence.conflict', { n: c })}</span>}
                      <span className="mono small nowrap">{fmtDbDate(a.from, locale)} – {fmtDbDate(a.to, locale)}</span>
                    </li>
                  )
                })}
              </ul>
            ) : <p className="empty" style={{ margin: 0 }}>{t('schedule.absence.upcomingNone')}</p>}
          </section>
        </>
      )}
    </>
  )
}
