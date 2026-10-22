'use client'

import { useEffect } from 'react'

const DEV = process.env.NODE_ENV !== 'production'
const FLAG = 'careos_sw'

const fullDev = () => {
  try { return localStorage.getItem(FLAG) === '1' } catch { return false }
}

/**
 * Skript-URL des Service Workers. In der Entwicklung ohne Caching («?dev=1»: nur Push),
 * ausser der Offline-Modus wurde mit «?sw=1» ausdrücklich eingeschaltet («?sw=0» schaltet ihn ab).
 */
export function swScriptUrl() {
  return DEV && !fullDev() ? '/sw.js?dev=1' : '/sw.js'
}

export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    // Klick auf eine Push-Benachrichtigung bei nicht kontrolliertem Fenster: Link hier öffnen.
    const onMsg = (e: MessageEvent) => {
      const href = (e.data as { type?: string; href?: string } | null)?.href
      if ((e.data as { type?: string })?.type === 'navigate' && href && new URL(href).origin === location.origin) location.href = href
    }
    navigator.serviceWorker.addEventListener('message', onMsg)
    const off = () => navigator.serviceWorker.removeEventListener('message', onMsg)
    if (DEV) {
      const q = new URLSearchParams(location.search).get('sw')
      try {
        if (q === '1') localStorage.setItem(FLAG, '1')
        if (q === '0') localStorage.removeItem(FLAG)
      } catch {}
      if (q === '0') {
        void navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()))
        return off
      }
      if (!fullDev()) return off
    }
    navigator.serviceWorker
      .register(swScriptUrl())
      .then((reg) => {
        // Offline-Seite und ihre Assets nach einem neuen Deployment aktualisieren (PRD §39).
        if (navigator.onLine) (reg.active ?? reg.waiting ?? reg.installing)?.postMessage({ type: 'precache-offline' })
      })
      .catch(() => {})
    return off
  }, [])
  return null
}
