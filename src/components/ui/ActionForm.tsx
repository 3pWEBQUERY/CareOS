'use client'

import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { useConfirm, splitQuestion, type ConfirmOptions } from '@/components/ui/ConfirmDialog'

type Result = { ok: true; message?: string; data?: unknown } | { ok: false; error: string; field?: string }

/**
 * Formular für Server Actions mit ActionResult. Zeigt Fehler direkt am Formular,
 * Erfolg als Toast. `success` ist ein i18n-Schlüssel oder Text.
 */
export function ActionForm({
  action, children, success, reset = true, className = 'form', onDone, id, confirm,
}: {
  action: (form: FormData) => Promise<Result>
  children: React.ReactNode
  success?: string
  reset?: boolean
  className?: string
  onDone?: (r: Result) => void
  id?: string
  /**
   * Bestätigung vor sicherheitskritischen Aktionen (PRD §32): i18n-Schlüssel oder Text (an der ersten
   * Frage in Titel und Erläuterung geteilt) oder Optionen des ConfirmDialog. Ohne Angabe wird
   * die Beschriftung des Absende-Knopfs übernommen, `danger` folgt dessen Klasse.
   */
  confirm?: string | ConfirmOptions
}) {
  const t = useT()
  const ref = useRef<HTMLFormElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const errId = useId()
  const focusAfter = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!pending && focusAfter.current) {
      focusAfter.current.focus()
      focusAfter.current = null
    }
  }, [pending, error])
  const tr = (s: string) => (/^[a-z]+\.[\w.]+$/.test(s) ? t(s) : s)
  const [ask, confirmDialog] = useConfirm()
  const submit = (formEl: HTMLFormElement) => {
    // Markierungen aus dem letzten Versuch entfernen
    formEl.querySelectorAll(`[aria-describedby="${errId}"]`).forEach((x) => { x.removeAttribute('aria-invalid'); x.removeAttribute('aria-describedby') })
    const form = new FormData(formEl)
    start(async () => {
      const r = await action(form)
      if (r.ok) {
        setError(null)
        if (reset) ref.current?.reset()
        const msg = r.message ?? success
        if (msg) toast(tr(msg))
      } else {
        setError(tr(r.error))
        // Fehler am Feld: markieren und fokussieren (PRD §32); sonst liest die Live-Region die Meldung vor.
        const el = r.field ? (ref.current?.querySelector(`[name="${r.field}"]`) as HTMLElement | null) : null
        if (el) {
          el.setAttribute('aria-invalid', 'true')
          el.setAttribute('aria-describedby', errId)
          focusAfter.current = el // erst fokussieren, wenn das Fieldset wieder aktiv ist
        }
      }
      onDone?.(r)
    })
  }
  return (
    <>
    <form
      ref={ref}
      id={id}
      className={className}
      noValidate
      data-pending={pending || undefined}
      aria-busy={pending || undefined}
      onSubmit={(e) => {
        e.preventDefault()
        const formEl = e.currentTarget
        if (!confirm) return submit(formEl)
        const btn = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null
        const o: ConfirmOptions = typeof confirm === 'string' ? splitQuestion(tr(confirm)) : confirm
        ask({
          ...o,
          title: tr(o.title),
          text: o.text && tr(o.text),
          ack: o.ack && tr(o.ack),
          confirmLabel: o.confirmLabel ? tr(o.confirmLabel) : btn?.textContent?.trim() || undefined,
          danger: o.danger ?? (!!btn?.classList.contains('danger') || !!o.ack),
        }).then((yes) => { if (yes && formEl.isConnected) submit(formEl) })
      }}
    >
      <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'contents' }}>
        {children}
      </fieldset>
      {error && <p className="err" id={errId} role="alert" style={{ margin: 0 }}>{error}</p>}
    </form>
    {confirmDialog}
    </>
  )
}

export function Submit({ children, className = 'btn primary', name, value }: { children: React.ReactNode; className?: string; name?: string; value?: string }) {
  return <button type="submit" className={className} name={name} value={value}>{children}</button>
}
