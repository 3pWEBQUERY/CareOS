'use client'

import { useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'

type Result = { ok: true; message?: string } | { ok: false; error: string }

/**
 * Einzelne Schaltfläche für eine gebundene Server Action (Team, Chat, Dienstplan).
 * Erfolg und Fehler erscheinen als Toast; `confirm` fragt vorher nach.
 */
export function ActButton({ action, children, className = 'btn sm', success, confirm, title, pressed, disabled }: {
  action: () => Promise<Result>
  children: React.ReactNode
  className?: string
  success?: string
  confirm?: string
  title?: string
  pressed?: boolean
  disabled?: boolean
}) {
  const t = useT()
  const [pending, start] = useTransition()
  const tr = (s: string) => (/^[a-z]+\.[\w.]+$/.test(s) ? t(s) : s)
  return (
    <button
      type="button"
      className={className}
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      disabled={disabled || pending}
      data-loading={pending || undefined}
      onClick={() => {
        if (confirm && !window.confirm(tr(confirm))) return
        start(async () => {
          const r = await action()
          if (r.ok) {
            const msg = r.message ?? success
            if (msg) toast(tr(msg))
          } else toast(tr(r.error), { kind: 'crit' })
        })
      }}
    >
      {children}
    </button>
  )
}
