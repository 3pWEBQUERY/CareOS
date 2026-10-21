'use client'

import { useEffect, useRef } from 'react'
import { useT } from '@/i18n/client'
import { IconClose } from '@/components/icons'

/** Modaler Dialog auf Basis von <dialog> (Fokusfalle, Esc, Backdrop durch den Browser). */
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
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} className={'dlg' + (wide ? ' wide' : '')} onClose={onClose} onCancel={onClose} aria-labelledby="dlg-title">
      {open && (
        <>
          <div className="dlg-head">
            <h2 id="dlg-title">{title}</h2>
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
