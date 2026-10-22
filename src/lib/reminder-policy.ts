/**
 * Erinnerungsfristen (PRD §20, §21): Zertifikate und Qualifikationen vor Ablauf, Pflichtschulungen vor der
 * Frist, Gültigkeit von Dokumenten. Rein und testbar; Ausführung im täglichen Job `reminders` (src/lib/reminders.ts).
 *
 * Jede Frist hat Stufen in Tagen vor dem Stichtag. Pro Gegenstand wird jede Stufe höchstens einmal gemeldet;
 * fällt der Job aus, wird beim nächsten Lauf nur die dringendste fällige Stufe gemeldet (keine Nachrichtenflut).
 */

/** Zertifikate und Qualifikationen: 60, 30 und 7 Tage vorher, am Ablauftag. */
export const CERT_STAGES = [60, 30, 7, 0] as const
/** Offene Pflichtschulungen: 14 und 3 Tage vor der Frist, am Fälligkeitstag. */
export const DUE_STAGES = [14, 3, 0] as const
/** Dokument-Gültigkeit (Verantwortliche/r): 30 und 7 Tage vorher, am Ablauftag. */
export const DOC_STAGES = [30, 7, 0] as const
/** Abgelaufenes wird nur innerhalb dieser Tage nach dem Stichtag noch gemeldet (keine Altlasten beim ersten Lauf). */
export const GRACE_DAYS = 14
/** Leitungen erhalten eine Zusammenfassung bei diesen Stufen. */
export const LEAD_STAGES = [30, 0] as const
/** Pflichtschulungen mit Gültigkeit werden so viele Tage vor Ablauf des Zertifikats erneut zugewiesen. */
export const RENEW_DAYS = 60

const DAY = 86_400_000

/** Kalendertage von `now` bis `date` (lokale Zeitzone, Uhrzeit ignoriert). Negativ = vorbei. */
export function daysUntil(date: Date, now: Date) {
  const a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const b = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.round((b - a) / DAY)
}

/**
 * Fällige Stufe: die kleinste Stufe s mit daysLeft ≤ s. Vorbei (daysLeft < 0) zählt als Stufe 0,
 * solange es nicht länger als GRACE_DAYS her ist. null = noch nichts zu melden.
 */
export function reminderStage(daysLeft: number, stages: readonly number[], grace = GRACE_DAYS): number | null {
  if (daysLeft < -grace) return null
  const sorted = [...stages].sort((a, b) => a - b)
  for (const s of sorted) if (daysLeft <= s) return s
  return null
}

/** Melden, wenn für diesen Gegenstand noch keine gleich dringende oder dringendere Stufe gemeldet wurde. */
export function shouldRemind(stage: number | null, sent: readonly number[]) {
  return stage !== null && !sent.some((s) => s <= stage)
}

/** Priorität der Benachrichtigung: ab 7 Tagen und bei Ablauf «Handlung», sonst «Information». */
export const reminderPriority = (stage: number): 'action' | 'info' => (stage <= 7 ? 'action' : 'info')

/** Pflichtschulung mit Gültigkeit erneut zuweisen, wenn das Zertifikat in RENEW_DAYS abläuft (und noch nicht abgelaufen ist). */
export function renewalDue(expiresAt: Date | null, now: Date, days = RENEW_DAYS) {
  if (!expiresAt) return false
  const left = daysUntil(expiresAt, now)
  return left >= 0 && left <= days
}

/** Neuestes Zertifikat je Person und Kurs (bzw. Titel bei externen Nachweisen) – ältere gelten als ersetzt. */
export function latestCertificates<T extends { id: string; userId: string; courseId: string | null; title: string; issuedAt: Date; expiresAt: Date | null }>(certs: T[]): T[] {
  const best = new Map<string, T>()
  for (const c of certs) {
    const k = c.userId + '|' + (c.courseId ?? 'title:' + c.title.trim().toLowerCase())
    const cur = best.get(k)
    if (!cur || c.issuedAt > cur.issuedAt) best.set(k, c)
  }
  return [...best.values()]
}

/**
 * Leitungen erhalten einen Gegenstand in ihrer Zusammenfassung, sobald er erstmals innerhalb von 30 Tagen
 * gemeldet wird, und nochmals bei Ablauf (Stufe 0).
 */
export function leadNotice(stage: number | null, sent: readonly number[]) {
  if (stage === null || !shouldRemind(stage, sent)) return false
  if (stage === 0) return true
  return stage <= LEAD_STAGES[0] && !sent.some((s) => s <= LEAD_STAGES[0])
}
