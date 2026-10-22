'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Hält «Jetzt»-Marke, Fälligkeiten und Überfälligkeiten der Schicht-Timeline aktuell (PRD §7.1 «verändert sich dynamisch»).
 * Ergänzt die ereignisgesteuerte Aktualisierung (LiveUpdates): lädt alle paar Minuten neu, wenn die Seite sichtbar ist
 * und niemand gerade tippt. Aufgeklappte Abschnitte bleiben offen.
 */
export function AutoRefresh({ minutes = 3 }: { minutes?: number }) {
  const router = useRouter()
  useEffect(() => {
    const tick = () => {
      const a = document.activeElement
      if (document.visibilityState !== 'visible' || (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) return
      router.refresh()
    }
    const id = setInterval(tick, minutes * 60_000)
    const onVis = () => document.visibilityState === 'visible' && tick()
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [router, minutes])
  return null
}
