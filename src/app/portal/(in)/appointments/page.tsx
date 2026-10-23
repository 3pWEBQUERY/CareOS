import { dateKey, hm } from '@/lib/time'
import { getPortalCtx } from '@/lib/portal/context'
import { portalAppointments } from '@/lib/portal/data'
import { Empty } from '@/components/ui/Empty'
import { fmtDay, NoAccess, PortalHead, portalPage } from '../ui'

export async function generateMetadata() {
  return { title: (await getPortalCtx()).t('portal.appointments.title') }
}

/** Termine der nächsten 60 Tage: Zeit, Art, Ort – Titel nur bei nicht klinischen Arten (policy.ts). */
export default async function PortalAppointments() {
  const p = await portalPage('appointments')
  const { t, locale, current } = p
  if (!current) return <NoAccess p={p} />
  if (!p.can('appointments')) return <NoAccess p={p} grant />
  const appts = await portalAppointments(p, current, { from: new Date(Date.now() - 3600_000), days: 60 })
  const days = new Map<string, typeof appts>()
  for (const a of appts) days.set(dateKey(a.at), [...(days.get(dateKey(a.at)) ?? []), a])
  return (
    <>
      <PortalHead label={`${current.resident.firstName} ${current.resident.lastName}`} title={t('portal.appointments.title')} sub={t('portal.appointments.sub')} />
      {appts.length ? [...days.values()].map((list) => (
        <section key={dateKey(list[0].at)} className="card" aria-label={fmtDay(list[0].at, locale, t)}>
          <div className="card-head"><h2>{fmtDay(list[0].at, locale, t)}</h2></div>
          <ul className="list">
            {list.map((a) => (
              <li key={a.id}><div className="li portal-li">
                <time className="mono small portal-when" dateTime={a.at.toISOString()}>{hm(a.at)}</time>
                <div className="grow">
                  <div>{a.title ?? t('portal.apptKinds.' + a.kind)}</div>
                  <div className="small muted">{[a.title ? t('portal.apptKinds.' + a.kind) : null, a.place].filter(Boolean).join(' · ') || ' '}</div>
                </div>
              </div></li>
            ))}
          </ul>
        </section>
      )) : <Empty title={t('portal.appointments.none')} />}
    </>
  )
}
