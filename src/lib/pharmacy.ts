/**
 * Apotheke (PRD §13.1 Bestandsmanagement, §40): Bestellvorschlag aus der Reichweite, Wareneingang mit Charge und
 * Verfall, Bestandskorrektur. Reine Logik ohne Datenbank (Server, Client, Tests).
 */
import { z } from 'zod'

/** Vorschlag ab dieser Reichweite (Tage) und Zielreichweite einer Bestellung (Tage). */
export const REORDER_AT_DAYS = 10
export const COVER_DAYS = 30

/** `daily`: Einheiten pro Tag (dailyUnits aus src/lib/medication.ts) */
type StockMed = { kind: 'regular' | 'prn' | 'temporary'; stock: number | null; daily: number; prnMaxPerDay: number | null; endDate: Date | null }

/**
 * Bestellvorschlag (Stück in der Bestandseinheit) oder null. Dauer-/befristete Verordnungen: Bedarf bis zur
 * Zielreichweite (befristet höchstens bis zum Ende); Reserve: auf den Bedarf von 10 Tagen bei Tageshöchstdosis.
 */
export function reorderSuggestion(m: StockMed, now = new Date()): number | null {
  if (m.stock == null) return null
  if (m.kind === 'prn') {
    const target = Math.max(10, (m.prnMaxPerDay ?? 1) * REORDER_AT_DAYS)
    return m.stock <= Math.max(3, m.prnMaxPerDay ?? 0) ? Math.max(0, target - m.stock) || null : null
  }
  const daily = m.daily
  if (!daily) return null
  if (m.stock / daily >= REORDER_AT_DAYS) return null
  let days = COVER_DAYS
  if (m.endDate) days = Math.min(days, Math.max(0, Math.ceil((m.endDate.getTime() - now.getTime()) / 86_400_000) + 1))
  const need = Math.ceil(daily * days) - m.stock
  return need > 0 ? need : null
}

/** Bestand nach einer Buchung (nie negativ). */
export const stockAfter = (stock: number | null, delta: number) => Math.max(0, (stock ?? 0) + delta)

/** Verfall: abgelaufen bzw. innert 30 Tagen. */
export function expiryState(expiry: Date | null, now = new Date()): 'none' | 'expired' | 'soon' | 'ok' {
  if (!expiry) return 'none'
  if (expiry < now) return 'expired'
  return expiry.getTime() - now.getTime() < 30 * 86_400_000 ? 'soon' : 'ok'
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
export const receiptSchema = z.object({
  medicationId: z.string().min(1).max(40),
  orderId: z.string().max(40),
  quantity: z.coerce.number().int('meds.pharmacy.errors.quantity').min(1, 'meds.pharmacy.errors.quantity').max(10000, 'meds.pharmacy.errors.quantity'),
  batch: z.string().trim().min(1, 'meds.pharmacy.errors.batch').max(40, 'meds.pharmacy.errors.batch'),
  expiry: z.string().regex(DATE, 'meds.pharmacy.errors.expiry'),
})
export const orderSchema = z.object({
  medicationId: z.string().min(1).max(40),
  quantity: z.coerce.number().int('meds.pharmacy.errors.quantity').min(1, 'meds.pharmacy.errors.quantity').max(10000, 'meds.pharmacy.errors.quantity'),
})
export const countSchema = z.object({
  medicationId: z.string().min(1).max(40),
  counted: z.coerce.number().int('meds.pharmacy.errors.counted').min(0, 'meds.pharmacy.errors.counted').max(100000, 'meds.pharmacy.errors.counted'),
  note: z.string().trim().min(3, 'meds.pharmacy.errors.note').max(300),
})
