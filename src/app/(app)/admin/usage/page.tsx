import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { fmtDate, fmtNum } from '@/lib/time'
import { MIN_GROUP, timeReturnedReport, usageReport } from '@/lib/usage'
import { Forbidden, Empty } from '@/components/ui/Empty'
import { BarChart } from '@/components/ui/BarChart'
import { ActBtn } from '@/components/admin/ui'
import { AdminHead } from '../Head'
import { setFeedbackStatusAction } from './actions'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: `${t('platform.usage.title')} · ${t('nav.admin')}` }
}

/** Produktkennzahlen und Rückmeldungen (PRD §62–§65), nur als Summen. */
export default async function UsagePage() {
  const ctx = await getCtx()
  const { t, locale } = ctx
  if (!ctx.can('admin.org')) return <Forbidden text={t('common.notAllowed')} />
  const [r, trc, feedback] = await Promise.all([
    usageReport(ctx.org.id),
    timeReturnedReport(ctx.org.id),
    db.feedback.findMany({ where: { orgId: ctx.org.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ])
  const authors = await db.user.findMany({ where: { id: { in: feedback.map((f) => f.userId).filter((x): x is string => !!x) }, orgId: ctx.org.id }, select: { id: true, firstName: true, lastName: true } })
  const who = new Map(authors.map((u) => [u.id, `${u.firstName} ${u.lastName}`]))
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
  const mins = (n: number | null) => (n == null ? '–' : t('platform.usage.minutes', { n }))
  const adoption = [...r.adoption].sort((a, b) => b.users - a.users || b.events - a.events)
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date()
    d.setHours(12, 0, 0, 0)
    d.setDate(d.getDate() - 13 + i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return { key, d, n: r.trend.find((x) => x.day === key)?.n ?? 0 }
  })
  const dt = (d: Date) => fmtDate(d, locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  return (
    <main className="panel main">
      <AdminHead section={t('admin.title')} title={t('platform.usage.title')} sub={t('platform.usage.sub')} />
      <div className="scroll" data-scroll>
        <div className="tabpanel">
          <div className="metrics">
            <div className="metric"><span className="lbl">{t('platform.usage.dau')}</span><span className="val">{r.dau}</span></div>
            <div className="metric"><span className="lbl">{t('platform.usage.wau')}</span><span className="val">{r.wau}</span></div>
            <div className="metric"><span className="lbl">{t('platform.usage.mau')}</span><span className="val">{r.mau}<small> / {r.accounts} {t('platform.usage.accounts')}</small></span></div>
            <div className="metric"><span className="lbl">{t('platform.usage.stickiness')}</span><span className="val">{r.mau ? `${pct(r.dau, r.mau)} %` : '–'}</span></div>
          </div>
          <p className="small muted" style={{ margin: 0, maxWidth: '80ch' }}>{t('platform.usage.privacy')}</p>

          <div className="grid-2">
            <section className="card" aria-labelledby="u-trend">
              <div className="card-head"><h2 id="u-trend">{t('platform.usage.trend')}</h2></div>
              <div className="card-body">
                <BarChart
                  title={t('platform.usage.dau')}
                  unit=""
                  current={String(r.dau)}
                  bars={days.map((x) => ({ label: String(x.d.getDate()), title: fmtDate(x.d, locale), v: x.n }))}
                  legend={{ bar: t('platform.usage.col.users') }}
                  ariaLabel={`${t('platform.usage.trend')}: ${days.map((x) => `${fmtDate(x.d, locale, { day: '2-digit', month: '2-digit' })} ${x.n}`).join(', ')}`}
                />
              </div>
            </section>
            <section className="card" aria-labelledby="u-eff">
              <div className="card-head"><h2 id="u-eff">{t('platform.usage.efficiency')}</h2></div>
              <div className="card-body">
                <dl className="kv">
                  <dt>{t('platform.usage.ack')}</dt>
                  <dd><span className="mono">{mins(r.ack.medianMin)}</span><div className="small muted">{t('platform.usage.ackHint')} · n = {r.ack.total}</div></dd>
                  <dt>{t('platform.usage.onTime')}</dt>
                  <dd><span className="mono">{r.ack.total ? `${pct(r.ack.onTime, r.ack.total)} %` : '–'}</span></dd>
                  <dt>{t('platform.usage.handover')}</dt>
                  <dd><span className="mono">{mins(r.handover.medianMin)}</span><div className="small muted">{t('platform.usage.handoverHint')} · n = {r.handover.n}</div></dd>
                  <dt>{t('platform.usage.avg')}</dt>
                  <dd><span className="mono">{r.rating.avg != null ? `${fmtNum(r.rating.avg, 1, locale)} / 5` : '–'}</span>{r.rating.n > 0 && <span className="small muted"> · n = {r.rating.n}</span>}</dd>
                </dl>
              </div>
            </section>
          </div>

          {/* North Star «Time returned to care» (PRD §65): ausdrücklich als Schätzung mit offengelegten Annahmen */}
          <section className="card" aria-labelledby="u-trc">
            <div className="card-head"><h2 id="u-trc">{t('insights.trc.title')}</h2><span className="tag outline">{t('insights.trc.estimate')}</span></div>
            <div className="card-body stack-sm">
              <div className="metrics">
                <div className="metric"><span className="lbl">{t('insights.trc.total')}</span><span className="val">{fmtNum(trc.totalMin / 60, 1, locale)} <small>h</small></span></div>
                <div className="metric"><span className="lbl">{t('insights.trc.perUser')}</span><span className="val">{trc.perUserWeekMin != null ? <>{trc.perUserWeekMin} <small>{t('common.minutes')}</small></> : <span className="muted">{t('platform.usage.few')}</span>}</span></div>
              </div>
              <div className="tablewrap">
                <table className="stable">
                  <thead><tr><th>{t('insights.trc.col.source')}</th><th className="right">{t('insights.trc.col.count')}</th><th className="right">{t('insights.trc.col.assumption')}</th><th className="right">{t('insights.trc.col.minutes')}</th></tr></thead>
                  <tbody>
                    {trc.rows.map((x) => (
                      <tr key={x.key}>
                        <th scope="row" style={{ fontWeight: 400 }}>{t('insights.trc.src.' + x.key)}</th>
                        <td className="num right">{x.n}</td>
                        <td className="num right">{fmtNum(x.perEvent, 1, locale)} {t('common.minutes')}</td>
                        <td className="num right">{x.minutes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="small muted" style={{ margin: 0, maxWidth: '80ch' }}>{t('insights.trc.hint')}</p>
            </div>
          </section>

          <section className="card" aria-labelledby="u-adopt">
            <div className="card-head"><h2 id="u-adopt">{t('platform.usage.adoption')}</h2></div>
            <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}>
              <table className="stable">
                <thead><tr><th>{t('platform.usage.col.module')}</th><th className="right">{t('platform.usage.col.users')}</th><th>{t('platform.usage.col.share')}</th><th className="right">{t('platform.usage.col.events')}</th></tr></thead>
                <tbody>
                  {adoption.map((m) => {
                    const few = m.users > 0 && m.users < MIN_GROUP
                    const share = pct(m.users, r.mau)
                    return (
                      <tr key={m.key}>
                        <th scope="row" style={{ fontWeight: 400 }}>{t('platform.usage.modules.' + m.key)}</th>
                        <td className="num right">{few ? <span className="muted">{t('platform.usage.few')}</span> : m.users}</td>
                        <td style={{ minWidth: 120 }}>{few ? <span className="muted">–</span> : <div className="row" style={{ gap: 8 }}><div className="bar grow" aria-hidden="true"><i style={{ width: share + '%' }} /></div><span className="mono small">{share} %</span></div>}</td>
                        <td className="num right">{few ? '–' : m.events}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card" aria-labelledby="feedback-h" id="feedback">
            <div className="card-head"><h2 id="feedback-h">{t('platform.usage.feedback')}</h2></div>
            {feedback.length ? (
              <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}>
                <table className="stable">
                  <thead><tr><th>{t('platform.usage.fcol.when')}</th><th>{t('platform.usage.fcol.kind')}</th><th>{t('platform.usage.fcol.text')}</th><th>{t('platform.usage.fcol.page')}</th><th>{t('platform.usage.fcol.from')}</th><th>{t('platform.usage.fcol.status')}</th><th><span className="sr-only">{t('admin.common.actions')}</span></th></tr></thead>
                  <tbody>
                    {feedback.map((f) => (
                      <tr key={f.id}>
                        <td className="num nowrap">{dt(f.createdAt)}</td>
                        <td><span className={'tag' + (f.kind === 'problem' ? ' warn' : f.kind === 'idea' ? ' accent' : '')}>{t('platform.feedback.kinds.' + f.kind)}{f.rating ? ` ${f.rating}/5` : ''}</span></td>
                        <td style={{ maxWidth: 420, overflowWrap: 'anywhere' }}>{f.text ?? <span className="muted">–</span>}</td>
                        <td className="mono small">{f.path ?? '–'}</td>
                        <td className="small">{f.userId ? who.get(f.userId) ?? '–' : <span className="muted">{t('platform.usage.anonymous')}</span>}</td>
                        <td><span className={'tag' + (f.status === 'new' ? ' accent' : f.status === 'done' ? ' ok' : '')}>{t('platform.usage.fstatus.' + f.status)}</span></td>
                        <td className="right nowrap">
                          {f.status === 'new' && <ActBtn action={setFeedbackStatusAction.bind(null, f.id, 'seen')} className="btn sm ghost">{t('platform.usage.markSeen')}</ActBtn>}
                          {f.status !== 'done' && <ActBtn action={setFeedbackStatusAction.bind(null, f.id, 'done')} className="btn sm">{t('platform.usage.markDone')}</ActBtn>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty title={t('platform.usage.feedbackNone')} />}
          </section>
        </div>
      </div>
    </main>
  )
}
