'use server'

import { refresh } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getCtx, assertCan } from '@/lib/context'
import { run, fdBool, fdNum, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { orgSettings } from '@/lib/admin'
import { WORKFLOW_LIMITS, WORKFLOW_RULES, workflowPolicy, type WorkflowPolicy } from '@/lib/workflow-rules'
import { invalidateTaskGeneration } from '@/lib/tasks'

/** Smart-Workflow-Regeln speichern (Organization.settings.workflows, PRD §48). */
export async function saveWorkflowsAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'admin.config')
    const next = {} as Record<string, Record<string, number | boolean>>
    for (const rule of WORKFLOW_RULES) {
      const out: Record<string, number | boolean> = { enabled: fdBool(form, rule + '.enabled') }
      for (const [field, lim] of Object.entries(WORKFLOW_LIMITS[rule]) as [string, { min: number; max: number }][]) {
        const n = fdNum(form, `${rule}.${field}`)
        if (n == null || !Number.isInteger(n) || n < lim.min || n > lim.max) return { ok: false, error: ctx.t('tasks.rules.errors.range', { min: lim.min, max: lim.max }), field: `${rule}.${field}` }
        out[field] = n
      }
      next[rule] = out
    }
    const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { settings: true } })
    const before = workflowPolicy(org.settings)
    const after: WorkflowPolicy = workflowPolicy({ workflows: next })
    await db.organization.update({ where: { id: ctx.org.id }, data: { settings: { ...orgSettings(org.settings), workflows: after } as Prisma.InputJsonValue } })
    await audit(ctx, { action: 'admin.config.workflows', entityType: 'Organization', entityId: ctx.org.id, before, after })
    invalidateTaskGeneration()
    refresh()
    return { ok: true, message: 'tasks.rules.saved' }
  })
}
