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
  cells: (CellDto | null)[]
}

export type ResidentCtxDto = { id: string; name: string; room: string | null; allergies: string[] }
export type ColleagueDto = { id: string; name: string }
