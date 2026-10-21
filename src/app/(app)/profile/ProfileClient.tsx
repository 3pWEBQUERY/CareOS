'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { startRegistration } from '@simplewebauthn/browser'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { setThemeAction } from '@/app/(app)/shell-actions'
import { LOCALES, LOCALE_NAMES, type Locale } from '@/i18n/core'
import { auditThemeAction, confirmMfaAction, disableMfaAction, regenerateMfaAction, renamePasskeyAction, setLocaleAction, startMfaSetupAction } from './actions'

type Theme = 'light' | 'dark' | 'system'

export function ThemeChooser({ current }: { current: Theme }) {
  const t = useT()
  const [v, setV] = useState<Theme>(current)
  const [, start] = useTransition()
  const pick = (x: Theme) => {
    document.documentElement.dataset.theme = x
    setV(x)
    start(async () => {
      await setThemeAction(x)
      await auditThemeAction(x)
    })
  }
  return (
    <div className="seg" role="group" aria-label={t('common.theme.label')} style={{ alignSelf: 'flex-start' }}>
      {(['light', 'dark', 'system'] as const).map((x) => (
        <button key={x} type="button" aria-pressed={v === x} onClick={() => pick(x)}>{t('common.theme.' + x)}</button>
      ))}
    </div>
  )
}

export function LocaleChooser({ current }: { current: Locale }) {
  const t = useT()
  const [v, setV] = useState<Locale>(current)
  const [pending, start] = useTransition()
  return (
    <div className="seg" role="group" aria-label={t('profile.appearance.language')} data-pending={pending || undefined} style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={v === l}
          disabled={pending}
          onClick={() => {
            setV(l)
            start(async () => {
              const r = await setLocaleAction(l)
              if (!r.ok) toast(t(r.error), { kind: 'crit' })
            })
          }}
        >
          {LOCALE_NAMES[l]}
        </button>
      ))}
    </div>
  )
}

type Setup = { qr: string; secret: string }

function CodeField({ label, autoFocus }: { label: string; autoFocus?: boolean }) {
  return (
    <label className="fld" style={{ maxWidth: 220 }}>
      <span className="lbl">{label}</span>
      <input className="field mono" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} pattern="\d{6}" required autoFocus={autoFocus} />
    </label>
  )
}

