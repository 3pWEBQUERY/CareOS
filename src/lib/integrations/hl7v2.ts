/**
 * HL7 v2 ADT-Empfang (PRD §41, §40 Patientenadministration aus Klinik-/Heim-Informationssystemen).
 * Rein, ohne Datenbank – Parser, Zuordnung zum ADT-Vorgang (src/lib/adt.ts) und Quittung (ACK). Die Ausführung
 * mit Zuordnung zu Personen, Bereichen und Zimmern erfolgt in POST /api/v1/hl7.
 *
 * Unterstützte Ereignisse: A01 Eintritt, A02 Verlegung, A03 Austritt, A21 Beurlaubung (Abwesenheit), A22 Rückkehr.
 * Felder: MSH-9 Nachrichtentyp, MSH-10 Kontroll-ID, EVN-2/EVN-6 Zeitpunkt, PID-3 Identifikatoren (AHV-Nr. als
 * Versichertennummer: Typ «SS» oder OID 2.16.756.5.32), PID-5 Name, PID-7 Geburtsdatum, PID-8 Geschlecht,
 * PID-19 (ältere Versionen: Sozialversicherungsnummer), PID-30 verstorben, PV1-3 Ort (Bereich^Zimmer^Bett),
 * PV1-36 Austrittsart (20 = verstorben), PV1-44/45 Ein-/Austrittszeit. Keine Gesundheitsdaten im Protokoll.
 */
export const HL7_EVENTS = ['A01', 'A02', 'A03', 'A21', 'A22'] as const
export type Hl7Event = (typeof HL7_EVENTS)[number]

export type Hl7Message = {
  segments: string[][]
  enc: { field: string; comp: string; rep: string; esc: string; sub: string }
  get: (seg: string, field: number, comp?: number, rep?: number) => string
}

/** Escape-Sequenzen \F\ \S\ \T\ \R\ \E\ auflösen. */
function unescape(v: string, enc: Hl7Message['enc']) {
  return v.replace(/\\([FSTRE])\\/g, (_, c: string) => ({ F: enc.field, S: enc.comp, T: enc.sub, R: enc.rep, E: enc.esc })[c] ?? '')
}

/** Nachricht in Segmente und Felder zerlegen (Segmenttrenner CR, auch LF/CRLF toleriert). */
export function parseHl7(text: string): Hl7Message {
  const raw = text.replace(/^﻿/, '').replace(/\r\n|\n/g, '\r').split('\r').map((s) => s.trim()).filter(Boolean)
  if (!raw.length || !raw[0].startsWith('MSH') || raw[0].length < 8) throw new Hl7Error('AR', 'no_msh')
  const fieldSep = raw[0][3]
  const encChars = raw[0].slice(4, 8)
  const enc = { field: fieldSep, comp: encChars[0] ?? '^', rep: encChars[1] ?? '~', esc: encChars[2] ?? '\\', sub: encChars[3] ?? '&' }
  const segments = raw.map((line) => {
    const parts = line.split(fieldSep)
    // MSH-1 ist das Trennzeichen selbst: Felder so verschieben, dass MSH-n = parts[n]
    return parts[0] === 'MSH' ? ['MSH', fieldSep, ...parts.slice(1)] : parts
  })
  const get = (seg: string, field: number, comp = 1, rep = 1) => {
    const s = segments.find((x) => x[0] === seg)
    const f = s?.[field] ?? ''
    if (seg === 'MSH' && field <= 2) return f
    const r = f.split(enc.rep)[rep - 1] ?? ''
    return unescape(r.split(enc.comp)[comp - 1] ?? '', enc).trim()
  }
  return { segments, enc, get }
}

export class Hl7Error extends Error {
  constructor(public ack: 'AE' | 'AR', public code: string) { super(code) }
}

