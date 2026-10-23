/**
 * Spitex (ambulante Pflege, PRD §60 Phase 6, §40 Abrechnung) – reine Logik ohne Datenbank (Server, Client, Tests).
 *
 * Ambulante Pflege nutzt dieselben Bausteine wie die Station: Bereich (Unit) mit `kind = 'homecare'` als Einsatzgebiet,
 * Person als «Klient/in» mit Einsatzort (Resident.street/postalCode/city, Zugang verschlüsselt in accessNote),
 * Einsätze (HomeCareVisit) mit Leistungen nach KLV (HomeCareService), Wochenvorlagen je Person (HomeCareTemplate),
 * aus denen die Einsätze je Tag idempotent erzeugt werden (src/lib/spitex-data.ts, wie ensureTasksForDay).
 * Durchführung mobil in «Meine Tour» mit der Offline-Outbox (src/lib/offline/), Leistungsnachweis je Person und Monat.
 */
import { z } from 'zod'
import type { TFn } from '@/i18n/core'
import { addDays, atTime, hm, startOfDay, toMin } from '@/lib/time'

export const isHomecare = (u: { kind?: string | null } | null | undefined) => u?.kind === 'homecare'

/**
 * Leistungen nach KLV Art. 7 Abs. 2 (Krankenpflege-Leistungsverordnung): a = Abklärung, Beratung und Koordination,
 * b = Untersuchung und Behandlung, c = Grundpflege. Schlüssel stabil, Anzeige über i18n `spitex.klv.*`.
 */
export const KLV_CATEGORIES = [
  { key: 'a', de: 'Abklärung, Beratung und Koordination' },
  { key: 'b', de: 'Untersuchung und Behandlung' },
  { key: 'c', de: 'Grundpflege' },
] as const
export type KlvCategory = (typeof KLV_CATEGORIES)[number]['key']
export const KLV_KEYS = KLV_CATEGORIES.map((k) => k.key) as KlvCategory[]
export const isKlv = (v: unknown): v is KlvCategory => typeof v === 'string' && (KLV_KEYS as string[]).includes(v)

/** Zuordnung der bestehenden Aufgabenkategorien (Pflegeplanung) zu KLV-Kategorien. */
export const KLV_BY_TASK_CATEGORY: Record<string, KlvCategory> = {
  Grundpflege: 'c', Ernährung: 'c', Mobilität: 'c', Aktivierung: 'c',
  Behandlungspflege: 'b', Medikation: 'b', Überwachung: 'b',
  Assessment: 'a', Planung: 'a', Organisation: 'a',
}
export const klvOf = (category: string): KlvCategory | null => KLV_BY_TASK_CATEGORY[category] ?? null

/**
 * Häufige Leistungen als Vorschläge beim Planen (Bezeichnung über i18n `spitex.presets.<key>`, frei änderbar).
 * Kompressionsstrümpfe anlegen und Beine einbinden gehören nach KLV zur Grundpflege (c).
 */
export const SERVICE_PRESETS: { key: string; klv: KlvCategory; minutes: number }[] = [
  { key: 'assessment', klv: 'a', minutes: 45 },
  { key: 'counselling', klv: 'a', minutes: 15 },
  { key: 'coordination', klv: 'a', minutes: 10 },
  { key: 'vitals', klv: 'b', minutes: 10 },
  { key: 'medication', klv: 'b', minutes: 10 },
  { key: 'injection', klv: 'b', minutes: 10 },
  { key: 'wound', klv: 'b', minutes: 20 },
  { key: 'hygiene', klv: 'c', minutes: 30 },
  { key: 'shower', klv: 'c', minutes: 40 },
  { key: 'dressing', klv: 'c', minutes: 10 },
  { key: 'compression', klv: 'c', minutes: 10 },
  { key: 'mobility', klv: 'c', minutes: 15 },
]

export const VISIT_STATUSES = ['planned', 'started', 'done', 'missed', 'cancelled'] as const
export type VisitStatus = (typeof VISIT_STATUSES)[number]
/** Abgeschlossen: keine Änderung mehr in der Tour. */
export const isClosedVisit = (s: string) => s === 'done' || s === 'missed' || s === 'cancelled'
/** Zählt für Tourplanung und Überschneidungen (abgesagte und nicht angetroffene nicht). */
export const isLiveVisit = (s: string) => s === 'planned' || s === 'started' || s === 'done'

