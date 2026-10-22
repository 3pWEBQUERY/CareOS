/**
 * Klinische Standardkonfiguration. Wird beim Anlegen einer Organisation in die DB übernommen
 * und ist danach in Admin → Klinische Konfiguration anpassbar.
 */

/** Pflegebereiche (PRD §9.1). */
export const CARE_DOMAINS = [
  { key: 'mobility', de: 'Mobilität' },
  { key: 'hygiene', de: 'Körperpflege' },
  { key: 'nutrition', de: 'Ernährung' },
  { key: 'elimination', de: 'Ausscheidung' },
  { key: 'sleep', de: 'Schlaf' },
  { key: 'communication', de: 'Kommunikation' },
  { key: 'cognition', de: 'Kognition' },
  { key: 'breathing', de: 'Atmung' },
  { key: 'pain', de: 'Schmerz' },
  { key: 'skin', de: 'Haut' },
  { key: 'social', de: 'Soziale Bedürfnisse' },
  { key: 'wellbeing', de: 'Psychisches Wohlbefinden' },
  { key: 'safety', de: 'Sicherheit' },
  { key: 'custom', de: 'Individueller Pflegebereich' },
] as const

export type AssessmentItem = { key: string; label: string; options: { v: number; label: string }[] }
export type AssessmentDef = {
  key: string
  name: string
  description: string
  intervalDays: number | null
  items: { questions: AssessmentItem[]; ranges: { min: number; max: number; result: string; level: 'ok' | 'warn' | 'crit' }[] }
}

const opts = (...labels: string[]) => labels.map((label, i) => ({ v: i + 1, label }))
const yesNo = (yes: number) => [{ v: 0, label: 'Nein' }, { v: yes, label: 'Ja' }]

