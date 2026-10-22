import 'server-only'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { notify, usersWithPermission } from '@/lib/notify'
import { residentInScope, type Ctx } from '@/lib/context'
import type { Permission } from '@/lib/permissions'
import { fmtNum, hm } from '@/lib/time'
import { abnormalKeys, mergeLimits, VITALS } from '@/lib/vitals'
import { OPEN_STATUSES } from '@/lib/tasks'
import { taskTitle } from '@/lib/task-title'
import { residentName, userNames } from '@/app/(app)/residents/_lib/resident'
import { parseOp, residentConflict, taskConflict, validateVitals } from './validate'
import type { OfflineKind, OfflineOp, OpResult } from './types'

/**
 * Offline-Synchronisation (PRD §39): wendet Vorgänge aus der Outbox eines Geräts idempotent an.
 * Gleiche Regeln wie die Server Actions (Berechtigung im Bereich der Person, Plausibilität, Audit, Events),
 * zusätzlich: dokumentierter Zeitpunkt bleibt erhalten, Einträge sind als «offline erfasst» markiert,
 * Konflikte werden ausdrücklich zurückgemeldet und nie still überschrieben.
 */
const PERM: Record<OfflineKind, Permission> = {
  note: 'resident.chart.write',
  vitals: 'resident.vitals.write',
  task: 'task.complete',
  intake: 'resident.nutrition.write',
}

export async function applyOps(ctx: Ctx, raws: unknown[], now = new Date()): Promise<OpResult[]> {
  const out: OpResult[] = []
  for (const raw of raws) out.push(await applyRaw(ctx, raw, now))
  return out
}

async function applyRaw(ctx: Ctx, raw: unknown, now: Date): Promise<OpResult> {
  const parsed = parseOp(raw, now)
  if ('reason' in parsed) return { id: parsed.id ?? '', status: 'rejected', reason: parsed.reason }
  const { op, at } = parsed

  // Idempotenz: dieselbe Vorgangs-ID liefert immer dasselbe Ergebnis.
  const existing = await db.offlineOp.findUnique({ where: { id: op.id } })
  if (existing) return stored(ctx, existing)
  try {
    await db.offlineOp.create({ data: { id: op.id, userId: ctx.user.id, orgId: ctx.org.id, kind: op.kind, status: 'pending', at } })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const again = await db.offlineOp.findUnique({ where: { id: op.id } })
      return again ? stored(ctx, again) : { id: op.id, status: 'error', reason: 'error' }
    }
    throw e
  }

  let res: OpResult
  try {
    res = await applyOne(ctx, op, at, now)
  } catch (e) {
    console.error('[offline-sync]', e)
    await db.offlineOp.delete({ where: { id: op.id } }).catch(() => {})
    return { id: op.id, status: 'error', reason: 'error' }
  }
  await db.offlineOp.update({
    where: { id: op.id },
    data: { status: res.status === 'duplicate' ? 'applied' : res.status, result: { reason: res.reason ?? null, detail: res.detail ?? null } as Prisma.InputJsonValue },
  })
  return res
}

function stored(ctx: Ctx, row: { id: string; userId: string; status: string; result: Prisma.JsonValue }): OpResult {
  if (row.userId !== ctx.user.id) return { id: row.id, status: 'rejected', reason: 'idTaken' }
  if (row.status === 'pending') return { id: row.id, status: 'error', reason: 'error' }
  const r = (row.result ?? {}) as { reason?: OpResult['reason'] | null; detail?: Record<string, string> | null }
  if (row.status === 'applied') return { id: row.id, status: 'duplicate' }
  return { id: row.id, status: row.status as OpResult['status'], reason: r.reason ?? undefined, detail: r.detail ?? undefined }
}

