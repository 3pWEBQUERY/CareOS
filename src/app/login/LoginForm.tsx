'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { startAuthentication } from '@simplewebauthn/browser'
import { loginAction, type LoginState } from './actions'

type Labels = Record<'email' | 'password' | 'submit' | 'passkey' | 'or' | 'invalid' | 'locked' | 'inactive' | 'passkeyFailed', string>

export function LoginForm({ labels, next, sso }: { labels: Labels; next: string; sso: { label: string } | null }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, undefined)
  const [pkError, setPkError] = useState(false)
  const [pkBusy, setPkBusy] = useState(false)
  const error = state?.error ? (state.error === 'locked' ? labels.locked.replace('{s}', String(state.retry ?? 60)) : labels[state.error as keyof Labels]) : null
  // Nach fehlgeschlagener Anmeldung Fokus ins Passwortfeld (der Absende-Knopf war während der Prüfung deaktiviert)
  const pw = useRef<HTMLInputElement>(null)
  useEffect(() => { if (state?.error) pw.current?.focus() }, [state])

  async function passkey() {
    setPkError(false)
    setPkBusy(true)
    try {
      const opts = await fetch('/api/auth/passkey/login', { method: 'GET' }).then((r) => r.json())
      const resp = await startAuthentication({ optionsJSON: opts })
      const res = await fetch('/api/auth/passkey/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(resp) })
      if (!res.ok) throw new Error()
      window.location.href = next
    } catch {
      setPkError(true)
      setPkBusy(false)
    }
  }

  return (
    <>
      <form action={action} className="form" noValidate>
        <input type="hidden" name="next" value={next} />
        <label className="fld">
          <span className="lbl">{labels.email}</span>
          <input className="field" name="email" type="email" autoComplete="username webauthn" required defaultValue={state?.email} aria-invalid={!!error} aria-describedby={error ? 'login-err' : undefined} autoFocus />
        </label>
        <label className="fld">
          <span className="lbl">{labels.password}</span>
          <input ref={pw} className="field" name="password" type="password" autoComplete="current-password" required aria-invalid={!!error} aria-describedby={error ? 'login-err' : undefined} />
        </label>
        {error && <p className="err" id="login-err" role="alert" style={{ margin: 0 }}>{error}</p>}
        <button className="btn primary lg block" type="submit" data-loading={pending} disabled={pending}>{labels.submit}</button>
      </form>
      <div className="divider">{labels.or}</div>
      <div className="stack-sm">
        <button type="button" className="btn lg block" onClick={passkey} data-loading={pkBusy} disabled={pkBusy}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="6" cy="5" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M1.5 14c.4-2.6 2.2-4 4.5-4 1 0 1.9.3 2.6.8M11.5 9.5a2 2 0 1 1 0 .01M11.5 11.5V15m0-1.5h1.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
          {labels.passkey}
        </button>
        {pkError && <p className="err" role="alert" style={{ margin: 0 }}>{labels.passkeyFailed}</p>}
        {sso && <a className="btn lg block" href={'/api/auth/sso?next=' + encodeURIComponent(next)}>{sso.label}</a>}
      </div>
    </>
  )
}
