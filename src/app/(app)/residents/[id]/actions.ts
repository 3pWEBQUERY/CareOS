'use server'

import { db } from '@/lib/db'
import { run, type ActionResult } from '@/lib/action'
import { getCtx } from '@/lib/context'
import { aiDraft, aiFeedback, AiUnavailable } from '@/lib/ai'
import { addDays, fmtDayMonth, hm } from '@/lib/time'
import { abnormalKeys, mergeLimits, VITALS } from '@/lib/vitals'
import { actionResident } from '../_lib/resident'

const INSTRUCTION = `Aufgabe: Erstelle eine kompakte Übersicht der relevanten Entwicklungen der letzten 7 Tage für eine Pflegefachperson.
Gliederung als kurze Aufzählung mit "- ": aktueller Zustand, Veränderungen, auffällige Werte, offene Punkte für die nächste Schicht.
Höchstens 8 Punkte. Keine Bewertung, keine Empfehlung zu Therapie oder Medikation. Nur Inhalte aus dem Input.`

/** Resident Summary (PRD §23.1). Ohne Namen an das Modell; Ergebnis wird nie gespeichert. */
export async function residentSummary(residentId: string): Promise<ActionResult<{ id: string; text: string }>> {
  return run(async () => {
    const { ctx, r } = await actionResident(residentId, 'resident.read')
    const now = new Date()
    const since = addDays(now, -7)
    const [obs, vitals, limitRows, incidents, plan] = await Promise.all([
      db.observation.findMany({ where: { residentId: r.id, at: { gte: since }, correctedBy: { none: {} } }, orderBy: { at: 'asc' }, take: 60 }),
      db.vitalSign.findMany({ where: { residentId: r.id, at: { gte: since } }, orderBy: { at: 'asc' } }),
      db.vitalThreshold.findMany({ where: { orgId: ctx.org.id, OR: [{ residentId: null }, { residentId: r.id }] } }),
      db.incident.findMany({ where: { residentId: r.id, occurredAt: { gte: since } }, include: { type: true } }),
      db.carePlan.findFirst({ where: { residentId: r.id, status: 'active' }, include: { areas: true } }),
    ])
    const limits = mergeLimits(limitRows, r.id)
    const lines: string[] = []
    lines.push(`Risiken: ${r.risks.join(', ') || '–'}; Allergien: ${r.allergies.join(', ') || '–'}; Mobilität: ${r.mobility ?? '–'}; Kostform: ${r.diet ?? '–'}`)
    if (r.importantNotes) lines.push(`Wichtige Hinweise: ${r.importantNotes}`)
    for (const a of plan?.areas ?? []) if (a.needs) lines.push(`Pflegebedarf ${a.domain}: ${a.needs}${a.goal ? ' – Ziel: ' + a.goal : ''}`)
    lines.push('Pflegebericht:')
    for (const o of obs) lines.push(`${fmtDayMonth(o.at, ctx.locale)} ${hm(o.at)} [${o.category}] ${o.text}`)
    const ab = vitals.map((v) => ({ v, k: abnormalKeys(v, limits) })).filter((x) => x.k.length)
    lines.push('Auffällige Vitalwerte:')
    for (const { v, k } of ab) lines.push(`${fmtDayMonth(v.at, ctx.locale)} ${hm(v.at)} ${k.map((key) => `${key} ${v[key]} ${VITALS[key].unit}`).join(', ')}`)
    for (const i of incidents) lines.push(`Ereignis ${fmtDayMonth(i.occurredAt, ctx.locale)}: ${i.type.name} – ${i.description}`)
    try {
      const res = await aiDraft(ctx, 'resident_summary', INSTRUCTION, lines.join('\n').slice(0, 16000), 900)
      return { ok: true, data: res }
    } catch (e) {
      if (e instanceof AiUnavailable) return { ok: false, error: 'common.ai.unavailable' }
      throw e
    }
  })
}

export async function discardSummary(aiId: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    await aiFeedback(ctx, aiId, false)
  })
}
