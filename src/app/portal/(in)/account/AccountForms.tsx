'use client'

import { useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { ActionForm } from '@/components/ui/ActionForm'
import { Select, TextField } from '@/components/ui/fields'
import { LOCALES, LOCALE_NAMES } from '@/i18n/core'
import { changePasswordAction, confirmPortalMfaAction, disablePortalMfaAction, signOutOthersAction, startPortalMfaAction, updateProfileAction } from '../actions'

export function ProfileForm({ name, phone, locale, theme, text }: { name: string; phone: string; locale: string; theme: string; text: string }) {
  const t = useT()
  return (
    <ActionForm action={updateProfileAction} reset={false} success="common.saved">
      <div className="form-grid">
        <TextField label={t('portal.account.name')} name="name" required maxLength={120} defaultValue={name} autoComplete="name" />
        <TextField label={t('portal.account.phone')} name="phone" type="tel" optional maxLength={40} defaultValue={phone} autoComplete="tel" />
        <Select label={t('portal.account.language')} name="locale" defaultValue={locale}>
          {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
        </Select>
        <Select label={t('portal.account.theme')} name="theme" defaultValue={theme}>
          {['light', 'dark', 'system'].map((v) => <option key={v} value={v}>{t('portal.account.themes.' + v)}</option>)}
        </Select>
        <Select label={t('portal.account.text')} name="text" defaultValue={text}>
          {['m', 'l', 'xl'].map((v) => <option key={v} value={v}>{t('portal.account.texts.' + v)}</option>)}
        </Select>
      </div>
      <div className="form-actions"><span className="spacer" /><button type="submit" className="btn primary">{t('common.save')}</button></div>
    </ActionForm>
  )
}

export function PasswordForm({ email }: { email: string }) {
  const t = useT()
  return (
    <ActionForm action={changePasswordAction}>
      {/* raw-field-ok: Benutzername für Passwortmanager, unsichtbar */}
      <input type="text" name="username" autoComplete="username" defaultValue={email} hidden readOnly />
      <div className="form-grid">
        <TextField label={t('portal.account.current')} name="current" type="password" required autoComplete="current-password" wrapClassName="span-all" />
        <TextField label={t('portal.account.newPassword')} name="password" type="password" required minLength={10} autoComplete="new-password" hint={t('portal.accept.rules')} />
        <TextField label={t('portal.accept.repeat')} name="repeat" type="password" required minLength={10} autoComplete="new-password" />
      </div>
      <div className="form-actions"><span className="spacer" /><button type="submit" className="btn primary">{t('portal.account.changePassword')}</button></div>
    </ActionForm>
  )
}

export function MfaSection({ enabled }: { enabled: boolean }) {
  const t = useT()
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null)
  const [pending, start] = useTransition()
  if (enabled) {
    return (
      <ActionForm action={disablePortalMfaAction} confirm={{ title: t('portal.account.mfaDisableConfirm'), danger: true }}>
        <p className="small fg2" style={{ margin: 0 }}><span className="tag ok">{t('portal.account.mfaOn')}</span> {t('portal.account.mfaOnHint')}</p>
        <TextField label={t('portal.mfa.code')} name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required className="otp" />
        <div className="form-actions"><span className="spacer" /><button type="submit" className="btn danger">{t('portal.account.mfaDisable')}</button></div>
      </ActionForm>
    )
  }
  if (!setup) {
    return (
      <div className="stack-sm">
        <p className="small fg2" style={{ margin: 0 }}>{t('portal.account.mfaHint')}</p>
        <div><button type="button" className="btn" data-loading={pending} disabled={pending} onClick={() => start(async () => {
          const r = await startPortalMfaAction()
          if (!r.ok) return void toast(t(r.error), { kind: 'crit' })
          setSetup(r.data ?? null)
        })}>{t('portal.account.mfaStart')}</button></div>
      </div>
    )
  }
  return (
    <ActionForm action={confirmPortalMfaAction} onDone={(r) => r.ok && setSetup(null)}>
      <p className="small fg2" style={{ margin: 0 }}>{t('portal.account.mfaScan')}</p>
      {/* QR-Code als data:-URL aus dem Server (kein Drittanbieter) */}
      <img src={setup.qr} alt={t('portal.account.mfaQr')} width={180} height={180} style={{ background: '#fff', borderRadius: 3 }} />
      <p className="small muted" style={{ margin: 0 }}>{t('portal.account.mfaManual')} <span className="mono">{setup.secret}</span></p>
      <TextField label={t('portal.mfa.code')} name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required className="otp" autoFocus />
      <div className="form-actions">
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => setSetup(null)}>{t('common.cancel')}</button>
        <button type="submit" className="btn primary">{t('portal.account.mfaConfirm')}</button>
      </div>
    </ActionForm>
  )
}

export function SignOutOthers() {
  const t = useT()
  const [pending, start] = useTransition()
  return (
    <button type="button" className="btn" data-loading={pending} disabled={pending} onClick={() => start(async () => {
      const r = await signOutOthersAction()
      toast(r.ok ? t(r.message ?? 'common.saved') : t(r.error), r.ok ? {} : { kind: 'crit' })
    })}>{t('portal.account.signOutOthers')}</button>
  )
}
