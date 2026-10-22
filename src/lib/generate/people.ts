/**
 * Zufällige Personen für die Erstbefüllung einer Organisation (INIT_STAFF, INIT_RESIDENTS).
 * Rein (ohne Datenbank), damit testbar. Es entstehen nur Stammdaten – keine klinischen Daten.
 * Deterministisch nur mit Seed (INIT_SEED), sonst zufällig.
 */
import { ELDER_FIRST, LAST_NAMES, STAFF_FIRST, type Sex } from './names'

export type Rng = () => number

/** Zufallsquelle: mit Seed reproduzierbar (mulberry32 über einen FNV-1a-Hash), ohne Seed Math.random. */
export function makeRng(seed?: string | null): Rng {
  if (!seed) return Math.random
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193)
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const randInt = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1))
export const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)]

function weighted<T>(rng: Rng, items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((s, [, w]) => s + w, 0)
  let r = rng() * total
  for (const [v, w] of items) if ((r -= w) < 0) return v
  return items[items.length - 1][0]
}

const DAY = 86400_000

/** Kalendertag zwischen from und to (beide eingeschlossen), lokale Mitternacht – unabhängig von Sommerzeit. */
function randomDate(rng: Rng, from: Date, to: Date) {
  const days = Math.round((Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / DAY)
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + randInt(rng, 0, Math.max(0, days)))
}

/** Eindeutige Namenskombination ziehen; nach vielen Versuchen (Pools erschöpft) wird eine Wiederholung zugelassen. */
function uniqueName(rng: Rng, first: readonly string[], seen: Set<string>) {
  let f = '', l = ''
  for (let i = 0; i < 200; i++) {
    f = pick(rng, first)
    l = pick(rng, LAST_NAMES)
    if (!seen.has(f + ' ' + l)) break
  }
  seen.add(f + ' ' + l)
  return { firstName: f, lastName: l }
}

/** Zimmernummer: Wohngruppe 1 → 101, 102 …; ab 100 Zimmern je Wohngruppe dreistellig (1001 …). */
export function roomNumber(unitIndex: number, roomIndex: number, perUnit: number) {
  return String(unitIndex + 1) + String(roomIndex + 1).padStart(perUnit > 99 ? 3 : 2, '0')
}

/** Pflegestufen 1–12 (BESA/RAI), Schwerpunkt in der Mitte. */
const CARE_LEVELS = [[1, 2], [2, 4], [3, 6], [4, 8], [5, 10], [6, 10], [7, 10], [8, 9], [9, 8], [10, 6], [11, 4], [12, 3]] as const

export type GenResident = {
  firstName: string
  lastName: string
  sex: Sex
  /** lokale Mitternacht */
  birthDate: Date
  admittedAt: Date
  careLevel: number
  unitIndex: number
  room: string
}

/**
 * n Bewohnende, gleichmässig auf `units` Wohngruppen verteilt, je ein Einzelzimmer.
 * Geburtsdatum 1925–1952, Eintritt in den letzten fünf Jahren (vor `today`).
 */
export function generateResidents(n: number, opts: { units: number; rng: Rng; today?: Date }): GenResident[] {
  const { rng } = opts
  const units = Math.max(1, opts.units)
  const today = opts.today ?? new Date()
  const perUnit = Math.ceil(n / units)
  const seen = new Set<string>()
  const used = new Array(units).fill(0)
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  const fiveYears = new Date(today.getFullYear() - 5, today.getMonth(), today.getDate())
  const out: GenResident[] = []
  for (let i = 0; i < n; i++) {
    const sex: Sex = rng() < 0.68 ? 'f' : 'm'
    const unitIndex = i % units
    const roomIndex = used[unitIndex]++
    const admitted = randomDate(rng, fiveYears, yesterday)
    admitted.setHours(randInt(rng, 9, 16), pick(rng, [0, 15, 30, 45]))
    out.push({
      ...uniqueName(rng, ELDER_FIRST[sex], seen),
      sex,
      birthDate: randomDate(rng, new Date(1925, 0, 1), new Date(1952, 11, 31)),
      admittedAt: admitted,
      careLevel: weighted(rng, CARE_LEVELS),
      unitIndex,
      room: roomNumber(unitIndex, roomIndex, perUnit),
    })
  }
  return out
}

export type StaffKind = 'director' | 'lead' | 'rn' | 'fage' | 'aide'

