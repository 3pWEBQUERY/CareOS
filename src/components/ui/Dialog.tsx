'use client'

import { useEffect, useId, useRef } from 'react'
import { useT } from '@/i18n/client'
import { IconClose } from '@/components/icons'

const FIELD = 'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])'

/**
 * Modaler Dialog auf Basis von <dialog> (Fokusfalle, Esc, Backdrop durch den Browser).
 * Fokus beim Öffnen: Element mit autoFocus, sonst erstes Eingabefeld, sonst der Titel (nie automatisch
 * auf eine Aktion). Beim Schliessen kehrt der Fokus zum auslösenden Element zurück.
 * Kopf und Fuss bleiben sichtbar, nur der Inhalt scrollt; auf Mobile erscheint der Dialog als Blatt am unteren Rand.
 */
export function Dialog({ open, onClose, title, children, footer, wide, context }: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
  wide?: boolean
  /** Kontextanzeige bei kritischen Aktionen, z. B. Name und Zimmer der Person (PRD §32). */
  context?: React.ReactNode
}) {
  const t = useT()
  const id = useId()
  const ref = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const openRef = useRef(open)
  openRef.current = open
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      opener.current = document.activeElement as HTMLElement | null
      d.showModal()
      const target = d.querySelector<HTMLElement>('[autofocus]') ?? d.querySelector<HTMLElement>(`.dlg-body ${FIELD.split(', ').join(', .dlg-body ')}`) ?? d.querySelector<HTMLElement>('.dlg-head h2')
      target?.focus()
    }
    if (!open && d.open) d.close()
    if (!open && opener.current) {
      const el = opener.current
      opener.current = null
      if (el.isConnected) el.focus()
    }
  }, [open])
  return (
    <dialog
      ref={ref}
      className={'dlg' + (wide ? ' wide' : '')}
      onClose={() => { if (openRef.current) onClose() }}
      onCancel={(e) => { e.preventDefault(); onClose() }}
      aria-labelledby={id + 't'}
    >
      {open && (
        <>
          <div className="dlg-head">
            <h2 id={id + 't'} tabIndex={-1}>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.close')}><IconClose size={18} /></button>
          </div>
          <div className="dlg-body">
            {context && <div className="dlg-context">{context}</div>}
            {children}
          </div>
          {footer && <div className="dlg-foot">{footer}</div>}
        </>
      )}
    </dialog>
  )
}
