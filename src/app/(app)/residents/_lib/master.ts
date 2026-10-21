import 'server-only'
import { z } from 'zod'
import { fd, fdNum } from '@/lib/action'
import { dbDate, parseDateKey } from '@/lib/time'
import { splitList } from './resident'

const schema = z.object({
  firstName: z.string().min(1, 'residents.form.errors.firstName').max(80),
  lastName: z.string().min(1, 'residents.form.errors.lastName').max(80),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'residents.form.errors.birthDate'),
  sex: z.enum(['', 'f', 'm', 'd']),
  roomId: z.string().max(40),
  rea: z.enum(['yes', 'no', 'unknown']),
  physician: z.string().max(120),
  diet: z.string().max(120),
  mobility: z.string().max(200),
})

/** Gemeinsame Validierung der Stammdaten (Aufnahme, Bearbeitung). Zod-Fehler werden von run() übersetzt. */
export function parseMaster(form: FormData) {
  const p = schema.parse({
    firstName: fd(form, 'firstName'), lastName: fd(form, 'lastName'), birthDate: fd(form, 'birthDate'), sex: fd(form, 'sex'),
    roomId: fd(form, 'roomId'), rea: fd(form, 'rea') || 'unknown', physician: fd(form, 'physician'), diet: fd(form, 'diet'), mobility: fd(form, 'mobility'),
  })
  const birth = parseDateKey(p.birthDate)
  const now = new Date()
  if (Number.isNaN(birth.getTime()) || birth > now || birth.getFullYear() < 1900) return { ok: false as const, error: 'residents.form.errors.birthDate', field: 'birthDate' }
  const level = fdNum(form, 'careLevel')
  if (level != null && (!Number.isInteger(level) || level < 0 || level > 12)) return { ok: false as const, error: 'residents.form.errors.careLevel', field: 'careLevel' }
  return { ok: true as const, data: {
    firstName: p.firstName,
    lastName: p.lastName,
    birthDate: dbDate(birth),
    sex: p.sex || null,
    roomId: p.roomId || null,
    careLevel: level,
    physician: p.physician || null,
    rea: p.rea,
    allergies: splitList(fd(form, 'allergies')),
    risks: splitList(fd(form, 'risks')),
    diet: p.diet || null,
    mobility: p.mobility || null,
  } }
}
