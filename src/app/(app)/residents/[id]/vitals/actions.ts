'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { run, fd, fdNum, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { notify, usersWithPermission } from '@/lib/notify'
import { fmtNum } from '@/lib/time'
import { abnormalKeys, mergeLimits, VITALS, VITAL_KEYS, type VitalKey, type VitalRow } from '@/lib/vitals'
import { actionResident, residentName } from '../../_lib/resident'
import { AlreadyVoided, correctionSchema, mayCorrect, voidData } from '../../_lib/correction'
import type { TFn } from '@/i18n/core'

/** Werte aus dem Formular: Plausibilität (Fehler am Feld), Blutdruck nur paarweise und sys > dia. */
function parseVitals(form: FormData, t: TFn): { row: VitalRow } | { error: { ok: false; error: string; field?: string } } {
  const row: VitalRow = {}
  for (const k of VITAL_KEYS) {
    const v = fdNum(form, k)
    if (v == null) continue
    const p = VITALS[k]
    if (!Number.isFinite(v) || v < p.min || v > p.max) {
      return { error: { ok: false, field: k, error: t('chart.vitals.errors.implausible', { label: t('common.vitals.' + k), value: fd(form, k), min: p.min, max: p.max, unit: p.unit }) } }
    }
    row[k] = p.dec ? Number(v.toFixed(p.dec)) : Math.round(v)
  }
  if ((row.sys == null) !== (row.dia == null)) return { error: { ok: false, error: 'chart.vitals.errors.bpPair', field: row.sys == null ? 'sys' : 'dia' } }
  if (row.sys != null && row.dia != null && row.dia >= row.sys) return { error: { ok: false, error: 'chart.vitals.errors.bpOrder', field: 'dia' } }
  if (!Object.keys(row).length) return { error: { ok: false, error: 'chart.vitals.errors.none' } }
  return { row }
}

const vitalData = (row: VitalRow) => ({
  sys: row.sys as number | undefined, dia: row.dia as number | undefined, pulse: row.pulse as number | undefined,
  temp: row.temp, spo2: row.spo2 as number | undefined, glucose: row.glucose, weight: row.weight,
  pain: row.pain as number | undefined, respRate: row.respRate as number | undefined,
})

/** Neue Messung (PRD §14): Plausibilität, Blutdruck nur paarweise, Abweichungen ohne Alarmflut melden. */
export async function recordVitals(residentId: string, form: FormData): Promise<ActionResult<{ abnormal: number }>> {
  return run(async () => {
    const { ctx, r } = await actionResident(residentId, 'resident.vitals.write')
    const { t, locale } = ctx
    const parsed = parseVitals(form, t)
    if ('error' in parsed) return parsed.error
    const { row } = parsed
    const note = fd(form, 'note').slice(0, 500) || null

    const v = await db.vitalSign.create({ data: { residentId: r.id, recordedById: ctx.user.id, note, ...vitalData(row) } })
    const limits = mergeLimits(await db.vitalThreshold.findMany({ where: { orgId: ctx.org.id, OR: [{ residentId: null }, { residentId: r.id }] } }), r.id)
    const ab = abnormalKeys(row, limits)
    await audit(ctx, { action: 'vitals.create', entityType: 'VitalSign', entityId: v.id, after: { ...row, note }, context: { residentId: r.id, abnormal: ab } })
    await emit({ orgId: ctx.org.id, type: 'vitals.recorded', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { vitalId: v.id } })
    if (ab.length) {
      const text = ab.map((k) => `${t('common.vitals.' + k)} ${fmtNum(row[k] as number, VITALS[k].dec, locale)} ${VITALS[k].unit}`).join(', ')
      await emit({ orgId: ctx.org.id, type: 'vitals.abnormal', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { vitalId: v.id, keys: ab } })
      const users = (await usersWithPermission(ctx.org.id, 'resident.read', r.unitId)).filter((u) => u !== ctx.user.id)
      await notify({
        orgId: ctx.org.id, userIds: users, priority: 'critical', kind: 'vitals.abnormal',
        title: t('chart.vitals.notifyTitle', { name: residentName(r), room: r.room?.number ?? '–' }),
        body: text, href: `/residents/${r.id}/vitals`, groupKey: `vitals:${r.id}`,
      })
    }
    refresh()
    return { ok: true, data: { abnormal: ab.length } }
  })
}

const LIMIT_KEYS: VitalKey[] = ['sys', 'dia', 'pulse', 'temp', 'spo2', 'glucose', 'respRate', 'pain']

