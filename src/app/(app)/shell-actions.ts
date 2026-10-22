'use server'

import { cookies } from 'next/headers'
import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { getCtx, UNIT_COOKIE } from '@/lib/context'
import { THEME_COOKIE, TEXT_COOKIE, normalizeTheme, normalizeTextSize } from '@/lib/theme'

export async function setThemeAction(theme: string) {
  const ctx = await getCtx()
  const v = normalizeTheme(theme)
  await db.user.update({ where: { id: ctx.user.id }, data: { theme: v } })
  ;(await cookies()).set(THEME_COOKIE, v, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
}

/** Schriftgrösse gilt pro Gerät (z. B. Stationstablet grösser als Smartphone). */
export async function setTextSizeAction(size: string) {
  await getCtx()
  ;(await cookies()).set(TEXT_COOKIE, normalizeTextSize(size), { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
}

export async function setUnitAction(unitId: string) {
  const ctx = await getCtx()
  if (!ctx.unitIds.includes(unitId)) return
  ;(await cookies()).set(UNIT_COOKIE, unitId, { path: '/', maxAge: 60 * 60 * 24 * 180, sameSite: 'lax', httpOnly: true })
  refresh()
}

export async function markNotificationsReadAction(ids?: string[]) {
  const ctx = await getCtx()
  await db.notification.updateMany({ where: { userId: ctx.user.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } })
  refresh()
}
