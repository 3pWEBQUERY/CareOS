import Link from 'next/link'
import { hm } from '@/lib/time'
import { getPortalCtx } from '@/lib/portal/context'
import { portalAppointments, portalThreads, portalUpdates, portalVisits } from '@/lib/portal/data'
import { fmtDay, fmtWhen, NoAccess, PortalHead, portalPage } from './ui'

export async function generateMetadata() {
  return { title: (await getPortalCtx()).t('portal.nav.home') }
}

/** Übersicht: Person, nächste Termine, Mitteilungen der Station, Besuche, offene Nachrichten. */
export default async function PortalHome() {
  const p = await portalPage('home')
  const { t, locale, current } = p
  if (!current) return <NoAccess p={p} />
  const r = current.resident
  const [appts, updates, visits, threads] = await Promise.all([
    portalAppointments(p, current, { from: new Date(Date.now() - 3600_000), days: 14, take: 5 }),
    portalUpdates(p, current, 3),
    portalVisits(p, current),
    portalThreads(p, current),
  ])
  const upcomingVisits = visits.filter((v) => v.end >= new Date() && (v.status === 'requested' || v.status === 'confirmed')).slice(0, 3)
  const unreadThreads = threads.filter((th) => th.status === 'answered' && (!th.familyReadAt || th.familyReadAt < th.lastMessageAt))
  const firstName = p.account.name.split(/\s+/)[0]
  return (
    <>
      <PortalHead
        kicker={t('portal.home.greeting', { name: firstName })}
        title={`${r.firstName} ${r.lastName}`}
        sub={[r.unit, r.room && t('portal.home.room', { n: r.room })].filter(Boolean).join(' · ')}
      >
        {p.can('messages') && <Link className="btn primary" href="/portal/messages?new=1">{t('portal.messages.new')}</Link>}
        {p.can('visits') && <Link className="btn" href="/portal/visits?new=1">{t('portal.visits.new')}</Link>}
      </PortalHead>

      {unreadThreads.length > 0 && (
        <div className="alert info">
          <span className="grow">{t('portal.home.answers', { n: unreadThreads.length })}</span>
          <Link className="btn sm" href={unreadThreads.length === 1 ? `/portal/messages/${unreadThreads[0].id}` : '/portal/messages'}>{t('portal.home.read')}</Link>
        </div>
      )}

      <div className="portal-grid">
        {p.can('appointments') && (
          <section className="card" aria-labelledby="ph-appts">
            <div className="card-head"><h2 id="ph-appts">{t('portal.home.appointments')}</h2><Link className="linkbtn small" href="/portal/appointments">{t('portal.home.all')}</Link></div>
            {appts.length ? (
              <ul className="list">
                {appts.map((a) => (
                  <li key={a.id}><div className="li portal-li">
                    <time className="mono small portal-when" dateTime={a.at.toISOString()}>{hm(a.at)}</time>
                    <div className="grow">
                      <div>{a.title ?? t('portal.apptKinds.' + a.kind)}</div>
                      <div className="small muted">{[fmtDay(a.at, locale, t), a.title ? t('portal.apptKinds.' + a.kind) : null, a.place].filter(Boolean).join(' · ')}</div>
                    </div>
                  </div></li>
                ))}
              </ul>
            ) : <div className="card-body small muted">{t('portal.home.noAppointments')}</div>}
          </section>
        )}

        {p.can('visits') && (
          <section className="card" aria-labelledby="ph-visits">
            <div className="card-head"><h2 id="ph-visits">{t('portal.home.visits')}</h2><Link className="linkbtn small" href="/portal/visits">{t('portal.home.all')}</Link></div>
            {upcomingVisits.length ? (
              <ul className="list">
                {upcomingVisits.map((v) => (
                  <li key={v.id}><div className="li portal-li">
                    <div className="grow">
                      <div>{fmtWhen(v.start, locale, t)}–{hm(v.end)}</div>
                      <div className="small muted">{t('portal.visits.people', { n: v.visitors })}</div>
                    </div>
                    <span className={'tag ' + (v.status === 'confirmed' ? 'ok' : 'accent')}>{t('portal.visitStatus.' + v.status)}</span>
                  </div></li>
                ))}
              </ul>
            ) : <div className="card-body small muted">{t('portal.home.noVisits')}</div>}
          </section>
        )}
      </div>

      {p.can('updates') && (
        <section className="card" aria-labelledby="ph-updates">
          <div className="card-head"><h2 id="ph-updates">{t('portal.home.updates')}</h2><Link className="linkbtn small" href="/portal/updates">{t('portal.home.all')}</Link></div>
          {updates.length ? (
            <ul className="list">
              {updates.map((u) => (
                <li key={u.id}><Link className="li" href={`/portal/updates#u-${u.id}`} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
                  <div className="row-between"><strong>{u.title}</strong><span className="small muted mono">{fmtDay(u.publishedAt, locale, t)}</span></div>
                  <p className="small fg2 portal-clamp" style={{ margin: 0 }}>{u.body}</p>
                </Link></li>
              ))}
            </ul>
          ) : <div className="card-body small muted">{t('portal.home.noUpdates')}</div>}
        </section>
      )}

      <p className="small muted portal-foot">{t('portal.home.privacy')} <Link href="/portal/account#data">{t('portal.home.privacyLink')}</Link></p>
    </>
  )
}
