'use client'

import { useEffect, useRef, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'

/**
 * Filterzeile oberhalb aller Diagramme; jede Änderung lädt die Ansicht mit neuen URL-Parametern.
 * Nativer Listener: Feld-Komponenten (Select, Combobox) lösen «change» am versteckten Feld aus.
 */
export function Filter({ children, keep }: { children: React.ReactNode; keep: Record<string, string> }) {
  const router = useRouter()
  const path = usePathname()
  const [pending, start] = useTransition()
  const ref = useRef<HTMLFormElement>(null)
  const keepRef = useRef(keep)
  keepRef.current = keep
  useEffect(() => {
    const form = ref.current
    if (!form) return
    const onChange = () => {
      const q = new URLSearchParams(keepRef.current)
      for (const [k, v] of new FormData(form).entries()) if (typeof v === 'string' && v) q.set(k, v)
      start(() => router.replace(path + '?' + q.toString(), { scroll: false }))
    }
    form.addEventListener('change', onChange)
    return () => form.removeEventListener('change', onChange)
  }, [router, path])
  return (
    <form
      ref={ref}
      className="row"
      style={{ alignItems: 'end', gap: 12, ...(pending ? { opacity: 0.7 } : {}) }}
      onSubmit={(e) => e.preventDefault()}
    >
      {children}
    </form>
  )
}
