import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { fmtDate, hm } from '@/lib/time'
import { EMERGENCY_MINUTES, EMERGENCY_REASON_MIN, emergencyRemaining, emergencyStatus } from '@/lib/emergency-core'
import { closeExpiredEmergencies } from '@/lib/emergency'
import { Forbidden, Empty } from '@/components/ui/Empty'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { ActBtn } from '@/components/admin/ui'
import { Checkbox, Select, Textarea } from '@/components/ui/fields'
import { AdminHead } from '../Head'
import { endEmergencyAction, startEmergencyAction } from './actions'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: `${t('tenancy.emergency.title')} · ${t('nav.admin')}` }
}

/** Notfallzugriff (PRD §34/§37): starten (admin.emergency), Verlauf und vorzeitiges Beenden (admin.audit: alle, sonst eigene). */
export default async function EmergencyPage() {
  const ctx = await getCtx()
  const { t, locale } = ctx
  const canStart = ctx.can('admin.emergency')
  const canReview = ctx.can('admin.audit')
  if (!canStart && !canReview) return <Forbidden text={t('common.notAllowed')} />
  await closeExpiredEmergencies(ctx.org.id)
  const now = new Date()
  const rows = await db.emergencyAccess.findMany({
    where: { orgId: ctx.org.id, ...(canReview ? {} : { userId: ctx.user.id }) },
    orderBy: { startedAt: 'desc' },
    take: 50,
  })
  const people = await db.user.findMany({ where: { orgId: ctx.org.id, id: { in: [...new Set(rows.flatMap((r) => [r.userId, r.endedById].filter((x): x is string => !!x)))] } }, select: { id: true, firstName: true, lastName: true } })
  const name = (id: string | null) => { const p = people.find((u) => u.id === id); return p ? `${p.firstName} ${p.lastName}` : '–' }
  const dtm = (d: Date) => fmtDate(d, locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const own = ctx.emergency
  const clinical = !own && ctx.can('resident.read')
  const dur = (m: number) => (m < 60 ? t('tenancy.emergency.minutes', { n: m }) : t('tenancy.emergency.hours', { n: m / 60 }))

  return (
    <main className="panel main">
      <AdminHead section={t('admin.title')} title={t('tenancy.emergency.title')} sub={t('tenancy.emergency.sub')} />
      <div className="scroll">
        <div className="tabpanel">
          {canStart && (
            <section className="card" aria-labelledby="em-start">
              <div className="card-head"><h2 id="em-start">{t('tenancy.emergency.start')}</h2></div>
              <div className="card-body stack-sm">
                <p className="fg2" style={{ margin: 0, maxWidth: '75ch' }}>{t('tenancy.emergency.grants')}</p>
                {own ? (
                  <div className="alert crit" role="status"><span className="grow"><strong className="em-title">{t('tenancy.emergency.activeTitle')}</strong> {t('tenancy.emergency.activeUntil', { time: hm(own.expiresAt), n: emergencyRemaining({ ...own, endedAt: null }, now) })}</span></div>
                ) : clinical ? (
                  <div className="alert" role="status"><span className="grow">{t('tenancy.emergency.notAvailable')}</span></div>
                ) : (
                  <ActionForm action={startEmergencyAction} success="tenancy.emergency.started" confirm={{ title: t('tenancy.emergency.start') + '?', text: t('tenancy.emergency.grants'), consequences: [t('tenancy.emergency.notify.title') + ': ' + t('admin.nav.emergencyHint')], danger: true }}>
                    <Textarea label={t('tenancy.emergency.reason')} hint={t('tenancy.emergency.reasonHint')} name="reason" rows={3} required minLength={EMERGENCY_REASON_MIN} maxLength={500} wrapStyle={{ maxWidth: 640 }} />
                    <Select label={t('tenancy.emergency.duration')} name="minutes" defaultValue="60" wrapStyle={{ maxWidth: 240 }}>
                      {EMERGENCY_MINUTES.map((m) => <option key={m} value={String(m)}>{dur(m)}</option>)}
                    </Select>
                    <Checkbox name="confirm" required label={t('tenancy.emergency.confirm')} />
                    <div className="form-actions"><Submit className="btn danger">{t('tenancy.emergency.start')}</Submit></div>
                  </ActionForm>
                )}
              </div>
            </section>
          )}
          <h2 className="sec">{t('tenancy.emergency.history')}</h2>
          {rows.length ? (
            <div className="tablewrap">
              <table className="stable">
                <thead><tr><th>{t('tenancy.emergency.col.person')}</th><th>{t('tenancy.emergency.col.reason')}</th><th>{t('tenancy.emergency.col.start')}</th><th>{t('tenancy.emergency.col.end')}</th><th className="right">{t('tenancy.emergency.col.views')}</th><th>{t('tenancy.emergency.col.status')}</th><th><span className="sr-only">{t('admin.common.actions')}</span></th></tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const st = emergencyStatus(r, now)
                    return (
                      <tr key={r.id}>
                        <th scope="row">{name(r.userId)}</th>
                        <td className="small" style={{ maxWidth: 380, overflowWrap: 'anywhere' }}>{r.reason}</td>
                        <td className="num nowrap">{dtm(r.startedAt)}</td>
                        <td className="num nowrap">{dtm(r.endedAt ?? r.expiresAt)}{st === 'ended' && r.endedById && r.endedById !== r.userId && <div className="small muted">{t('tenancy.emergency.endedBy', { name: name(r.endedById) })}</div>}</td>
                        <td className="num right">{r.views}</td>
                        <td><span className={'tag ' + (st === 'active' ? 'crit' : '')}>{t('tenancy.emergency.status.' + st)}</span></td>
                        <td className="right nowrap">
                          {st === 'active' && (r.userId === ctx.user.id || canReview) && (
                            <ActBtn action={endEmergencyAction.bind(null, r.id)} className="btn sm" confirm="tenancy.emergency.endConfirm" context={<span><strong>{name(r.userId)}</strong> · {r.reason}</span>}>{t('tenancy.emergency.end')}</ActBtn>
                          )}
                          {canReview && <Link className="btn sm ghost" href={`/admin/audit?action=emergency&user=${r.userId}&from=${r.startedAt.toISOString().slice(0, 10)}`}>{t('tenancy.emergency.audit')}</Link>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : <Empty title={t('tenancy.emergency.none')}>{t('tenancy.emergency.noneHint')}</Empty>}
        </div>
      </div>
    </main>
  )
}