/** Assessments (PRD §8.2 / CareOS Assess). Punkte werden summiert und über Bereiche bewertet. */
export const ASSESSMENTS: AssessmentDef[] = [
  {
    key: 'braden', name: 'Braden-Skala', description: 'Dekubitusrisiko. Tiefer Wert = höheres Risiko.', intervalDays: 7,
    items: {
      questions: [
        { key: 'sensory', label: 'Sensorisches Empfinden', options: opts('fehlt', 'stark eingeschränkt', 'leicht eingeschränkt', 'vorhanden') },
        { key: 'moisture', label: 'Feuchtigkeit', options: opts('ständig feucht', 'oft feucht', 'manchmal feucht', 'selten feucht') },
        { key: 'activity', label: 'Aktivität', options: opts('bettlägerig', 'sitzt auf', 'geht wenig', 'geht regelmässig') },
        { key: 'mobility', label: 'Mobilität', options: opts('komplett immobil', 'stark eingeschränkt', 'leicht eingeschränkt', 'mobil') },
        { key: 'nutrition', label: 'Ernährung', options: opts('sehr schlecht', 'mässig', 'adäquat', 'gut') },
        { key: 'friction', label: 'Reibung und Scherkräfte', options: opts('Problem', 'potenzielles Problem', 'kein Problem') },
      ],
      ranges: [
        { min: 0, max: 12, result: 'hohes Risiko', level: 'crit' },
        { min: 13, max: 14, result: 'mittleres Risiko', level: 'warn' },
        { min: 15, max: 18, result: 'geringes Risiko', level: 'warn' },
        { min: 19, max: 23, result: 'kein Risiko', level: 'ok' },
      ],
    },
  },
  {
    key: 'fallrisk', name: 'Sturzrisiko', description: 'Einschätzung des Sturzrisikos nach typischen Risikofaktoren.', intervalDays: 30,
    items: {
      questions: [
        { key: 'history', label: 'Sturz in den letzten 12 Monaten', options: yesNo(2) },
        { key: 'gait', label: 'Gang- oder Gleichgewichtsstörung', options: yesNo(1) },
        { key: 'aids', label: 'Gehhilfe benötigt', options: yesNo(1) },
        { key: 'meds', label: 'Sturzfördernde Medikamente (Sedativa, Antihypertensiva …)', options: yesNo(1) },
        { key: 'cognition', label: 'Kognitive Einschränkung', options: yesNo(1) },
        { key: 'incontinence', label: 'Inkontinenz / nächtlicher Harndrang', options: yesNo(1) },
      ],
      ranges: [
        { min: 0, max: 1, result: 'geringes Risiko', level: 'ok' },
        { min: 2, max: 3, result: 'mittleres Risiko', level: 'warn' },
        { min: 4, max: 7, result: 'erhöhtes Risiko', level: 'crit' },
      ],
    },
  },
  {
    key: 'mna', name: 'MNA-SF', description: 'Mini Nutritional Assessment, Kurzform.', intervalDays: 90,
    items: {
      questions: [
        { key: 'intake', label: 'Nahrungsaufnahme in den letzten 3 Monaten', options: [{ v: 0, label: 'stark abgenommen' }, { v: 1, label: 'leicht abgenommen' }, { v: 2, label: 'unverändert' }] },
        { key: 'weight', label: 'Gewichtsverlust in den letzten 3 Monaten', options: [{ v: 0, label: '> 3 kg' }, { v: 1, label: 'weiss nicht' }, { v: 2, label: '1–3 kg' }, { v: 3, label: 'kein' }] },
        { key: 'mobility', label: 'Mobilität', options: [{ v: 0, label: 'bettlägerig' }, { v: 1, label: 'in der Wohnung' }, { v: 2, label: 'verlässt die Wohnung' }] },
        { key: 'stress', label: 'Akute Krankheit oder Stress', options: [{ v: 0, label: 'Ja' }, { v: 2, label: 'Nein' }] },
        { key: 'neuro', label: 'Neuropsychologische Probleme', options: [{ v: 0, label: 'schwere Demenz/Depression' }, { v: 1, label: 'leichte Demenz' }, { v: 2, label: 'keine' }] },
        { key: 'bmi', label: 'BMI', options: [{ v: 0, label: '< 19' }, { v: 1, label: '19–21' }, { v: 2, label: '21–23' }, { v: 3, label: '≥ 23' }] },
      ],
      ranges: [
        { min: 0, max: 7, result: 'Mangelernährung', level: 'crit' },
        { min: 8, max: 11, result: 'Risiko für Mangelernährung', level: 'warn' },
        { min: 12, max: 14, result: 'normaler Ernährungszustand', level: 'ok' },
      ],
    },
  },
  {
    key: 'nrs', name: 'Schmerz NRS', description: 'Numerische Rating-Skala 0–10.', intervalDays: 1,
    items: {
      questions: [{ key: 'nrs', label: 'Schmerzstärke', options: Array.from({ length: 11 }, (_, i) => ({ v: i, label: String(i) })) }],
      ranges: [
        { min: 0, max: 0, result: 'schmerzfrei', level: 'ok' },
        { min: 1, max: 3, result: 'leichte Schmerzen', level: 'ok' },
        { min: 4, max: 6, result: 'mittlere Schmerzen', level: 'warn' },
        { min: 7, max: 10, result: 'starke Schmerzen', level: 'crit' },
      ],
    },
  },
  {
    key: 'barthel', name: 'Barthel-Index', description: 'Selbstständigkeit bei Aktivitäten des täglichen Lebens (0–100).', intervalDays: 180,
    items: {
      questions: [
        { key: 'eating', label: 'Essen', options: [{ v: 0, label: 'unselbstständig' }, { v: 5, label: 'mit Hilfe' }, { v: 10, label: 'selbstständig' }] },
        { key: 'transfer', label: 'Transfer Bett/Stuhl', options: [{ v: 0, label: 'unmöglich' }, { v: 5, label: 'grosse Hilfe' }, { v: 10, label: 'wenig Hilfe' }, { v: 15, label: 'selbstständig' }] },
        { key: 'grooming', label: 'Sich waschen', options: [{ v: 0, label: 'mit Hilfe' }, { v: 5, label: 'selbstständig' }] },
        { key: 'toilet', label: 'Toilettenbenutzung', options: [{ v: 0, label: 'unselbstständig' }, { v: 5, label: 'mit Hilfe' }, { v: 10, label: 'selbstständig' }] },
        { key: 'bathing', label: 'Baden/Duschen', options: [{ v: 0, label: 'mit Hilfe' }, { v: 5, label: 'selbstständig' }] },
        { key: 'walking', label: 'Gehen', options: [{ v: 0, label: 'immobil' }, { v: 5, label: 'Rollstuhl selbstständig' }, { v: 10, label: 'mit Hilfe' }, { v: 15, label: 'selbstständig' }] },
        { key: 'stairs', label: 'Treppensteigen', options: [{ v: 0, label: 'unmöglich' }, { v: 5, label: 'mit Hilfe' }, { v: 10, label: 'selbstständig' }] },
        { key: 'dressing', label: 'An-/Auskleiden', options: [{ v: 0, label: 'unselbstständig' }, { v: 5, label: 'mit Hilfe' }, { v: 10, label: 'selbstständig' }] },
        { key: 'bowel', label: 'Stuhlkontrolle', options: [{ v: 0, label: 'inkontinent' }, { v: 5, label: 'gelegentlich' }, { v: 10, label: 'kontinent' }] },
        { key: 'bladder', label: 'Harnkontrolle', options: [{ v: 0, label: 'inkontinent' }, { v: 5, label: 'gelegentlich' }, { v: 10, label: 'kontinent' }] },
      ],
      ranges: [
        { min: 0, max: 30, result: 'weitgehend pflegeabhängig', level: 'crit' },
        { min: 31, max: 60, result: 'hilfebedürftig', level: 'warn' },
        { min: 61, max: 100, result: 'weitgehend selbstständig', level: 'ok' },
      ],
    },
  },
]

