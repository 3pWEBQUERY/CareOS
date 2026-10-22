import 'server-only'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { addDays } from '@/lib/time'
import { taskTitle } from '@/lib/task-title'
import { asStructuredForm, readFields } from '@/lib/forms'
import { abnormalKeys, LIVE, mergeLimits } from '@/lib/vitals'
import { focusRules, pendingFocus } from '@/lib/focus-rules'
import type { FormOption } from '@/components/forms/FormEntry'
import type { FocusSuggestionDto } from '@/components/forms/FocusSuggestions'

/**
 * Offene Vorschläge zur Fokusdokumentation einer Person (PRD §10.3) samt aktiven Formularen.
 * Liest Vitalwerte (ohne stornierte), Verlauf und Aufgaben der letzten 48 h bzw. des längsten Regelfensters.
 */
export async function focusFor(ctx: Ctx, r: { id: string }, opts: { only?: ('pain' | 'fall' | 'vitalAbnormal' | 'taskSkipped')[] } = {}) {
  const rules = focusRules(ctx.org.settings).filter((x) => !opts.only || opts.only.includes(x.key))
  const enabled = rules.filter((x) => x.enabled)
  if (!enabled.length) return { suggestions: [] as FocusSuggestionDto[], forms: [] as FormOption[] }
  const now = new Date()
  const from = new Date(now.getTime() - Math.max(...enabled.map((x) => x.windowH)) * 3600_000)
  const [vitals, notes, tasks, defs, limitRows] = await Promise.all([
    db.vitalSign.findMany({ where: { residentId: r.id, ...LIVE, at: { gte: from } }, orderBy: { at: 'desc' }, take: 60 }),
    db.observation.findMany({ where: { residentId: r.id, at: { gte: addDays(from, -1) } }, select: { id: true, at: true, createdAt: true, text: true, structured: true, source: true, taskId: true }, take: 200 }),
    db.task.findMany({ where: { residentId: r.id, status: 'skipped', completedAt: { gte: from } }, select: { id: true, title: true, dueAt: true, status: true, completedAt: true } }),
    db.formDefinition.findMany({ where: { orgId: ctx.org.id, active: true }, orderBy: { name: 'asc' } }),
    db.vitalThreshold.findMany({ where: { orgId: ctx.org.id, OR: [{ residentId: null }, { residentId: r.id }] } }),
  ])
  const limits = mergeLimits(limitRows, r.id)
  const forms: FormOption[] = defs.map((d) => ({ id: d.id, key: d.key, name: d.name, description: d.description, version: d.version, fields: readFields(d.fields) })).filter((f) => f.fields.length)
  const list = pendingFocus({
    rules,
    now,
    forms: forms.map((f) => f.key!),
    vitals: vitals.map((v) => ({ id: v.id, at: v.at, pain: v.pain, abnormal: abnormalKeys(v, limits) })),
    // Massgebend ist der Erfassungszeitpunkt (nachträglich erfasste Einträge erledigen den Vorschlag ebenfalls)
    notes: notes.map((n) => ({ id: n.id, at: n.createdAt > n.at ? n.createdAt : n.at, text: n.text, formKey: asStructuredForm(n.structured)?.formKey ?? null, source: n.source, taskId: n.taskId })),
    tasks: tasks.map((x) => ({ id: x.id, title: taskTitle(ctx.t, x), status: x.status, completedAt: x.completedAt })),
  })
  const suggestions: FocusSuggestionDto[] = list.map((s) => ({
    id: s.id, rule: s.rule, at: s.at.toISOString(), formKey: s.formKey, prefill: s.prefill, vars: s.vars,
    formName: s.formKey ? forms.find((f) => f.key === s.formKey)?.name ?? null : null,
  }))
  return { suggestions, forms }
}
