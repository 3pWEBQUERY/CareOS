'use client'

import { useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'

/** Filterzeile oberhalb aller Diagramme; jede Änderung lädt die Ansicht mit neuen URL-Parametern. */
export function Filter({ children, keep }: { children: React.ReactNode; keep: Record<string, string> }) {
  const router = useRouter()
  const path = usePathname()
  const [pending, start] = useTransition()
  return (
    <form
      className="row"
      style={{ alignItems: 'end', gap: 12, ...(pending ? { opacity: 0.7 } : {}) }}
      onChange={(e) => {
        const q = new URLSearchParams(keep)
        for (const [k, v] of new FormData(e.currentTarget).entries()) if (typeof v === 'string' && v) q.set(k, v)
        start(() => router.replace(path + '?' + q.toString(), { scroll: false }))
      }}
      onSubmit={(e) => e.preventDefault()}
    >
      {children}
    </form>
  )
}
