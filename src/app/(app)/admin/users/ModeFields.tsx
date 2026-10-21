'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'

/** Auswahl: Einmal-Link (empfohlen) oder vorläufiges Passwort. */
export function ModeFields({ linkLabel, linkHint }: { linkLabel: string; linkHint: string }) {
  const t = useT()
  const [mode, setMode] = useState<'link' | 'password'>('link')
  return (
    <fieldset className="stack-sm">
      <legend className="lbl">{t('admin.users.access')}</legend>
      <label className="check"><input type="radio" name="mode" value="invite" checked={mode === 'link'} onChange={() => setMode('link')} /><span>{linkLabel}</span></label>
      {mode === 'link' && <span className="small muted" style={{ paddingLeft: 24 }}>{linkHint}</span>}
      <label className="check"><input type="radio" name="mode" value="password" checked={mode === 'password'} onChange={() => setMode('password')} /><span>{t('admin.users.modePassword')}</span></label>
      {mode === 'password' && (
        <label className="fld" style={{ paddingLeft: 24 }}>
          <span className="lbl">{t('admin.users.tempPassword')}</span>
          <input className="field" type="password" name="password" autoComplete="new-password" minLength={10} required />
          <span className="hint">{t('profile.password.rules')}</span>
        </label>
      )}
    </fieldset>
  )
}
