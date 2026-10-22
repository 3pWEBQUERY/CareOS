import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { Empty, Forbidden } from '@/components/ui/Empty'
import { certState, EXPIRING_DAYS } from '@/lib/learn'
import { fmtDate } from '@/lib/time'
import { LearnHead, LearnTabs } from '../LearnTabs'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: t('nav.learn') + ' · ' + t('learn.tabs.certificates') }
}

export default async function CertificatesPage() {
  const ctx = await getCtx()
  const { t, locale } = ctx
  if (!ctx.can('learn.read')) return <Forbidden text={t('common.notAllowed')} />
  const now = new Date()
  const certs = await db.certificate.findMany({ where: { userId: ctx.user.id }, orderBy: { issuedAt: 'desc' } })
  const courses = await db.course.findMany({ where: { orgId: ctx.org.id, id: { in: certs.map((c) => c.courseId).filter((x): x is string => !!x) } }, select: { id: true, mandatory: true } })
  const mandatory = new Set(courses.filter((c) => c.mandatory).map((c) => c.id))
  // Nur das neueste Zertifikat je Kurs gilt; ältere sind ersetzt.
  const seen = new Set<string>()
  const rows = certs.map((c) => {
    const key = c.courseId ?? c.id
    const superseded = seen.has(key)
    seen.add(key)
    return { c, superseded, state: certState(c.expiresAt, now) }
  })
  const current = rows.filter((r) => !r.superseded)
  const soon = current.filter((r) => r.state === 'expiring')
  const expired = current.filter((r) => r.state === 'expired')
  const daysLeft = (d: Date) => Math.ceil((d.getTime() - now.getTime()) / 86_400_000)

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <LearnHead title={t('learn.certs.title')} sub={t('learn.certs.sub', { n: current.length })} />
      <LearnTabs ctx={ctx} current="certificates" />
      <div className="scroll">
        <div className="tabpanel">
          {(soon.length > 0 || expired.length > 0) && (
            <div className={'alert ' + (expired.length ? 'crit' : 'warn')}>
              <div className="grow">
                <strong>{t('learn.certs.attention')}</strong>
                <span>{[expired.length && t('learn.certs.nExpired', { n: expired.length }), soon.length && t('learn.certs.nExpiring', { n: soon.length, days: EXPIRING_DAYS })].filter(Boolean).join(' · ')}</span>
              </div>
            </div>
          )}
          {rows.length ? (
            <div className="tablewrap rwrap">
              <table className="stable rtable">
                <thead><tr><th>{t('learn.col.certificate')}</th><th>{t('learn.col.issued')}</th><th>{t('learn.col.validUntil')}</th><th>{t('learn.col.status')}</th></tr></thead>
                <tbody>
                  {rows.map(({ c, superseded, state }) => (
                    <tr key={c.id} style={superseded ? { color: 'var(--fg-3)' } : undefined}>
                      <td>
                        {c.courseId ? <Link href={`/learn/${c.courseId}`}>{c.title}</Link> : c.title}
                        {c.courseId && mandatory.has(c.courseId) && <> <span className="tag outline">{t('learn.mandatory')}</span></>}
                      </td>
                      <td className="num" data-label={t('learn.col.issued')}>{fmtDate(c.issuedAt, locale)}</td>
                      <td className="num" data-label={t('learn.col.validUntil')}>{c.expiresAt ? fmtDate(c.expiresAt, locale) : <span className="muted">{t('learn.cert.noExpiry')}</span>}</td>
                      <td className="nowrap">
                        {superseded ? <span className="tag">{t('learn.cert.superseded')}</span> : (
                          <>
                            <span className={'tag ' + { valid: 'ok', expiring: 'warn', expired: 'crit' }[state]}>{t('learn.cert.' + state)}</span>
                            {state === 'expiring' && c.expiresAt && <span className="small warn-text"> {t('learn.cert.inDays', { n: daysLeft(c.expiresAt) })}</span>}
                            {state !== 'valid' && c.courseId && <> <Link className="linkbtn small" href={`/learn/${c.courseId}`}>{t('learn.cert.renew')}</Link></>}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty title={t('learn.certs.empty')}>{t('learn.certs.emptyHint')}</Empty>}
        </div>
      </div>
    </main>
  )
}
