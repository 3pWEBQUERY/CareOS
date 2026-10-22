'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { RadioGroup, TextField } from '@/components/ui/fields'

/** Auswahl: Einmal-Link (empfohlen) oder vorläufiges Passwort. */
export function ModeFields({ linkLabel, linkHint }: { linkLabel: string; linkHint: string }) {
  const t = useT()
  const [mode, setMode] = useState<'link' | 'password'>('link')
  return (
    <div className="stack-sm">
      <RadioGroup
        label={t('admin.users.access')}
        name="mode"
        value={mode === 'link' ? 'invite' : 'password'}
        onChange={(v) => setMode(v === 'invite' ? 'link' : 'password')}
        options={[
          { value: 'invite', label: linkLabel, hint: linkHint },
          { value: 'password', label: t('admin.users.modePassword') },
        ]}
      />
      {mode === 'password' && (
        <TextField label={t('admin.users.tempPassword')} hint={t('profile.password.rules')} wrapStyle={{ paddingLeft: 24 }} type="password" name="password" autoComplete="new-password" minLength={10} required />
      )}
    </div>
  )
}
