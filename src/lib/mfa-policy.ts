/**
 * MFA-Pflicht beim Login (PRD §33). Reine Entscheidungslogik, ohne Datenbank.
 * Organisationseinstellungen: settings.requireMfaForAdmins, settings.requireMfaForAll.
 */

export type LoginMethod = 'password' | 'passkey' | 'sso'

export const LOGIN_METHODS: readonly LoginMethod[] = ['password', 'passkey', 'sso']

export function mfaPolicy(settings: unknown) {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  return { forAdmins: s.requireMfaForAdmins === true, forAll: s.requireMfaForAll === true }
}

/** Gilt die Person als Administrator? (irgendeine admin.*-Berechtigung) */
export const isAdminGrant = (permissions: readonly string[]) => permissions.some((p) => p.startsWith('admin.'))

/**
 * Muss die Person vor der Nutzung von CareOS einen zweiten Faktor einrichten?
 * - Nur, wenn die Organisation es für alle oder (bei Administratoren) für Admins verlangt.
 * - SSO-Anmeldungen sind ausgenommen: Der Identity Provider ist für MFA zuständig.
 * - Erfüllt ist die Pflicht mit aktivem TOTP oder mindestens einem Passkey.
 */
export function mfaSetupRequired(input: {
  settings: unknown
  isAdmin: boolean
  mfaEnabled: boolean
  passkeys: number
  method: string | null | undefined
}) {
  const p = mfaPolicy(input.settings)
  if (!p.forAll && !(p.forAdmins && input.isAdmin)) return false
  if (input.method === 'sso') return false
  return !input.mfaEnabled && input.passkeys < 1
}

/** Pfade, die während der Einrichtung erreichbar bleiben (Profil mit Sicherheitsbereich). */
export const mfaSetupAllowedPath = (path: string) => path === '/profile' || path.startsWith('/profile/') || path.startsWith('/profile?')

export const MFA_SETUP_URL = '/profile?setup=mfa#p-mfa'
