/**
 * Lokaler Allergie-Abgleich beim Verordnen (PRD §13.1, §32) – ohne externe Datenquelle, Server und Client.
 *
 * Allergien sind in der Akte Freitext («Penicillin», «NSAR», «Sulfonamide»), Medikamente ebenfalls («Co-Amoxi 1 g»).
 * Der Abgleich erkennt
 *  - direkte Treffer (Allergie-Text kommt im Medikamentennamen vor oder umgekehrt),
 *  - Wirkstoffklassen (Allergie «Penicillin» ↔ Amoxicillin, Co-Amoxi, Augmentin …),
 *  - bekannte Kreuzreaktionen mit geringerer Sicherheit (Penicillin ↔ Cephalosporine).
 * Er ersetzt keine pharmakologische Prüfung: ohne Treffer gilt «kein Hinweis gefunden», nicht «unbedenklich».
 */

export type AllergyMatchKind = 'direct' | 'class' | 'cross'
export type AllergyMatch = {
  /** Allergie wie in der Akte erfasst */
  allergy: string
  kind: AllergyMatchKind
  /** Klassenschlüssel (i18n meds.allergy.classes.<key>), bei direkten Treffern null */
  classKey: string | null
  /** Begriff im Medikamentennamen, der getroffen hat */
  term: string
}

type AllergyClass = {
  key: string
  /** Begriffe, an denen die Allergie in der Akte erkannt wird (normalisiert, Wortanfang) */
  allergy: string[]
  /** Wirkstoffe und in der Schweiz gebräuchliche Handelsnamen (normalisiert, Wortanfang) */
  drugs: string[]
  /** Klassen mit möglicher Kreuzreaktion */
  cross?: string[]
}

export const ALLERGY_CLASSES: AllergyClass[] = [
  {
    key: 'penicillin',
    allergy: ['penicillin', 'penicilline', 'penizillin', 'betalaktam', 'beta-laktam', 'amoxicillin', 'amoxi'],
    drugs: ['penicillin', 'amoxicillin', 'amoxi', 'co-amoxi', 'coamoxi', 'augmentin', 'clamoxyl', 'ampicillin', 'flucloxacillin', 'floxapen', 'piperacillin', 'tazobac', 'phenoxymethylpenicillin', 'ospen', 'benzylpenicillin', 'stabicilline'],
    cross: ['cephalosporin'],
  },
  {
    key: 'cephalosporin',
    allergy: ['cephalosporin', 'cefalosporin'],
    drugs: ['cef', 'ceph', 'zinat', 'rocephin', 'keflex'],
  },
  {
    key: 'sulfonamide',
    allergy: ['sulfonamid', 'sulfa', 'cotrimoxazol', 'co-trimoxazol', 'bactrim'],
    drugs: ['sulfamethoxazol', 'cotrimoxazol', 'co-trimoxazol', 'bactrim', 'nopil', 'sulfasalazin', 'salazopyrin', 'sulfadiazin'],
  },
  {
    key: 'nsaid',
    allergy: ['nsar', 'nsaid', 'ains', 'fans', 'acetylsalicyl', 'aspirin', 'ass ', 'salicyl', 'ibuprofen', 'diclofenac', 'naproxen', 'mefenamin'],
    drugs: ['acetylsalicyl', 'aspirin', 'aspegic', 'alcacyl', 'tiatral', 'ibuprofen', 'brufen', 'algifor', 'irfen', 'diclofenac', 'voltaren', 'inflamac', 'naproxen', 'apranax', 'proxen', 'mefenamin', 'ponstan', 'ketoprofen', 'etoricoxib', 'arcoxia', 'celecoxib', 'celebrex', 'indometacin', 'piroxicam', 'meloxicam', 'mobicox'],
  },
  {
    key: 'metamizole',
    allergy: ['metamizol', 'novalgin', 'minalgin', 'novaminsulfon'],
    drugs: ['metamizol', 'novalgin', 'minalgin', 'novaminsulfon'],
  },
  {
    key: 'paracetamol',
    allergy: ['paracetamol', 'acetaminophen', 'dafalgan', 'panadol'],
    drugs: ['paracetamol', 'acetaminophen', 'dafalgan', 'panadol', 'ben-u-ron', 'zolben', 'perfalgan'],
  },
  {
    key: 'opioid',
    allergy: ['opiat', 'opioid', 'morphin', 'codein', 'oxycodon', 'tramadol', 'hydromorphon'],
    drugs: ['morphin', 'mst ', 'sevredol', 'codein', 'oxycodon', 'oxycontin', 'targin', 'hydromorphon', 'palladon', 'tramadol', 'tramal', 'fentanyl', 'durogesic', 'buprenorphin', 'transtec', 'temgesic', 'tapentadol', 'palexia', 'methadon', 'pethidin'],
  },
  {
    key: 'macrolide',
    allergy: ['makrolid', 'macrolid', 'erythromycin', 'clarithromycin', 'azithromycin'],
    drugs: ['erythromycin', 'clarithromycin', 'klacid', 'azithromycin', 'zithromax'],
  },
  {
    key: 'quinolone',
    allergy: ['chinolon', 'quinolon', 'fluorchinolon', 'ciprofloxacin', 'levofloxacin'],
    drugs: ['ciprofloxacin', 'ciproxin', 'levofloxacin', 'tavanic', 'moxifloxacin', 'avalox', 'norfloxacin', 'ofloxacin'],
  },
  {
    key: 'tetracycline',
    allergy: ['tetracyclin', 'doxycyclin', 'minocyclin'],
    drugs: ['tetracyclin', 'doxycyclin', 'vibramycin', 'minocyclin'],
  },
  {
    key: 'aceInhibitor',
    allergy: ['ace-hemmer', 'ace hemmer', 'ace-inhibitor', 'iec'],
    drugs: ['enalapril', 'lisinopril', 'ramipril', 'perindopril', 'captopril', 'zofenopril', 'fosinopril', 'quinapril', 'reniten', 'zestril', 'triatec', 'coversum'],
  },
  {
    key: 'heparin',
    allergy: ['heparin', 'hit'],
    drugs: ['heparin', 'liquemin', 'enoxaparin', 'clexane', 'dalteparin', 'fragmin', 'nadroparin', 'fraxiparin'],
  },
  {
    key: 'iodine',
    allergy: ['jod', 'iod', 'povidon', 'kontrastmittel'],
    drugs: ['povidon', 'betadine', 'jod', 'iod'],
  },
]

