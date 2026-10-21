'use client'

import { useRef, useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'

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
  /** Bestätigungsfrage vor sicherheitskritischen Aktionen (PRD §32). */
  confirm?: string
}) {
  const t = useT()
  const ref = useRef<HTMLFormElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const tr = (s: string) => (/^[a-z]+\.[\w.]+$/.test(s) ? t(s) : s)
  return (
    <form
      ref={ref}
      id={id}
      className={className}
      noValidate
      data-pending={pending || undefined}
      onSubmit={(e) => {
        e.preventDefault()
        if (confirm && !window.confirm(tr(confirm))) return
        const form = new FormData(e.currentTarget)
        start(async () => {
          const r = await action(form)
          if (r.ok) {
            setError(null)
            if (reset) ref.current?.reset()
            const msg = r.message ?? success
            if (msg) toast(tr(msg))
          } else {
            setError(tr(r.error))
            if (r.field) (ref.current?.querySelector(`[name="${r.field}"]`) as HTMLElement | null)?.focus()
          }
          onDone?.(r)
        })
      }}
    >
      <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'contents' }}>
        {children}
      </fieldset>
      {error && <p className="err" role="alert" style={{ margin: 0 }}>{error}</p>}
    </form>
  )
}

export function Submit({ children, className = 'btn primary', name, value }: { children: React.ReactNode; className?: string; name?: string; value?: string }) {
  return <button type="submit" className={className} name={name} value={value}>{children}</button>
}
