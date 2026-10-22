'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getCtx, assertCan } from '@/lib/context'
import { run, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'

/** Rückmeldung als gelesen/erledigt markieren (Admin → Nutzung). */
export async function setFeedbackStatusAction(id: string, status: 'seen' | 'done'): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'admin.org')
    const next = z.enum(['seen', 'done']).parse(status)
    const row = await db.feedback.findFirst({ where: { id, orgId: ctx.org.id }, select: { id: true, status: true } })
    if (!row) return { ok: false, error: 'common.notFound' }
    await db.feedback.update({ where: { id }, data: { status: next } })
    await audit(ctx, { action: 'feedback.status', entityType: 'Feedback', entityId: id, before: { status: row.status }, after: { status: next } })
    refresh()
    return { ok: true }
  })
}
