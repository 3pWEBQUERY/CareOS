import 'server-only'
import { NextResponse } from 'next/server'
import type { Medication, Resident, VitalSign } from '@prisma/client'
import { dateKey, fromDbDate } from '@/lib/time'
import { VITALS } from '@/lib/vitals'

/** HL7 FHIR R4 (nur lesend). Abbildung der CareOS-Daten auf Ressourcen (PRD §41). */
export const FHIR_CT = 'application/fhir+json; charset=utf-8'
export const SYS = {
  resident: 'urn:careos:resident',
  insurance: 'urn:careos:insurance-number',
  medication: 'urn:careos:medication',
  vital: 'urn:careos:vital',
}

export const fhirJson = (body: unknown, status = 200) => new NextResponse(JSON.stringify(body), { status, headers: { 'content-type': FHIR_CT, 'cache-control': 'private, no-store' } })
export const fhirBase = (req: Request) => new URL(req.url).origin + '/api/fhir'

export function bundle(req: Request, resources: { resourceType: string; id: string }[], total: number) {
  const base = fhirBase(req)
  return {
    resourceType: 'Bundle',
    type: 'searchset',
    total,
    link: [{ relation: 'self', url: req.url }],
    entry: resources.map((r) => ({ fullUrl: `${base}/${r.resourceType}/${r.id}`, resource: r, search: { mode: 'match' } })),
  }
}

const gender = (sex: string | null) => (sex === 'f' || sex === 'w' ? 'female' : sex === 'm' ? 'male' : sex ? 'other' : 'unknown')

export function patient(r: Resident & { unit?: { name: string } | null }, orgName: string) {
  return {
    resourceType: 'Patient',
    id: r.id,
    meta: { lastUpdated: r.createdAt.toISOString() },
    identifier: [
      { use: 'usual', system: SYS.resident, value: r.id },
      ...(r.insuranceNo ? [{ use: 'secondary', system: SYS.insurance, value: r.insuranceNo }] : []),
    ],
    active: r.status === 'active' || r.status === 'absent',
    name: [{ use: 'official', family: r.lastName, given: [r.firstName], text: `${r.firstName} ${r.lastName}` }],
    gender: gender(r.sex),
    birthDate: dateKey(fromDbDate(r.birthDate)),
    ...(r.status === 'deceased' ? { deceasedBoolean: true } : {}),
    managingOrganization: { display: orgName },
    ...(r.unit ? { extension: [{ url: 'urn:careos:unit', valueString: r.unit.name }] } : {}),
  }
}

/** LOINC-Codes der Vitalparameter (Vital Signs Profile). */
export const LOINC: Partial<Record<keyof typeof VITALS, { code: string; display: string; unit: string; ucum: string }>> = {
  sys: { code: '8480-6', display: 'Systolic blood pressure', unit: 'mmHg', ucum: 'mm[Hg]' },
  dia: { code: '8462-4', display: 'Diastolic blood pressure', unit: 'mmHg', ucum: 'mm[Hg]' },
  pulse: { code: '8867-4', display: 'Heart rate', unit: '/min', ucum: '/min' },
  temp: { code: '8310-5', display: 'Body temperature', unit: '°C', ucum: 'Cel' },
  spo2: { code: '59408-5', display: 'Oxygen saturation in Arterial blood by Pulse oximetry', unit: '%', ucum: '%' },
  glucose: { code: '2339-0', display: 'Glucose [Mass/volume] in Blood', unit: 'mmol/l', ucum: 'mmol/L' },
  weight: { code: '29463-7', display: 'Body weight', unit: 'kg', ucum: 'kg' },
  respRate: { code: '9279-1', display: 'Respiratory rate', unit: '/min', ucum: '/min' },
  pain: { code: '72514-3', display: 'Pain severity - 0-10 verbal numeric rating [Score] - Reported', unit: 'NRS', ucum: '{score}' },
}
export const LOINC_KEYS = Object.keys(LOINC) as (keyof typeof LOINC)[]
export const keyForLoinc = (code: string) => LOINC_KEYS.find((k) => LOINC[k]!.code === code)

