import 'server-only'
import type { Prisma, Task } from '@prisma/client'
import { db } from '@/lib/db'
import { auditSystem } from '@/lib/audit'
import { emit } from '@/lib/events'
import { dictionary } from '@/i18n'
import { makeT, type Locale, type Terminology } from '@/i18n/core'
import { abnormalKeys, LIVE, mergeLimits, VITALS, type VitalKey } from '@/lib/vitals'
import { fmtNum, hm, addDays } from '@/lib/time'
import { dayTimeDue, periodIndex, ruleDue, RULE_LOOKBACK_HOURS, weightChange, woundProgress, workflowPolicy } from '@/lib/workflow-rules'

/**
 * Smart Workflows (PRD §48): leitet aus Messwerten, Assessments und Wunddokumentation Folgeaufgaben ab.
 * Läuft mit dem Eskalationsjob (alle 5 Min.) und beim Aufbau der Aufgabenliste. Idempotent: jede Regel prüft
 * vor dem Anlegen, ob es für denselben Auslöser schon eine Aufgabe gibt. Jede erzeugte oder automatisch
 * abgeschlossene Aufgabe wird mit auditSystem() protokolliert.
 */

const RECHECK = 'rule:vitalsRecheck:'
const OPEN_STATUSES = ['planned', 'ready', 'in_progress', 'escalated'] as const
type Row = Prisma.TaskUncheckedCreateInput & { rule: string; trigger: Record<string, unknown> }

