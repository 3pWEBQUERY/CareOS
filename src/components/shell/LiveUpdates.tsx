'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/components/toast'
import { OfflineSync } from '@/components/shell/OfflineSync'

/**
 * Echtzeit (PRD §44): Server-Sent Events. Bei relevanten Domain Events wird die Ansicht neu geladen,
 * kritische Benachrichtigungen erscheinen zusätzlich als Hinweis. Offline-Zustand wird angezeigt.
 */
export function LiveUpdates({ userId }: { userId: string }) {
  const router = useRouter()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [offline, setOffline] = useState(false)
  // Erst nach abgeschlossener Hydration neu laden («Router action dispatched before initialization»)
  const ready = useRef(false)
  useEffect(() => {
    const ric = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 200))
    const id = window.setTimeout(() => ric(() => { ready.current = true }), 0)
    return () => window.clearTimeout(id)
  }, [])

  useEffect(() => {
    let es: EventSource | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        const a = document.activeElement
        // Während jemand tippt, nicht neu rendern – sonst springt der Cursor. Später nachholen.
        if (!ready.current || (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && (a as HTMLInputElement).value)) return schedule()
        router.refresh()
      }, 700)
    }
    const connect = () => {
      es = new EventSource('/api/events')
      es.onmessage = (m) => {
        try {
          const e = JSON.parse(m.data) as { type: string; actorId?: string; payload?: { priority?: string; title?: string } }
          if (e.type === 'notification.created' && e.payload?.priority === 'critical') toast(e.payload.title ?? '', { kind: 'crit', ms: 8000 })
          if (e.actorId !== userId || e.type === 'notification.created') schedule()
        } catch {}
      }
      es.onerror = () => {
        es?.close()
        retry = setTimeout(connect, 5000)
      }
    }
    connect()
    const on = () => { setOffline(false); if (ready.current) router.refresh(); else schedule() }
    const off = () => setOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    setOffline(!navigator.onLine)
    return () => {
      es?.close()
      if (retry) clearTimeout(retry)
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [router, userId])

  // Offline-Leiste mit wartenden Einträgen und Synchronisation (PRD §39)
  return <OfflineSync userId={userId} offline={offline} />
}