/** Rolle (DEFAULT_ROLES) je Art */
export const STAFF_ROLE: Record<StaffKind, string> = { director: 'nursing_director', lead: 'ward_lead', rn: 'nurse', fage: 'nurse', aide: 'care_assistant' }

const STAFF_TITLE: Record<StaffKind, Record<Sex, string>> = {
  director: { f: 'Pflegedienstleiterin', m: 'Pflegedienstleiter' },
  lead: { f: 'Stationsleiterin', m: 'Stationsleiter' },
  rn: { f: 'Pflegefachfrau HF', m: 'Pflegefachmann HF' },
  fage: { f: 'Fachfrau Gesundheit EFZ', m: 'Fachmann Gesundheit EFZ' },
  aide: { f: 'Pflegehelferin SRK', m: 'Pflegehelfer SRK' },
}

/**
 * Rollen-Mix für n Mitarbeitende: 1 Pflegedienstleitung, je Wohngruppe eine Stationsleitung, soweit auf jede
 * Leitung mindestens zwei weitere Personen kommen; der Rest etwa 40 % Pflegefachpersonen HF, 30 % FaGe, 30 % Pflegehilfe.
 * Fachpersonen werden zuerst reihum verteilt, damit jede Wohngruppe eine Fachperson hat.
 * Beispiel 15 Personen, 4 Wohngruppen: 1 PDL, 4 Stationsleitungen, 4 HF, 3 FaGe, 3 Pflegehilfe.
 */
export function planStaff(n: number, units: number): { kind: StaffKind; unitIndex: number }[] {
  const out: { kind: StaffKind; unitIndex: number }[] = []
  if (n <= 0) return out
  const u = Math.max(1, units)
  out.push({ kind: 'director', unitIndex: 0 })
  const leads = Math.min(u, Math.floor((n - 1) / 3))
  for (let i = 0; i < leads; i++) out.push({ kind: 'lead', unitIndex: i })
  const rest = n - 1 - leads
  const rn = Math.round(rest * 0.4)
  const fage = Math.round(rest * 0.3)
  const kinds: StaffKind[] = [...Array<StaffKind>(rn).fill('rn'), ...Array<StaffKind>(fage).fill('fage'), ...Array<StaffKind>(rest - rn - fage).fill('aide')]
  kinds.forEach((kind, i) => out.push({ kind, unitIndex: i % u }))
  return out
}

/** E-Mail-Teil aus einem Namen: Kleinbuchstaben, Umlaute ausgeschrieben, Akzente entfernt. */
export function mailPart(s: string) {
  return s.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** Kürzel: Initialen, bei Kollision zweiter Buchstabe des Nachnamens, dann Ziffer. */
export function uniqueInitials(first: string, last: string, taken: Set<string>) {
  const f = (first[0] ?? 'X').toUpperCase()
  const l = (last[0] ?? 'X').toUpperCase()
  const candidates = [f + l, f + l + (last[1] ?? '').toUpperCase()]
  for (let i = 2; i < 100; i++) candidates.push(f + l + i)
  const c = candidates.find((x) => x.length >= 2 && !taken.has(x)) ?? f + l
  taken.add(c)
  return c
}

export type GenStaff = {
  firstName: string
  lastName: string
  sex: Sex
  email: string
  initials: string
  jobTitle: string
  role: string
  kind: StaffKind
  unitIndex: number
}

/** n Mitarbeitende nach planStaff, E-Mail vorname.nachname@domain (eindeutig, auch gegenüber `takenEmails`). */
export function generateStaff(n: number, opts: { units: number; rng: Rng; domain: string; takenEmails?: Iterable<string>; takenInitials?: Iterable<string> }): GenStaff[] {
  const { rng } = opts
  const seen = new Set<string>()
  const emails = new Set([...(opts.takenEmails ?? [])].map((e) => e.toLowerCase()))
  const initials = new Set(opts.takenInitials ?? [])
  return planStaff(n, opts.units).map(({ kind, unitIndex }) => {
    const sex: Sex = rng() < 0.82 ? 'f' : 'm'
    const name = uniqueName(rng, STAFF_FIRST[sex], seen)
    const base = `${mailPart(name.firstName)}.${mailPart(name.lastName)}`
    let email = `${base}@${opts.domain}`
    for (let i = 2; emails.has(email); i++) email = `${base}${i}@${opts.domain}`
    emails.add(email)
    return { ...name, sex, email, initials: uniqueInitials(name.firstName, name.lastName, initials), jobTitle: STAFF_TITLE[kind][sex], role: STAFF_ROLE[kind], kind, unitIndex }
  })
}
