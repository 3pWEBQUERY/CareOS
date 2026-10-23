/**
 * FHIR R4 schreibend (PRD §41): Vitalparameter-Observation → CareOS-Messung. Reine Prüfung ohne Datenbank,
 * damit Fehler verständlich (OperationOutcome) und testbar sind. Unterstützt Einzelwerte mit LOINC-Code und
 * das Blutdruck-Panel 85354-9 (Komponenten 8480-6/8462-4). Einheiten nach UCUM; Blutzucker in mg/dL wird umgerechnet.
 */
import { VITALS, type VitalKey } from '@/lib/vitals'

export const LOINC_WRITE: Partial<Record<VitalKey, { code: string; ucum: string[] }>> = {
  sys: { code: '8480-6', ucum: ['mm[Hg]', 'mmHg'] },
  dia: { code: '8462-4', ucum: ['mm[Hg]', 'mmHg'] },
  pulse: { code: '8867-4', ucum: ['/min', '{beats}/min'] },
  temp: { code: '8310-5', ucum: ['Cel', '°C'] },
  spo2: { code: '59408-5', ucum: ['%'] },
  glucose: { code: '2339-0', ucum: ['mmol/L', 'mmol/l', 'mg/dL'] },
  weight: { code: '29463-7', ucum: ['kg'] },
  respRate: { code: '9279-1', ucum: ['/min', '{breaths}/min'] },
  pain: { code: '72514-3', ucum: ['{score}', '1', ''] },
}
const BP_PANEL = '85354-9'
const ACCEPTED_STATUS = ['final', 'amended', 'corrected']

type Coding = { system?: string; code?: string }
type Quantity = { value?: unknown; unit?: string; code?: string; system?: string }
type Obs = {
  resourceType?: string; status?: string; subject?: { reference?: string }; effectiveDateTime?: string
  code?: { coding?: Coding[] }; valueQuantity?: Quantity; component?: { code?: { coding?: Coding[] }; valueQuantity?: Quantity }[]; note?: { text?: string }[]
}

export type ParsedVital = { residentId: string; at: Date; values: Partial<Record<VitalKey, number>>; note: string | null }

const loinc = (c?: { coding?: Coding[] }) => c?.coding?.find((x) => !x.system || x.system === 'http://loinc.org')?.code ?? null
const keyOf = (code: string | null) => (Object.keys(LOINC_WRITE) as VitalKey[]).find((k) => LOINC_WRITE[k]!.code === code) ?? null

function value(key: VitalKey, q: Quantity | undefined): number | string {
  if (!q || typeof q.value !== 'number' || !Number.isFinite(q.value)) return `${key}: valueQuantity.value required`
  const unit = q.code ?? q.unit ?? ''
  if (!LOINC_WRITE[key]!.ucum.includes(unit)) return `${key}: unit "${unit}" not supported (expected ${LOINC_WRITE[key]!.ucum.filter(Boolean).join(', ')})`
  let v = q.value
  if (key === 'glucose' && unit === 'mg/dL') v = v / 18.016
  const p = VITALS[key]
  v = p.dec ? Number(v.toFixed(p.dec)) : Math.round(v)
  if (v < p.min || v > p.max) return `${key}: ${v} ${p.unit} outside plausible range ${p.min}–${p.max}`
  return v
}

export function parseFhirVital(raw: unknown, now = new Date()): ParsedVital | { error: string } {
  const o = (raw ?? {}) as Obs
  if (o.resourceType !== 'Observation') return { error: 'resourceType must be Observation' }
  if (!o.status || !ACCEPTED_STATUS.includes(o.status)) return { error: 'status must be final, amended or corrected' }
  const m = /^Patient\/([\w-]+)$/.exec(o.subject?.reference ?? '')
  if (!m) return { error: 'subject.reference must be Patient/{id}' }
  if (!o.effectiveDateTime) return { error: 'effectiveDateTime required' }
  const at = new Date(o.effectiveDateTime)
  if (Number.isNaN(at.getTime()) || !/[zZ]|[+-]\d{2}:\d{2}$/.test(o.effectiveDateTime)) return { error: 'effectiveDateTime must be ISO 8601 with time zone' }
  if (at.getTime() > now.getTime() + 5 * 60_000) return { error: 'effectiveDateTime must not be in the future' }
  const values: Partial<Record<VitalKey, number>> = {}
  const code = loinc(o.code)
  if (code === BP_PANEL) {
    for (const c of o.component ?? []) {
      const k = keyOf(loinc(c.code))
      if (k !== 'sys' && k !== 'dia') continue
      const v = value(k, c.valueQuantity)
      if (typeof v === 'string') return { error: v }
      values[k] = v
    }
    if (values.sys == null || values.dia == null) return { error: 'blood pressure panel needs components 8480-6 and 8462-4' }
    if (values.dia >= values.sys) return { error: 'diastolic must be lower than systolic' }
  } else {
    const k = keyOf(code)
    if (!k) return { error: `code ${code ?? '(none)'} not supported` }
    if (k === 'sys' || k === 'dia') return { error: 'blood pressure must be sent as panel 85354-9 with both components' }
    const v = value(k, o.valueQuantity)
    if (typeof v === 'string') return { error: v }
    values[k] = v
  }
  const note = (o.note ?? []).map((n) => n.text?.trim()).filter(Boolean).join(' ').slice(0, 500) || null
  return { residentId: m[1], at, values, note }
}

type Allergy = {
  resourceType?: string; patient?: { reference?: string }
  code?: { text?: string; coding?: { system?: string; code?: string; display?: string }[] }
  clinicalStatus?: { coding?: Coding[] }; verificationStatus?: { coding?: Coding[] }
}
export type ParsedAllergy = { residentId: string; text: string }

/**
 * FHIR R4 AllergyIntolerance schreibend (PRD §41), z. B. Austrittsbericht des Spitals: neue, aktive Allergie als
 * Eintrag in den Allergien der Person (Freitext wie in der App). Inaktive/erledigte oder als Fehler markierte
 * Einträge werden abgewiesen – Entfernen bleibt eine bewusste Entscheidung in der Akte.
 */
export function parseFhirAllergy(raw: unknown): ParsedAllergy | { error: string } {
  const o = (raw ?? {}) as Allergy
  if (o.resourceType !== 'AllergyIntolerance') return { error: 'resourceType must be AllergyIntolerance' }
  const m = /^Patient\/([\w-]+)$/.exec(o.patient?.reference ?? '')
  if (!m) return { error: 'patient.reference must be Patient/{id}' }
  const clinical = o.clinicalStatus?.coding?.[0]?.code
  if (clinical && clinical !== 'active') return { error: 'only clinicalStatus active is supported; remove allergies in the record' }
  const verification = o.verificationStatus?.coding?.[0]?.code
  if (verification === 'entered-in-error' || verification === 'refuted') return { error: `verificationStatus ${verification} is not supported` }
  const text = (o.code?.text || o.code?.coding?.find((c) => c.display)?.display || '').replace(/[\r\n]+/g, ' ').trim()
  if (!text) return { error: 'code.text or code.coding.display required' }
  if (text.length > 80) return { error: 'allergy text longer than 80 characters' }
  return { residentId: m[1], text }
}