/** Planbarer Zeitraum: bis 4 Wochen im Voraus, rückwirkend nur heute. */
export const PLAN_AHEAD_DAYS = 28

// ───────── Validierung ─────────

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
export const MAX_SERVICES = 12

export const serviceSchema = z.object({
  klv: z.enum(['a', 'b', 'c'], { message: 'spitex.errors.klv' }),
  label: z.string().trim().min(2, 'spitex.errors.serviceLabel').max(80, 'spitex.errors.serviceLabel'),
  minutes: z.coerce.number().int('spitex.errors.minutes').min(1, 'spitex.errors.minutes').max(240, 'spitex.errors.minutes'),
})
export type ServiceInput = z.infer<typeof serviceSchema>

const services = z.array(serviceSchema).min(1, 'spitex.errors.services').max(MAX_SERVICES, 'spitex.errors.services')

const timeWindow = { start: z.string().regex(TIME, 'spitex.errors.time'), end: z.string().regex(TIME, 'spitex.errors.time') }
const endAfterStart = (v: { start: string; end: string }) => toMin(v.end) > toMin(v.start)
const END_AFTER_START = { path: ['end'], message: 'spitex.errors.endBeforeStart' }

/** Einzelner Einsatz (Disposition). */
export const visitSchema = z.object({
  id: z.string().max(40),
  residentId: z.string().min(1, 'spitex.errors.client').max(40),
  date: z.string().regex(DATE, 'spitex.errors.date'),
  ...timeWindow,
  assigneeId: z.string().max(40),
  note: z.string().trim().max(500),
  services,
}).refine(endAfterStart, END_AFTER_START)

/** Wochenvorlage je Person. */
export const templateSchema = z.object({
  id: z.string().max(40),
  residentId: z.string().min(1, 'spitex.errors.client').max(40),
  weekdays: z.array(z.coerce.number().int().min(0).max(6)).min(1, 'spitex.errors.weekdays').max(7),
  ...timeWindow,
  preferredUserId: z.string().max(40),
  startDate: z.string().regex(DATE, 'spitex.errors.date'),
  endDate: z.string().refine((v) => !v || DATE.test(v), 'spitex.errors.date'),
  note: z.string().trim().max(500),
  services,
}).refine(endAfterStart, END_AFTER_START).refine((v) => !v.endDate || v.endDate >= v.startDate, { path: ['endDate'], message: 'spitex.errors.endDate' })

/** Einsatzort der Person. Zugang: leer = unverändert, `clearAccess` entfernt ihn. */
export const clientSchema = z.object({
  residentId: z.string().min(1).max(40),
  street: z.string().trim().max(120),
  postalCode: z.string().trim().max(10).refine((v) => !v || /^[0-9A-Za-z -]{3,10}$/.test(v), 'spitex.errors.postalCode'),
  city: z.string().trim().max(80),
  phone: z.string().trim().max(40).refine((v) => !v || /^[+0-9 ()/.-]{6,40}$/.test(v), 'spitex.errors.phone'),
  accessNote: z.string().trim().max(500),
  clearAccess: z.boolean(),
})

/** Leistungen aus Formularfeldern svc_klv / svc_label / svc_min (wiederholt, gleiche Reihenfolge). */
export function servicesFromForm(get: (k: string) => string[]): unknown[] {
  const klv = get('svc_klv')
  const label = get('svc_label')
  const min = get('svc_min')
  return klv.map((k, i) => ({ klv: k, label: label[i] ?? '', minutes: (min[i] ?? '').replace(',', '.') }))
}

/** Gespeicherte Leistungen einer Vorlage (Json) robust lesen; Ungültiges wird übergangen. */
export function parseServices(json: unknown): ServiceInput[] {
  if (!Array.isArray(json)) return []
  const out: ServiceInput[] = []
  for (const x of json) {
    const p = serviceSchema.safeParse(x)
    if (p.success) out.push(p.data)
  }
  return out.slice(0, MAX_SERVICES)
}

// ───────── Erzeugung aus Wochenvorlagen ─────────

