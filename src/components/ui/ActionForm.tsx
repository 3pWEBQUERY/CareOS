'use client'

import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
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
  // Platz für die Meldung direkt am Feld (Feld-Komponenten: `[data-err-slot]` im Rahmen .fld), sonst unten im Formular
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const [pending, start] = useTransition()
  const errId = useId()
  const focusAfter = useRef<HTMLElement | null>(null)
  // Während des Speicherns ist das Fieldset deaktiviert und der Fokus fällt auf <body>: danach zum
  // auslösenden Element zurück, sofern der Fokus nicht inzwischen woanders liegt (WCAG 2.4.3).
  const restore = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (pending) return
    if (focusAfter.current) {
      focusAfter.current.focus()
      focusAfter.current = null
      restore.current = null
    } else if (restore.current) {
      const el = restore.current
      restore.current = null
      if (el.isConnected && (!document.activeElement || document.activeElement === document.body)) el.focus()
    }
  }, [pending, error])
  const tr = (s: string) => (/^[a-z]+\.[\w.]+$/.test(s) ? t(s) : s)
  const [ask, confirmDialog] = useConfirm()
  const submit = (formEl: HTMLFormElement) => {
    // Markierungen aus dem letzten Versuch entfernen
    formEl.querySelectorAll<HTMLElement>('[data-err-mark]').forEach((x) => {
      x.removeAttribute('aria-invalid')
      x.removeAttribute('data-err-mark')
      const rest = (x.getAttribute('aria-describedby') ?? '').split(' ').filter((v) => v && v !== errId).join(' ')
      if (rest) x.setAttribute('aria-describedby', rest)
      else x.removeAttribute('aria-describedby')
    })
    const form = new FormData(formEl)
    restore.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
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
        let el = r.field ? (ref.current?.querySelector(`[name="${r.field}"]`) as HTMLElement | null) : null
        // Eigene Felder (DateField/TimeField) schreiben in ein verstecktes Feld – markiert wird das sichtbare
        if (el instanceof HTMLInputElement && el.type === 'hidden' && el.dataset.for) el = document.getElementById(el.dataset.for) ?? el
        // Gruppen (RadioGroup) sind selbst nicht fokussierbar → erste Option
        if (el && !el.matches('input, select, textarea, button, [tabindex]')) el = el.querySelector<HTMLElement>('[tabindex="0"], input:not([type="hidden"]), button, select, textarea') ?? el
        const host = el?.closest('.fld, .chk-fld')?.querySelector<HTMLElement>(':scope > [data-err-slot]') ?? null
        setSlot(host)
        if (el) {
          el.setAttribute('aria-invalid', 'true')
          // Hinweis/Einheit des Felds bleiben verknüpft; die Meldung kommt dazu
          const prev = (el.getAttribute('aria-describedby') ?? '').split(' ').filter((v) => v && v !== errId)
          el.setAttribute('aria-describedby', [...prev, errId].join(' '))
          el.setAttribute('data-err-mark', '')
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
      {error && (slot?.isConnected
        ? createPortal(<span className="err fld-err" id={errId} role="alert">{error}</span>, slot)
        : <p className="err" id={errId} role="alert" style={{ margin: 0 }}>{error}</p>)}
    </form>
    {confirmDialog}
    </>
  )
}

export function Submit({ children, className = 'btn primary', name, value }: { children: React.ReactNode; className?: string; name?: string; value?: string }) {
  return <button type="submit" className={className} name={name} value={value}>{children}</button>
}
