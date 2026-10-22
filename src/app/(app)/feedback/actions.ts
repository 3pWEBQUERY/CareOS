'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { run, fd, type ActionResult } from '@/lib/action'
import { rateLimit } from '@/lib/rate-limit'
import { routeLabel } from '@/lib/metrics'
import { notifyT } from '@/lib/notify-t'
import { usersWithPermission } from '@/lib/notify'

const schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rating'), rating: z.coerce.number({ message: 'platform.feedback.errors.rating' }).int().min(1, 'platform.feedback.errors.rating').max(5, 'platform.feedback.errors.rating'), text: z.string().max(2000) }),
  z.object({ kind: z.enum(['problem', 'idea']), rating: z.any().optional(), text: z.string().trim().min(5, 'platform.feedback.errors.text').max(2000) }),
])

/** In-App-Rückmeldung (PRD §62–§64). Datensparsam: Ansicht ohne Kennungen, Name nur auf Wunsch. */
export async function sendFeedbackAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    if (!(await rateLimit('feedback:' + ctx.user.id, 10, 60 * 60_000)).ok) return { ok: false, error: 'platform.feedback.errors.rate' }
    const parsed = schema.safeParse({ kind: fd(form, 'kind'), rating: fd(form, 'rating') || undefined, text: fd(form, 'text') })
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return { ok: false, error: issue.message.startsWith('platform.') ? issue.message : 'platform.feedback.errors.text', field: String(issue.path[0] ?? 'text') }
    }
    const p = parsed.data
    const from = fd(form, 'from')
    const path = from.startsWith('/') && !from.startsWith('//') ? routeLabel(from) : null
    const anonymous = form.get('anonymous') === 'on'
    const row = await db.feedback.create({
      data: { orgId: ctx.org.id, userId: anonymous ? null : ctx.user.id, kind: p.kind, rating: p.kind === 'rating' ? p.rating : null, text: p.text.trim() || null, path },
    })
    // Bewusst kein Audit-Eintrag mit Inhalt (keine Personendaten); Organisationsverantwortliche sehen es unter Admin → Nutzung.
    if (p.kind === 'problem') {
      const admins = await usersWithPermission(ctx.org.id, 'admin.org')
      await notifyT({ orgId: ctx.org.id, userIds: admins.filter((id) => id !== ctx.user.id), priority: 'info', kind: 'feedback', titleKey: 'platform.feedback.title', bodyKey: 'platform.feedback.kinds.problem', href: '/admin/usage#feedback', groupKey: 'feedback:new' })
    }
    void row
    return { ok: true, message: 'platform.feedback.sent' }
  })
}
