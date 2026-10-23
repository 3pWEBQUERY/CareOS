import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { fmtDate, hm } from '@/lib/time'
import { RETENTION_ACTION, RETENTION_CATEGORIES, RETENTION_RULES, lastDailySlot } from '@/lib/retention-policy'
import { retentionPreview } from '@/lib/retention'
import { PORTAL_ORPHAN_DAYS, PORTAL_RETENTION_KEYS } from '@/lib/portal/retention'
import { Forbidden } from '@/components/ui/Empty'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { ActBtn } from '@/components/admin/ui'
import { AdminHead } from '../Head'
import { runRetentionNowAction, saveRetentionAction } from './actions'
import { Checkbox, NumberField } from '@/components/ui/fields'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: `${t('admin.nav.privacy')} · ${t('nav.admin')}` }
}

/** Portal-Daten im Probelauf: Kommunikation nach Frist «chat», Sitzungen nach «sessions», verwaiste Konten/Einladungen nach PORTAL_ORPHAN_DAYS. */
type PortalKey = (typeof PORTAL_RETENTION_KEYS)[number]
const PORTAL_BASIS: Record<PortalKey, 'chat' | 'sessions' | 'orphan'> = {
  portalMessages: 'chat', portalThreads: 'chat', portalVisits: 'chat', portalUpdates: 'chat', portalSessions: 'sessions', portalInvites: 'orphan', portalAccounts: 'orphan',
}
const SUMMARY_KEYS = [...RETENTION_CATEGORIES, ...PORTAL_RETENTION_KEYS, 'files'] as const