export type TemplateLike = {
  id: string
  residentId: string
  weekdays: number[]
  start: string
  end: string
  services: unknown
  preferredUserId: string | null
  /** lokale Mitternacht (fromDbDate) */
  startDate: Date
  endDate: Date | null
  active: boolean
  /** Zeitfenster, die beim Anlegen/Ändern schon begonnen hatten, werden an diesem Tag nicht nachträglich erzeugt. */
  updatedAt?: Date
}

/** Fällt die Vorlage auf diesen Kalendertag? */
export function templateOccursOn(tpl: TemplateLike, day: Date): boolean {
  if (!tpl.active || !tpl.weekdays.includes(day.getDay())) return false
  const d = startOfDay(day)
  if (d < startOfDay(tpl.startDate)) return false
  if (tpl.endDate && d > startOfDay(tpl.endDate)) return false
  return true
}

export type GeneratedVisit = {
  templateId: string
  residentId: string
  plannedStart: Date
  plannedEnd: Date
  assigneeId: string | null
  services: ServiceInput[]
}

/**
 * Einsätze eines Tages aus den Wochenvorlagen. Idempotent: Vorlagen mit bereits erzeugtem Einsatz (`existing`, auch
 * abgesagt) werden übergangen. Nur aktive Personen (`activeResidents`; abwesend = z. B. Spitalaufenthalt → kein Einsatz).
 * Die bevorzugte Person wird zugewiesen, ausser sie ist an diesem Tag abwesend (`unavailable`) – dann bleibt der
 * Einsatz zur Disposition offen. Reihenfolge: nach Beginn.
 */
export function visitsForDay(templates: TemplateLike[], day: Date, opts: { existing: ReadonlySet<string>; activeResidents: ReadonlySet<string>; unavailable?: ReadonlySet<string> }): GeneratedVisit[] {
  const out: GeneratedVisit[] = []
  for (const tpl of templates) {
    if (opts.existing.has(tpl.id) || !opts.activeResidents.has(tpl.residentId) || !templateOccursOn(tpl, day)) continue
    const plannedStart = atTime(day, tpl.start)
    let plannedEnd = atTime(day, tpl.end)
    if (plannedEnd <= plannedStart) continue
    if (tpl.updatedAt && plannedStart < tpl.updatedAt) continue
    const svc = parseServices(tpl.services)
    if (!svc.length) continue
    if (plannedEnd > addDays(startOfDay(day), 1)) plannedEnd = addDays(startOfDay(day), 1)
    const assigneeId = tpl.preferredUserId && !opts.unavailable?.has(tpl.preferredUserId) ? tpl.preferredUserId : null
    out.push({ templateId: tpl.id, residentId: tpl.residentId, plannedStart, plannedEnd, assigneeId, services: svc })
  }
  return out.sort((a, b) => a.plannedStart.getTime() - b.plannedStart.getTime() || a.templateId.localeCompare(b.templateId))
}

/**
 * Tourposition neuer Einsätze: je Person hinter den bestehenden (höchste vorhandene Position + 1), in zeitlicher Folge.
 * Nicht zugewiesene Einsätze erhalten ebenfalls eine fortlaufende Position (Reihenfolge der offenen Liste).
 */
export function appendSequences<T extends { assigneeId: string | null }>(existing: { assigneeId: string | null; sequence: number }[], rows: T[]): (T & { sequence: number })[] {
  const next = new Map<string, number>()
  for (const e of existing) next.set(e.assigneeId ?? '', Math.max(next.get(e.assigneeId ?? '') ?? 0, e.sequence + 1))
  return rows.map((r) => {
    const k = r.assigneeId ?? ''
    const s = next.get(k) ?? 0
    next.set(k, s + 1)
    return { ...r, sequence: s }
  })
}

// ───────── Tour ─────────

type Ordered = { id: string; sequence: number; plannedStart: Date }

/** Reihenfolge der Tour: Position, bei Gleichstand nach geplantem Beginn. */
export function tourOrder<T extends Ordered>(visits: T[]): T[] {
  return [...visits].sort((a, b) => a.sequence - b.sequence || a.plannedStart.getTime() - b.plannedStart.getTime() || a.id.localeCompare(b.id))
}

