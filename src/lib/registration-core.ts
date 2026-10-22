/**
 * Selbstregistrierung (PRD §33) – reine Logik ohne Datenbank: Registrierungscode, Einstellungen, Validierung.
 * Server-Teil: src/lib/registration.ts, Seite /register, Freigabe unter Admin → Benutzer → Anfragen.
 */
import { createHash, randomInt } from 'node:crypto'
import { z } from 'zod'
import { passwordProblem } from './auth/password'

/** Ohne verwechselbare Zeichen (I, O, 0, 1) */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 12

/** Neuer Code im Format XXXX-XXXX-XXXX (60 Bit). */
export function newRegistrationCode(rand: (max: number) => number = randomInt) {
  let s = ''
  for (let i = 0; i < CODE_LENGTH; i++) s += ALPHABET[rand(ALPHABET.length)]
  return s.match(/.{4}/g)!.join('-')
}

/** Eingabe tolerant: Gross-/Kleinschreibung, Leerzeichen und Bindestriche egal. */
export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
export const hashCode = (code: string) => createHash('sha256').update('careos-registration:' + normalizeCode(code)).digest('hex')

export type RegistrationSettings = { enabled: boolean; codeHash: string | null; codeEnc: string | null; rotatedAt: string | null }

export function readRegistration(settings: unknown): RegistrationSettings {
  const r = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).registration : null
  const o = r && typeof r === 'object' ? (r as Record<string, unknown>) : {}
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  return { enabled: o.enabled === true && !!str(o.codeHash), codeHash: str(o.codeHash), codeEnc: str(o.codeEnc), rotatedAt: str(o.rotatedAt) }
}

export const REGISTER_MIN_PASSWORD = 12

const name = (key: string) => z.string().trim().min(1, key).max(60, key)
const email = z.string().trim().toLowerCase().max(160, 'register.errors.email').pipe(z.email('register.errors.email'))
const password = z.string().max(200, 'register.errors.passwordLength').superRefine((pw, c) => {
  const p = passwordProblem(pw, REGISTER_MIN_PASSWORD)
  if (p) c.addIssue({ code: 'custom', message: p === 'min_length' ? 'register.errors.passwordLength' : 'register.errors.passwordDigits' })
})
const consent = z.literal('on', 'register.errors.consent')

/** Konto beantragen (Registrierungscode der Organisation) */
export const registrationSchema = z.object({
  code: z.string().transform(normalizeCode).pipe(z.string().length(CODE_LENGTH, 'register.errors.code')),
  firstName: name('register.errors.firstName'),
  lastName: name('register.errors.lastName'),
  email,
  password,
  note: z.string().trim().max(120, 'register.errors.note').optional().transform((v) => v || null),
  consent,
})

/** Neue Organisation anlegen (nur ORG_SIGNUP=true) */
export const orgSignupSchema = z.object({
  orgName: z.string().trim().min(2, 'register.errors.orgName').max(120, 'register.errors.orgName'),
  firstName: name('register.errors.firstName'),
  lastName: name('register.errors.lastName'),
  email,
  password,
  consent,
})

/** Formular → Objekt (nur Textfelder) */
export const formObject = (form: FormData) => Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string')) as Record<string, string>
