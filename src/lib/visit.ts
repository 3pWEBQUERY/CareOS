/**
 * Arztvisite (PRD §29, §4.4, §32): reine Logik ohne Datenbank – Server, Client und Tests.
 * Anordnungen werden zu Aufgaben für die Pflege; Medikamentenänderungen werden nie direkt verordnet,
 * sondern als Aufgabe «Verordnung anpassen» mit Link in die Medikation erfasst.
 */
import type { TFn } from '@/i18n/core'
import { VITALS, VITAL_KEYS, flag, type Limits, type VitalKey } from '@/lib/vitals'
import { addDays, addMinutes, atTime, sameDay, startOfDay } from '@/lib/time'

export const ORDER_KINDS = ['medication', 'lab', 'check', 'therapy', 'other'] as const
export type OrderKind = (typeof ORDER_KINDS)[number]
export const isOrderKind = (v: unknown): v is OrderKind => typeof v === 'string' && (ORDER_KINDS as readonly string[]).includes(v)

/** Aufgabenkategorie (Klartext wie in der Pflegeplanung, siehe TASK_CATEGORIES). */
export const ORDER_CATEGORY: Record<OrderKind, string> = {
  medication: 'Medikation', lab: 'Behandlungspflege', check: 'Überwachung', therapy: 'Organisation', other: 'Organisation',
}
const ORDER_MINUTES: Record<OrderKind, number> = { medication: 10, lab: 10, check: 5, therapy: 10, other: 10 }

/** Systemtitel der Aufgabe (Schlüssel, Anzeige über taskTitle). */
export const ORDER_TITLE_PREFIX = 'visit.order.'
export const orderTitle = (kind: OrderKind) => ORDER_TITLE_PREFIX + kind
export const orderKindOfTitle = (title: string): OrderKind | null => {
  if (!title.startsWith(ORDER_TITLE_PREFIX)) return null
  const k = title.slice(ORDER_TITLE_PREFIX.length)
  return isOrderKind(k) ? k : null
}

const roundUp = (d: Date, min: number) => new Date(Math.ceil(d.getTime() / (min * 60_000)) * min * 60_000)

/**
 * Fälligkeit ohne Angabe: Verordnung anpassen innert 1 h, übrige Anordnungen innert 4 h (auf 15 Min. gerundet).
 * Fiele das nach 21:30 oder auf den Folgetag, gilt der Folgetag 08:00 (keine Nachtaufgaben aus der Visite).
 */
export function defaultDue(kind: OrderKind, now = new Date()): Date {
  const d = roundUp(addMinutes(now, kind === 'medication' ? 60 : 240), 15)
  if (!sameDay(d, now) || d > atTime(startOfDay(now), '21:30')) return atTime(addDays(startOfDay(now), 1), '08:00')
  return d
}

export type OrderInput = { kind: OrderKind; text: string; dueAt: Date | null; questionId?: string | null }
export type OrderTaskSpec = { title: string; description: string; category: string; priority: 'important' | 'routine'; dueAt: Date; durationMin: number }

/** Aufgabe zu einer Anordnung. Medikation hat Vorrang (Priorität «wichtig»), alles andere ist Routine. */
export function orderTask(order: OrderInput, now = new Date(), physician?: string | null): OrderTaskSpec {
  return {
    title: orderTitle(order.kind),
    description: physician ? `${order.text.trim()} (${physician})` : order.text.trim(),
    category: ORDER_CATEGORY[order.kind],
    priority: order.kind === 'medication' ? 'important' : 'routine',
    dueAt: order.dueAt ?? defaultDue(order.kind, now),
    durationMin: ORDER_MINUTES[order.kind],
  }
}

/**
 * Beginn des Zeitraums «seit der letzten Visite»: letzte dokumentierte Visite oder letzter erledigter Arzttermin,
 * sonst 14 Tage. Nie weiter als 30 Tage zurück, damit die Ansicht kompakt bleibt.
 */
export function visitSince(last: (Date | null | undefined)[], now = new Date()): { since: Date; fromVisit: boolean } {
  const known = last.filter((d): d is Date => !!d && d < now).sort((a, b) => b.getTime() - a.getTime())[0]
  const floor = addDays(now, -30)
  if (!known) return { since: addDays(now, -14), fromVisit: false }
  return { since: known < floor ? floor : known, fromVisit: true }
}

