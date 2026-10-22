/**
 * Spalten und Prüfregeln der CSV-Importe (PRD §41): Bewohnende, Personal, Dienste.
 * Rein (ohne Datenbank) und testbar – Abgleich mit Stammdaten (Bereiche, Zimmer, Rollen, Personen) folgt in run.ts.
 *
 * Spaltennamen werden ohne Gross-/Kleinschreibung, Akzente und Satzzeichen verglichen und in allen
 * vier Sprachen erkannt. Die Vorlage verwendet jeweils den ersten Namen der Sprache der importierenden Person.
 */
import { headerKey } from './csv'

export const IMPORT_KINDS = ['residents', 'staff', 'shifts'] as const
export type ImportKind = (typeof IMPORT_KINDS)[number]
type Lang = 'de' | 'fr' | 'it' | 'en'

export type FieldType = 'text' | 'date' | 'email' | 'int' | 'list' | 'phone' | 'sex' | 'rea' | 'locale' | 'scope'
export type FieldSpec = {
  key: string
  type: FieldType
  required?: boolean
  /** maximale Länge (Text) */
  max?: number
  /** Ganzzahl-Bereich */
  range?: [number, number]
  /** Datum darf nicht in der Zukunft liegen (z. B. Geburtsdatum) */
  past?: boolean
  names: Record<Lang, string[]>
}

const n = (de: string[], fr: string[], it: string[], en: string[]) => ({ de, fr, it, en })

const LAST = n(['Nachname', 'Name', 'Familienname'], ['Nom', 'Nom de famille'], ['Cognome'], ['Last name', 'Surname', 'Family name'])
const FIRST = n(['Vorname'], ['Prénom'], ['Nome'], ['First name', 'Given name'])
const UNIT = n(['Bereich', 'Wohngruppe', 'Station', 'Abteilung'], ['Unité', 'Secteur'], ['Reparto', 'Unità'], ['Unit', 'Ward'])

