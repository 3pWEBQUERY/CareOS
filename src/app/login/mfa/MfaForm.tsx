'use client'

import { useActionState, useEffect, useRef } from 'react'
import { mfaAction, type LoginState } from '../actions'

export function MfaForm({ next, labels }: { next: string; labels: Record<'mfaCode' | 'mfaSubmit' | 'mfaInvalid' | 'locked', string> }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(mfaAction, undefined)
  const code = useRef<HTMLInputElement>(null)
  useEffect(() => { if (state?.error) code.current?.focus() }, [state])
  const error = state?.error === 'locked' ? labels.locked.replace('{s}', String(state.retry ?? 60)) : state?.error ? labels.mfaInvalid : null
  return (
    <form action={action} className="form" noValidate>
      <input type="hidden" name="next" value={next} />
      <label className="fld">
        <span className="lbl">{labels.mfaCode}</span>
        <input ref={code} className="field otp" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={7} required autoFocus aria-invalid={!!error} aria-describedby={error ? 'mfa-err' : undefined} />
      </label>
      {error && <p className="err" id="mfa-err" role="alert" style={{ margin: 0 }}>{error}</p>}
      <button className="btn primary lg block" type="submit" data-loading={pending} disabled={pending}>{labels.mfaSubmit}</button>
    </form>
  )
}