export async function applyWorkflowRules(orgId: string, unitIds: string[], now = new Date()) {
  const out = { created: 0, closed: 0 }
  if (!unitIds.length) return out
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settings: true, defaultLocale: true, terminology: true } })
  if (!org) return out
  const p = workflowPolicy(org.settings)
  const locale = org.defaultLocale as Locale
  const t = makeT(dictionary(locale), locale, org.terminology as Terminology)
  const residents = await db.resident.findMany({ where: { orgId, unitId: { in: unitIds }, status: 'active' }, select: { id: true, unitId: true } })
  if (!residents.length) return out
  const rIds = residents.map((r) => r.id)
  const unitOf = new Map(residents.map((r) => [r.id, r.unitId]))
  const thresholds = await db.vitalThreshold.findMany({ where: { orgId } })
  const vitalText = (keys: VitalKey[], v: Partial<Record<VitalKey, number | null>>) =>
    keys.map((k) => `${t('common.vitals.' + k)} ${fmtNum(v[k] as number, VITALS[k].dec, locale)} ${VITALS[k].unit}`).join(', ')

  // ── Nachkontrolle erledigt sich mit dem nächsten erfassten Wert (Document Once) ──
  const openRechecks = await db.task.findMany({ where: { orgId, unitId: { in: unitIds }, source: 'event', sourceId: { startsWith: RECHECK }, status: { in: [...OPEN_STATUSES] } } })
  if (openRechecks.length) {
    const trig = await db.vitalSign.findMany({ where: { id: { in: openRechecks.map((k) => k.sourceId!.slice(RECHECK.length)) } } })
    for (const task of openRechecks) {
      const v = trig.find((x) => x.id === task.sourceId!.slice(RECHECK.length))
      if (!v) continue
      const keys = abnormalKeys(v, mergeLimits(thresholds, v.residentId))
      const later = await db.vitalSign.findFirst({
        where: { residentId: v.residentId, at: { gt: v.at }, ...LIVE, OR: (keys.length ? keys : (['sys'] as VitalKey[])).map((k) => ({ [k]: { not: null } }) as Prisma.VitalSignWhereInput) },
        orderBy: { at: 'asc' },
      })
      if (!later) continue
      const upd = await db.task.updateMany({
        where: { id: task.id, status: { in: [...OPEN_STATUSES] } },
        data: { status: 'done', completedById: later.recordedById, completedAt: later.at, note: t('tasks.rules.autoDone', { time: hm(later.at) }) },
      })
      if (!upd.count) continue
      out.closed++
      await auditSystem({ orgId, action: 'task.complete', entityType: 'Task', entityId: task.id, before: { status: task.status }, after: { status: 'done' }, context: { residentId: task.residentId, auto: true, rule: 'vitalsRecheck', vitalId: later.id } })
      await emit({ orgId, type: 'task.completed', unitId: task.unitId, residentId: task.residentId, payload: { taskId: task.id, auto: true } })
    }
  }

  const rows: Row[] = []
  const base = (residentId: string) => ({ orgId, unitId: unitOf.get(residentId)!, residentId, status: 'planned' as const })

  // ── Auffälliger Vitalwert → Nachkontrolle ──
  if (p.vitalsRecheck.enabled) {
    const since = new Date(now.getTime() - RULE_LOOKBACK_HOURS.vitalsRecheck * 3600_000)
    const vitals = await db.vitalSign.findMany({ where: { residentId: { in: rIds }, at: { gte: since, lte: now }, ...LIVE }, orderBy: { at: 'asc' } })
    const existing = new Set((await db.task.findMany({ where: { source: 'event', sourceId: { in: vitals.map((v) => RECHECK + v.id) } }, select: { sourceId: true } })).map((k) => k.sourceId))
    for (const v of vitals) {
      const keys = abnormalKeys(v, mergeLimits(thresholds, v.residentId))
      if (!keys.length || existing.has(RECHECK + v.id)) continue
      // Bereits nachkontrolliert (späterer Wert desselben Parameters): keine Aufgabe.
      if (vitals.some((x) => x.residentId === v.residentId && x.at > v.at && keys.some((k) => x[k] != null))) continue
      rows.push({
        ...base(v.residentId), title: 'rule.vitalsRecheck', category: 'Überwachung', priority: 'important', durationMin: 5,
        description: t('tasks.rules.vitalsRecheck.reason', { values: vitalText(keys, v), time: hm(v.at) }),
        dueAt: ruleDue(v.at, p.vitalsRecheck.afterMin, now), source: 'event', sourceId: RECHECK + v.id,
        rule: 'vitalsRecheck', trigger: { vitalId: v.id, keys },
      })
    }
  }

  // ── Gewichtsverlust → MNA-SF (erledigt sich mit dem Assessment) ──
  if (p.weightLoss.enabled) {
    const mnaDef = await db.assessmentDefinition.findMany({ where: { orgId }, select: { key: true, active: true } })
    const mnaActive = !mnaDef.length || mnaDef.some((d) => d.key === 'mna' && d.active)
    if (mnaActive) {
      const from = addDays(now, -p.weightLoss.days)
      const weights = await db.vitalSign.findMany({ where: { residentId: { in: rIds }, weight: { not: null }, at: { gte: from, lte: now }, ...LIVE }, select: { residentId: true, at: true, weight: true } })
      const byRes = new Map<string, { at: Date; weight: number }[]>()
      for (const w of weights) byRes.set(w.residentId, [...(byRes.get(w.residentId) ?? []), { at: w.at, weight: w.weight! }])
      for (const [rid, pts] of byRes) {
        const c = weightChange(pts, p.weightLoss.days, now)
        if (!c || c.pct > -p.weightLoss.pct) continue
        const [mna, task] = await Promise.all([
          db.assessment.findFirst({ where: { residentId: rid, key: 'mna', at: { gte: c.fromAt }, ...LIVE }, select: { id: true } }),
          db.task.findFirst({ where: { source: 'assessment', sourceId: `${rid}:mna`, OR: [{ dueAt: { gte: c.fromAt } }, { status: { in: [...OPEN_STATUSES] } }] }, select: { id: true } }),
        ])
        if (mna || task) continue
        rows.push({
          ...base(rid), title: 'assessment.mna', category: 'Assessment', priority: 'important', durationMin: 15,
          description: t('tasks.rules.weightLoss.reason', { pct: fmtNum(Math.abs(c.pct), 1, locale), from: fmtNum(c.from, 1, locale), to: fmtNum(c.to, 1, locale), days: p.weightLoss.days }),
          dueAt: dayTimeDue(now), source: 'assessment', sourceId: `${rid}:mna`,
          rule: 'weightLoss', trigger: { pct: Math.round(c.pct * 10) / 10, from: c.from, to: c.to },
        })
      }
    }
  }

  // ── Braden ≤ Grenze → Lagerungsplan prüfen ──
  if (p.bradenRisk.enabled) {
    const since = new Date(now.getTime() - RULE_LOOKBACK_HOURS.bradenRisk * 3600_000)
    const list = await db.assessment.findMany({ where: { residentId: { in: rIds }, key: 'braden', at: { gte: since }, ...LIVE }, orderBy: { at: 'desc' } })
    const latest = new Map<string, (typeof list)[number]>()
    for (const a of list) if (!latest.has(a.residentId)) latest.set(a.residentId, a)
    const cand = [...latest.values()].filter((a) => a.score != null && a.score <= p.bradenRisk.maxScore)
    if (cand.length) {
      const ids = cand.map((a) => 'rule:bradenRisk:' + a.id)
      const existing = new Set((await db.task.findMany({ where: { source: 'event', sourceId: { in: ids } }, select: { sourceId: true } })).map((k) => k.sourceId))
      const plans = await db.carePlan.findMany({ where: { residentId: { in: cand.map((a) => a.residentId) }, status: 'active' }, select: { residentId: true, approvedAt: true } })
      for (const a of cand) {
        if (existing.has('rule:bradenRisk:' + a.id)) continue
        // Pflegeplanung nach dem Assessment freigegeben: bereits geprüft.
        if (plans.some((x) => x.residentId === a.residentId && x.approvedAt && x.approvedAt > a.at)) continue
        rows.push({
          ...base(a.residentId), title: 'rule.bradenRisk', category: 'Planung', priority: 'important', durationMin: 15,
          description: t('tasks.rules.bradenRisk.reason', { score: a.score ?? '', max: p.bradenRisk.maxScore }),
          dueAt: dayTimeDue(now), source: 'event', sourceId: 'rule:bradenRisk:' + a.id,
          rule: 'bradenRisk', trigger: { assessmentId: a.id, score: a.score },
        })
      }
    }
  }

  // ── Wunde ohne Heilungsfortschritt → Wundevaluation ──
  if (p.woundStalled.enabled) {
    const wounds = await db.wound.findMany({
      where: { residentId: { in: rIds }, status: { in: ['open', 'healing'] }, startedAt: { lte: addDays(now, -p.woundStalled.days) } },
      include: { entries: { where: LIVE, select: { at: true, lengthMm: true, widthMm: true }, orderBy: { at: 'asc' } } },
    })
    for (const w of wounds) {
      const r = woundProgress(w.entries, p.woundStalled.days, p.woundStalled.minReductionPct)
      if (!r?.stalled) continue
      const sourceId = `rule:woundStalled:${w.id}:${periodIndex(w.startedAt, r.lastAt, p.woundStalled.days)}`
      if (await db.task.findFirst({ where: { source: 'event', sourceId }, select: { id: true } })) continue
      rows.push({
        ...base(w.residentId), title: 'rule.woundStalled', category: 'Behandlungspflege', priority: 'important', durationMin: 20,
        description: t('tasks.rules.woundStalled.reason', { site: w.bodySite, days: p.woundStalled.days, pct: fmtNum(Math.max(0, r.reductionPct), 0, locale) }),
        dueAt: dayTimeDue(now), source: 'event', sourceId,
        rule: 'woundStalled', trigger: { woundId: w.id, reductionPct: Math.round(r.reductionPct) },
      })
    }
  }

  const units = new Set<string>()
  for (const { rule, trigger, ...data } of rows) {
    let task: Task
    try {
      task = await db.task.create({ data })
    } catch {
      continue // gleichzeitiger Lauf hat dieselbe Aufgabe angelegt (Unique-Schlüssel)
    }
    out.created++
    units.add(task.unitId)
    await auditSystem({ orgId, action: 'workflow.task', entityType: 'Task', entityId: task.id, after: { title: task.title, dueAt: task.dueAt, source: task.source }, context: { residentId: task.residentId, auto: true, rule, trigger } })
  }
  for (const unitId of units) await emit({ orgId, type: 'task.created', unitId, payload: { source: 'workflow', n: rows.filter((r) => r.unitId === unitId).length } })
  return out
}

/** Alle Organisationen (Hintergrundjob). */
export async function runWorkflowRules(now = new Date()) {
  const units = await db.unit.findMany({ select: { id: true, orgId: true } })
  const byOrg = new Map<string, string[]>()
  for (const u of units) byOrg.set(u.orgId, [...(byOrg.get(u.orgId) ?? []), u.id])
  const total = { created: 0, closed: 0 }
  for (const [orgId, ids] of byOrg) {
    const r = await applyWorkflowRules(orgId, ids, now)
    total.created += r.created
    total.closed += r.closed
  }
  return total
}
