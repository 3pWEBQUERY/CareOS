import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { getPortalCtx } from '@/lib/portal/context'
import { portalThread } from '@/lib/portal/data'
import { fmtWhen, NoAccess, PortalHead, portalPage } from '../../ui'
import { Reply } from '../Composer'

export async function generateMetadata() {
  return { title: (await getPortalCtx()).t('portal.nav.messages') }
}

export default async function PortalThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await portalPage('thread')
  const { t, locale, current } = p
  if (!current) return <NoAccess p={p} />
  if (!p.can('messages')) return <NoAccess p={p} grant />
  const th = await portalThread(p, current, (await params).id)
  if (!th) notFound()
  // Gelesen-Merker (nur Zeitstempel, idempotent)
  if (!th.familyReadAt || th.familyReadAt < th.lastMessageAt) await db.portalThread.updateMany({ where: { id: th.id }, data: { familyReadAt: new Date() } })
  return (
    <>
      <PortalHead label={t('portal.messages.title')} title={th.subject}>
        <Link className="btn" href="/portal/messages">{t('portal.messages.back')}</Link>
      </PortalHead>
      <section className="card" aria-label={t('portal.messages.conversation')}>
        <ol className="portal-msgs">
          {th.messages.map((m) => (
            <li key={m.id} className={'portal-msg ' + (m.side === 'family' ? 'mine' : 'team')}>
              <div className="small muted">
                <strong className="fg2">{m.side === 'family' ? t('portal.messages.you') : m.author ?? t('portal.messages.team')}</strong>
                {' · '}<time dateTime={m.createdAt.toISOString()}>{fmtWhen(m.createdAt, locale, t)}</time>
              </div>
              <p>{m.body}</p>
            </li>
          ))}
        </ol>
        <div className="card-foot portal-reply">
          {th.status === 'closed' && <p className="small muted" style={{ margin: 0 }}>{t('portal.messages.closedHint')}</p>}
          <Reply threadId={th.id} />
        </div>
      </section>
    </>
  )
}