export type VitalRowAt = { at: Date } & Partial<Record<VitalKey, number | null>>
export type VitalChange = {
  key: VitalKey
  /** Letzter Messwert im Zeitraum */
  last: number
  lastAt: Date
  lastFlag: '' | 'lo' | 'hi'
  /** Auffälligster Wert (am weitesten ausserhalb des Referenzbereichs) */
  peak: number
  peakFlag: 'lo' | 'hi'
  abnormal: number
  count: number
  /** Richtung letzter gegenüber vorletztem Wert */
  trend: 'up' | 'down' | 'flat' | null
  series: number[]
}

/**
 * Auffällige Vitalwerte seit `since` (PRD §14): je Parameter mit mindestens einem Wert ausserhalb der
 * Grenzwerte der letzte Wert, der auffälligste Wert und die Richtung. Gewicht gilt ab ±2 kg als auffällig.
 */
export function vitalChanges(rows: VitalRowAt[], limits: Limits, since: Date): VitalChange[] {
  const inWin = rows.filter((r) => r.at >= since).sort((a, b) => a.at.getTime() - b.at.getTime())
  const out: VitalChange[] = []
  for (const key of VITAL_KEYS) {
    const vals = inWin.filter((r) => r[key] != null).map((r) => ({ at: r.at, v: r[key] as number }))
    if (!vals.length) continue
    const last = vals[vals.length - 1]
    const prev = vals.length > 1 ? vals[vals.length - 2] : null
    const trend = prev ? (last.v > prev.v ? 'up' : last.v < prev.v ? 'down' : 'flat') : null
    if (key === 'weight') {
      const delta = last.v - vals[0].v
      if (vals.length < 2 || Math.abs(delta) < 2) continue
      out.push({ key, last: last.v, lastAt: last.at, lastFlag: '', peak: last.v, peakFlag: delta > 0 ? 'hi' : 'lo', abnormal: 1, count: vals.length, trend, series: vals.map((x) => x.v) })
      continue
    }
    const ab = vals.filter((x) => flag(key, x.v, limits))
    if (!ab.length) continue
    const dist = (v: number) => (v < limits[key].lo ? limits[key].lo - v : v - limits[key].hi) / (VITALS[key].hi - VITALS[key].lo || 1)
    const peak = ab.reduce((a, b) => (dist(b.v) >= dist(a.v) ? b : a))
    out.push({
      key, last: last.v, lastAt: last.at, lastFlag: flag(key, last.v, limits), peak: peak.v, peakFlag: flag(key, peak.v, limits) as 'lo' | 'hi',
      abnormal: ab.length, count: vals.length, trend, series: vals.map((x) => x.v),
    })
  }
  return out
}

export type SummaryInput = {
  physician: string | null
  answers: { question: string; answer: string | null }[]
  orders: { kind: OrderKind; text: string; dueAt: Date }[]
  note: string | null
}

/**
 * Text des Verlaufseintrags zur Visite (Document Once): Fragen mit Antwort, Anordnungen mit Fälligkeit, Notiz.
 * `when` formatiert die Fälligkeit (z. B. «22.10. 15:00»).
 */
export function visitSummary(t: TFn, v: SummaryInput, when: (d: Date) => string): string {
  const lines: string[] = [v.physician?.trim() ? t('visit.summary.headWith', { physician: v.physician.trim() }) : t('visit.summary.head')]
  // Anordnungen zuerst: Übergabe und Timeline kürzen lange Einträge, das Wichtigste steht vorne.
  if (v.orders.length) {
    lines.push(t('visit.summary.orders'))
    for (const o of v.orders) {
      const extra = o.kind === 'medication' ? ' ' + t('visit.summary.viaMeds') : ''
      lines.push(`- ${t('visit.kinds.' + o.kind)}: ${o.text.trim()}${extra} · ${t('visit.summary.due', { when: when(o.dueAt) })}`)
    }
  }
  if (v.answers.length) {
    lines.push(t('visit.summary.questions'))
    for (const a of v.answers) lines.push(`- ${a.question.trim()} → ${a.answer?.trim() || t('visit.summary.stillOpen')}`)
  }
  if (v.note?.trim()) lines.push(t('visit.summary.note', { text: v.note.trim() }))
  if (!v.orders.length && !v.note?.trim() && !v.answers.some((a) => a.answer?.trim())) lines.push(t('visit.summary.none'))
  return lines.join('\n')
}

/** Leerer Abschluss (keine Antwort, keine Anordnung, keine Notiz) wird vor dem Speichern bestätigt (PRD §32). */
export const isEmptyVisit = (v: { answers: { answer: string | null }[]; orders: unknown[]; note: string | null }) =>
  !v.orders.length && !v.note?.trim() && !v.answers.some((a) => a.answer?.trim())
