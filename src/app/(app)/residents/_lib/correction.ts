import 'server-only'
import { z } from 'zod'
import type { Ctx } from '@/lib/context'
import type { Permission } from '@/lib/permissions'

/**
 * Storno und Korrektur klinischer Messungen (PRD §35, §32): Vitalwerte, Assessments, Wundbeurteilungen.
 * Nie überschreiben: Der ursprüngliche Eintrag wird mit Zeitpunkt, Person und Begründung als storniert markiert;
 * eine Korrektur ist ein neuer Eintrag mit `supersedesId` und demselben Messzeitpunkt.
 */
export const correctionSchema = z.object({
  mode: z.enum(['void', 'correct']),
  reason: z.string().trim().min(5, 'chart.void.errors.reason').max(500, 'chart.void.errors.reasonLong'),
})
export type CorrectionMode = z.infer<typeof correctionSchema>['mode']

/** Eigene Einträge darf die erfassende Person korrigieren, fremde nur mit «Einträge korrigieren». */
export function mayCorrect(ctx: Ctx, can: (p: Permission) => boolean, authorId: string) {
  return authorId === ctx.user.id || can('resident.chart.correct')
}

/** Zwischenzeitlich storniert (zweites Gerät, Doppelklick): verständliche Meldung statt doppelter Buchung. */
export class AlreadyVoided extends Error {}

/** Felder für den Storno eines Eintrags (in einem bedingten Update mit `voidedAt: null`). */
export const voidData = (ctx: Ctx, reason: string, at = new Date()) => ({ voidedAt: at, voidedById: ctx.user.id, voidReason: reason })