/** Einsatz in der Tour um eine Position verschieben; Ergebnis: IDs in neuer Reihenfolge (Position = Index). */
export function moveInTour(ids: string[], id: string, dir: -1 | 1): string[] {
  const i = ids.indexOf(id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= ids.length) return ids
  const out = [...ids]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

// ───────── Überschneidungen und Konflikte ─────────

export type VisitTimes = { id: string; status: string; plannedStart: Date; plannedEnd: Date; actualStart?: Date | null; actualEnd?: Date | null }

/**
 * Massgebliches Zeitfenster eines Einsatzes: erfasste Zeiten, sobald vorhanden. Läuft der Einsatz noch, gilt die
 * geplante Dauer ab dem tatsächlichen Beginn.
 */
export function visitWindow(v: VisitTimes): { start: Date; end: Date } {
  const start = v.actualStart ?? v.plannedStart
  const dur = Math.max(0, v.plannedEnd.getTime() - v.plannedStart.getTime())
  const end = v.actualEnd ?? (v.actualStart ? new Date(v.actualStart.getTime() + dur) : v.plannedEnd)
  return { start, end: end > start ? end : start }
}

const overlaps = (a: { start: Date; end: Date }, b: { start: Date; end: Date }) => a.start < b.end && b.start < a.end

/** Paare überschneidender Einsätze einer Person (Berührung an den Grenzen zählt nicht). Abgesagte zählen nicht. */
export function overlappingVisits(visits: VisitTimes[]): Map<string, string[]> {
  const live = visits.filter((v) => isLiveVisit(v.status)).map((v) => ({ id: v.id, ...visitWindow(v) })).sort((a, b) => a.start.getTime() - b.start.getTime())
  const out = new Map<string, string[]>()
  const add = (a: string, b: string) => out.set(a, [...(out.get(a) ?? []), b])
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length && live[j].start < live[i].end; j++) {
      if (!overlaps(live[i], live[j])) continue
      add(live[i].id, live[j].id)
      add(live[j].id, live[i].id)
    }
  }
  return out
}

/** Belegung ausserhalb der Spitex: genehmigte Abwesenheit (ganzer Tag) oder Dienst auf einer Station. */
export type Busy = { kind: 'absence' | 'shift'; start: Date; end: Date; label: string }
export type Conflict = { kind: 'overlap'; with: string } | { kind: 'absence' | 'shift'; label: string }

/**
 * Hinweise je Einsatz einer Person: Überschneidung mit einem anderen Einsatz, genehmigte Abwesenheit oder Dienst auf
 * einer Station im selben Zeitraum. Nur Hinweise – die Disposition entscheidet. Erledigte Einsätze erhalten keine
 * Hinweise mehr (zählen aber als Belegung für die übrigen).
 */
export function visitConflicts(visits: VisitTimes[], busy: Busy[]): Map<string, Conflict[]> {
  const out = new Map<string, Conflict[]>()
  const done = new Set(visits.filter((v) => v.status === 'done').map((v) => v.id))
  for (const [id, others] of overlappingVisits(visits)) if (!done.has(id)) out.set(id, others.map((w) => ({ kind: 'overlap' as const, with: w })))
  for (const v of visits) {
    if (!isLiveVisit(v.status) || v.status === 'done') continue
    const w = visitWindow(v)
    for (const b of busy) if (overlaps(w, b)) out.set(v.id, [...(out.get(v.id) ?? []), { kind: b.kind, label: b.label }])
  }
  return out
}

/** Ganztägige Abwesenheit (von/bis als Kalendertage, beide eingeschlossen) als Belegung. */
export const absenceBusy = (from: Date, to: Date, label: string): Busy => ({ kind: 'absence', start: startOfDay(from), end: addDays(startOfDay(to), 1), label })

/** Dienst (Beginn am Kalendertag `day`, Nachtdienst über Mitternacht) als Belegung. */
export function shiftBusy(day: Date, start: string, end: string, label: string): Busy {
  const s = atTime(day, start)
  let e = atTime(day, end)
  if (e <= s) e = addDays(e, 1)
  return { kind: 'shift', start: s, end: e, label }
}

// ───────── Minuten je KLV-Kategorie ─────────

