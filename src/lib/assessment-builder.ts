/**
 * Eigene Assessment-Instrumente (PRD §45): Prüfung einer Definition aus dem Admin-Editor – reine Logik.
 * Punkte je Antwort werden summiert; die Bewertungsbereiche müssen den möglichen Punktbereich lückenlos
 * und ohne Überschneidung abdecken, damit jedes Ergebnis genau eine Stufe erhält.
 */
import { z } from 'zod'
import type { AssessmentDef } from '@/lib/clinical-config'

export const LEVELS = ['ok', 'warn', 'crit'] as const

const text = (max: number, msg: string) => z.string().trim().min(1, msg).max(max, msg)

export const AssessmentDraft = z.object({
  name: z.string().trim().min(2, 'forms.assessment.errors.name').max(80, 'forms.assessment.errors.name'),
  description: z.string().trim().max(300, 'forms.assessment.errors.description'),
  intervalDays: z.union([z.literal(''), z.null(), z.coerce.number().int('forms.assessment.errors.interval').min(1, 'forms.assessment.errors.interval').max(730, 'forms.assessment.errors.interval')]).transform((v) => (v === '' ? null : v)),
  questions: z
    .array(z.object({
      label: text(200, 'forms.assessment.errors.question'),
      options: z.array(z.object({ label: text(120, 'forms.assessment.errors.option'), v: z.coerce.number({ message: 'forms.assessment.errors.points' }).int('forms.assessment.errors.points').min(-100, 'forms.assessment.errors.points').max(100, 'forms.assessment.errors.points') }))
        .min(2, 'forms.assessment.errors.options').max(12, 'forms.assessment.errors.options'),
    }))
    .min(1, 'forms.assessment.errors.questions').max(40, 'forms.assessment.errors.questions'),
  ranges: z
    .array(z.object({
      min: z.coerce.number({ message: 'forms.assessment.errors.range' }).int('forms.assessment.errors.range'),
      max: z.coerce.number({ message: 'forms.assessment.errors.range' }).int('forms.assessment.errors.range'),
      result: text(80, 'forms.assessment.errors.result'),
      level: z.enum(LEVELS, { message: 'forms.assessment.errors.level' }),
    }))
    .min(1, 'forms.assessment.errors.ranges').max(10, 'forms.assessment.errors.ranges'),
})
export type AssessmentDraftInput = z.input<typeof AssessmentDraft>

/** Kleinste und grösste mögliche Summe. */
export function scoreBounds(questions: { options: { v: number }[] }[]) {
  let min = 0
  let max = 0
  for (const q of questions) {
    if (!q.options.length) continue
    const vs = q.options.map((o) => o.v)
    min += Math.min(...vs)
    max += Math.max(...vs)
  }
  return { min, max }
}

/** Bereiche lückenlos und überschneidungsfrei über [min, max]? Liefert einen i18n-Schlüssel oder null. */
export function rangeProblem(questions: { options: { v: number }[] }[], ranges: { min: number; max: number }[]) {
  const b = scoreBounds(questions)
  const s = [...ranges].sort((a, c) => a.min - c.min)
  if (s.some((r) => r.min > r.max)) return 'forms.assessment.errors.rangeOrder'
  if (s[0].min > b.min || s[s.length - 1].max < b.max) return 'forms.assessment.errors.rangeCoverage'
  for (let i = 1; i < s.length; i++) {
    if (s[i].min <= s[i - 1].max) return 'forms.assessment.errors.rangeOverlap'
    if (s[i].min > s[i - 1].max + 1) return 'forms.assessment.errors.rangeGap'
  }
  return null
}

/** Gespeicherte Form (AssessmentDefinition.items) mit stabilen Schlüsseln q1, q2, … */
export function toItems(d: z.output<typeof AssessmentDraft>): AssessmentDef['items'] {
  return {
    questions: d.questions.map((q, i) => ({ key: 'q' + (i + 1), label: q.label, options: q.options.map((o) => ({ v: o.v, label: o.label })) })),
    ranges: [...d.ranges].sort((a, b) => a.min - b.min).map((r) => ({ min: r.min, max: r.max, result: r.result, level: r.level })),
  }
}
