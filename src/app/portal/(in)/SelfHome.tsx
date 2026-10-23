import Link from 'next/link'
import { dateKey, hm, startOfDay } from '@/lib/time'
import type { PortalCtx } from '@/lib/portal/context'
import { portalAppointments, portalHelp, portalUnread, portalUpdates, portalVisits } from '@/lib/portal/data'
import { dayPlan } from '@/lib/portal/policy'
import { fmtDay, fmtLongDate, selfAppointmentText } from './ui'

type Entry = { key: string; at: Date; until?: Date; kind: 'appointment' | 'visit'; residentId: string; label: string; meta: string; tag: { text: string; tone: string } | null }

/**
 * «Mein Tag» (Bewohnerportal): heute und die nächsten 7 Tage in einer Zeitleiste (Termine, Therapieeinheiten,
 * Besuche), Neuigkeiten, Nachrichten an das Team und Hilfe/Kontakt. Nur freigegebene Bereiche; alles über
 * die Projektionen aus policy.ts, nie klinische Daten.
 */
export async function SelfHome({ p }: { p: PortalCtx }) {
  const cur = p.current!
  const { t, locale } = p
  const now = new Date()
  const [appts, visits, updates, unread, help] = await Promise.all([
    portalAppointments(p, cur, { from: startOfDay(now), days: 8, take: 80 }),
    portalVisits(p, cur),
    portalUpdates(p, cur, 3),
    portalUnread(p, cur),
    portalHelp(p, cur),
  ])
  // Bestätigte Besuche stehen auch als Termin «Angehörige» in der Akte – nur einmal zeigen (als Besuch)
  const visitAppts = new Set(visits.map((v) => v.appointmentId).filter(Boolean))
  const entries: Entry[] = [
    ...appts.filter((a) => !visitAppts.has(a.id)).map((a) => {
      const x = selfAppointmentText(a, t)
      return { key: 'a' + a.id, at: a.at, kind: 'appointment' as const, residentId: a.residentId, label: x.label, meta: x.meta, tag: null }
    }),
    ...visits.filter((v) => v.status === 'requested' || v.status === 'confirmed').map((v) => ({
      key: 'v' + v.id, at: v.start, until: v.end, kind: 'visit' as const, residentId: v.residentId,
      label: v.who ? t('residentPortal.day.visitFrom', { name: v.who }) : t('residentPortal.day.visit'),
      meta: [t('residentPortal.day.people', { n: v.visitors }), v.own ? t('residentPortal.visits.byYou') : null].filter(Boolean).join(' · '),
      tag: v.status === 'confirmed' ? { text: t('residentPortal.day.visitConfirmed'), tone: 'ok' } : { text: t('residentPortal.day.visitOpen'), tone: 'accent' },
    })),
  ]
  const plan = dayPlan(entries, cur, now)
  const days = new Map<string, Entry[]>()
  for (const e of plan.upcoming) days.set(dateKey(e.at), [...(days.get(dateKey(e.at)) ?? []), e])
  const showPlan = p.can('appointments') || p.can('visits')
  const firstName = p.account.name.split(/\s+/)[0]

  const Item = ({ e, past }: { e: Entry; past?: boolean }) => (
    <li className={'self-item' + (past ? ' past' : '')}>
      <time className="self-time mono" dateTime={e.at.toISOString()}>{hm(e.at)}{e.until && <span className="self-until">–{hm(e.until)}</span>}</time>
      <div className="grow">
        <div className="self-what">{e.label}</div>
        {e.meta && <div className="self-meta">{e.meta}</div>}
        {/* Status als Text unter dem Eintrag (nicht nur Farbe; bricht auf schmalen Geräten nicht den Titel) */}
        {(past || e.tag) && <div className="self-tag">{past ? <span className="tag">{t('residentPortal.day.past')}</span> : <span className={'tag ' + e.tag!.tone}>{e.tag!.text}</span>}</div>}
      </div>
    </li>
  )

  return (
    <>
      <div className="portal-head self-head">
        <div className="grow">
          <p className="portal-kicker">{t('residentPortal.day.greeting', { name: firstName })}</p>
          <h1>{t('residentPortal.day.title')}</h1>
          <p className="sub">{fmtLongDate(now, locale)}</p>
        </div>
      </div>

      {showPlan && (
        <section className="card self-card" aria-labelledby="sd-today">
          <div className="card-head"><h2 id="sd-today">{t('residentPortal.day.today')}</h2></div>
          {plan.today.length
            ? <ul className="self-list">{plan.today.map((e) => <Item key={e.key} e={e} past={e.past} />)}</ul>
            : <p className="card-body self-empty">{t('residentPortal.day.todayEmpty')}</p>}
        </section>
      )}

      <div className="portal-grid">
        {p.can('messages') && (
          <section className="card self-card" aria-labelledby="sd-msg">
            <div className="card-head"><h2 id="sd-msg">{t('residentPortal.messages.card')}</h2></div>
            <div className="card-body stack-sm">
              <p className="self-lead">
                {unread.messages ? t('residentPortal.messages.unread', { n: unread.messages }) : t('residentPortal.messages.noUnread')}
              </p>
              <Link className="btn primary lg block" href="/portal/messages?new=1">{t('residentPortal.messages.write')}</Link>
              <Link className="btn lg block" href="/portal/messages">{t('residentPortal.messages.read')}</Link>
            </div>
          </section>
        )}

        <section className="card self-card" aria-labelledby="sd-help">
          <div className="card-head"><h2 id="sd-help">{t('residentPortal.help.title')}</h2></div>
          <div className="card-body stack-sm">
            <p className="self-lead">{t('residentPortal.help.urgent')}</p>
            {help?.phone ? (
              <a className="btn lg block self-call" href={`tel:${help.phone.replace(/[^\d+]/g, '')}`}>
                <span>{t('residentPortal.help.call', { unit: help.unit })}</span>
                <span className="mono">{help.phone}</span>
              </a>
            ) : help && <p className="self-meta">{t('residentPortal.help.noPhone', { unit: help.unit })}</p>}
          </div>
        </section>
      </div>

      {showPlan && (
        <section className="card self-card" aria-labelledby="sd-next">
          <div className="card-head">
            <h2 id="sd-next">{t('residentPortal.day.upcoming')}</h2>
            {p.can('appointments') && <Link className="linkbtn" href="/portal/appointments">{t('residentPortal.day.allAppointments')}</Link>}
          </div>
          {days.size ? [...days.values()].map((list) => (
            <div key={dateKey(list[0].at)} className="self-day">
              <h3>{fmtDay(list[0].at, locale, t)}</h3>
              <ul className="self-list">{list.map((e) => <Item key={e.key} e={e} />)}</ul>
            </div>
          )) : <p className="card-body self-empty">{t('residentPortal.day.upcomingEmpty')}</p>}
        </section>
      )}

      {p.can('updates') && (
        <section className="card self-card" aria-labelledby="sd-news">
          <div className="card-head">
            <h2 id="sd-news">{t('residentPortal.day.news')}</h2>
            {updates.length > 0 && <Link className="linkbtn" href="/portal/updates">{t('residentPortal.day.newsAll')}</Link>}
          </div>
          {updates.length ? (
            <ul className="self-list">
              {updates.map((u) => (
                <li key={u.id} className="self-news">
                  <Link href={`/portal/updates#u-${u.id}`}>
                    <span className="self-what">{u.title}</span>
                    <span className="self-meta">{fmtDay(u.publishedAt, locale, t)}</span>
                  </Link>
                  <p className="portal-clamp">{u.body}</p>
                </li>
              ))}
            </ul>
          ) : <p className="card-body self-empty">{t('residentPortal.day.newsEmpty')}</p>}
        </section>
      )}
    </>
  )
}
