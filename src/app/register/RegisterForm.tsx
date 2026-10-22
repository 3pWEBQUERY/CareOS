'use client'

import { useActionState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { orgSignupAction, registerAction, type RegisterState } from './actions'
import { Checkbox, TextField } from '@/components/ui/fields'

export function RegisterForm({ mode, labels }: { mode: 'request' | 'org'; labels: Record<string, string> }) {
  const [state, action, pending] = useActionState<RegisterState, FormData>(mode === 'org' ? orgSignupAction : registerAction, undefined)
  const form = useRef<HTMLFormElement>(null)
  const done = useRef<HTMLHeadingElement>(null)
  const v = state?.values ?? {}
  const msg = state?.error ? labels[state.error] ?? labels['register.errors.generic'] : null
  const err = (f: string) => (state?.field === f ? msg : undefined)
  const general = msg && !['code', 'firstName', 'lastName', 'email', 'password', 'note', 'consent', 'orgName'].includes(state?.field ?? '') ? msg : null

  // Fokus auf das fehlerhafte Feld bzw. auf die Bestätigung
  useEffect(() => {
    if (state?.done) return done.current?.focus()
    if (state?.field) (form.current?.elements.namedItem(state.field) as HTMLElement | null)?.focus()
  }, [state])

  if (state?.done) {
    const org = state.done === 'org'
    return (
      <div className="stack-sm" role="status">
        <h2 ref={done} tabIndex={-1} className="reg-done">{org ? labels.doneOrgTitle : labels.doneTitle}</h2>
        <p className="fg2" style={{ margin: 0 }}>{org ? labels.doneOrgText : labels.doneText}</p>
        <Link className="btn primary lg block" href="/login">{labels.toLogin}</Link>
      </div>
    )
  }

  return (
    <form ref={form} action={action} className="form" noValidate>
      {mode === 'org'
        ? <TextField label={labels.orgName} name="orgName" defaultValue={v.orgName} required maxLength={120} autoComplete="organization" error={err('orgName')} autoFocus />
        : <TextField label={labels.code} hint={labels.codeHint} name="code" defaultValue={v.code} required maxLength={20} autoComplete="off" autoCapitalize="characters" spellCheck={false} className="mono" error={err('code')} autoFocus />}
      <div className="form-grid">
        <TextField label={labels.firstName} name="firstName" defaultValue={v.firstName} required maxLength={60} autoComplete="given-name" error={err('firstName')} />
        <TextField label={labels.lastName} name="lastName" defaultValue={v.lastName} required maxLength={60} autoComplete="family-name" error={err('lastName')} />
      </div>
      <TextField label={labels.email} name="email" type="email" defaultValue={v.email} required maxLength={160} autoComplete="email" error={err('email')} />
      <TextField label={labels.password} hint={labels.passwordHint} name="password" type="password" required minLength={12} autoComplete="new-password" error={err('password')} />
      {mode === 'request' && <TextField label={labels.note} hint={labels.noteHint} name="note" defaultValue={v.note} optional maxLength={120} autoComplete="organization-title" error={err('note')} />}
      <details className="reg-privacy">
        <summary>{labels.privacyTitle}</summary>
        <p className="small fg2">{mode === 'org' ? labels.privacyOrg : labels.privacyText}</p>
      </details>
      <Checkbox label={labels.consent} name="consent" required defaultChecked={v.consent === 'on'} error={err('consent')} />
      {general && <p className="err" role="alert" style={{ margin: 0 }}>{general}</p>}
      <button className="btn primary lg block" type="submit" data-loading={pending} disabled={pending}>{mode === 'org' ? labels.submitOrg : labels.submit}</button>
    </form>
  )
}
