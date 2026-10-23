/**
 * Telefonische und mündliche Verordnungen (PRD §13, §32): Die Pflege erfasst «telefonisch angeordnet von …»,
 * die Verordnung gilt sofort, die Ärztin bzw. der Arzt zeichnet sie innert Frist gegen. Ohne Gegenzeichnung
 * nach Fristablauf eskaliert der Hintergrundjob (src/lib/phone-orders-server.ts). Reine Logik ohne Datenbank.
 */

export const ORDER_SOURCES = ['written', 'phone', 'verbal'] as const
export type OrderSource = (typeof ORDER_SOURCES)[number]
export const isOrderSource = (v: unknown): v is OrderSource => typeof v === 'string' && (ORDER_SOURCES as readonly string[]).includes(v)
export const needsConfirmation = (source: string | null | undefined) => source === 'phone' || source === 'verbal'

/** Standardfrist für die Gegenzeichnung in Stunden (übliche Heimpraxis: am nächsten Arbeitstag, spätestens 24 h). */
export const PHONE_ORDER_HOURS_DEFAULT = 24
const MIN_H = 1
const MAX_H = 72

/** Frist aus Organization.settings.medication.phoneOrderConfirmHours (1–72 h), sonst Standard. */
export function phoneOrderHours(settings: unknown): number {
  const med = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).medication : null
  const h = med && typeof med === 'object' ? Number((med as Record<string, unknown>).phoneOrderConfirmHours) : NaN
  return Number.isInteger(h) && h >= MIN_H && h <= MAX_H ? h : PHONE_ORDER_HOURS_DEFAULT
}

/** Fälligkeit der Gegenzeichnung; schriftliche Verordnungen brauchen keine. */
export function confirmDueAt(source: string, at: Date, hours: number): Date | null {
  return needsConfirmation(source) ? new Date(at.getTime() + hours * 3600_000) : null
}

export type ConfirmState = 'none' | 'pending' | 'overdue' | 'confirmed'

export function confirmState(m: { orderSource: string; confirmedAt: Date | null; confirmDueAt: Date | null }, now = new Date()): ConfirmState {
  if (!needsConfirmation(m.orderSource)) return 'none'
  if (m.confirmedAt) return 'confirmed'
  if (m.confirmDueAt && m.confirmDueAt <= now) return 'overdue'
  return 'pending'
}

/** Muss nach Fristablauf eskaliert werden? (einmalig, nicht bei bereits gegengezeichneten) */
export function dueForEscalation(m: { orderSource: string; confirmedAt: Date | null; confirmDueAt: Date | null; confirmEscalatedAt: Date | null }, now = new Date()) {
  return confirmState(m, now) === 'overdue' && !m.confirmEscalatedAt
}

/**
 * Darf diese Person gegenzeichnen? Ärztliches Verordnungsrecht (resident.medication.edit im Bereich bzw. Zuordnung
 * im Ärzteportal) und nicht die Person, die die Anordnung entgegengenommen hat (Vier-Augen-Prinzip).
 */
export function mayConfirm(input: { userId: string; createdById: string; canPrescribe: boolean; state: ConfirmState }):
  { ok: true } | { ok: false; error: 'meds.phone.errors.notPending' | 'meds.phone.errors.self' | 'meds.phone.errors.noRight' } {
  if (input.state !== 'pending' && input.state !== 'overdue') return { ok: false, error: 'meds.phone.errors.notPending' }
  if (input.userId === input.createdById) return { ok: false, error: 'meds.phone.errors.self' }
  if (!input.canPrescribe) return { ok: false, error: 'meds.phone.errors.noRight' }
  return { ok: true }
}
