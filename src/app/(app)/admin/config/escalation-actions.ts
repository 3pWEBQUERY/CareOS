'use server'

import { refresh } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getCtx, assertCan } from '@/lib/context'
import { run, fdBool, fdNum, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { orgSettings } from '@/lib/admin'
import { ESCALATION_LIMITS, VISIT_QUESTION_HOURS, escalationPolicy, type EscalationPolicy } from '@/lib/escalation-policy'

const NUM_FIELDS = ['taskOverdueMinutes', 'criticalTaskOverdueMinutes', 'unackedImportantHandoverMinutes'] as const
const ROLE_FIELDS = ['taskNotifyRoles', 'vitalsAbnormalNotifyRoles', 'incidentSevereNotifyRoles'] as const

/** Eskalationsregeln speichern (Organization.settings.escalation, PRD §45). */
export async function saveEscalationAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'admin.config')
    const roleKeys = new Set((await db.role.findMany({ where: { orgId: ctx.org.id }, select: { key: true } })).map((r) => r.key))
    const next = { enabled: fdBool(form, 'enabled') } as EscalationPolicy
    for (const k of NUM_FIELDS) {
      const n = fdNum(form, k)
      const lim = ESCALATION_LIMITS[k]
      if (n == null || !Number.isInteger(n) || n < lim.min || n > lim.max) return { ok: false, error: 'admin.escalation.errors.range', field: k }
      next[k] = n
    }
    // Visitenfragen: Feld nur mit aktivem Modul «Visite» sichtbar, sonst bisheriger Wert
    const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { settings: true } })
    const before = escalationPolicy(org.settings)
    const h = form.has('visitQuestionHours') ? fdNum(form, 'visitQuestionHours') : before.visitQuestionHours
    if (h == null || !Number.isInteger(h) || h < VISIT_QUESTION_HOURS.min || h > VISIT_QUESTION_HOURS.max) return { ok: false, error: 'admin.escalation.errors.range', field: 'visitQuestionHours' }
    next.visitQuestionHours = h
    for (const k of ROLE_FIELDS) {
      const vals = [...new Set(form.getAll(k).map(String))]
      if (vals.some((v) => !roleKeys.has(v))) return { ok: false, error: 'admin.escalation.errors.role', field: k }
      next[k] = vals
    }
    await db.organization.update({ where: { id: ctx.org.id }, data: { settings: { ...orgSettings(org.settings), escalation: next } as Prisma.InputJsonValue } })
    await audit(ctx, { action: 'admin.config.escalation', entityType: 'Organization', entityId: ctx.org.id, before, after: next })
    refresh()
  })
}
