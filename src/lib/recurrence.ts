/**
 * Wiederkehrende Aufgaben (PRD §12.1): Rhythmus einer Aufgabenvorlage – reine Logik, auf Server und Client nutzbar.
 * Tage werden als Kalendertage gerechnet (unabhängig von Sommer-/Winterzeit).
 */
import { z } from 'zod'
import type { TFn } from '@/i18n/core'

export const RHYTHMS = ['daily', 'weekly', 'monthly'] as const
export type Rhythm = (typeof RHYTHMS)[number]

export type Recurrence = {
  rhythm: Rhythm
  /** alle n Tage / Wochen / Monate */
  every: number
  /** 0 = So … 6 = Sa (weekly); leer = Wochentag des Starts */
  weekdays: number[]
  /** 1–31 (monthly); leer = Tag des Starts */
  monthDay: number | null
  startDate: Date
  endDate: Date | null
}

const dayNo = (d: Date) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000)
/** Laufende Wochennummer, Wochen von Montag bis Sonntag (1970-01-01 war ein Donnerstag). */
const weekNo = (d: Date) => Math.floor((dayNo(d) + 3) / 7)
const lastDayOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()

/** Fällt die Vorlage auf diesen Kalendertag? */
export function occursOn(r: Recurrence, day: Date): boolean {
  const n = dayNo(day)
  if (n < dayNo(r.startDate)) return false
  if (r.endDate && n > dayNo(r.endDate)) return false
  const every = Math.max(1, Math.floor(r.every) || 1)
  if (r.rhythm === 'daily') return (n - dayNo(r.startDate)) % every === 0
  if (r.rhythm === 'weekly') {
    const days = r.weekdays.length ? r.weekdays : [r.startDate.getDay()]
    if (!days.includes(day.getDay())) return false
    return (weekNo(day) - weekNo(r.startDate)) % every === 0
  }
  const months = (day.getFullYear() - r.startDate.getFullYear()) * 12 + day.getMonth() - r.startDate.getMonth()
  if (months % every !== 0) return false
  const want = r.monthDay ?? r.startDate.getDate()
  return day.getDate() === Math.min(want, lastDayOfMonth(day))
}

/** Nächster Tag ab `from` (einschliesslich), an dem die Vorlage fällig ist; null nach dem Ende oder nach 400 Tagen. */
export function nextOccurrence(r: Recurrence, from: Date): Date | null {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  for (let i = 0; i < 400; i++) {
    if (r.endDate && dayNo(d) > dayNo(r.endDate)) return null
    if (occursOn(r, d)) return new Date(d)
    d.setDate(d.getDate() + 1)
  }
  return null
}

/** Wochentage in Anzeigereihenfolge ab Montag. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

/** Lesbarer Rhythmus, z. B. «Täglich», «Alle 2 Wochen: Mo, Do», «Monatlich am 1.». */
export function describeRecurrence(t: TFn, r: Pick<Recurrence, 'rhythm' | 'every' | 'weekdays' | 'monthDay' | 'startDate'>, times: string[] = []) {
  const names = t('common.weekdaysShort').split(',')
  let base: string
  if (r.rhythm === 'daily') base = r.every > 1 ? t('tasks.recur.everyNDays', { n: r.every }) : t('tasks.recur.daily')
  else if (r.rhythm === 'weekly') {
    const days = (r.weekdays.length ? r.weekdays : [r.startDate.getDay()])
    const list = WEEK_ORDER.filter((d) => days.includes(d)).map((d) => names[d]).join(', ')
    base = (r.every > 1 ? t('tasks.recur.everyNWeeks', { n: r.every }) : t('tasks.recur.weekly')) + ': ' + list
  } else {
    const day = r.monthDay ?? r.startDate.getDate()
    base = r.every > 1 ? t('tasks.recur.everyNMonths', { n: r.every, day }) : t('tasks.recur.monthly', { day })
  }
  return times.length ? `${base} · ${times.join(', ')}` : base
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Eingabe aus Formularen (Aufgabe erstellen, Admin). Zeiten «7:30, 14:00» werden normalisiert. */
export const RecurrenceInput = z
  .object({
    rhythm: z.enum(RHYTHMS, { message: 'tasks.recur.errors.rhythm' }),
    every: z.coerce.number({ message: 'tasks.recur.errors.every' }).int('tasks.recur.errors.every').min(1, 'tasks.recur.errors.every').max(52, 'tasks.recur.errors.every'),
    weekdays: z.array(z.coerce.number().int().min(0).max(6)).max(7),
    monthDay: z.union([z.literal(''), z.coerce.number().int('tasks.recur.errors.monthDay').min(1, 'tasks.recur.errors.monthDay').max(31, 'tasks.recur.errors.monthDay')]).transform((v) => (v === '' ? null : v)),
    times: z.string().transform((s, c) => {
      const out: string[] = []
      for (const p of s.split(/[\s,;]+/).filter(Boolean)) {
        const m = /^(\d{1,2})[:.h]?(\d{2})$/.exec(p)
        const v = m ? m[1].padStart(2, '0') + ':' + m[2] : ''
        if (!TIME.test(v)) {
          c.addIssue({ code: 'custom', message: 'tasks.recur.errors.times' })
          return z.NEVER
        }
        if (!out.includes(v)) out.push(v)
      }
      if (!out.length || out.length > 12) {
        c.addIssue({ code: 'custom', message: 'tasks.recur.errors.times' })
        return z.NEVER
      }
      return out.sort()
    }),
    startDate: z.string().regex(DATE, 'tasks.recur.errors.start'),
    endDate: z.union([z.literal(''), z.string().regex(DATE, 'tasks.recur.errors.end')]),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, { message: 'tasks.recur.errors.end', path: ['endDate'] })

/** Feldnamen der Eingabe → Formularfeld (für Fehlermeldungen direkt am Feld). */
export const RECURRENCE_FIELDS: Record<string, string> = {
  rhythm: 'rhythm', every: 'every', weekdays: 'weekdays', monthDay: 'monthDay', times: 'times', startDate: 'startDate', endDate: 'endDate',
}

/** Vorlage für Formulare (Client): Datumswerte als YYYY-MM-DD. */
export type TemplateDto = {
  id: string
  unitId: string
  residentId: string | null
  title: string
  description: string | null
  category: string
  rhythm: Rhythm
  every: number
  weekdays: number[]
  monthDay: number | null
  times: string[]
  startDate: string
  endDate: string | null
  durationMin: number
  priority: 'critical' | 'important' | 'routine'
  assigneeId: string | null
  active: boolean
}
