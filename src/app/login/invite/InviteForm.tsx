'use client'

import { useActionState } from 'react'
import { acceptInviteAction, type InviteState } from './actions'

export function InviteForm({ token, email, labels }: { token: string; email: string; labels: Record<string, string> }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(acceptInviteAction, undefined)
  const error = state?.error ? labels['err_' + state.error] ?? labels.err_invalid : null
  return (
    <form action={action} className="form" noValidate>
      <input type="hidden" name="token" value={token} />
      <input type="text" name="username" autoComplete="username" defaultValue={email} hidden readOnly />
      <label className="fld">
        <span className="lbl">{labels.password}</span>
        <input className="field" type="password" name="password" autoComplete="new-password" minLength={10} required autoFocus aria-invalid={!!error} />
        <span className="hint">{labels.rules}</span>
      </label>
      <label className="fld">
        <span className="lbl">{labels.repeat}</span>
        <input className="field" type="password" name="repeat" autoComplete="new-password" minLength={10} required />
      </label>
      {error && <p className="err" role="alert" style={{ margin: 0 }}>{error}</p>}
      <button className="btn primary lg block" type="submit" data-loading={pending} disabled={pending}>{labels.submit}</button>
    </form>
  )
}