/** Individuelle Grenzwerte (überschreiben die Organisationswerte). Leere Felder = Organisationswert. */
export async function saveThresholds(residentId: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const { ctx, r } = await actionResident(residentId, 'resident.careplan.edit')
    const { t } = ctx
    const before = await db.vitalThreshold.findMany({ where: { orgId: ctx.org.id, residentId: r.id } })
    const ops: { key: VitalKey; lo: number; hi: number }[] = []
    const remove: VitalKey[] = []
    for (const k of LIMIT_KEYS) {
      const lo = fdNum(form, 'lo_' + k)
      const hi = fdNum(form, 'hi_' + k)
      if (lo == null && hi == null) { remove.push(k); continue }
      const p = VITALS[k]
      const label = t('common.vitals.' + k)
      if (lo == null || hi == null || !Number.isFinite(lo) || !Number.isFinite(hi)) return { ok: false, field: 'lo_' + k, error: t('chart.vitals.errors.limitPair', { label }) }
      if (lo < p.min || hi > p.max || lo >= hi) return { ok: false, field: 'lo_' + k, error: t('chart.vitals.errors.limitRange', { label, min: p.min, max: p.max }) }
      ops.push({ key: k, lo, hi })
    }
    await db.$transaction([
      db.vitalThreshold.deleteMany({ where: { orgId: ctx.org.id, residentId: r.id, key: { in: remove } } }),
      ...ops.map((o) => db.vitalThreshold.upsert({
        where: { orgId_residentId_key: { orgId: ctx.org.id, residentId: r.id, key: o.key } },
        create: { orgId: ctx.org.id, residentId: r.id, key: o.key, lo: o.lo, hi: o.hi },
        update: { lo: o.lo, hi: o.hi },
      })),
    ])
    await audit(ctx, {
      action: 'vitals.thresholds', entityType: 'Resident', entityId: r.id,
      before: Object.fromEntries(before.map((b) => [b.key, { lo: b.lo, hi: b.hi }])),
      after: Object.fromEntries(ops.map((o) => [o.key, { lo: o.lo, hi: o.hi }])),
      context: { residentId: r.id },
    })
    await emit({ orgId: ctx.org.id, type: 'resident.updated', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { thresholds: true } })
    refresh()
  })
}

/**
 * Storno oder Korrektur einer Messung (PRD §35): der ursprüngliche Wert bleibt erhalten und wird als storniert
 * markiert (Begründung Pflicht); eine Korrektur ist eine neue Messung mit demselben Zeitpunkt und `supersedesId`.
 * Stornierte Werte fliessen nicht mehr in Hinweise, Trends und Übergabe (`LIVE`).
 */
export async function correctVitals(residentId: string, vitalId: string, form: FormData): Promise<ActionResult<{ id?: string; abnormal: number }>> {
  return run(async () => {
    const { mode, reason } = correctionSchema.parse({ mode: fd(form, 'mode'), reason: fd(form, 'reason') })
    const { ctx, r, can } = await actionResident(residentId, 'resident.vitals.write')
    const { t, locale } = ctx
    const old = await db.vitalSign.findFirst({ where: { id: vitalId, residentId: r.id } })
    if (!old) return { ok: false, error: 'common.notFound' }
    if (!mayCorrect(ctx, can, old.recordedById)) return { ok: false, error: 'common.notAllowed' }
    if (old.voidedAt) return { ok: false, error: 'chart.void.errors.already' }
    const before = Object.fromEntries(VITAL_KEYS.filter((k) => old[k] != null).map((k) => [k, old[k]]))

    let row: VitalRow | null = null
    let note: string | null = null
    if (mode === 'correct') {
      const parsed = parseVitals(form, t)
      if ('error' in parsed) return parsed.error
      row = parsed.row
      note = fd(form, 'note').slice(0, 500) || null
      const same = VITAL_KEYS.every((k) => (row![k] ?? null) === (old[k] ?? null)) && note === old.note
      if (same) return { ok: false, error: 'chart.void.errors.unchanged' }
    }

    const now = new Date()
    let created: { id: string } | null = null
    try {
      created = await db.$transaction(async (tx) => {
        const res = await tx.vitalSign.updateMany({ where: { id: old.id, voidedAt: null }, data: voidData(ctx, reason, now) })
        if (res.count !== 1) throw new AlreadyVoided()
        if (!row) return null
        return tx.vitalSign.create({ data: { residentId: r.id, at: old.at, recordedById: ctx.user.id, note, supersedesId: old.id, ...vitalData(row) }, select: { id: true } })
      })
    } catch (e) {
      if (e instanceof AlreadyVoided) return { ok: false, error: 'chart.void.errors.already' }
      throw e
    }

    const limits = mergeLimits(await db.vitalThreshold.findMany({ where: { orgId: ctx.org.id, OR: [{ residentId: null }, { residentId: r.id }] } }), r.id)
    const ab = row ? abnormalKeys(row, limits) : []
    await audit(ctx, {
      action: created ? 'vitals.correct' : 'vitals.void', entityType: 'VitalSign', entityId: old.id,
      before: { ...before, note: old.note, at: old.at, recordedById: old.recordedById },
      after: { voided: true, reason, ...(created ? { correctionId: created.id, ...row, note } : {}) },
      context: { residentId: r.id, abnormal: ab },
    })
    await emit({ orgId: ctx.org.id, type: 'vitals.corrected', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { vitalId: old.id, correctionId: created?.id ?? null } })
    // Nur neu auffällige Werte melden – der ursprüngliche Wert hat bereits benachrichtigt (keine Alarmflut, PRD §14).
    const fresh = ab.filter((k) => !abnormalKeys(old, limits).includes(k))
    if (created && fresh.length) {
      const text = fresh.map((k) => `${t('common.vitals.' + k)} ${fmtNum(row![k] as number, VITALS[k].dec, locale)} ${VITALS[k].unit}`).join(', ')
      await emit({ orgId: ctx.org.id, type: 'vitals.abnormal', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { vitalId: created.id, keys: fresh } })
      const users = (await usersWithPermission(ctx.org.id, 'resident.read', r.unitId)).filter((u) => u !== ctx.user.id)
      await notify({
        orgId: ctx.org.id, userIds: users, priority: 'critical', kind: 'vitals.abnormal',
        title: t('chart.vitals.notifyTitle', { name: residentName(r), room: r.room?.number ?? '–' }),
        body: text, href: `/residents/${r.id}/vitals`, groupKey: `vitals:${r.id}`,
      })
    }
    refresh()
    return { ok: true, data: { id: created?.id, abnormal: ab.length }, message: created ? 'chart.void.corrected' : 'chart.void.voided' }
  })
}