/** Zwei-Faktor-Authentisierung mit TOTP: Einrichten, Neu einrichten, Deaktivieren. */
export function MfaPanel({ enabled }: { enabled: boolean }) {
  const t = useT()
  const [setup, setSetup] = useState<Setup | null>(null)
  const [mode, setMode] = useState<'idle' | 'regen' | 'disable'>('idle')
  const [pending, start] = useTransition()

  if (setup)
    return (
      <div className="stack-sm">
        <ol className="small fg2" style={{ margin: 0, paddingLeft: 18 }}>
          <li>{t('profile.mfa.step1')}</li>
          <li>{t('profile.mfa.step2')}</li>
        </ol>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          {/* QR-Code wird serverseitig als Data-URL erzeugt; weisser Rand nötig für die Lesbarkeit im Dunkelmodus. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} width={168} height={168} alt={t('profile.mfa.qrAlt')} style={{ background: '#fff', borderRadius: 'var(--r)', border: '1px solid var(--line)', padding: 4 }} />
          <div className="stack-sm grow" style={{ minWidth: 200 }}>
            <span className="lbl">{t('profile.mfa.manual')}</span>
            <code className="mono" style={{ wordBreak: 'break-all', background: 'var(--sunken)', padding: '6px 8px', borderRadius: 'var(--r-sm)' }}>{setup.secret}</code>
            <span className="small muted">{t('profile.mfa.manualHint')}</span>
          </div>
        </div>
        <ActionForm action={confirmMfaAction} onDone={(r) => r.ok && (setSetup(null), setMode('idle'))}>
          <CodeField label={t('profile.mfa.code')} autoFocus />
          <div className="form-actions">
            <Submit>{t('profile.mfa.confirm')}</Submit>
            <button type="button" className="btn ghost" onClick={() => (setSetup(null), setMode('idle'))}>{t('common.cancel')}</button>
          </div>
        </ActionForm>
      </div>
    )

  if (!enabled)
    return (
      <div className="stack-sm">
        <p className="fg2" style={{ margin: 0 }}>{t('profile.mfa.offHint')}</p>
        <div className="row">
          <button
            type="button"
            className="btn primary"
            data-loading={pending || undefined}
            disabled={pending}
            onClick={() => start(async () => {
              const r = await startMfaSetupAction()
              if (r.ok && r.data) setSetup(r.data)
              else if (!r.ok) toast(t(r.error), { kind: 'crit' })
            })}
          >
            {t('profile.mfa.setup')}
          </button>
        </div>
      </div>
    )

  return (
    <div className="stack-sm">
      <p className="fg2" style={{ margin: 0 }}>{t('profile.mfa.onHint')}</p>
      {mode === 'idle' && (
        <div className="row">
          <button type="button" className="btn" onClick={() => setMode('regen')}>{t('profile.mfa.regenerate')}</button>
          <button type="button" className="btn danger" onClick={() => setMode('disable')}>{t('profile.mfa.disable')}</button>
        </div>
      )}
      {mode === 'regen' && (
        <ActionForm action={async (f) => {
          const r = await regenerateMfaAction(f)
          if (r.ok && r.data) setSetup(r.data)
          return r
        }}>
          <p className="small muted" style={{ margin: 0 }}>{t('profile.mfa.regenHint')}</p>
          <CodeField label={t('profile.mfa.currentCode')} autoFocus />
          <div className="form-actions">
            <Submit>{t('profile.mfa.continue')}</Submit>
            <button type="button" className="btn ghost" onClick={() => setMode('idle')}>{t('common.cancel')}</button>
          </div>
        </ActionForm>
      )}
      {mode === 'disable' && (
        <ActionForm action={disableMfaAction} onDone={(r) => r.ok && setMode('idle')} confirm="profile.mfa.disableConfirm">
          <p className="small muted" style={{ margin: 0 }}>{t('profile.mfa.disableHint')}</p>
          <CodeField label={t('profile.mfa.currentCode')} autoFocus />
          <div className="form-actions">
            <Submit className="btn danger">{t('profile.mfa.disable')}</Submit>
            <button type="button" className="btn ghost" onClick={() => setMode('idle')}>{t('common.cancel')}</button>
          </div>
        </ActionForm>
      )}
    </div>
  )
}

/** Passkey registrieren (WebAuthn, Benutzerverifikation erforderlich). */
export function PasskeyRegister({ defaultName }: { defaultName: string }) {
  const t = useT()
  const router = useRouter()
  const [name, setName] = useState(defaultName)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const supported = typeof window === 'undefined' || 'PublicKeyCredential' in window
  return (
    <form
      className="stack-sm"
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        start(async () => {
          try {
            const res = await fetch('/api/auth/passkey/register')
            if (!res.ok) throw new Error('options')
            const optionsJSON = await res.json()
            const response = await startRegistration({ optionsJSON })
            const v = await fetch('/api/auth/passkey/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ response, name }) })
            if (!v.ok) throw new Error('verify')
            toast(t('profile.passkeys.added'))
            router.refresh()
          } catch (err) {
            const n = (err as { name?: string })?.name
            setError(n === 'NotAllowedError' || n === 'AbortError' ? t('profile.passkeys.cancelled') : t('profile.passkeys.failed'))
          }
        })
      }}
    >
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="fld grow" style={{ minWidth: 180 }}>
          <span className="lbl">{t('profile.passkeys.name')}</span>
          <input className="field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
        </label>
        <button className="btn primary" type="submit" disabled={pending || !supported} data-loading={pending || undefined}>{t('profile.passkeys.add')}</button>
      </div>
      {!supported && <p className="small muted" style={{ margin: 0 }}>{t('profile.passkeys.unsupported')}</p>}
      {error && <p className="err" role="alert" style={{ margin: 0 }}>{error}</p>}
    </form>
  )
}

/** Inline-Umbenennen eines Passkeys. */
export function PasskeyRename({ id, name }: { id: string; name: string }) {
  const t = useT()
  const [edit, setEdit] = useState(false)
  if (!edit) return <button type="button" className="btn sm ghost" onClick={() => setEdit(true)}>{t('profile.passkeys.rename')}</button>
  return (
    <ActionForm action={renamePasskeyAction} reset={false} className="row" success="common.saved" onDone={(r) => r.ok && setEdit(false)}>
      <input type="hidden" name="id" value={id} />
      <input className="field" name="name" defaultValue={name} maxLength={60} aria-label={t('profile.passkeys.name')} style={{ width: 180 }} autoFocus />
      <Submit className="btn sm primary">{t('common.save')}</Submit>
      <button type="button" className="btn sm ghost" onClick={() => setEdit(false)}>{t('common.cancel')}</button>
    </ActionForm>
  )
}
