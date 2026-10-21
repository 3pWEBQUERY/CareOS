'use client'

import { useActionState } from 'react'
import { mfaAction, type LoginState } from '../actions'

export function MfaForm({ next, labels }: { next: string; labels: Record<'mfaCode' | 'mfaSubmit' | 'mfaInvalid' | 'locked', string> }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(mfaAction, undefined)
  const error = state?.error === 'locked' ? labels.locked.replace('{s}', String(state.retry ?? 60)) : state?.error ? labels.mfaInvalid : null
  return (
    <form action={action} className="form" noValidate>
      <input type="hidden" name="next" value={next} />
      <label className="fld">
        <span className="lbl">{labels.mfaCode}</span>
        <input className="field otp" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={7} required autoFocus aria-invalid={!!error} />
      </label>
      {error && <p className="err" role="alert" style={{ margin: 0 }}>{error}</p>}
      <button className="btn primary lg block" type="submit" data-loading={pending} disabled={pending}>{labels.mfaSubmit}</button>
    </form>
  )
}
