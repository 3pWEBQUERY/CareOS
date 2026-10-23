/**
 * Rollenbezogene Startseite (PRD §4.6 Role Awareness, §7): welche Ansichten eine Person hat und welche zuerst erscheint.
 * Reine Logik ohne Datenbank (Server und Tests). Entscheidend sind Berechtigungen und Dienst, nicht Rollennamen,
 * damit eigene Rollen der Organisation ebenfalls passen.
 */
export const HOME_VIEWS = ['care', 'physician', 'therapy', 'lead', 'quality', 'office'] as const
export type HomeView = (typeof HOME_VIEWS)[number]

export type HomeViewInput = {
  /** Akte lesen und Aufgaben oder Übergabe im gewählten Bereich (klinischer Schichtalltag) */
  careHere: boolean
  /** Eigener Dienst im gewählten Bereich läuft oder beginnt heute */
  onDutyHere: boolean
  /** Bereiche mit Akte + Aufgaben (Leitung über mehrere Bereiche ab 2) */
  clinicalUnits: number
  /** Führungsrechte: Dienstplan planen oder Kennzahlen */
  leadPerms: boolean
  /** Ereignisse bearbeiten (Qualitätsmanagement) */
  quality: boolean
  /** Personal- oder Plattformverwaltung (Benutzer, Organisation) */
  office: boolean
  /** Ärztliche Arbeit: Verordnungen und Visite, ohne Pflegeaufgaben zu quittieren (eigene Startseite statt Station) */
  physician?: boolean
  /** Therapie: Therapieeinheiten dokumentieren, ohne Medikamente abzugeben */
  therapy?: boolean
}

export function homeViews(i: HomeViewInput): HomeView[] {
  const lead = i.clinicalUnits >= 2 && i.leadPerms
  const out: HomeView[] = []
  // Ärztinnen/Ärzte und Therapie erhalten ihre eigene Ansicht statt der Pflegeansicht (Zuteilung, Übergabe, Schicht)
  if (i.physician) out.push('physician')
  else if (i.therapy) out.push('therapy')
  else if (i.careHere) out.push('care')
  if (lead) out.push('lead')
  // Die Leitungsübersicht enthält die Ereignisse bereits; eigene Qualitätsansicht nur ohne sie
  if (i.quality && !lead) out.push('quality')
  if (i.office || !out.length) out.push('office')
  return out
}

/** Erste Ansicht: im Dienst die Station, sonst nach Funktion (Verwaltung, Leitung, Station, Qualität). */
export function defaultHomeView(i: HomeViewInput): HomeView {
  const views = homeViews(i)
  if (views.includes('physician')) return 'physician'
  if (views.includes('therapy')) return 'therapy'
  if (i.careHere && i.onDutyHere) return 'care'
  for (const v of ['office', 'lead', 'care', 'quality'] as const) {
    if (v === 'office' && !i.office) continue
    if (views.includes(v)) return v
  }
  return views[0]
}

/** Gewünschte Ansicht (?view=…), sofern verfügbar; sonst die erste. */
export function pickHomeView(i: HomeViewInput, requested?: string | null): { view: HomeView; views: HomeView[] } {
  const views = homeViews(i)
  const view = requested && (views as string[]).includes(requested) ? (requested as HomeView) : defaultHomeView(i)
  return { view, views }
}
