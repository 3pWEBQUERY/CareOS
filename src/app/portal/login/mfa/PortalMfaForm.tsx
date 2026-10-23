'use client'

import { useActionState, useEffect, useRef } from 'react'
import { portalMfaAction, type PortalAuthState } from '../../actions'
import { TextField } from '@/components/ui/fields'

export function PortalMfaForm({ next, labels }: { next: string; labels: Record<'code' | 'submit' | 'invalid' | 'locked', string> }) {
  const [state, action, pending] = useActionState<PortalAuthState, FormData>(portalMfaAction, undefined)
  const code = useRef<HTMLInputElement>(null)
  useEffect(() => { if (state?.error) code.current?.focus() }, [state])
  const error = state?.error === 'locked' ? labels.locked.replace('{s}', String(state.retry ?? 60)) : state?.error ? labels.invalid : null
  return (
    <form action={action} className="form" noValidate>
      <input type="hidden" name="next" value={next} />
      <TextField label={labels.code} ref={code} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={7} required autoFocus aria-invalid={!!error} aria-describedby={error ? 'pmfa-err' : undefined} className="otp" />
      {error && <p className="err" id="pmfa-err" role="alert" style={{ margin: 0 }}>{error}</p>}
      <button className="btn primary lg block" type="submit" data-loading={pending} disabled={pending}>{labels.submit}</button>
    </form>
  )
}
