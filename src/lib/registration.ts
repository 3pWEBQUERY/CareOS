import 'server-only'
import { db } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { hashCode, readRegistration } from '@/lib/registration-core'

/** Neue Organisationen über /register anlegen (Standard: aus). */
export const orgSignupEnabled = () => process.env.ORG_SIGNUP === 'true'

/** Organisation zum Registrierungscode – nur wenn die Registrierung dort aktiv ist. */
export async function orgByCode(code: string) {
  const org = await db.organization.findFirst({ where: { settings: { path: ['registration', 'codeHash'], equals: hashCode(code) } }, select: { id: true, name: true, settings: true } })
  return org && readRegistration(org.settings).enabled ? org : null
}

/** Ist irgendwo eine Registrierung offen? (Link «Konto beantragen» auf der Anmeldeseite) */
export async function registrationOpen() {
  if (orgSignupEnabled()) return true
  return (await db.organization.count({ where: { settings: { path: ['registration', 'enabled'], equals: true } } })) > 0
}

/** Registrierungscode im Klartext – nur für die Anzeige unter Admin → Benutzer → Registrierung (admin.users). */
export function registrationCode(settings: unknown): string | null {
  const r = readRegistration(settings)
  if (!r.codeEnc) return null
  try {
    return decrypt(r.codeEnc)
  } catch {
    return null
  }
}
