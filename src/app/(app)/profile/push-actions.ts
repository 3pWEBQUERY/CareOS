'use server'

import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { run, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { normalizePriorities } from '@/lib/push-shared'

/** Prioritäten, für die Push-Benachrichtigungen gesendet werden (PRD §25). */
export async function savePushPrioritiesAction(priorities: string[]): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const next = normalizePriorities(priorities)
    const before = ctx.user.pushPriorities
    await db.user.update({ where: { id: ctx.user.id }, data: { pushPriorities: next } })
    await audit(ctx, { action: 'profile.push', entityType: 'User', entityId: ctx.user.id, before: { pushPriorities: before }, after: { pushPriorities: next } })
    return { ok: true, message: 'profile.push.prioritiesSaved' }
  })
}
