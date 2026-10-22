import type { Metadata } from 'next'
import { dictionary } from '@/i18n'
import { LOCALES, type Locale, type Tree } from '@/i18n/core'
import { OfflineView } from './OfflineView'

export const metadata: Metadata = { title: 'Offline' }

/** Nur die Texte, die die Offline-Ansicht braucht – in allen Sprachen (Sprache folgt dem Lesestand). */
function messages(locale: Locale): Tree {
  const d = dictionary(locale) as { common: Tree; chart: Tree }
  const c = d.common
  return {
    common: { offlineSync: c.offlineSync, offline: c.offline, offlineQueued: c.offlineQueued, cancel: c.cancel, close: c.close, now: c.now, today: c.today, undo: c.undo, loading: c.loading },
    chart: { cat: (d.chart as { cat: Tree }).cat },
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
