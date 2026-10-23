/**
 * Freigabe von Dokumentversionen (PRD §49 Assign/Escalate, §20 Docs) – reine Logik ohne Datenbank, testbar.
 * Beim Einreichen wählt die Autorin/der Autor optional eine Person mit docs.approve und eine Frist. Nur diese
 * Person wird benachrichtigt; ohne Wahl alle mit docs.approve. Nach Fristablauf eskaliert der Job «escalations»
 * einmal an die übrigen Freigabeberechtigten bzw. die Leitung (src/lib/docs-review-server.ts).
 */
import { addDays, dateKey, parseDateKey } from '@/lib/time'

/** Standardfrist in Tagen ab Einreichung */
export const REVIEW_DAYS_DEFAULT = 5
export const REVIEW_DAYS_MAX = 90

/** Vorschlag für das Datumsfeld (YYYY-MM-DD). */
export const defaultReviewDue = (now = new Date()) => dateKey(addDays(now, REVIEW_DAYS_DEFAULT))

/** Frist aus dem Datumsfeld: Ende des gewählten Tages (lokal). Heute bis +90 Tage, sonst null. */
export function parseReviewDue(s: string, now = new Date()): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const day = parseDateKey(s)
  if (Number.isNaN(day.getTime()) || dateKey(day) !== s) return null
  if (s < dateKey(now) || s > dateKey(addDays(now, REVIEW_DAYS_MAX))) return null
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59)
}

type ReviewState = { submittedAt: Date | null; approvedAt: Date | null; reviewDueAt: Date | null; reviewEscalatedAt: Date | null }

/** Eingereicht, nicht freigegeben und Frist abgelaufen? */
export const reviewOverdue = (v: Omit<ReviewState, 'reviewEscalatedAt'>, now = new Date()) =>
  !!v.submittedAt && !v.approvedAt && !!v.reviewDueAt && v.reviewDueAt < now

/** Muss jetzt eskaliert werden? (einmalig je Einreichung) */
export const reviewDueForEscalation = (v: ReviewState, now = new Date()) => reviewOverdue(v, now) && !v.reviewEscalatedAt

/**
 * Empfangende der Eskalation. Mit zugewiesener Person: die übrigen Freigabeberechtigten (ohne einreichende Person),
 * ohne solche die Leitung, sonst erneut die zugewiesene Person. Ohne Zuweisung (alle wurden bereits benachrichtigt):
 * alle Freigabeberechtigten erneut und die Leitung, ohne die einreichende Person.
 */
export function reviewEscalationRecipients(input: { reviewerId: string | null; authorId: string; approvers: string[]; leads: string[] }): string[] {
  const not = (ids: string[], ...drop: (string | null)[]) => [...new Set(ids.filter((id) => !drop.includes(id)))]
  if (input.reviewerId) {
    const others = not(input.approvers, input.reviewerId, input.authorId)
    if (others.length) return others
    const leads = not(input.leads, input.reviewerId)
    return leads.length ? leads : [input.reviewerId]
  }
  return not([...input.approvers, ...input.leads], input.authorId)
}