export const SPECS: Record<ImportKind, FieldSpec[]> = {
  residents: [
    { key: 'lastName', type: 'text', required: true, max: 80, names: LAST },
    { key: 'firstName', type: 'text', required: true, max: 80, names: FIRST },
    { key: 'birthDate', type: 'date', required: true, past: true, names: n(['Geburtsdatum', 'Geburtstag'], ['Date de naissance'], ['Data di nascita'], ['Date of birth', 'Birth date', 'DOB']) },
    { key: 'sex', type: 'sex', names: n(['Geschlecht'], ['Sexe'], ['Sesso'], ['Sex', 'Gender']) },
    { key: 'unit', type: 'text', required: true, max: 80, names: UNIT },
    { key: 'room', type: 'text', max: 20, names: n(['Zimmer', 'Zimmernummer'], ['Chambre'], ['Camera', 'Stanza'], ['Room']) },
    { key: 'admittedAt', type: 'date', past: true, names: n(['Eintritt', 'Eintrittsdatum', 'Aufnahme'], ["Date d'entrée", 'Entrée', 'Admission'], ['Data di ammissione', 'Ammissione', 'Entrata'], ['Admission date', 'Admitted']) },
    { key: 'careLevel', type: 'int', range: [0, 12], names: n(['Pflegestufe', 'BESA', 'RAI'], ['Niveau de soins'], ['Livello di cura'], ['Care level']) },
    { key: 'insuranceNo', type: 'text', max: 40, names: n(['Versichertennummer', 'AHV-Nr', 'AHV'], ['Numéro AVS', 'AVS'], ['Numero AVS', 'AVS'], ['Insurance number', 'Insurance no', 'AHV number']) },
    { key: 'physician', type: 'text', max: 120, names: n(['Hausarzt', 'Hausärztin', 'Arzt'], ['Médecin traitant', 'Médecin'], ['Medico curante', 'Medico'], ['Physician', 'GP']) },
    { key: 'rea', type: 'rea', names: n(['REA', 'Reanimation'], ['Réanimation'], ['Rianimazione'], ['Resuscitation', 'CPR']) },
    { key: 'allergies', type: 'list', max: 120, names: n(['Allergien'], ['Allergies'], ['Allergie'], ['Allergies']) },
    { key: 'diet', type: 'text', max: 120, names: n(['Kostform', 'Diät'], ['Régime'], ['Dieta'], ['Diet']) },
    { key: 'mobility', type: 'text', max: 200, names: n(['Mobilität'], ['Mobilité'], ['Mobilità'], ['Mobility']) },
  ],
  staff: [
    { key: 'email', type: 'email', required: true, max: 160, names: n(['E-Mail', 'Mail'], ['E-mail', 'Courriel'], ['E-mail', 'Posta elettronica'], ['Email', 'E-mail']) },
    { key: 'lastName', type: 'text', required: true, max: 60, names: LAST },
    { key: 'firstName', type: 'text', required: true, max: 60, names: FIRST },
    { key: 'initials', type: 'text', max: 4, names: n(['Kürzel', 'Initialen', 'Visum'], ['Initiales', 'Visa'], ['Sigla', 'Iniziali'], ['Initials']) },
    { key: 'jobTitle', type: 'text', max: 80, names: n(['Funktion', 'Berufsbezeichnung'], ['Fonction'], ['Funzione'], ['Job title', 'Position', 'Function']) },
    { key: 'employeeNo', type: 'text', max: 30, names: n(['Personalnummer', 'Personal-Nr'], ['Matricule', 'Numéro du personnel'], ['Numero del personale', 'Matricola'], ['Employee number', 'Employee no', 'Staff number']) },
    { key: 'workPhone', type: 'phone', names: n(['Telefon dienstlich', 'Telefon geschäftlich', 'Geschäftstelefon'], ['Téléphone professionnel'], ['Telefono aziendale', 'Telefono di servizio'], ['Work phone', 'Business phone']) },
    { key: 'phone', type: 'phone', names: n(['Telefon privat', 'Mobile', 'Natel'], ['Téléphone privé', 'Portable'], ['Telefono privato', 'Cellulare'], ['Private phone', 'Mobile']) },
    { key: 'unit', type: 'text', max: 80, names: n(['Bereich', 'Stammbereich', 'Wohngruppe', 'Station'], ['Unité', 'Secteur'], ['Reparto', 'Unità'], ['Unit', 'Home unit', 'Ward']) },
    { key: 'role', type: 'text', max: 80, names: n(['Rolle'], ['Rôle'], ['Ruolo'], ['Role']) },
    { key: 'roleScope', type: 'scope', names: n(['Geltungsbereich', 'Rollenbereich'], ['Portée du rôle', 'Portée'], ['Ambito del ruolo', 'Ambito'], ['Role scope', 'Scope']) },
    { key: 'qualifications', type: 'list', max: 80, names: n(['Qualifikationen', 'Qualifikation'], ['Qualifications'], ['Qualifiche'], ['Qualifications']) },
    { key: 'locale', type: 'locale', names: n(['Sprache'], ['Langue'], ['Lingua'], ['Language']) },
  ],
  shifts: [
    { key: 'date', type: 'date', required: true, names: n(['Datum'], ['Date'], ['Data'], ['Date']) },
    { key: 'unit', type: 'text', required: true, max: 80, names: UNIT },
    { key: 'shift', type: 'text', required: true, max: 40, names: n(['Dienst', 'Schicht', 'Dienstcode'], ['Service', 'Horaire', 'Code'], ['Turno', 'Codice turno'], ['Shift', 'Shift code']) },
    { key: 'person', type: 'text', max: 160, names: n(['Person', 'Mitarbeiter/in', 'E-Mail', 'Personalnummer'], ['Personne', 'Collaborateur', 'E-mail', 'Matricule'], ['Persona', 'Collaboratore', 'E-mail', 'Matricola'], ['Person', 'Employee', 'Email', 'Employee number']) },
    { key: 'qualification', type: 'text', max: 80, names: n(['Qualifikation', 'Benötigte Qualifikation'], ['Qualification', 'Qualification requise'], ['Qualifica', 'Qualifica richiesta'], ['Qualification', 'Required qualification']) },
    { key: 'note', type: 'text', max: 300, names: n(['Bemerkung', 'Notiz'], ['Remarque', 'Note'], ['Nota', 'Osservazione'], ['Note', 'Comment']) },
  ],
}

/** Issue = i18n-Schlüssel unter `imports.err.*` mit Variablen. */
export type Issue = { code: string; col?: string; vars?: Record<string, string | number> }

export type HeaderMap = { index: Record<string, number>; missing: string[]; unknown: string[]; duplicate: string[] }