/** Kleinschreibung, ohne Akzente, ß → ss, Satzzeichen ausser Bindestrich als Leerzeichen. */
export function normalize(s: string) {
  return ' ' + s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() + ' '
}

/** Begriff am Wortanfang im normalisierten Text (« amoxi» trifft «co-amoxi», aber nicht «tamoxifen»). */
function hasTerm(text: string, term: string) {
  const t = term.trimEnd()
  const trailing = term.length !== t.length
  let i = text.indexOf(t)
  while (i >= 0) {
    const before = text[i - 1]
    if (before === ' ' || before === '-' || before === undefined) {
      if (!trailing || text[i + t.length] === ' ') return true
    }
    i = text.indexOf(t, i + 1)
  }
  return false
}

/** Wörter aus Freitext, die für einen direkten Abgleich taugen (mind. 4 Zeichen, keine Füllwörter). */
const STOP = new Set(['allergie', 'allergien', 'unvertraglichkeit', 'intoleranz', 'gegen', 'auf', 'bei', 'und', 'oder', 'mit', 'nach', 'allergy', 'allergie', 'allergia', 'tabletten', 'tablette', 'mg', 'tropfen'])
function words(s: string) {
  return normalize(s).trim().split(' ').filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d/.test(w))
}

/**
 * Prüft einen Medikamentennamen (optional mit Wirkstoff/Form) gegen die Allergien der Person.
 * Liefert je Allergie höchstens einen Treffer, den stärksten (direkt > Klasse > Kreuzreaktion).
 */
export function checkAllergies(allergies: string[], medication: string): AllergyMatch[] {
  const med = normalize(medication)
  if (!med.trim()) return []
  const out: AllergyMatch[] = []
  for (const allergy of allergies) {
    const a = normalize(allergy)
    if (!a.trim()) continue
    let hit: AllergyMatch | null = null
    // direkt: ein Wort der Allergie im Namen (oder ein Wort des Namens in der Allergie)
    const direct = words(allergy).find((w) => hasTerm(med, w)) ?? words(medication).find((w) => hasTerm(a, w))
    if (direct) hit = { allergy, kind: 'direct', classKey: null, term: direct }
    const classes = ALLERGY_CLASSES.filter((c) => c.allergy.some((x) => hasTerm(a, x)))
    if (!hit) {
      for (const c of classes) {
        const term = c.drugs.find((d) => hasTerm(med, d))
        if (term) { hit = { allergy, kind: 'class', classKey: c.key, term: term.trim() }; break }
      }
    }
    if (!hit) {
      for (const c of classes) {
        for (const ck of c.cross ?? []) {
          const cc = ALLERGY_CLASSES.find((x) => x.key === ck)
          const term = cc?.drugs.find((d) => hasTerm(med, d))
          if (term) { hit = { allergy, kind: 'cross', classKey: ck, term: term.trim() }; break }
        }
        if (hit) break
      }
    }
    if (hit) out.push(hit)
  }
  return out
}

/** Schwerster Treffer zuerst; «cross» ist ein Hinweis, «direct»/«class» eine Warnung mit Begründungspflicht. */
export const blocking = (m: AllergyMatch[]) => m.some((x) => x.kind !== 'cross')
