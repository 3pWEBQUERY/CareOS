/** DTOs der Arztvisite (Server → Client). */
export type VisitRefDto = { type: 'vital' | 'observation'; label: string; href: string }
export type VisitQuestionDto = { id: string; text: string; ref: VisitRefDto | null; by: string; when: string; mine: boolean }
export type VisitRefOptionDto = { value: string; label: string; group: 'vital' | 'observation' }
export type VisitRosterDto = { id: string; name: string; room: string | null; at: string | null; questions: number; done: boolean; href: string; allergy: boolean }
export type VisitNavDto = { prev: string | null; next: { href: string; label: string } | null }
