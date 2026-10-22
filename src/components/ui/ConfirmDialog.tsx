'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useT } from '@/i18n/client'
import { Dialog } from '@/components/ui/Dialog'

/**
 * Bestätigung vor folgenreichen Aktionen (PRD §32): Titel als Frage, Folgen im Klartext,
 * betroffener Datensatz als Kontext und optional eine ausdrückliche Bestätigung (Checkbox)
 * für nicht umkehrbare Aktionen. Der Fokus landet auf dem Titel, nie automatisch auf der Aktion.
 */
export function ConfirmDialog({ open, onClose, onConfirm, title, text, consequences, context, ack, confirmLabel, danger, pending, error }: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  text?: string
  consequences?: string[]
  context?: React.ReactNode
  /** Text einer Checkbox, die vor dem Bestätigen angekreuzt werden muss. */
  ack?: string
  confirmLabel: string
  danger?: boolean
  pending?: boolean
  error?: string | null
}) {
  const t = useT()
  const id = useId()
  const [acked, setAcked] = useState(false)
  useEffect(() => {
    if (!open) setAcked(false)
  }, [open])
  return (
    <Dialog
      open={open}
      onClose={() => !pending && onClose()}
      title={title}
      context={context}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={pending}>{t('common.cancel')}</button>
          <button
            type="button"
            className={'btn ' + (danger ? 'danger solid' : 'primary')}
            onClick={onConfirm}
            disabled={pending || (!!ack && !acked)}
            data-loading={pending || undefined}
            aria-describedby={text ? id + 'x' : undefined}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      {text && <p id={id + 'x'} style={{ margin: 0 }}>{text}</p>}
      {consequences && consequences.length > 0 && (
        <ul className="confirm-list">
          {consequences.map((c) => <li key={c}>{c}</li>)}
        </ul>
      )}
      {ack && (
        <label className="check confirm-ack">
          <input type="checkbox" checked={acked} onChange={(e) => setAcked(e.target.checked)} />
          <span>{ack}</span>
        </label>
      )}
      {error && <p className="err" role="alert" style={{ margin: 0 }}>{error}</p>}
    </Dialog>
  )
}

/** Teilt eine Bestätigungsfrage «Konto deaktivieren? Alle Sitzungen …» in Titel und Erläuterung. */
export function splitQuestion(s: string): { title: string; text?: string } {
  const i = s.search(/[?？]\s/)
  if (i < 0) return { title: s }
  return { title: s.slice(0, i + 1), text: s.slice(i + 1).trim() || undefined }
}

/** Optionen einer Bestätigung: Frage als Titel, Folgen im Klartext, betroffener Datensatz als Kontext. */
export type ConfirmOptions = {
  title: string
  text?: string
  consequences?: string[]
  context?: React.ReactNode
  /** Nur für nicht umkehrbare Aktionen: Checkbox, die vor dem Bestätigen angekreuzt werden muss. */
  ack?: string
  confirmLabel?: string
  danger?: boolean
}

/**
 * Ersatz für `window.confirm` (PRD §32): `const [ask, dialog] = useConfirm()`, dann
 * `if (!(await ask({ title, context, danger }))) return` und `{dialog}` rendern.
 * Ein String wird an der ersten Frage in Titel und Erläuterung geteilt (siehe `splitQuestion`).
 */
export function useConfirm(): [(o: ConfirmOptions | string) => Promise<boolean>, React.ReactNode] {
  const t = useT()
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const [open, setOpen] = useState(false)
  const resolver = useRef<((v: boolean) => void) | null>(null)
  const ask = useCallback((o: ConfirmOptions | string) => {
    resolver.current?.(false)
    setOpts(typeof o === 'string' ? splitQuestion(o) : o)
    setOpen(true)
    return new Promise<boolean>((resolve) => { resolver.current = resolve })
  }, [])
  const done = (v: boolean) => {
    setOpen(false)
    const r = resolver.current
    resolver.current = null
    r?.(v)
  }
  useEffect(() => () => resolver.current?.(false), [])
  const node = opts ? (
    <ConfirmDialog
      open={open}
      onClose={() => done(false)}
      onConfirm={() => done(true)}
      title={opts.title}
      text={opts.text}
      consequences={opts.consequences}
      context={opts.context}
      ack={opts.ack}
      confirmLabel={opts.confirmLabel ?? t('common.confirm')}
      danger={opts.danger}
    />
  ) : null
  return [ask, node]
}
