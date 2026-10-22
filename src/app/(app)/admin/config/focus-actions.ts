'use server'

import { refresh } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getCtx, assertCan } from '@/lib/context'
import { run, fd, fdBool, fdNum, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { orgSettings } from '@/lib/admin'
import { DEFAULT_FOCUS_RULES, FOCUS_LIMITS, focusRules } from '@/lib/focus-rules'

/** Regeln der Fokusdokumentation speichern (Organization.settings.focusDocumentation, PRD §10.3). */
export async function saveFocusRulesAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'admin.config')
    const forms = new Set((await db.formDefinition.findMany({ where: { orgId: ctx.org.id, active: true }, select: { key: true } })).map((f) => f.key))
    const next: Record<string, { enabled: boolean; formKey: string | null; threshold?: number; windowH: number }> = {}
    const range = (name: string, lim: { min: number; max: number }) => {
      const n = fdNum(form, name)
      return n != null && Number.isInteger(n) && n >= lim.min && n <= lim.max ? n : null
    }
    for (const d of DEFAULT_FOCUS_RULES) {
      const formKey = fd(form, d.key + '.formKey') || null
      if (formKey && !forms.has(formKey)) return { ok: false, error: 'admin.config.focusDoc.errForm', field: d.key + '.formKey' }
      const windowH = range(d.key + '.windowH', FOCUS_LIMITS.windowH)
      if (windowH == null) return { ok: false, error: ctx.t('admin.config.focusDoc.errRange', FOCUS_LIMITS.windowH), field: d.key + '.windowH' }
      const rule: (typeof next)[string] = { enabled: fdBool(form, d.key + '.enabled'), formKey, windowH }
      if (d.threshold != null) {
        const lim = FOCUS_LIMITS.threshold[d.key as keyof typeof FOCUS_LIMITS.threshold]
        const threshold = range(d.key + '.threshold', lim)
        if (threshold == null) return { ok: false, error: ctx.t('admin.config.focusDoc.errRange', lim), field: d.key + '.threshold' }
        rule.threshold = threshold
      }
      next[d.key] = rule
    }
    const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { settings: true } })
    const before = focusRules(org.settings)
    await db.organization.update({ where: { id: ctx.org.id }, data: { settings: { ...orgSettings(org.settings), focusDocumentation: next } as Prisma.InputJsonValue } })
    await audit(ctx, { action: 'admin.config.focusDocumentation', entityType: 'Organization', entityId: ctx.org.id, before, after: focusRules({ focusDocumentation: next }) })
    refresh()
    return { ok: true, message: 'admin.config.focusDoc.saved' }
  })
}
