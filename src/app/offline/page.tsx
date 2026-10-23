import type { Metadata } from 'next'
import { dictionary } from '@/i18n'
import { LOCALES, type Locale, type Tree } from '@/i18n/core'
import { OfflineView } from './OfflineView'

export const metadata: Metadata = { title: 'Offline' }

/** Nur die Texte, die die Offline-Ansicht braucht – in allen Sprachen (Sprache folgt dem Lesestand). */
function messages(locale: Locale): Tree {
  const d = dictionary(locale) as { common: Tree; chart: Tree; spitex: Tree }
  const c = d.common
  const s = d.spitex as Record<string, Tree>
  return {
    common: { offlineSync: c.offlineSync, offline: c.offline, offlineQueued: c.offlineQueued, cancel: c.cancel, close: c.close, now: c.now, today: c.today, undo: c.undo, loading: c.loading, genericError: c.genericError, optional: c.optional, field: c.field },
    chart: { cat: (d.chart as { cat: Tree }).cat },
    // Spitex: «Meine Tour» offline (TourCard)
    spitex: { tour: s.tour, status: s.status, access: s.access, errors: s.errors, toast: s.toast, min: s.min, minutes: s.minutes, noAddress: s.noAddress, doneAt: s.doneAt },
  }
}

/**
 * Offline-Ansicht (PRD §39). Ohne Anmeldung und ohne Serverdaten: liest den verschlüsselten Lesestand
 * der Schicht im Browser. Wird vom Service Worker vorab gespeichert und bei fehlender Verbindung gezeigt.
 */
export default function OfflinePage() {
  const all = Object.fromEntries(LOCALES.map((l) => [l, messages(l)])) as Record<Locale, Tree>
  return <OfflineView messages={all} />
}