/** Kopfzeile den Feldern zuordnen. Erste passende Spalte gewinnt; doppelte Zuordnungen werden gemeldet. */
export function mapHeader(kind: ImportKind, header: string[]): HeaderMap {
  const specs = SPECS[kind]
  const lookup = new Map<string, string>()
  for (const s of specs) for (const names of Object.values(s.names)) for (const name of names) if (!lookup.has(headerKey(name))) lookup.set(headerKey(name), s.key)
  // Spaltennamen, die in mehreren Feldern vorkommen (z. B. «E-Mail» bei Diensten = Person), gehören dem ersten Feld.
  const index: Record<string, number> = {}
  const unknown: string[] = []
  const duplicate: string[] = []
  header.forEach((h, i) => {
    const key = lookup.get(headerKey(h)) ?? (headerKey(h) && specs.find((s) => headerKey(s.key) === headerKey(h))?.key)
    if (!key) { if (h.trim()) unknown.push(h); return }
    if (key in index) duplicate.push(h)
    else index[key] = i
  })
  const missing = specs.filter((s) => s.required && !(s.key in index)).map((s) => s.key)
  return { index, missing, unknown, duplicate }
}

// ───────── Werte ─────────

const pad = (x: number) => String(x).padStart(2, '0')
const validYmd = (y: number, m: number, d: number) => {
  if (m < 1 || m > 12 || d < 1) return false
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Datum aus 31.12.2026, 31/12/2026, 31-12-2026 oder 2026-12-31 → ISO. 'year4' bei zweistelligem Jahr. */
export function parseDateCell(raw: string): { ok: true; iso: string } | { ok: false; code: 'date' | 'year4' } {
  const s = raw.trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(s)
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
    return validYmd(y, mo, d) ? { ok: true, iso: `${y}-${pad(mo)}-${pad(d)}` } : { ok: false, code: 'date' }
  }
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?:\s.*)?$/.exec(s)
  if (!m) return { ok: false, code: 'date' }
  if (m[3].length === 2) return { ok: false, code: 'year4' }
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return validYmd(y, mo, d) && y >= 1900 ? { ok: true, iso: `${y}-${pad(mo)}-${pad(d)}` } : { ok: false, code: 'date' }
}

const word = (s: string) => headerKey(s)
const SEX: Record<string, 'f' | 'm' | 'd'> = {
  f: 'f', w: 'f', weiblich: 'f', frau: 'f', female: 'f', femme: 'f', feminin: 'f', donna: 'f', femminile: 'f',
  m: 'm', mannlich: 'm', maennlich: 'm', mann: 'm', male: 'm', homme: 'm', masculin: 'm', uomo: 'm', maschile: 'm',
  d: 'd', x: 'd', divers: 'd', diverse: 'd', other: 'd', autre: 'd', altro: 'd',
}
const REA: Record<string, 'yes' | 'no' | 'unknown'> = {
  ja: 'yes', yes: 'yes', oui: 'yes', si: 'yes', '1': 'yes', true: 'yes', rea: 'yes', reaja: 'yes',
  nein: 'no', no: 'no', non: 'no', '0': 'no', false: 'no', dnr: 'no', norea: 'no', reanein: 'no',
  unbekannt: 'unknown', unknown: 'unknown', inconnu: 'unknown', sconosciuto: 'unknown', offen: 'unknown', '': 'unknown',
}
const LOCALE: Record<string, Lang> = {
  de: 'de', deutsch: 'de', german: 'de', allemand: 'de', tedesco: 'de',
  fr: 'fr', franzosisch: 'fr', francais: 'fr', french: 'fr', francese: 'fr',
  it: 'it', italienisch: 'it', italiano: 'it', italian: 'it', italien: 'it',
  en: 'en', englisch: 'en', english: 'en', anglais: 'en', inglese: 'en',
}
const SCOPE: Record<string, 'unit' | 'location' | 'org'> = {
  bereich: 'unit', unit: 'unit', wohngruppe: 'unit', station: 'unit', unite: 'unit', reparto: 'unit',
  standort: 'location', location: 'location', site: 'location', sede: 'location',
  organisation: 'org', organization: 'org', org: 'org', organizzazione: 'org', alle: 'org', all: 'org',
}

/** Liste in einer Zelle: getrennt durch | , oder ; (in Anführungszeichen). */
export const splitCell = (s: string) => [...new Set(s.split(/[|,;\n]/).map((x) => x.trim()).filter(Boolean))].slice(0, 30)

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE = /^[+\d][\d\s()./-]{3,39}$/

export type RowValues = Record<string, string | number | string[] | null>

/**
 * Prüft und normalisiert eine Zeile. `today` als ISO-Datum (Europe/Zurich), damit Tests deterministisch sind.
 * Leere optionale Zellen ergeben null (bzw. [] bei Listen).
 */
