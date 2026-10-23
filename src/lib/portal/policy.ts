/**
 * Angehörigenportal (PRD §60, §36) – Freigabe-Policy, rein und testbar.
 *
 * Grundsatz: Das Portal zeigt nur, was die Organisation ausdrücklich freigibt und wozu die Person bzw. ihre
 * gesetzliche Vertretung eingewilligt hat. Klinische Daten (Vitalwerte, Medikation, Verlauf, Pflegeplanung,
 * Assessments, Wunden, Diagnosen, Aufgaben, Übergaben) gehören zu keiner Freigabe und werden im Portal nie geladen.
 * Alles, was das Portal von einer Person sieht, läuft über die Projektionen in dieser Datei.
 */

/** Freigaben je Zugang. Reihenfolge = Anzeige. */
export const PORTAL_GRANTS = ['appointments', 'updates', 'messages', 'visits', 'files'] as const
export type PortalGrant = (typeof PORTAL_GRANTS)[number]

/** Daten, die nie freigegeben werden können (Dokumentation und Tests). */
export const NEVER_SHARED = [
  'vitals', 'medication', 'observations', 'careplan', 'assessments', 'wounds', 'nutrition', 'intake',
  'tasks', 'handover', 'incidents', 'diagnoses', 'allergies', 'risks', 'labs', 'visits.physician',
] as const

/** Rollen eines Zugangs. `self` = Bewohnerportal (Datenmodell vorbereitet, Oberfläche folgt). */
export const PORTAL_ROLES = ['relative', 'legal_rep', 'self'] as const
export type PortalRole = (typeof PORTAL_ROLES)[number]
/** Rollen, die heute eingeladen werden können. */
export const INVITABLE_ROLES: PortalRole[] = ['relative', 'legal_rep']

/** Wer eingewilligt hat. */
export const CONSENT_BY = ['resident', 'legal_rep'] as const
export type ConsentBy = (typeof CONSENT_BY)[number]

/** Standardfreigaben einer neuen Einladung (überschreibbar über Organization.settings.portal.defaultGrants). */
export const DEFAULT_GRANTS: PortalGrant[] = ['appointments', 'updates', 'messages', 'visits']

export const isGrant = (g: unknown): g is PortalGrant => typeof g === 'string' && (PORTAL_GRANTS as readonly string[]).includes(g)

/** Bereinigt eine Liste: nur bekannte Freigaben, ohne Doppelte, feste Reihenfolge. */
export function normalizeGrants(list: readonly unknown[] | null | undefined): PortalGrant[] {
  const set = new Set((list ?? []).filter(isGrant))
  return PORTAL_GRANTS.filter((g) => set.has(g))
}

/** Freigaben liegen immer innerhalb der Einwilligung. */
export function clampToConsent(grants: readonly unknown[], consentScope: readonly unknown[]): PortalGrant[] {
  const scope = new Set(normalizeGrants(consentScope))
  return normalizeGrants(grants).filter((g) => scope.has(g))
}

/** Einstellungen aus Organization.settings.portal. */
export type PortalSettings = { defaultGrants: PortalGrant[]; visitLeadHours: number; visitMaxDays: number }
export function portalSettings(settings: unknown): PortalSettings {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>).portal : null
  const p = (s && typeof s === 'object' && !Array.isArray(s) ? s : {}) as Record<string, unknown>
  const num = (v: unknown, def: number, min: number, max: number) => {
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def
  }
  return {
    defaultGrants: Array.isArray(p.defaultGrants) ? normalizeGrants(p.defaultGrants) : DEFAULT_GRANTS,
    visitLeadHours: num(p.visitLeadHours, 2, 0, 72),
    visitMaxDays: num(p.visitMaxDays, 60, 1, 365),
  }
}

export type AccessLike = {
  grants: readonly string[]
  consentScope: readonly string[]
  revokedAt: Date | null
  acceptedAt: Date | null
  accountId: string | null
}
export type AccountLike = { lockedAt: Date | null }
export type ResidentLike = { status: string; anonymisedAt: Date | null }

/** Personen, deren Angehörige das Portal nutzen können (nicht ausgetreten, nicht verstorben, nicht anonymisiert). */
export const PORTAL_RESIDENT_STATUS = ['active', 'absent'] as const

export function residentVisible(r: ResidentLike) {
  return !r.anonymisedAt && (PORTAL_RESIDENT_STATUS as readonly string[]).includes(r.status)
}

/**
 * Wirksame Freigaben eines Zugangs. Leer, wenn das Modul aus ist, der Zugang widerrufen oder noch nicht
 * angenommen ist, das Konto gesperrt ist oder die Person nicht (mehr) sichtbar ist.
 */
export function effectiveGrants(o: { moduleOn: boolean; access: AccessLike; account: AccountLike | null; resident: ResidentLike }): PortalGrant[] {
  if (!o.moduleOn) return []
  if (o.access.revokedAt || !o.access.acceptedAt || !o.access.accountId) return []
  if (!o.account || o.account.lockedAt) return []
  if (!residentVisible(o.resident)) return []
  return clampToConsent(o.access.grants, o.access.consentScope)
}

