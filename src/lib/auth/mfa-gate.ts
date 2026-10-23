import 'server-only'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { isAdminGrant, mfaPolicy, mfaSetupAllowedPath, mfaSetupRequired, MFA_SETUP_URL } from '@/lib/mfa-policy'

/** Muss die angemeldete Person noch einen zweiten Faktor einrichten? (Organisationsrichtlinie, PRD §33) */
export async function needsMfaSetup(ctx: Ctx) {
  // Externe Ärztinnen und Ärzte (Ärzteportal): zweiter Faktor immer Pflicht, unabhängig von der Organisationsrichtlinie
  if (ctx.user.kind === 'external_physician' && !ctx.user.mfaEnabled && ctx.session.method !== 'sso') {
    return (await db.passkey.count({ where: { userId: ctx.user.id } })) < 1
  }
  const p = mfaPolicy(ctx.org.settings)
  if (!p.forAll && !p.forAdmins) return false
  const isAdmin = ctx.grants.some((g) => isAdminGrant(g.permissions))
  if (!p.forAll && !isAdmin) return false
  if (ctx.user.mfaEnabled || ctx.session.method === 'sso') return false
  const passkeys = await db.passkey.count({ where: { userId: ctx.user.id } })
  return mfaSetupRequired({ settings: ctx.org.settings, isAdmin, mfaEnabled: ctx.user.mfaEnabled, passkeys, method: ctx.session.method })
}

/**
 * Für das App-Layout: Solange die Pflicht offen ist, bleibt nur das Profil (Sicherheit) erreichbar.
 * Der Pfad kommt aus dem Proxy (x-careos-path); ohne ihn wird nicht umgeleitet (keine Schleife),
 * der Admin-Bereich prüft zusätzlich selbst.
 */
export async function enforceMfaSetup(ctx: Ctx) {
  if (!(await needsMfaSetup(ctx))) return
  const path = (await headers()).get('x-careos-path')
  if (path && !mfaSetupAllowedPath(path)) redirect(MFA_SETUP_URL)
}