export type ServiceLike = { klv: string; plannedMin: number; actualMin: number | null; done: boolean }
export type KlvTotals = Record<KlvCategory, number> & { total: number; visits: number }

/** Erbrachte Minuten einer Leistung: erfasste Minuten, sonst geplante; nicht erbrachte zählen nicht. */
export const serviceMinutes = (s: ServiceLike) => (s.done ? Math.max(0, s.actualMin ?? s.plannedMin) : 0)

/** Minuten je KLV-Kategorie über abgeschlossene Einsätze (Status «done»); andere Status zählen nicht. */
export function klvTotals(visits: { status: string; services: ServiceLike[] }[]): KlvTotals {
  const out: KlvTotals = { a: 0, b: 0, c: 0, total: 0, visits: 0 }
  for (const v of visits) {
    if (v.status !== 'done') continue
    out.visits++
    for (const s of v.services) {
      if (!isKlv(s.klv)) continue
      const m = serviceMinutes(s)
      out[s.klv] += m
      out.total += m
    }
  }
  return out
}

/** Minuten als Stunden mit zwei Nachkommastellen (Abrechnung). */
export const hours = (min: number) => (min / 60).toFixed(2)

// ───────── Texte ─────────

/** Einsatzort einzeilig: «Lindenweg 12, 8000 Zürich». */
export function addressLine(r: { street?: string | null; postalCode?: string | null; city?: string | null }) {
  const place = [r.postalCode, r.city].filter(Boolean).join(' ')
  return [r.street, place].filter(Boolean).join(', ')
}

/** Externer Kartenlink (Suche nach der Adresse); null ohne Adresse. */
export function mapsHref(r: { street?: string | null; postalCode?: string | null; city?: string | null }) {
  const a = addressLine(r)
  return a ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(a) : null
}

/** Telefonlink (tel:) aus einer erfassten Nummer. */
export const telHref = (phone: string | null | undefined) => (phone ? 'tel:' + phone.replace(/[^+0-9]/g, '') : null)

/**
 * Verlaufseintrag zum abgeschlossenen Einsatz (Document Once): Zeitraum, erbrachte Leistungen mit KLV und Minuten,
 * nicht erbrachte Leistungen, Notiz.
 */
export function visitObservationText(t: TFn, v: { start: Date; end: Date; services: (ServiceLike & { label: string })[]; note?: string | null }) {
  const done = v.services.filter((s) => s.done)
  const open = v.services.filter((s) => !s.done)
  const parts = [t('spitex.obs.visit', { from: hm(v.start), to: hm(v.end) })]
  if (done.length) parts.push(t('spitex.obs.done', { list: done.map((s) => t('spitex.obs.item', { label: s.label, klv: s.klv, min: serviceMinutes(s) })).join(', ') }))
  if (open.length) parts.push(t('spitex.obs.open', { list: open.map((s) => s.label).join(', ') }))
  if (v.note?.trim()) parts.push(v.note.trim())
  return parts.join(' ')
}

// ───────── Leistungsnachweis (CSV) ─────────

export type ProofVisit = { date: Date; start: Date; end: Date; staff: string; services: (ServiceLike & { label: string })[] }

/** CSV-Zeilen des Leistungsnachweises einer Person: je Einsatz eine Zeile, am Ende die Summen je KLV-Kategorie. */
export function proofCsvRows(visits: ProofVisit[], h: { header: string[]; total: string; dateKey: (d: Date) => string }) {
  const rows: string[][] = [h.header]
  const sum = { a: 0, b: 0, c: 0 }
  for (const v of visits) {
    const m = { a: 0, b: 0, c: 0 }
    for (const s of v.services) if (isKlv(s.klv)) m[s.klv] += serviceMinutes(s)
    sum.a += m.a; sum.b += m.b; sum.c += m.c
    rows.push([
      h.dateKey(v.date), hm(v.start), hm(v.end), v.staff,
      v.services.filter((s) => s.done).map((s) => `${s.label} (${s.klv})`).join('; '),
      String(m.a), String(m.b), String(m.c), String(m.a + m.b + m.c),
    ])
  }
  rows.push([h.total, '', '', '', '', String(sum.a), String(sum.b), String(sum.c), String(sum.a + sum.b + sum.c)])
  return rows
}