export const hasGrant = (grants: readonly string[], g: PortalGrant) => grants.includes(g)

/** Zustand eines Zugangs für die Anzeige (Team, Kontakte). */
export type AccessState = 'invited' | 'expired' | 'active' | 'revoked' | 'locked'
export function accessState(a: { revokedAt: Date | null; acceptedAt: Date | null; inviteExpiresAt: Date | null }, account: AccountLike | null, now = new Date()): AccessState {
  if (a.revokedAt) return 'revoked'
  if (a.acceptedAt) return account?.lockedAt ? 'locked' : 'active'
  if (!a.inviteExpiresAt || a.inviteExpiresAt <= now) return 'expired'
  return 'invited'
}

// ───────── Projektionen: das Einzige, was das Portal von einer Person zu sehen bekommt ─────────

/** Stammdaten im Portal: nur Name, Bereich und Zimmer (für den Besuch). Keine Gesundheitsdaten. */
export function portalResident(r: { id: string; firstName: string; lastName: string; unit: { name: string }; room: { number: string } | null }) {
  return { id: r.id, firstName: r.firstName, lastName: r.lastName, unit: r.unit.name, room: r.room?.number ?? null }
}

/** Terminarten, deren Titel ins Portal darf. Ärztliche, Therapie- und Spitaltermine nur mit der Art (Titel kann Diagnosen enthalten). */
export const APPOINTMENT_TITLE_KINDS = ['relatives', 'other'] as const
export const APPOINTMENT_KINDS = ['physician', 'therapy', 'hospital', 'relatives', 'other'] as const

/** Termin im Portal: Zeit, Art, Ort; Titel nur bei nicht klinischen Arten; nie Notizen. */
export function portalAppointment(a: { id: string; at: Date; kind: string; title: string; place: string | null; done: boolean }) {
  const kind = (APPOINTMENT_KINDS as readonly string[]).includes(a.kind) ? a.kind : 'other'
  return {
    id: a.id,
    at: a.at,
    kind,
    title: (APPOINTMENT_TITLE_KINDS as readonly string[]).includes(kind) ? a.title : null,
    place: a.place,
    done: a.done,
  }
}

/** Dateikategorien der Akte, die einzeln freigegeben werden dürfen. Berichte, Labor, Bildgebung, Rezepte nie. */
export const SHAREABLE_FILE_CATEGORIES = ['directive', 'consent', 'insurance', 'other'] as const
export const isShareableFileCategory = (c: string) => (SHAREABLE_FILE_CATEGORIES as readonly string[]).includes(c)

/** Datei im Portal: Titel, Typ, Grösse, Datum. */
export function portalFile(f: { id: string; title: string; category: string; createdAt: Date; portalShared: boolean; file: { contentType: string; size: number } }) {
  if (!f.portalShared || !isShareableFileCategory(f.category)) return null
  return { id: f.id, title: f.title, contentType: f.file.contentType, size: f.file.size, createdAt: f.createdAt }
}

// ───────── Besuche ─────────

export const VISIT_STATUS = ['requested', 'confirmed', 'declined', 'cancelled'] as const
export type VisitStatus = (typeof VISIT_STATUS)[number]
export const VISIT_MAX_MINUTES = 8 * 60
export const VISIT_MAX_VISITORS = 10

/** Prüft eine Besuchsanfrage; Rückgabe: i18n-Fehlerschlüssel (portal.errors.*) oder null. */
export function visitProblem(v: { start: Date; end: Date; visitors: number }, settings: PortalSettings, now = new Date()): string | null {
  if (!Number.isFinite(v.start.getTime()) || !Number.isFinite(v.end.getTime())) return 'visitTime'
  if (v.end <= v.start) return 'visitEnd'
  if ((v.end.getTime() - v.start.getTime()) / 60_000 > VISIT_MAX_MINUTES) return 'visitLong'
  if (v.start.getTime() < now.getTime() + settings.visitLeadHours * 3600_000) return 'visitSoon'
  if (v.start.getTime() > now.getTime() + settings.visitMaxDays * 86400_000) return 'visitFar'
  if (!Number.isInteger(v.visitors) || v.visitors < 1 || v.visitors > VISIT_MAX_VISITORS) return 'visitors'
  return null
}

/** Übergänge: offen → bestätigt/abgelehnt (Team) oder zurückgezogen (Angehörige); bestätigt → zurückgezogen. */
export function visitTransition(from: string, to: VisitStatus, by: 'staff' | 'family'): boolean {
  if (by === 'staff') return from === 'requested' && (to === 'confirmed' || to === 'declined')
  return to === 'cancelled' && (from === 'requested' || from === 'confirmed')
}

// ───────── Nachrichten ─────────

export const THREAD_STATUS = ['open', 'answered', 'closed'] as const
export const MESSAGE_MAX = 4000
export const SUBJECT_MAX = 120

/** Status nach einer neuen Nachricht: Angehörige öffnen wieder, Antwort des Teams → beantwortet. */
export const threadStatusAfter = (side: 'family' | 'staff') => (side === 'family' ? 'open' : 'answered')
