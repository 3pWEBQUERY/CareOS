'use client'

import { useRef, useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { ConfirmDialog, splitQuestion } from '@/components/ui/ConfirmDialog'

type Result = { ok: true; message?: string } | { ok: false; error: string; field?: string }

/**
 * Formular einer Workflow-Stufe mit zwei Absichten: Speichern oder Speichern und weiter.
 * Der Absender-Button wird mitgeschickt (FormData mit submitter). Folgenreiche Schritte
 * (weiter trotz offener Massnahmen, Abschliessen) werden in einem Dialog bestätigt.
 */
export function StageForm({ action, children, advanceLabel, confirmAdvance, canAdvance = true, canSave = true, context }: {
  action: (form: FormData) => Promise<Result>
  children: React.ReactNode
  advanceLabel?: string
  confirmAdvance?: string
  canAdvance?: boolean
  canSave?: boolean
  context?: React.ReactNode
}) {
  const t = useT()
  const ref = useRef<HTMLFormElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [ask, setAsk] = useState<FormData | null>(null)
  const [pending, start] = useTransition()
  const tr = (s: string) => (/^[a-z]+\.[\w.]+$/.test(s) ? t(s) : s)
  const send = (fd: FormData) =>
    start(async () => {
      const r = await action(fd)
      setAsk(null)
      if (r.ok) {
        setError(null)
        if (r.message) toast(tr(r.message))
      } else {
        setError(tr(r.error))
        if (r.field) (ref.current?.querySelector(`[name="${r.field}"]`) as HTMLElement | null)?.focus()
      }
    })
  const q = confirmAdvance ? splitQuestion(confirmAdvance) : null
  return (
    <form
      ref={ref}
      className="form"
      noValidate
      aria-busy={pending || undefined}
      onSubmit={(e) => {
        e.preventDefault()
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
        const fd = new FormData(e.currentTarget, submitter)
        if (submitter?.value === 'advance' && confirmAdvance) return setAsk(fd)
        send(fd)
      }}
    >
      <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'contents' }}>
        {children}
        <div className="form-actions">
          {canSave && <button type="submit" className="btn" name="intent" value="save">{t('common.save')}</button>}
          {canAdvance && advanceLabel && <button type="submit" className="btn primary" name="intent" value="advance" data-loading={(pending && !ask) || undefined}>{advanceLabel}</button>}
        </div>
      </fieldset>
      {error && <p className="err" role="alert" style={{ margin: 0 }}>{error}</p>}
      {q && (
        <ConfirmDialog
          open={!!ask}
          onClose={() => setAsk(null)}
          onConfirm={() => ask && send(ask)}
          title={q.title}
          text={q.text}
          context={context}
          confirmLabel={advanceLabel ?? t('common.confirm')}
          pending={pending}
        />
      )}
    </form>
  )
}
