import Link from 'next/link'
import { addDays, dateKey, hm } from '@/lib/time'
import { getPortalCtx } from '@/lib/portal/context'
import { portalVisits } from '@/lib/portal/data'
import { portalSettings } from '@/lib/portal/policy'
import { Empty } from '@/components/ui/Empty'
import { fmtWhen, NoAccess, PortalHead, portalPage } from '../ui'
import { CancelVisit, VisitForm } from './VisitForm'

export async function generateMetadata() {
  return { title: (await getPortalCtx()).t('portal.nav.visits') }
}

const TONE: Record<string, string> = { requested: 'accent', confirmed: 'ok', declined: 'warn', cancelled: '' }

export default async function PortalVisits({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const p = await portalPage('visits')
  const { t, locale, current } = p
  if (!current) return <NoAccess p={p} />
  if (!p.can('visits')) return <NoAccess p={p} grant />
  const visits = await portalVisits(p, current)
  const now = new Date()
  const s = portalSettings(p.org.settings)
  const upcoming = visits.filter((v) => v.end >= now)
  const past = visits.filter((v) => v.end < now).reverse()
  const open = (await searchParams).new === '1' || visits.length === 0
  const minDay = dateKey(new Date(now.getTime() + s.visitLeadHours * 3600_000))
  const Row = ({ v }: { v: (typeof visits)[number] }) => {
    const when = `${fmtWhen(v.start, locale, t)}–${hm(v.end)}`
    return (
      <li>
        <div className="li portal-li" style={{ alignItems: 'flex-start' }}>
          <div className="grow stack-sm">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <strong>{when}</strong>
              <span className={'tag ' + TONE[v.status]}>{t('portal.visitStatus.' + v.status)}</span>
            </div>
            <div className="small muted">{t('portal.visits.people', { n: v.visitors })}{v.note ? ' · ' + v.note : ''}</div>
            {v.reply && <p className="small portal-reply-text" style={{ margin: 0 }}><span className="lbl">{t('portal.visits.reply')}</span> {v.reply}</p>}
          </div>
          {(v.status === 'requested' || v.status === 'confirmed') && v.end >= now && <CancelVisit id={v.id} when={when} />}
        </div>
      </li>
    )
  }
  return (
    <>
      <PortalHead label={`${current.resident.firstName} ${current.resident.lastName}`} title={t('portal.visits.title')} sub={t('portal.visits.sub')}>
        {!open && <Link className="btn primary" href="/portal/visits?new=1">{t('portal.visits.new')}</Link>}
      </PortalHead>
      {open && (
        <section className="card" aria-labelledby="pv-new">
          <div className="card-head"><h2 id="pv-new">{t('portal.visits.new')}</h2></div>
          <div className="card-body"><VisitForm min={minDay} max={dateKey(addDays(now, s.visitMaxDays))} cancelHref={visits.length ? '/portal/visits' : null} /></div>
        </section>
      )}
      {upcoming.length > 0 && (
        <section className="card" aria-labelledby="pv-up">
          <div className="card-head"><h2 id="pv-up">{t('portal.visits.upcoming')}</h2></div>
          <ul className="list">{upcoming.map((v) => <Row key={v.id} v={v} />)}</ul>
        </section>
      )}
      {past.length > 0 && (
        <section className="card" aria-labelledby="pv-past">
          <div className="card-head"><h2 id="pv-past">{t('portal.visits.past')}</h2></div>
          <ul className="list">{past.map((v) => <Row key={v.id} v={v} />)}</ul>
        </section>
      )}
      {!visits.length && !open && <Empty title={t('portal.visits.none')} />}
    </>
  )
}
