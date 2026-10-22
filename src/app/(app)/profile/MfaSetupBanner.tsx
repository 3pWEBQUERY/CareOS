import { getCtx } from '@/lib/context'
import { mfaPolicy } from '@/lib/mfa-policy'
import { needsMfaSetup } from '@/lib/auth/mfa-gate'

/** Hinweis, solange die Organisation einen zweiten Faktor verlangt und noch keiner eingerichtet ist (PRD §33). */
export async function MfaSetupBanner() {
  const ctx = await getCtx()
  if (!(await needsMfaSetup(ctx))) return null
  const { t } = ctx
  const forAll = mfaPolicy(ctx.org.settings).forAll
  return (
    <div className="alert warn" role="alert" id="mfa-setup">
      <span className="grow">
        <strong>{t('profile.mfaSetup.title')}</strong>
        {t(forAll ? 'profile.mfaSetup.textAll' : 'profile.mfaSetup.textAdmin')} <a href="#p-mfa">{t('profile.mfaSetup.totp')}</a> · <a href="#p-passkeys">{t('profile.mfaSetup.passkey')}</a>
      </span>
    </div>
  )
}