async function applyOne(ctx: Ctx, op: OfflineOp, at: Date, now: Date): Promise<OpResult> {
  const r = await residentInScope(ctx, op.residentId, PERM[op.kind])
  if (!r) return { id: op.id, status: 'rejected', reason: 'forbidden' }
  const gone = residentConflict(r)
  if (gone) return { id: op.id, status: 'conflict', reason: gone }
  const marker = ctx.t('common.offlineSync.marker')
  const offline = { offline: true, opId: op.id, capturedAt: at.toISOString(), syncedAt: now.toISOString() }

  switch (op.kind) {
    case 'note': {
      const d = op.data
      const obs = await db.observation.create({
        data: {
          residentId: r.id, at, category: d.category as never, text: d.text.trim(), important: d.important, authorId: ctx.user.id,
          source: 'manual', structured: { offline } as Prisma.InputJsonValue,
        },
      })
      await audit(ctx, { action: 'observation.create', entityType: 'Observation', entityId: obs.id, after: { category: obs.category, text: obs.text, important: obs.important, source: obs.source, at }, context: { residentId: r.id, ...offline } })
      await emit({ orgId: ctx.org.id, type: 'observation.created', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { observationId: obs.id, category: obs.category, important: obs.important, offline: true } })
      return { id: op.id, status: 'applied' }
    }

    case 'vitals': {
      const v = validateVitals(op.data.values)
      if ('reason' in v) return { id: op.id, status: 'conflict', reason: v.reason }
      const row = v.row
      const note = [op.data.note?.trim().slice(0, 450), marker].filter(Boolean).join(' · ')
      const rec = await db.vitalSign.create({
        data: {
          residentId: r.id, at, recordedById: ctx.user.id, note,
          sys: row.sys as number | undefined, dia: row.dia as number | undefined, pulse: row.pulse as number | undefined,
          temp: row.temp, spo2: row.spo2 as number | undefined, glucose: row.glucose, weight: row.weight,
          pain: row.pain as number | undefined, respRate: row.respRate as number | undefined,
        },
      })
      const limits = mergeLimits(await db.vitalThreshold.findMany({ where: { orgId: ctx.org.id, OR: [{ residentId: null }, { residentId: r.id }] } }), r.id)
      const ab = abnormalKeys(row, limits)
      await audit(ctx, { action: 'vitals.create', entityType: 'VitalSign', entityId: rec.id, after: { ...row, note, at }, context: { residentId: r.id, abnormal: ab, ...offline } })
      await emit({ orgId: ctx.org.id, type: 'vitals.recorded', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { vitalId: rec.id, offline: true } })
      if (ab.length) {
        const { t, locale } = ctx
        const text = ab.map((k) => `${t('common.vitals.' + k)} ${fmtNum(row[k] as number, VITALS[k].dec, locale)} ${VITALS[k].unit}`).join(', ')
        await emit({ orgId: ctx.org.id, type: 'vitals.abnormal', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { vitalId: rec.id, keys: ab } })
        const users = (await usersWithPermission(ctx.org.id, 'resident.read', r.unitId)).filter((u) => u !== ctx.user.id)
        await notify({
          orgId: ctx.org.id, userIds: users, priority: 'critical', kind: 'vitals.abnormal',
          title: t('chart.vitals.notifyTitle', { name: residentName(r), room: r.room?.number ?? '–' }),
          body: `${text} · ${marker} ${hm(at)}`, href: `/residents/${r.id}/vitals`, groupKey: `vitals:${r.id}`,
        })
      }
      return { id: op.id, status: 'applied' }
    }

    case 'task': {
      const d = op.data
      const task = await db.task.findFirst({ where: { id: d.taskId, orgId: ctx.org.id, residentId: r.id } })
      if (d.status !== 'done' && (d.reason ?? '').trim().length < 3) return { id: op.id, status: 'conflict', reason: 'invalid' }
      const change = task
        ? await db.auditLog.findFirst({
            where: { orgId: ctx.org.id, entityType: 'Task', entityId: task.id, at: { gt: at }, userId: { not: ctx.user.id } },
            orderBy: { at: 'desc' },
            select: { userId: true, at: true },
          })
        : null
      const c = taskConflict(task, { userId: ctx.user.id, status: d.status, at }, change ? { by: change.userId ?? '', at: change.at } : null)
      if (c) {
        if (c.status === 'duplicate') return { id: op.id, status: 'duplicate' }
        const byId = c.reason === 'taskClosed' ? task?.completedById : c.reason === 'taskChanged' ? change?.userId : null
        const whenAt = c.reason === 'taskClosed' ? task?.completedAt : c.reason === 'taskChanged' ? change?.at : null
        const names = await userNames(ctx, [byId])
        const detail = byId || whenAt ? { by: (byId && names.get(byId)?.short) || '–', at: whenAt?.toISOString() ?? '' } : undefined
        return { id: op.id, status: 'conflict', reason: c.reason, detail }
      }
      const t = task!
      const reason = (d.reason ?? '').trim()
      const extra = (d.note ?? '').trim()
      const noteText = [d.status !== 'done' ? reason : '', extra].filter(Boolean).join(' – ')
      // Nur übernehmen, wenn die Aufgabe noch offen ist (gleichzeitiger Abschluss online).
      const upd = await db.task.updateMany({
        where: { id: t.id, status: { in: [...OPEN_STATUSES] } },
        data: { status: d.status, completedById: ctx.user.id, completedAt: at, note: [noteText, marker].filter(Boolean).join(' · ') },
      })
      if (!upd.count) {
        const now2 = await db.task.findUnique({ where: { id: t.id } })
        const names = await userNames(ctx, [now2?.completedById])
        return { id: op.id, status: 'conflict', reason: 'taskClosed', detail: { by: names.get(now2?.completedById ?? '')?.short ?? '–', at: now2?.completedAt?.toISOString() ?? '' } }
      }
      const pick = (k: { status: string; completedById: string | null; completedAt: Date | null; note: string | null }) => ({ status: k.status, completedById: k.completedById, completedAt: k.completedAt, note: k.note })
      const after = await db.task.findUniqueOrThrow({ where: { id: t.id } })
      await audit(ctx, { action: 'task.document', entityType: 'Task', entityId: t.id, before: pick(t), after: pick(after), context: { residentId: r.id, title: t.title, ...offline } })
      if (d.status !== 'done' || extra) {
        const title = taskTitle(ctx.t, t)
        const parts = [`${title}: ${ctx.t('chart.day.statusText.' + d.status)}.`]
        if (d.status !== 'done') parts.push(ctx.t('chart.day.reasonPrefix') + ' ' + reason)
        if (extra) parts.push(extra)
        const obs = await db.observation.create({
          data: { residentId: r.id, at, category: 'care', text: parts.join(' '), authorId: ctx.user.id, source: 'task', taskId: t.id, structured: { offline } as Prisma.InputJsonValue },
        })
        await audit(ctx, { action: 'observation.create', entityType: 'Observation', entityId: obs.id, after: { category: obs.category, text: obs.text, taskId: t.id, at }, context: { residentId: r.id, ...offline } })
        await emit({ orgId: ctx.org.id, type: 'observation.created', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { observationId: obs.id, offline: true } })
      }
      await emit({ orgId: ctx.org.id, type: 'task.completed', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { taskId: t.id, status: d.status, offline: true } })
      return { id: op.id, status: 'applied' }
    }

    case 'intake': {
      const d = op.data
      const log = d.type === 'drink'
        ? await db.intakeLog.create({ data: { residentId: r.id, at, kind: 'drink', amountMl: d.ml, item: d.item?.trim().slice(0, 120) || null, authorId: ctx.user.id } })
        : await db.intakeLog.create({ data: { residentId: r.id, at, kind: 'meal', item: ctx.t('care.nutrition.mealNames.' + d.meal), portion: d.portion, authorId: ctx.user.id } })
      await audit(ctx, { action: 'nutrition.intake', entityType: 'IntakeLog', entityId: log.id, after: d.type === 'drink' ? { kind: 'drink', amountMl: d.ml, item: log.item, at } : { kind: 'meal', meal: d.meal, item: log.item, portion: d.portion, at }, context: { residentId: r.id, ...offline } })
      await emit({ orgId: ctx.org.id, type: 'nutrition.recorded', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { kind: d.type, offline: true } })
      return { id: op.id, status: 'applied' }
    }
  }
}
