/**
 * Therapie (PRD §60): Physio-, Ergo-, Logotherapie und Aktivierung mit Therapieplan (Ziel, Frequenz, Evaluation),
 * Einheiten als Termine mit Bericht (Verlauf Kategorie «therapy») und Anleitung für die Pflege (wiederkehrende Aufgabe).
 * Reine Logik ohne Datenbank (Server, Client, Tests).
 */
import { z } from 'zod'
import { addDays, startOfDay } from '@/lib/time'

export const DISCIPLINES = ['physio', 'ergo', 'speech', 'activation'] as const
export type Discipline = (typeof DISCIPLINES)[number]
export const isDiscipline = (v: unknown): v is Discipline => typeof v === 'string' && (DISCIPLINES as readonly string[]).includes(v)

/** Aufgabenkategorie der Pflege-Anleitung (Klartext wie in den Aufgaben). */
export const CARE_CATEGORY: Record<Discipline, string> = { physio: 'Mobilität', ergo: 'Aktivierung', speech: 'Ernährung', activation: 'Aktivierung' }

export const PLAN_STATUSES = ['active', 'completed', 'stopped'] as const
export const SESSION_OUTCOMES = ['done', 'refused', 'ill', 'absent', 'other'] as const
export type SessionOutcome = (typeof SESSION_OUTCOMES)[number]

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export const planSchema = z.object({
  residentId: z.string().min(1).max(40),
  discipline: z.enum(DISCIPLINES, { message: 'therapy.errors.discipline' }),
  goal: z.string().trim().min(5, 'therapy.errors.goal').max(1000, 'therapy.errors.goal'),
  perWeek: z.coerce.number().int('therapy.errors.perWeek').min(1, 'therapy.errors.perWeek').max(14, 'therapy.errors.perWeek'),
  sessionMin: z.coerce.number().int('therapy.errors.sessionMin').min(10, 'therapy.errors.sessionMin').max(120, 'therapy.errors.sessionMin'),
  startDate: z.string().regex(DATE, 'therapy.errors.date'),
  reviewAt: z.string().regex(DATE, 'therapy.errors.date'),
  endDate: z.string().refine((v) => !v || DATE.test(v), 'therapy.errors.date'),
  careInstructions: z.string().trim().max(500),
  careTime: z.string().refine((v) => !v || TIME.test(v), 'therapy.errors.time'),
  orderId: z.string().max(40),
})

export const sessionSchema = z.object({
  planId: z.string().min(1).max(40),
  appointmentId: z.string().max(40),
  outcome: z.enum(SESSION_OUTCOMES, { message: 'therapy.errors.outcome' }),
  durationMin: z.coerce.number().int().min(0).max(240),
  text: z.string().trim().max(4000),
}).superRefine((v, c) => {
  // Durchgeführte Einheit braucht einen Bericht; ausgefallene eine Begründung (bei «anderer Grund»)
  if (v.outcome === 'done' && v.text.length < 5) c.addIssue({ code: 'custom', path: ['text'], message: 'therapy.errors.report' })
  if (v.outcome === 'other' && v.text.length < 3) c.addIssue({ code: 'custom', path: ['text'], message: 'therapy.errors.reason' })
  if (v.outcome === 'done' && v.durationMin < 5) c.addIssue({ code: 'custom', path: ['durationMin'], message: 'therapy.errors.duration' })
})

/** Montag 00:00 der Woche von `d` (Schweiz: Woche beginnt am Montag). */
export function weekStart(d: Date): Date {
  const s = startOfDay(d)
  const dow = (s.getDay() + 6) % 7
  return addDays(s, -dow)
}

/** Stand dieser Woche: dokumentierte Einheiten gegenüber dem Soll; «im Rückstand» erst, wenn das Soll nicht mehr erreichbar ist. */
export function weekProgress(perWeek: number, sessions: Date[], now = new Date()) {
  const from = weekStart(now)
  const done = sessions.filter((d) => d >= from && d <= now).length
  const daysLeft = 7 - Math.round((startOfDay(now).getTime() - from.getTime()) / 86_400_000)
  return { done, target: perWeek, behind: perWeek - done > daysLeft }
}

/** Zielevaluation fällig (am Tag selbst oder überfällig), nur bei aktiven Plänen. */
export function reviewDue(p: { status: string; reviewAt: Date | null }, now = new Date()) {
  return p.status === 'active' && !!p.reviewAt && p.reviewAt <= startOfDay(addDays(now, 1))
}

/** Text des Verlaufseintrags (Document Once): Disziplin · Dauer · Bericht bzw. Ausfallgrund. */
export function sessionText(t: (k: string, v?: Record<string, string | number>) => string, s: { discipline: Discipline; outcome: SessionOutcome; durationMin: number; text: string; goal: string }) {
  const head = t('therapy.disciplines.' + s.discipline)
  if (s.outcome === 'done') return `${head} · ${t('therapy.minutes', { n: s.durationMin })}\n${s.text.trim()}\n${t('therapy.goalLine', { goal: s.goal.trim() })}`
  return `${head} · ${t('therapy.outcome.' + s.outcome)}${s.text.trim() ? ': ' + s.text.trim() : ''}`
}
