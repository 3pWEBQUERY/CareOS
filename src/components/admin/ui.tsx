'use client'

import { useEffect, useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { ConfirmDialog, splitQuestion } from '@/components/ui/ConfirmDialog'

type Result = { ok: true; message?: string; data?: unknown } | { ok: false; error: string; field?: string }

const isKey = (s: string) => /^[a-z]+\.[\w.]+$/.test(s)

/**
 * Knopf für eine einzelne Server Action ohne Formularfelder (z. B. Widerrufen, Entfernen).
 * Mit `confirm` öffnet sich vorher ein Bestätigungsdialog: Frage als Titel, Folgen als Text,
 * betroffener Datensatz als `context`, bei nicht umkehrbaren Aktionen zusätzlich `ack` (PRD §32).
 */
export function ActBtn({ action, children, className = 'btn sm', confirm, success, title, context, consequences, ack, confirmLabel }: {
  action: () => Promise<Result>
  children: React.ReactNode
  className?: string
  confirm?: string
  success?: string
  title?: string
  context?: React.ReactNode
  consequences?: string[]
  ack?: string
  confirmLabel?: string
}) {
  const t = useT()
  const tr = (s: string) => (isKey(s) ? t(s) : s)
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const exec = () =>
    start(async () => {
      const r = await action()
      if (r.ok) {
        setOpen(false)
        const m = r.message ?? success
        if (m) toast(tr(m))
      } else if (open) setError(tr(r.error))
      else toast(tr(r.error), { kind: 'crit' })
    })
  const q = confirm ? splitQuestion(tr(confirm)) : null
  const label = confirmLabel ?? (typeof children === 'string' ? children : title ?? t('common.confirm'))
  return (
    <>
      <button
        type="button"
        className={className}
        title={title}
        data-loading={(pending && !open) || undefined}
        disabled={pending}
        onClick={() => {
          if (!confirm) return exec()
          setError(null)
          setOpen(true)
        }}
      >
        {children}
      </button>
      {q && (
        <ConfirmDialog
          open={open}
          onClose={() => setOpen(false)}
          onConfirm={exec}
          title={q.title}
          text={q.text}
          consequences={consequences}
          context={context}
          ack={ack}
          confirmLabel={label}
          danger={/\bdanger\b/.test(className) || !!ack}
          pending={pending}
          error={error}
        />
      )}
    </>
  )
}

/**
 * Warnt beim Verlassen der Seite mit ungespeicherten Änderungen: Browser-Navigation (beforeunload)
 * und Klicks auf interne Links (Next.js Link) werden abgefangen.
 */
export function useUnsavedGuard(dirty: boolean, message: string) {
  useEffect(() => {
    if (!dirty) return
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = message
    }
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return
      const url = new URL(a.href, location.href)
      if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return
      if (!window.confirm(message)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', onUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [dirty, message])
}

/** Knopf, der einen Dialog mit Formular öffnet. Schliesst nach erfolgreichem Speichern. */
export function FormDialog({ label, title, action, success, submit, children, buttonClass = 'btn', wide, confirm, submitClass }: {
  label: React.ReactNode
  title: string
  action: (form: FormData) => Promise<Result>
  success?: string
  submit: string
  children: React.ReactNode
  buttonClass?: string
  wide?: boolean
  confirm?: string
  submitClass?: string
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={buttonClass} onClick={() => setOpen(true)}>{label}</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} wide={wide}>
        <ActionForm action={action} success={success} confirm={confirm} onDone={(r) => r.ok && setOpen(false)}>
          {children}
          <div className="form-actions">
            <span className="spacer" />
            <button type="button" className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
            <Submit className={submitClass}>{submit}</Submit>
          </div>
        </ActionForm>
      </Dialog>
    </>
  )
}

/** Formular, dessen Ergebnis ein einmalig angezeigtes Geheimnis enthält (API-Token, Webhook-Secret, Einladungslink). */
export function SecretForm({ action, children, submit, intro, label, success, submitClass = 'btn primary' }: {
  action: (form: FormData) => Promise<Result>
  children?: React.ReactNode
  submit: string
  intro: string
  label: string
  success?: string
  submitClass?: string
}) {
  const [secret, setSecret] = useState<string | null>(null)
  return (
    <div className="stack-sm">
      <ActionForm
        action={action}
        success={success}
        onDone={(r) => {
          if (r.ok && r.data && typeof r.data === 'object' && 'secret' in r.data) setSecret(String((r.data as { secret: string }).secret))
        }}
      >
        {children}
        <div className="form-actions"><Submit className={submitClass}>{submit}</Submit></div>
      </ActionForm>
      {secret && <SecretBox value={secret} intro={intro} label={label} onDismiss={() => setSecret(null)} />}
    </div>
  )
}

/** Wie FormDialog, zeigt aber ein zurückgegebenes Geheimnis einmalig im Dialog an, statt ihn zu schliessen. */
export function SecretDialog({ label, title, action, submit, children, intro, secretLabel, buttonClass = 'btn', success, submitClass }: {
  label: React.ReactNode
  title: string
  action: (form: FormData) => Promise<Result>
  submit: string
  children: React.ReactNode
  intro: string
  secretLabel: string
  buttonClass?: string
  success?: string
  submitClass?: string
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  const close = () => {
    setOpen(false)
    setSecret(null)
  }
  return (
    <>
      <button type="button" className={buttonClass} onClick={() => setOpen(true)}>{label}</button>
      <Dialog open={open} onClose={close} title={title}>
        {secret ? (
          <>
            <SecretBox value={secret} intro={intro} label={secretLabel} />
            <div className="form-actions"><span className="spacer" /><button type="button" className="btn primary" onClick={close}>{t('common.close')}</button></div>
          </>
        ) : (
          <ActionForm
            action={action}
            success={success}
            onDone={(r) => {
              if (!r.ok) return
              const s = r.data && typeof r.data === 'object' && 'secret' in r.data ? (r.data as { secret?: string }).secret : undefined
              if (s) setSecret(s)
              else close()
            }}
          >
            {children}
            <div className="form-actions">
              <span className="spacer" />
              <button type="button" className="btn" onClick={close}>{t('common.cancel')}</button>
              <Submit className={submitClass}>{submit}</Submit>
            </div>
          </ActionForm>
        )}
      </Dialog>
    </>
  )
}

export function SecretBox({ value, intro, label, onDismiss }: { value: string; intro: string; label: string; onDismiss?: () => void }) {
  const t = useT()
  return (
    <div className="alert warn" role="status">
      <div className="grow stack-sm">
        <strong>{intro}</strong>
        <label className="fld">
          <span className="lbl">{label}</span>
          <input className="field mono" readOnly value={value} onFocus={(e) => e.currentTarget.select()} aria-label={label} />
        </label>
        <div className="row">
          <button
            type="button"
            className="btn sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(value)
                toast(t('admin.common.copied'))
              } catch {
                /* Zwischenablage nicht verfügbar */
              }
            }}
          >
            {t('admin.common.copy')}
          </button>
          {onDismiss && <button type="button" className="btn sm ghost" onClick={onDismiss}>{t('admin.common.hide')}</button>}
        </div>
      </div>
    </div>
  )
}