export function validateRow(kind: ImportKind, map: HeaderMap, cells: string[], today: string): { values: RowValues; issues: Issue[] } {
  const values: RowValues = {}
  const issues: Issue[] = []
  for (const s of SPECS[kind]) {
    const i = map.index[s.key]
    const raw = i == null ? '' : (cells[i] ?? '').trim()
    if (!raw) {
      if (s.required) issues.push({ code: 'required', col: s.key })
      values[s.key] = s.type === 'list' ? [] : s.type === 'rea' ? 'unknown' : null
      continue
    }
    switch (s.type) {
      case 'text':
        if (s.max && raw.length > s.max) issues.push({ code: 'tooLong', col: s.key, vars: { max: s.max } })
        values[s.key] = raw.slice(0, s.max ?? 500)
        break
      case 'email':
        if (!EMAIL.test(raw) || raw.length > (s.max ?? 160)) issues.push({ code: 'email', col: s.key, vars: { value: raw } })
        values[s.key] = raw.toLowerCase()
        break
      case 'phone':
        if (!PHONE.test(raw)) issues.push({ code: 'phone', col: s.key, vars: { value: raw } })
        values[s.key] = raw
        break
      case 'date': {
        const d = parseDateCell(raw)
        if (!d.ok) { issues.push({ code: d.code, col: s.key, vars: { value: raw } }); values[s.key] = null; break }
        if (s.past && d.iso > today) issues.push({ code: 'dateFuture', col: s.key, vars: { value: raw } })
        values[s.key] = d.iso
        break
      }
      case 'int': {
        const v = Number(raw.replace(',', '.'))
        const [lo, hi] = s.range ?? [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]
        if (!Number.isInteger(v) || v < lo || v > hi) { issues.push({ code: 'int', col: s.key, vars: { value: raw, min: lo, max: hi } }); values[s.key] = null }
        else values[s.key] = v
        break
      }
      case 'list': {
        const list = splitCell(raw)
        const long = list.find((x) => s.max && x.length > s.max)
        if (long) issues.push({ code: 'tooLong', col: s.key, vars: { max: s.max ?? 0 } })
        values[s.key] = list
        break
      }
      case 'sex':
        if (!SEX[word(raw)]) issues.push({ code: 'sex', col: s.key, vars: { value: raw } })
        values[s.key] = SEX[word(raw)] ?? null
        break
      case 'rea':
        if (!REA[word(raw)]) issues.push({ code: 'rea', col: s.key, vars: { value: raw } })
        values[s.key] = REA[word(raw)] ?? 'unknown'
        break
      case 'locale':
        if (!LOCALE[word(raw)]) issues.push({ code: 'locale', col: s.key, vars: { value: raw } })
        values[s.key] = LOCALE[word(raw)] ?? null
        break
      case 'scope':
        if (!SCOPE[word(raw)]) issues.push({ code: 'scope', col: s.key, vars: { value: raw } })
        values[s.key] = SCOPE[word(raw)] ?? null
        break
    }
  }
  return { values, issues }
}

/** «Pflegefachperson HF: 31.12.2027» → Name und Gültigkeit (optional). */
export function parseQualificationCell(item: string): { name: string; validUntil: string | null; bad?: boolean } {
  const m = /^(.*?)\s*[:@]\s*([\d./-]+)$/.exec(item)
  if (!m) return { name: item.trim(), validUntil: null }
  const d = parseDateCell(m[2])
  return d.ok ? { name: m[1].trim(), validUntil: d.iso } : { name: m[1].trim(), validUntil: null, bad: true }
}

/** Kopfzeile der Vorlage in der Sprache der Person. */
export function templateHeader(kind: ImportKind, lang: Lang) {
  return SPECS[kind].map((s) => s.names[lang][0])
}

/** Beispielzeile der Vorlage (fiktive Werte). */
export const TEMPLATE_EXAMPLE: Record<ImportKind, Record<string, string>> = {
  residents: { lastName: 'Muster', firstName: 'Erika', birthDate: '14.03.1938', sex: 'f', unit: 'Wohngruppe 1', room: '101', admittedAt: '01.10.2026', careLevel: '6', insuranceNo: '', physician: 'Dr. med. B. Beispiel', rea: 'nein', allergies: 'Penicillin | Nüsse', diet: 'Diabetiker', mobility: 'Rollator' },
  staff: { email: 'vorname.nachname@example.ch', lastName: 'Nachname', firstName: 'Vorname', initials: 'VN', jobTitle: 'Pflegefachperson HF', employeeNo: '10234', workPhone: '044 000 00 21', phone: '', unit: 'Wohngruppe 1', role: 'nurse', roleScope: 'Bereich', qualifications: 'Pflegefachperson HF', locale: 'de' },
  shifts: { date: '02.11.2026', unit: 'Wohngruppe 1', shift: 'F', person: 'vorname.nachname@example.ch', qualification: '', note: '' },
}