export function scoreAssessment(def: AssessmentDef, answers: Record<string, number>) {
  const score = def.items.questions.reduce((s, q) => s + (Number(answers[q.key]) || 0), 0)
  const range = def.items.ranges.find((r) => score >= r.min && score <= r.max) ?? def.items.ranges[def.items.ranges.length - 1]
  return { score, result: range.result, level: range.level }
}

export type WorkflowStep = { key: string; title: string; category: string; offsetMin: number; durationMin: number }

/** Ereignistypen mit Folgeprozess (PRD §22, §48 Smart Workflows). */
export const INCIDENT_TYPES: { key: string; de: string; workflow: WorkflowStep[] }[] = [
  {
    key: 'fall', de: 'Sturz',
    workflow: [
      { key: 'vitals', title: 'Vitalwertkontrolle', category: 'Überwachung', offsetMin: 15, durationMin: 10 },
      { key: 'assessment', title: 'Sturzassessment durchführen', category: 'Assessment', offsetMin: 60, durationMin: 15 },
      { key: 'physician', title: 'Hausarzt gemäss Standard informieren', category: 'Organisation', offsetMin: 120, durationMin: 5 },
      { key: 'careplan', title: 'Pflegeplanung prüfen', category: 'Planung', offsetMin: 1440, durationMin: 15 },
      { key: 'followup', title: 'Verlaufskontrolle nach 24 h', category: 'Überwachung', offsetMin: 1440, durationMin: 10 },
    ],
  },
  {
    key: 'medication', de: 'Medikationsereignis',
    workflow: [
      { key: 'vitals', title: 'Vitalwertkontrolle', category: 'Überwachung', offsetMin: 15, durationMin: 10 },
      { key: 'physician', title: 'Hausarzt informieren', category: 'Organisation', offsetMin: 30, durationMin: 5 },
      { key: 'followup', title: 'Wirkungskontrolle', category: 'Überwachung', offsetMin: 120, durationMin: 10 },
    ],
  },
  { key: 'pressure', de: 'Dekubitus', workflow: [{ key: 'wound', title: 'Wunddokumentation anlegen', category: 'Behandlungspflege', offsetMin: 60, durationMin: 15 }, { key: 'careplan', title: 'Lagerungsplan prüfen', category: 'Planung', offsetMin: 240, durationMin: 15 }] },
  { key: 'injury', de: 'Verletzung', workflow: [{ key: 'vitals', title: 'Vitalwertkontrolle', category: 'Überwachung', offsetMin: 15, durationMin: 10 }, { key: 'physician', title: 'Hausarzt informieren', category: 'Organisation', offsetMin: 60, durationMin: 5 }] },
  { key: 'aggression', de: 'Aggressionsereignis', workflow: [{ key: 'debrief', title: 'Nachbesprechung im Team', category: 'Organisation', offsetMin: 1440, durationMin: 20 }] },
  { key: 'nearmiss', de: 'Beinahe-Ereignis', workflow: [] },
  { key: 'technical', de: 'Technisches Ereignis', workflow: [] },
]
