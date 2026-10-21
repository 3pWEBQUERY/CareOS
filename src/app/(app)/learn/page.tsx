import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { Empty, Forbidden } from '@/components/ui/Empty'
import { certState, progress, syncExpired } from '@/lib/learn'
import { fmtDate } from '@/lib/time'
import { LearnHead, LearnTabs } from './LearnTabs'

export const metadata = { title: 'Learn' }

export default async function LearnPage() {
  const ctx = await getCtx()
  const { t, locale } = ctx
  if (!ctx.can('learn.read')) return <Forbidden text={t('common.notAllowed')} />
  await syncExpired(ctx.org.id, ctx.user.id)
  const now = new Date()
  const [enrollments, certs] = await Promise.all([
    db.enrollment.findMany({
      where: { userId: ctx.user.id, course: { orgId: ctx.org.id } },
      include: { course: { include: { modules: { select: { id: true, order: true } } } } },
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { assignedAt: 'desc' }],
    }),
    db.certificate.findMany({ where: { userId: ctx.user.id }, orderBy: { issuedAt: 'desc' } }),
  ])
  const certFor = (courseId: string) => certs.find((c) => c.courseId === courseId)
  const open = enrollments.filter((e) => e.status !== 'completed')
  const done = enrollments.filter((e) => e.status === 'completed').sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))
  const overdue = open.filter((e) => e.dueAt && e.dueAt < now)
  const latestCerts = [...new Map(certs.map((c) => [c.courseId ?? c.id, c])).values()]
  const expiring = latestCerts.filter((c) => certState(c.expiresAt, now) !== 'valid')

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <LearnHead title={t('learn.mine.title')} sub={t('learn.mine.sub', { open: open.length, done: done.length })} />
      <LearnTabs ctx={ctx} current="mine" />
      <div className="scroll">
        <div className="tabpanel">
          <div className="metrics">
            <div className="metric"><span className="lbl">{t('learn.mine.open')}</span><span className="val">{open.length}</span></div>
            <div className="metric"><span className="lbl">{t('learn.mine.overdue')}</span><span className={'val' + (overdue.length ? ' crit' : '')}>{overdue.length}</span></div>
            <div className="metric"><span className="lbl">{t('learn.mine.completed')}</span><span className="val">{done.length}</span></div>
            <Link className="metric" href="/learn/certificates"><span className="lbl">{t('learn.mine.certsAttention')}</span><span className={'val' + (expiring.length ? ' warn' : '')}>{expiring.length}</span></Link>
          </div>

          <section className="stack-sm" aria-labelledby="open">
            <div className="sec-head"><h2 className="sec" id="open">{t('learn.mine.openTitle')}</h2></div>
            {open.length ? (
              <ul className="list card">
                {open.map((e) => {
                  const p = progress(e.course.modules, e.doneModules)
                  const over = e.dueAt && e.dueAt < now
                  const status = over ? 'overdue' : e.status
                  return (
                    <li key={e.id}>
                      <Link className="li" href={`/learn/${e.courseId}`}>
                        <div className="grow stack-sm" style={{ gap: 6 }}>
                          <div className="row" style={{ gap: 6 }}>
                            <span style={{ fontWeight: 500 }}>{e.course.title}</span>
                            {e.course.mandatory && <span className="tag outline">{t('learn.mandatory')}</span>}
                            <span className={'tag ' + ({ overdue: 'crit', expired: 'warn', in_progress: 'accent', assigned: '' } as Record<string, string>)[status]}>{t('learn.status.' + status)}</span>
                          </div>
                          <div className="row small muted" style={{ gap: 12 }}>
                            <span>{t('learn.cat.' + e.course.category)}</span>
                            <span className="mono">{e.course.estMinutes} {t('common.minutes')}</span>
                            <span>{t('learn.modulesDone', { done: p.done, total: p.total })}</span>
                          </div>
                          <div className="bar" style={{ maxWidth: 320 }} aria-hidden="true"><i style={{ width: p.pct + '%' }} /></div>
                        </div>
                        {e.dueAt && <span className={'small nowrap ' + (over ? 'crit-text' : 'muted')}>{t(over ? 'learn.overdueSince' : 'learn.dueOn', { date: fmtDate(e.dueAt, locale) })}</span>}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <Empty title={t('learn.mine.noneOpen')}><Link href="/learn/catalog">{t('learn.mine.toCatalog')}</Link></Empty>
            )}
          </section>

          <section className="stack-sm" aria-labelledby="done">
            <div className="sec-head"><h2 className="sec" id="done">{t('learn.mine.doneTitle')}</h2></div>
            {done.length ? (
              <div className="tablewrap">
                <table className="stable">
                  <thead><tr><th>{t('learn.col.course')}</th><th>{t('learn.col.completed')}</th><th>{t('learn.col.score')}</th><th>{t('learn.col.validUntil')}</th></tr></thead>
                  <tbody>
                    {done.map((e) => {
                      const c = certFor(e.courseId)
                      const st = c ? certState(c.expiresAt, now) : 'valid'
                      return (
                        <tr key={e.id}>
                          <td><Link href={`/learn/${e.courseId}`}>{e.course.title}</Link>{e.course.mandatory && <> <span className="tag outline">{t('learn.mandatory')}</span></>}</td>
                          <td className="num">{e.completedAt ? fmtDate(e.completedAt, locale) : '–'}</td>
                          <td className="num">{e.score != null ? Math.round(e.score * 100) + ' %' : '–'}</td>
                          <td className="nowrap">{c?.expiresAt ? <span className={st === 'expiring' ? 'warn-text' : st === 'expired' ? 'crit-text' : ''}><span className="mono">{fmtDate(c.expiresAt, locale)}</span>{st !== 'valid' && ' · ' + t('learn.cert.' + st)}</span> : <span className="muted">{t('learn.cert.noExpiry')}</span>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : <p className="small muted" style={{ margin: 0 }}>{t('learn.mine.noneDone')}</p>}
          </section>
        </div>
      </div>
    </main>
  )
}
