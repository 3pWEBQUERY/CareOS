'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useT } from '@/i18n/client'
import { IconClose, IconResidents } from '@/components/icons'

/**
 * Arbeitsbereich mit Bewohnerliste (PRD §29 Tablet). Auf Tablets im Hochformat (721–920 px) ist die Liste
 * eine schmale Zimmerleiste neben der Akte: ein Tipp auf das Zimmer wechselt die Person, der Umschalter
 * öffnet die volle Liste als Schublade (Esc, Klick daneben oder Personenwechsel schliessen sie).
 * Auf Desktop und Mobile hat der Umschalter keine Wirkung (per CSS ausgeblendet).
 */
export function ResidentWorkspace({ detail, children }: { detail: boolean; children: React.ReactNode }) {
  const t = useT()
  const path = usePathname()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)

  // Personenwechsel schliesst die Schublade; im Auswahlmodus (?pick=notes|vitals, «Für wen dokumentieren?») ist sie offen.
  useEffect(() => setOpen(!detail && new URLSearchParams(window.location.search).has('pick')), [path, detail])
  useEffect(() => {
    if (!open) return
    // Filterfeld nur fokussieren, wenn die Schublade sichtbar ist (Tablet), sonst nicht ungefragt Fokus verschieben
    if (btn.current && getComputedStyle(btn.current).display !== 'none') ref.current?.querySelector<HTMLInputElement>('aside input[type="search"]')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); btn.current?.focus() }
    }
    const onDown = (e: MouseEvent) => {
      const aside = ref.current?.querySelector('aside')
      if (aside && !aside.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  const label = open ? t('common.listDrawer.close') : t('common.listDrawer.open')
  return (
    <div ref={ref} className="workspace" data-detail={detail ? 'true' : undefined} data-list={open ? 'open' : undefined}>
      <button ref={btn} type="button" className="icon-btn ws-list-toggle" aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen(!open)}>
        {open ? <IconClose size={18} /> : <IconResidents size={18} />}
      </button>
      {children}
    </div>
  )
}
