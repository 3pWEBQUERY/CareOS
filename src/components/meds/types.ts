import type { AllergyMatch } from '@/lib/allergy-check'

/** Serialisierbare Daten für die Medikations-Komponenten (Server → Client). */
export type DoseStateDto = 'open' | 'given' | 'refused' | 'omitted' | 'held'

export type HistDto = { id: string; status: Exclude<DoseStateDto, 'open'>; at: string; by: string; checkedBy: string | null; note: string | null; voidedAt: string | null; voidedBy: string | null }

export type CellDto = {
  time: string
  dose: string
  applicable: boolean
  state: DoseStateDto
  over: boolean
  adminId: string
  at: string | null
  by: string | null
  checkedBy: string | null
  note: string | null
  history: HistDto[]
}

export type MarRowDto = {
  id: string
  name: string
  form: string | null
  route: string
  indication: string | null
  notes: string | null
  kind: 'regular' | 'temporary' | 'prn'
  requiresDoubleCheck: boolean
  stoppedAt: string | null
  /** Allergie-Treffer aus dem lokalen Abgleich (PRD §13.1) */
  allergy?: AllergyMatch[]
  /** Telefonische/mündliche Verordnung noch nicht ärztlich gegengezeichnet */
  unconfirmed?: boolean
  cells: (CellDto | null)[]
}

/** photoId: Bewohnerfoto zur Identifikation (PRD §32), null = kein Foto */
export type ResidentCtxDto = { id: string; name: string; room: string | null; allergies: string[]; photoId?: string | null }
export type ColleagueDto = { id: string; name: string }
