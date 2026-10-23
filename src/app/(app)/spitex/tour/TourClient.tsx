'use client'

import { useEffect } from 'react'
import { useT } from '@/i18n/client'
import { isQueued, offlineSupported, orQueue } from '@/lib/offline/client'
import { saveTour } from '@/lib/offline/store'
import type { TourSnapshot } from '@/lib/offline/types'
import { TourCard, type TourVisit } from '@/components/spitex/TourCard'
import { revealAccessAction, visitStepAction } from '../actions'

/**
 * Meine Tour (mobil zuerst): Einsätze des Tages in Reihenfolge. Schritte laufen online als Server Action, ohne
 * Verbindung über die verschlüsselte Outbox (Zeitpunkt vom Gerät). Der Stand der Tour wird für die Offline-Ansicht
 * verschlüsselt gespeichert – ohne Zugangsangaben.
 */
export function TourClient({ userId, day, visits }: { userId: string; day: string; visits: TourVisit[] }) {
  const t = useT()
  const snapKey = JSON.stringify(visits.map(({ hasAccess, recordHref, doneFrom, doneTo, ...v }) => v))
  useEffect(() => {
    if (!offlineSupported() || !navigator.onLine) return
    const snap: TourSnapshot = { userId, day, savedAt: new Date().toISOString(), visits: JSON.parse(snapKey) }
    void saveTour(snap).catch(() => {})
  }, [userId, day, snapKey])
  const current = visits.find((v) => v.status === 'planned' || v.status === 'started')?.id
  return (
    <ol className="sx-tour" aria-label={t('spitex.tour.title')}>
      {visits.map((v, i) => (
        <TourCard key={v.id} v={v} n={i + 1} current={v.id === current}
          revealAccess={v.hasAccess ? () => revealAccessAction(v.residentId) : undefined}
          onStep={async (d) => {
            const r = await orQueue(() => visitStepAction(d), { kind: 'visit', residentId: v.residentId, data: d }, { who: v.name, label: `${v.from}–${v.to}` })
            if (isQueued(r)) return { ok: true, queued: true, message: r.message }
            return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error }
          }} />
      ))}
    </ol>
  )
}
