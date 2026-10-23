import { getCtx } from '@/lib/context'
import { dateKey, fmtDate, hm } from '@/lib/time'
import { addressLine, isLiveVisit, mapsHref } from '@/lib/spitex'
import { myTour } from '@/lib/spitex-data'
import { Empty, Forbidden } from '@/components/ui/Empty'
import type { TourVisit } from '@/components/spitex/TourCard'
import { SpitexHead } from '../_ui/SpitexHead'
import { TourClient } from './TourClient'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: t('spitex.tour.title') }
}

/** Meine Tour (PRD §28 Mobile, §39 Offline): heutige Einsätze der angemeldeten Person in Tourreihenfolge. */
export default async function TourPage() {
  const ctx = await getCtx()
  const { t, locale } = ctx
  if (!ctx.hasModule('spitex')) return <Forbidden text={t('common.moduleOff')} />
  const now = new Date()
  const tour = await myTour(ctx, now)
  if (!tour.units.length) return <Forbidden text={t('common.notAllowed')} />
  const rOf = (id: string) => tour.residents.find((r) => r.id === id)
  const visits: TourVisit[] = tour.visits.map((v) => {
    const r = rOf(v.residentId)
    return {
      id: v.id, residentId: v.residentId, name: r ? `${r.lastName} ${r.firstName}` : '–', address: r ? addressLine(r) : '', mapsHref: r ? mapsHref(r) : null, phone: r?.phone ?? null,
      from: hm(v.plannedStart), to: hm(v.plannedEnd), status: v.status, startedAt: v.actualStart ? hm(v.actualStart) : null,
      services: v.services.map((s) => ({ id: s.id, klv: s.klv, label: s.label, plannedMin: s.plannedMin })),
      hasAccess: !!r?.hasAccess, allergies: r?.allergies ?? [], recordHref: `/residents/${v.residentId}`,
      doneFrom: v.status === 'done' && v.actualStart ? hm(v.actualStart) : null, doneTo: v.status === 'done' && v.actualEnd ? hm(v.actualEnd) : null,
    }
  })
  const open = tour.visits.filter((v) => v.status === 'planned' || v.status === 'started').length
  const live = tour.visits.filter((v) => isLiveVisit(v.status)).length

  return (
    <main className="panel main sx" style={{ flex: 1 }}>
      <SpitexHead ctx={ctx} current="tour" title={t('spitex.tour.title')} where={fmtDate(now, locale, { weekday: 'long', day: 'numeric', month: 'long' })}
        actions={live > 0 ? <span className="pill">{t('spitex.tour.progress', { done: live - open, n: live })}</span> : undefined} />
      <div className="scroll">
        <div className="tabpanel sx-tour-panel">
          {visits.length
            ? <TourClient userId={ctx.user.id} day={dateKey(now)} visits={visits} />
            : <Empty title={t('spitex.tour.none')}>{t('spitex.tour.noneHint')}</Empty>}
        </div>
      </div>
    </main>
  )
}
