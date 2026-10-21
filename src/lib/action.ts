import 'server-only'
import { z } from 'zod'
import { ForbiddenError } from '@/lib/context'

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string; field?: string }

/**
 * Einheitlicher Rahmen für Server Actions: wandelt Berechtigungs- und Validierungsfehler
 * in verständliche Rückgaben um, statt die Seite abstürzen zu lassen.
 * Fehlertexte sind i18n-Schlüssel oder bereits übersetzte Texte.
 */
export async function run<T>(fn: () => Promise<ActionResult<T> | void>): Promise<ActionResult<T>> {
  try {
    return (await fn()) ?? { ok: true }
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: 'common.notAllowed' }
    if (e instanceof z.ZodError) {
      const issue = e.issues[0]
      return { ok: false, error: issue?.message || 'common.genericError', field: issue?.path.join('.') }
    }
    if (e && typeof e === 'object' && 'digest' in e && String((e as { digest: unknown }).digest).startsWith('NEXT_')) throw e
    console.error('[action]', e)
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