/** HL7-Zeitstempel YYYYMMDD[HHMM[SS]][+/-ZZZZ] → Date (ohne Zone: Europe/Zurich, wie die Serverzeit). */
export function parseHl7Time(v: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(?:(\d{2})(?:\.\d+)?)?)?([+-]\d{4})?$/.exec(v.trim())
  if (!m) return null
  const [y, mo, d, h = '00', mi = '00', s = '00', tz] = m.slice(1)
  if (tz) {
    const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${tz.slice(0, 3)}:${tz.slice(3)}`
    const date = new Date(iso)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  return Number.isNaN(date.getTime()) || date.getMonth() !== Number(mo) - 1 ? null : date
}

const pad = (n: number) => String(n).padStart(2, '0')
export const hl7Now = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

export type AdtIntent = {
  event: Hl7Event
  controlId: string
  at: Date | null
  person: { insuranceNo: string | null; ids: string[]; lastName: string; firstName: string; birthDate: string | null; sex: 'f' | 'm' | 'd' | null; deceased: boolean }
  location: { unit: string; room: string }
  admittedAt: Date | null
  dischargedAt: Date | null
}

const AHV_OID = '2.16.756.5.32'

/** Nachricht in einen ADT-Vorgang übersetzen. Wirft Hl7Error (AR = nicht unterstützt, AE = inhaltlich fehlerhaft). */
export function toAdtIntent(msg: Hl7Message): AdtIntent {
  const type = msg.get('MSH', 9, 1)
  const trigger = msg.get('MSH', 9, 2) || msg.get('EVN', 1)
  if (type !== 'ADT') throw new Hl7Error('AR', 'unsupported_type')
  if (!(HL7_EVENTS as readonly string[]).includes(trigger)) throw new Hl7Error('AR', 'unsupported_event')
  if (!msg.segments.some((s) => s[0] === 'PID')) throw new Hl7Error('AE', 'no_pid')
  const pidSeg = msg.segments.find((s) => s[0] === 'PID')!
  const ids: string[] = []
  let insuranceNo: string | null = null
  for (const rep of (pidSeg[3] ?? '').split(msg.enc.rep)) {
    const c = rep.split(msg.enc.comp)
    const id = (c[0] ?? '').trim()
    if (!id) continue
    ids.push(id)
    const authority = (c[3] ?? '').split(msg.enc.sub)
    if ((c[4] ?? '').trim() === 'SS' || authority.includes(AHV_OID)) insuranceNo = id
  }
  insuranceNo ??= msg.get('PID', 19) || null
  const sexRaw = msg.get('PID', 8).toUpperCase()
  const birth = parseHl7Time(msg.get('PID', 7))
  const person = {
    insuranceNo, ids,
    lastName: msg.get('PID', 5, 1), firstName: msg.get('PID', 5, 2),
    birthDate: birth ? `${birth.getFullYear()}-${pad(birth.getMonth() + 1)}-${pad(birth.getDate())}` : null,
    sex: sexRaw === 'F' ? 'f' as const : sexRaw === 'M' ? 'm' as const : sexRaw === 'O' || sexRaw === 'X' ? 'd' as const : null,
    deceased: msg.get('PID', 30).toUpperCase() === 'Y' || msg.get('PV1', 36) === '20',
  }
  if (!person.lastName || !person.firstName) throw new Hl7Error('AE', 'pid_name')
  const at = parseHl7Time(msg.get('EVN', 6)) ?? parseHl7Time(msg.get('EVN', 2))
  return {
    event: trigger as Hl7Event,
    controlId: msg.get('MSH', 10),
    at,
    person,
    location: { unit: msg.get('PV1', 3, 1), room: msg.get('PV1', 3, 2) },
    admittedAt: parseHl7Time(msg.get('PV1', 44)),
    dischargedAt: parseHl7Time(msg.get('PV1', 45)),
  }
}

/** Quittung (ACK) mit MSA-1 AA/AE/AR und Bezug auf MSH-10; Absender/Empfänger vertauscht. */
export function buildAck(msg: Hl7Message | null, code: 'AA' | 'AE' | 'AR', text = '', now = new Date()) {
  const f = msg?.enc.field ?? '|'
  const encChars = msg ? msg.segments[0][2] : '^~\\&'
  const g = (field: number) => (msg ? (msg.segments[0][field] ?? '') : '')
  const trigger = msg ? msg.get('MSH', 9, 2) : ''
  const version = g(12) || '2.5'
  const control = 'ACK' + hl7Now(now) + Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  const clean = (s: string) => s.replace(/[\r\n|^~\\&]/g, ' ').slice(0, 80)
  return [
    ['MSH', encChars, g(5) || 'CAREOS', g(6), g(3), g(4), hl7Now(now), '', `ACK^${trigger}^ACK`, control, g(11) || 'P', version].join(f),
    ['MSA', code, msg ? msg.get('MSH', 10) : '', clean(text)].join(f),
  ].join('\r') + '\r'
}
