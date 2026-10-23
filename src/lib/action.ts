import 'server-only'
import { z } from 'zod'
import { ForbiddenError } from '@/lib/context'

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string; field?: string }

/**
 * Einheitlicher Rahmen für Server Actions: wandelt Berechtigungs- und Validierungsfehler
 * in verständliche Rückgaben um, statt die Seite abstürzen zu lassen.
 * Fehlertexte sind i18n-Schlüssel oder bereits übersetzte Texte.
 */
export async function run<T>(fn: () => Promise<ActionResult<T> | void>, opts: { allowDuringMfaSetup?: boolean } = {}): Promise<ActionResult<T>> {
  try {
    // MFA-Pflicht der Organisation gilt auch für Aktionen, nicht nur für Seiten (ausser Einrichtung im Profil).
    if (!opts.allowDuringMfaSetup) {
      const { getSession } = await import('@/lib/auth/session')
      const session = await getSession()
      if (session?.mfaPassed) {
        const [{ getCtx }, { needsMfaSetup }] = await Promise.all([import('@/lib/context'), import('@/lib/auth/mfa-gate')])
        if (await needsMfaSetup(await getCtx())) return { ok: false, error: 'profile.mfaSetup.required' }
      }
    }
    return (await fn()) ?? { ok: true }
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: e.moduleOff ? 'common.moduleOff' : 'common.notAllowed' }
    if (e instanceof z.ZodError) {
      const issue = e.issues[0]
      return { ok: false, error: issue?.message || 'common.genericError', field: issue?.path.join('.') }
    }
    if (e && typeof e === 'object' && 'digest' in e && String((e as { digest: unknown }).digest).startsWith('NEXT_')) throw e
    // Abgefangene Fehler trotzdem erfassen (Log, Zähler, Admin → Sicherheit → Betrieb), PRD §66.
    await import('@/lib/errors').then((m) => m.captureError(e, { route: 'server-action', routeType: 'action' })).catch(() => console.error('[action]', e))
    return { ok: false, error: 'common.genericError' }
  }
}

export const fd = (form: FormData, k: string) => {
  const v = form.get(k)
  return typeof v === 'string' ? v.trim() : ''
}
export const fdNum = (form: FormData, k: string) => {
  const v = fd(form, k).replace(',', '.')
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}
export const fdBool = (form: FormData, k: string) => form.get(k) === 'on' || form.get(k) === 'true'

/** Für Aktionen, die während einer offenen MFA-Pflicht erlaubt sind (Einrichtung im Profil). */
export const runSetup = <T>(fn: () => Promise<ActionResult<T> | void>) => run(fn, { allowDuringMfaSetup: true })
