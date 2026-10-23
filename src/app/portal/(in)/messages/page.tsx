import Link from 'next/link'
import { getPortalCtx } from '@/lib/portal/context'
import { portalThreads } from '@/lib/portal/data'
import { Empty } from '@/components/ui/Empty'
import { fmtWhen, NoAccess, PortalHead, portalPage } from '../ui'
import { NewMessage } from './Composer'

export async function generateMetadata() {
  return { title: (await getPortalCtx()).t('portal.nav.messages') }
}

export default async function PortalMessages({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const p = await portalPage('messages')
  const { t, locale, current } = p
  if (!current) return <NoAccess p={p} />
  if (!p.can('messages')) return <NoAccess p={p} grant />
  const threads = await portalThreads(p, current)
  const open = (await searchParams).new === '1' || threads.length === 0
  return (
    <>
      <PortalHead label={`${current.resident.firstName} ${current.resident.lastName}`} title={t('portal.messages.title')} sub={t('portal.messages.sub')}>
        {!open && <Link className="btn primary" href="/portal/messages?new=1">{t('portal.messages.new')}</Link>}
      </PortalHead>
      {open && (
        <section className="card" aria-labelledby="pm-new">
          <div className="card-head"><h2 id="pm-new">{t('portal.messages.new')}</h2></div>
          <div className="card-body"><NewMessage cancelHref={threads.length ? '/portal/messages' : null} /></div>
        </section>
      )}
      {threads.length ? (
        <section className="card" aria-labelledby="pm-list">
          <div className="card-head"><h2 id="pm-list">{t('portal.messages.list')}</h2></div>
          <ul className="list">
            {threads.map((th) => {
              const unread = th.status === 'answered' && (!th.familyReadAt || th.familyReadAt < th.lastMessageAt)
              return (
                <li key={th.id}>
                  <Link className={'li' + (unread ? ' unread' : '')} href={`/portal/messages/${th.id}`}>
                    <div className="grow">
                      <div style={{ fontWeight: unread ? 600 : 500 }}>{th.subject}</div>
                      <div className="small muted">{fmtWhen(th.lastMessageAt, locale, t)} · {t('portal.messages.count', { n: th._count.messages })}</div>
                    </div>
                    <span className={'tag ' + (th.status === 'answered' ? (unread ? 'accent' : 'ok') : th.status === 'closed' ? '' : 'outline')}>
                      {unread ? t('portal.threadStatus.new') : t('portal.threadStatus.' + th.status)}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      ) : !open && <Empty title={t('portal.messages.none')} />}
    </>
  )
}
