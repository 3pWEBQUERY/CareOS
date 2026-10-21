'use client'

import { useRef, useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'

type Result = { ok: true; message?: string } | { ok: false; error: string; field?: string }

/**
 * Formular einer Workflow-Stufe mit zwei Absichten: Speichern oder Speichern und weiter.
 * Der Absender-Button wird mitgeschickt (FormData mit submitter).
 */
export function StageForm({ action, children, advanceLabel, confirmAdvance, canAdvance = true, canSave = true }: {
  action: (form: FormData) => Promise<Result>
  children: React.ReactNode
  advanceLabel?: string
  confirmAdvance?: string
  canAdvance?: boolean
  canSave?: boolean
}) {
  const t = useT()
  const ref = useRef<HTMLFormElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const tr = (s: string) => (/^[a-z]+\.[\w.]+$/.test(s) ? t(s) : s)
  return (
    <form
      ref={ref}
      className="form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
        if (submitter?.value === 'advance' && confirmAdvance && !window.confirm(confirmAdvance)) return
        const fd = new FormData(e.currentTarget, submitter)
        start(async () => {
          const r = await action(fd)
          if (r.ok) {
            setError(null)
            if (r.message) toast(tr(r.message))
          } else {
            setError(tr(r.error))
            if (r.field) (ref.current?.querySelector(`[name="${r.field}"]`) as HTMLElement | null)?.focus()
          }
        })
      }}
    >
      <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'contents' }}>
        {children}
        <div className="form-actions">
          {canSave && <button type="submit" className="btn" name="intent" value="save">{t('common.save')}</button>}
          {canAdvance && advanceLabel && <button type="submit" className="btn primary" name="intent" value="advance" data-loading={pending || undefined}>{advanceLabel}</button>}
        </div>
      </fieldset>
      {error && <p className="err" role="alert" style={{ margin: 0 }}>{error}</p>}
    </form>
  )
}
