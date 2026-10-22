'use server'

import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { run, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { LOCKED_IN_APP, NOTIFY_CATEGORIES, normalizePrefs } from '@/lib/notify-prefs'

/** Profil → Benachrichtigungen: je Art In-App/Push und «keine Push-Nachrichten ausserhalb meiner Dienste» (PRD §25). */
export async function saveNotificationPrefsAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const current = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { notificationPrefs: true } })
    const before = normalizePrefs(current.notificationPrefs)
    const shown = new Set(form.getAll('cats').map(String))
    const next = normalizePrefs({
      // Nur angezeigte Arten übernehmen; andere (z. B. Sicherheit ohne Berechtigung) behalten ihren Wert.
      kinds: Object.fromEntries(NOTIFY_CATEGORIES.map((c) => [c, shown.has(c) ? { app: LOCKED_IN_APP.includes(c) || form.get('app.' + c) === 'on', push: form.get('push.' + c) === 'on' } : before.kinds[c]])),
      quietOffDuty: form.get('quietOffDuty') === 'on',
    })
    await db.user.update({ where: { id: ctx.user.id }, data: { notificationPrefs: next as unknown as Prisma.InputJsonValue } })
    await audit(ctx, { action: 'profile.notifications', entityType: 'User', entityId: ctx.user.id, before, after: next })
    return { ok: true, message: 'platform.notifications.saved' }
  })
}
