'use client'

import { useActionState, useEffect, useRef } from 'react'
import { portalLoginAction, type PortalAuthState } from '../actions'
import { TextField } from '@/components/ui/fields'

type Labels = Record<'email' | 'password' | 'submit' | 'invalid' | 'locked' | 'accountLocked' | 'unavailable', string>

export function PortalLoginForm({ labels, next }: { labels: Labels; next: string }) {
  const [state, action, pending] = useActionState<PortalAuthState, FormData>(portalLoginAction, undefined)
  const pw = useRef<HTMLInputElement>(null)
  useEffect(() => { if (state?.error) pw.current?.focus() }, [state])
  const error = state?.error ? (state.error === 'locked' ? labels.locked.replace('{s}', String(state.retry ?? 60)) : labels[state.error as keyof Labels] ?? labels.invalid) : null
  return (
    <form action={action} className="form" noValidate>
      <input type="hidden" name="next" value={next} />
      <TextField label={labels.email} name="email" type="email" autoComplete="username" required defaultValue={state?.email} aria-invalid={!!error} aria-describedby={error ? 'plogin-err' : undefined} autoFocus />
      <TextField label={labels.password} ref={pw} name="password" type="password" autoComplete="current-password" required aria-invalid={!!error} aria-describedby={error ? 'plogin-err' : undefined} />
      {error && <p className="err" id="plogin-err" role="alert" style={{ margin: 0 }}>{error}</p>}
      <button className="btn primary lg block" type="submit" data-loading={pending} disabled={pending}>{labels.submit}</button>
    </form>
  )
}