/** Eine Messung kann mehrere Werte enthalten; jeder Wert wird eine Observation mit der ID "<messung>-<parameter>". */
export function vitalObservations(v: VitalSign, only?: (keyof typeof LOINC)[]) {
  const out: Record<string, unknown>[] = []
  for (const k of only ?? LOINC_KEYS) {
    const val = v[k as keyof VitalSign] as number | null
    const l = LOINC[k]
    if (val == null || !l) continue
    out.push({
      resourceType: 'Observation',
      id: `${v.id}-${k}`,
      meta: { profile: ['http://hl7.org/fhir/StructureDefinition/vitalsigns'] },
      // Storno/Korrektur (PRD §35): stornierte Messungen als «entered-in-error», Korrekturen als «corrected»
      status: v.voidedAt ? 'entered-in-error' : v.supersedesId ? 'corrected' : 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs', display: 'Vital Signs' }] }],
      code: { coding: [{ system: 'http://loinc.org', code: l.code, display: l.display }], text: l.display },
      subject: { reference: `Patient/${v.residentId}` },
      effectiveDateTime: v.at.toISOString(),
      valueQuantity: { value: val, unit: l.unit, system: 'http://unitsofmeasure.org', code: l.ucum },
      ...(v.note ? { note: [{ text: v.note }] } : {}),
    })
  }
  return out as { resourceType: string; id: string }[]
}

export function medicationStatement(m: Medication) {
  const now = new Date()
  const status = !m.active || m.stoppedAt ? 'stopped' : m.endDate && m.endDate < now ? 'completed' : 'active'
  const schedule = m.kind === 'prn'
    ? [{ text: `${m.prnDose ?? ''} PRN${m.prnMaxPerDay ? `, max ${m.prnMaxPerDay}/d` : ''}${m.prnMinIntervalH ? `, min interval ${m.prnMinIntervalH} h` : ''}`.trim(), asNeededBoolean: true, route: { text: m.route } }]
    : m.times.map((time, i) => ({ text: `${time}: ${m.doses[i] ?? ''}`.trim(), timing: { repeat: { timeOfDay: [time.length === 5 ? time + ':00' : time] } }, route: { text: m.route } }))
  return {
    resourceType: 'MedicationStatement',
    id: m.id,
    status,
    category: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/medication-statement-category', code: 'inpatient' }] },
    medicationCodeableConcept: { text: [m.name, m.form].filter(Boolean).join(' ') },
    subject: { reference: `Patient/${m.residentId}` },
    effectivePeriod: { start: m.startDate.toISOString(), ...(m.stoppedAt ? { end: m.stoppedAt.toISOString() } : m.endDate ? { end: m.endDate.toISOString() } : {}) },
    dateAsserted: m.createdAt.toISOString(),
    ...(m.indication ? { reasonCode: [{ text: m.indication }] } : {}),
    ...(m.prescriber ? { informationSource: { display: m.prescriber } } : {}),
    ...(m.notes ? { note: [{ text: m.notes }] } : {}),
    dosage: schedule,
  }
}

/** Allergien sind in CareOS Freitext-Einträge; jeder wird eine AllergyIntolerance mit ID "<bewohner>-<index>". */
export function allergies(r: Resident) {
  return r.allergies.map((text, i) => ({
    resourceType: 'AllergyIntolerance',
    id: `${r.id}-${i}`,
    clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }] },
    verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification', code: 'unconfirmed' }] },
    code: { text },
    patient: { reference: `Patient/${r.id}` },
  }))
}

/** "Patient/abc" oder "abc" → "abc" */
export const refId = (v: string | null) => (v ? v.replace(/^Patient\//, '').trim() : null)
