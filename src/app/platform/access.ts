import 'server-only'
import { db } from '@/lib/db'
import { getCtx, type Ctx } from '@/lib/context'
import { isPlatformOperator } from '@/lib/platform-core'
import { syncPlatformAdmins } from '@/lib/platform-sync'

export class NotOperatorError extends Error {}

/**
 * Zugang zum Plattform-Betrieb (PRD §42): `User.platformRole = 'operator'` (PLATFORM_ADMIN_EMAILS) und zweiter Faktor.
 * Liefert den normalen Kontext (Sprache, Audit) plus `ok`/`mfa`. Grants der eigenen Organisation spielen keine Rolle.
 */
export async function platformAccess(): Promise<{ ctx: Ctx; ok: boolean; mfa: boolean }> {
  const ctx = await getCtx()
  let operator = isPlatformOperator(ctx.user)
  if (!operator && (await syncPlatformAdmins())) operator = isPlatformOperator(await db.user.findUnique({ where: { id: ctx.user.id }, select: { platformRole: true, active: true } }))
  const mfa = ctx.user.mfaEnabled || ctx.session.method === 'passkey' || (await db.passkey.count({ where: { userId: ctx.user.id } })) > 0
  return { ctx, ok: operator, mfa }
}

/** Für Server Actions: wirft, wenn kein Plattform-Betrieb mit zweitem Faktor. */
export async function requireOperator() {
  const a = await platformAccess()
  if (!a.ok || !a.mfa) throw new NotOperatorError()
  return a.ctx
}
