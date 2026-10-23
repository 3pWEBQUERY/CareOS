'use client'

import { useActionState } from 'react'
import { acceptPortalInviteAction, type PortalAuthState } from '../actions'
import { Checkbox, TextField } from '@/components/ui/fields'

export function InviteAcceptForm({ token, email, name, existing, locale, labels }: { token: string; email: string; name: string; existing: boolean; locale: string; labels: Record<string, string> }) {
  const [state, action, pending] = useActionState<PortalAuthState, FormData>(acceptPortalInviteAction, undefined)
  const error = state?.error ? labels['err_' + state.error] ?? labels.err_invalid : null
  return (
    <form action={action} className="form" noValidate>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="locale" value={locale} />
      <TextField label={labels.email} name="username" type="email" autoComplete="username" value={email} readOnly />
      {existing ? (
        <>
          <p className="small fg2" style={{ margin: 0 }}>{labels.existingHint}</p>
          <TextField label={labels.password} type="password" name="password" autoComplete="current-password" required autoFocus aria-invalid={!!error} aria-describedby={error ? 'pacc-err' : undefined} />
        </>
      ) : (
        <>
          <TextField label={labels.name} name="name" autoComplete="name" required maxLength={120} defaultValue={name} />
          <TextField label={labels.password} hint={labels.rules} type="password" name="password" autoComplete="new-password" minLength={10} required aria-invalid={!!error} aria-describedby={error ? 'pacc-err' : undefined} />
          <TextField label={labels.repeat} type="password" name="repeat" autoComplete="new-password" minLength={10} required />
          <Checkbox name="privacy" required label={labels.privacy} />
        </>
      )}
      {error && <p className="err" id="pacc-err" role="alert" style={{ margin: 0 }}>{error}</p>}
      <button className="btn primary lg block" type="submit" data-loading={pending} disabled={pending}>{existing ? labels.submitExisting : labels.submitNew}</button>
    </form>
  )
}
