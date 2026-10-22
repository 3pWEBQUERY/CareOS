'use client'

import { useOptimistic, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { useConfirm, splitQuestion } from '@/components/ui/ConfirmDialog'

type Result = { ok: true; message?: string } | { ok: false; error: string }

/**
 * Einzelne Schaltfläche für eine gebundene Server Action (Team, Chat, Dienstplan).
 * Erfolg und Fehler erscheinen als Toast; `confirm` fragt vorher nach.
 * `optimistic`: Inhalt, der sofort nach dem Klick erscheint (nur für ungefährliche, idempotente Aktionen ohne
 * Bestätigung, z. B. Kenntnisnahme); bei Fehler kehrt die Schaltfläche zurück (PRD §31).
 */
export function ActButton({ action, children, className = 'btn sm', success, confirm, title, pressed, disabled, context, optimistic, optimisticClassName, onOptimistic }: {
  action: () => Promise<Result>
  children: React.ReactNode
  className?: string
  success?: string
  confirm?: string
  title?: string
  pressed?: boolean
  disabled?: boolean
  /** Betroffener Datensatz im Bestätigungsdialog. */
  context?: React.ReactNode
  optimistic?: React.ReactNode
  optimisticClassName?: string
  /** Wird in derselben Transition aufgerufen (z. B. optimistischer Zähler); endet mit ihr. */
  onOptimistic?: () => void
}) {
  const t = useT()
  const [pending, start] = useTransition()
  const tr = (s: string) => (/^[a-z]+\.[\w.]+$/.test(s) ? t(s) : s)
  const [ask, confirmDialog] = useConfirm()
  const [done, setDone] = useOptimistic(false)
  const opt = done && optimistic !== undefined && !confirm
  return (
    <>
    <button
      type="button"
      className={opt && optimisticClassName ? optimisticClassName : className}
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      disabled={disabled || pending}
      data-loading={(pending && !opt) || undefined}
      onClick={async (e) => {
        const label = e.currentTarget.textContent?.trim() || title
        if (confirm && !(await ask({ ...splitQuestion(tr(confirm)), context, confirmLabel: label, danger: /\bdanger\b/.test(className) }))) return
        start(async () => {
          setDone(true)
          onOptimistic?.()
          const r = await action()
          if (r.ok) {
            const msg = r.message ?? success
            if (msg) toast(tr(msg))
          } else toast(tr(r.error), { kind: 'crit' })
        })
      }}
    >
      {opt ? optimistic : children}
    </button>
    {confirmDialog}
    </>
  )
}