export default async function PrivacyPage() {
  const ctx = await getCtx()
  const { t, org, locale } = ctx
  if (!ctx.can('admin.org')) return <Forbidden text={t('common.notAllowed')} />
  const now = new Date()
  const [{ policy, cutoffs, counts }, runs] = await Promise.all([
    retentionPreview(org.id, undefined, now),
    db.jobRun.findMany({ where: { name: 'retention', orgId: org.id }, orderBy: { startedAt: 'desc' }, take: 20 }),
  ])
  const actors = await db.user.findMany({ where: { orgId: org.id, id: { in: runs.map((r) => r.actorId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } })
  const actor = (id: string | null) => {
    const u = actors.find((a) => a.id === id)
    return u ? `${u.firstName.charAt(0)}. ${u.lastName}` : null
  }
  const when = (d: Date) => `${fmtDate(d, locale)} ${hm(d)}`
  const next = lastDailySlot(new Date(now.getTime() + 86400_000), '02:30', 'Europe/Zurich')
  const portalCount = (k: PortalKey) => counts[k] ?? 0
  const showPortal = ctx.hasModule('portals') || PORTAL_RETENTION_KEYS.some((k) => portalCount(k) > 0)
  const orphanCutoff = new Date(now.getTime() - PORTAL_ORPHAN_DAYS * 86400_000)
  const summary = (s: unknown) => {
    const o = (s && typeof s === 'object' ? s : {}) as Record<string, number>
    const parts = SUMMARY_KEYS.filter((k) => Number(o[k]) > 0).map((k) => `${t('admin.privacy.short.' + k)} ${o[k]}`)
    return parts.length ? parts.join(' · ') : t('admin.privacy.nothing')
  }

  return (
    <main className="panel main">
      <AdminHead section={t('admin.title')} title={t('admin.nav.privacy')} sub={t('admin.privacy.sub')} />
      <div className="scroll">
        <div className="tabpanel">
          <div className="alert info" role="note">
            <span className="grow"><strong>{t('admin.privacy.legalTitle')}</strong><span className="fg">{t('admin.privacy.legal')}</span></span>
          </div>

          <section className="card" aria-labelledby="p-policy">
            <div className="card-head"><h2 id="p-policy">{t('admin.privacy.policy')}</h2><span className="small muted">{t('admin.privacy.policyHint')}</span></div>
            <div className="card-body">
              <ActionForm action={saveRetentionAction} reset={false} success="common.saved">
                <div className="tablewrap">
                  <table className="stable">
                    <thead>
                      <tr>
                        <th>{t('admin.privacy.category')}</th>
                        <th>{t('admin.privacy.period')}</th>
                        <th>{t('admin.privacy.limits')}</th>
                        <th>{t('admin.privacy.consequence')}</th>
                        <th>{t('admin.privacy.preview')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {RETENTION_CATEGORIES.map((c) => {
                        const r = RETENTION_RULES[c]
                        const unit = t('admin.privacy.units.' + r.unit)
                        const n = counts[c]
                        const anonymise = RETENTION_ACTION[c] === 'anonymise'
                        return (
                          <tr key={c}>
                            <th scope="row" style={{ minWidth: 220 }}>
                              <div>{t('admin.privacy.cat.' + c)}</div>
                              <div className="small muted" style={{ fontWeight: 400, maxWidth: '52ch' }}>{t('admin.privacy.catHint.' + c)}</div>
                            </th>
                            <td className="nowrap">
                              <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                                <NumberField name={c} min={r.min} max={r.max} step={1} defaultValue={policy[c]} required style={{ width: 84 }} aria-label={`${t('admin.privacy.cat.' + c)} (${unit})`} />
                                <span className="small muted">{unit}</span>
                              </span>
                            </td>
                            <td className="mono small muted nowrap">{r.min}–{r.max}</td>
                            <td>{anonymise ? <span className="tag accent">{t('admin.privacy.anonymise')}</span> : <span className="tag outline">{t('admin.privacy.delete')}</span>}</td>
                            <td className="small nowrap">
                              <div className={n > 0 ? 'warn-text' : 'muted'}>{t(anonymise ? 'admin.privacy.wouldAnonymise' : 'admin.privacy.wouldDelete', { n })}</div>
                              <div className="muted mono" style={{ fontSize: '0.6875rem' }}>{t('admin.privacy.cutoff', { date: fmtDate(cutoffs[c], locale) })}</div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <Checkbox name="auto" defaultChecked={policy.auto} label={t('admin.privacy.auto')} />
                <div className="form-actions"><Submit>{t('common.save')}</Submit></div>
              </ActionForm>
            </div>
          </section>

          {showPortal && (
            <section className="card" aria-labelledby="p-portal">
              <div className="card-head"><h2 id="p-portal">{t('admin.privacy.portalTitle')}</h2><span className="small muted">{t('admin.privacy.portalHint', { days: PORTAL_ORPHAN_DAYS })}</span></div>
              <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}>
                <table className="stable">
                  <thead>
                    <tr>
                      <th>{t('admin.privacy.category')}</th>
                      <th>{t('admin.privacy.period')}</th>
                      <th>{t('admin.privacy.consequence')}</th>
                      <th>{t('admin.privacy.preview')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PORTAL_RETENTION_KEYS.map((k) => {
                      const n = portalCount(k)
                      const basis = PORTAL_BASIS[k]
                      const cut = basis === 'orphan' ? orphanCutoff : cutoffs[basis]
                      return (
                        <tr key={k}>
                          <th scope="row" style={{ minWidth: 220 }}>{t('admin.privacy.portal.' + k)}</th>
                          <td className="small nowrap">{t('admin.privacy.portalBasis.' + basis, { days: PORTAL_ORPHAN_DAYS })}</td>
                          <td><span className="tag outline">{t('admin.privacy.delete')}</span></td>
                          <td className="small nowrap">
                            <div className={n > 0 ? 'warn-text' : 'muted'}>{t('admin.privacy.wouldDelete', { n })}</div>
                            <div className="muted mono" style={{ fontSize: '0.6875rem' }}>{t('admin.privacy.cutoff', { date: fmtDate(cut, locale) })}</div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {counts.missingDischarge > 0 && (
            <div className="alert warn" role="status"><span className="grow">{t('admin.privacy.missingDischarge', { n: counts.missingDischarge })}</span></div>
          )}

          <section className="card" aria-labelledby="p-run">
            <div className="card-head">
              <h2 id="p-run">{t('admin.privacy.runTitle')}</h2>
              <span className="small muted">{policy.auto ? t('admin.privacy.autoOn', { at: when(next) }) : t('admin.privacy.autoOff')}</span>
            </div>
            <div className="card-body row-between">
              <p className="fg2" style={{ margin: 0, maxWidth: '70ch' }}>{t('admin.privacy.runHint')}</p>
              <ActBtn
                action={runRetentionNowAction}
                className="btn danger"
                confirm="admin.privacy.runConfirm"
                context={<span>{t('admin.ux.runAffected', { n: RETENTION_CATEGORIES.reduce((n, c) => n + counts[c], 0) + PORTAL_RETENTION_KEYS.reduce((n, k) => n + portalCount(k), 0) })}</span>}
                consequences={[
                  ...RETENTION_CATEGORIES.filter((c) => counts[c] > 0).map((c) => `${t('admin.privacy.cat.' + c)}: ${t(RETENTION_ACTION[c] === 'anonymise' ? 'admin.privacy.wouldAnonymise' : 'admin.privacy.wouldDelete', { n: counts[c] })}`),
                  ...PORTAL_RETENTION_KEYS.filter((k) => portalCount(k) > 0).map((k) => `${t('admin.privacy.short.' + k)}: ${t('admin.privacy.wouldDelete', { n: portalCount(k) })}`),
                ]}
                ack={t('admin.ux.runAck')}
              >{t('admin.privacy.run')}</ActBtn>
            </div>
          </section>

          <section className="stack-sm" aria-labelledby="p-hist">
            <div className="sec-head"><h2 className="sec" id="p-hist">{t('admin.privacy.history')}</h2></div>
            {runs.length ? (
              <div className="tablewrap">
                <table className="stable">
                  <thead>
                    <tr>
                      <th>{t('admin.privacy.started')}</th>
                      <th>{t('admin.privacy.trigger')}</th>
                      <th className="right">{t('admin.privacy.duration')}</th>
                      <th>{t('admin.privacy.result')}</th>
                      <th>{t('admin.privacy.category')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={r.id}>
                        <td className="num small nowrap">{when(r.startedAt)}</td>
                        <td className="small nowrap">{t('admin.privacy.triggers.' + (r.trigger === 'manual' ? 'manual' : 'schedule'))}{actor(r.actorId) && <span className="muted"> · {actor(r.actorId)}</span>}</td>
                        <td className="num small right">{r.finishedAt ? `${Math.max(0, Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 100) / 10)} s` : '–'}</td>
                        <td>
                          {r.ok === true ? <span className="tag ok">{t('admin.privacy.ok')}</span> : r.ok === false ? <span className="tag crit">{t('admin.privacy.error')}</span> : <span className="tag">{t('admin.privacy.running')}</span>}
                        </td>
                        <td className="small">{r.ok === false ? <span className="crit-text">{r.error}</span> : summary(r.summary)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="empty">{t('admin.privacy.noRuns')}</p>}
          </section>

          <section className="card" aria-labelledby="p-rights">
            <div className="card-head"><h2 id="p-rights">{t('admin.privacy.rights')}</h2></div>
            <div className="card-body"><p className="fg2" style={{ margin: 0, maxWidth: '70ch' }}>{t('admin.privacy.rightsText')}</p></div>
          </section>
        </div>
      </div>
    </main>
  )
}
