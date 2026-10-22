'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useT } from '@/i18n/client'
import { IconPlus } from '@/components/icons'

/**
 * Zentraler Action Button für Mobile (PRD §28), Einhandbedienung.
 * Das Blatt ist ein modaler Dialog: Fokus auf die erste Aktion, Tab bleibt im Blatt, Esc schliesst
 * und der Fokus kehrt zum Button zurück.
 */
export function QuickActions({ canIncident, canTask }: { canIncident: boolean; canTask: boolean }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const sheet = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const el = sheet.current
    el?.querySelector<HTMLElement>('a')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close(true)
      } else if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>('a, button')]
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  function close(refocus: boolean) {
    setOpen(false)
    if (refocus) btn.current?.focus()
  }

  return (
    <>
      <button ref={btn} type="button" className="fab" aria-label={t('common.quick.label')} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        <IconPlus size={24} />
      </button>
      {open && (
        <>
          <div className="scrim" style={{ alignItems: 'flex-end', padding: 0 }} onClick={() => close(true)} />
          <div ref={sheet} className="sheet" role="dialog" aria-modal="true" aria-labelledby="quick-title" onClick={(e) => (e.target as HTMLElement).closest('a') && close(false)}>
            <div className="row-between">
              <h2 className="lbl" id="quick-title" style={{ margin: 0 }}>{t('common.quick.label')}</h2>
              <button type="button" className="btn ghost sm" onClick={() => close(true)}>{t('common.close')}</button>
            </div>
            <Link className="btn lg" href="/residents?pick=notes">{t('common.quick.document')}</Link>
            <Link className="btn lg" href="/residents?pick=vitals">{t('common.quick.vitals')}</Link>
            {canTask && <Link className="btn lg" href="/tasks?new=1">{t('common.quick.task')}</Link>}
            {canIncident && <Link className="btn lg" href="/quality/new">{t('common.quick.incident')}</Link>}
          </div>
        </>
      )}
    </>
  )
}
