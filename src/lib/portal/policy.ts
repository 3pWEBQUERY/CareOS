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

/** Rollen eines Zugangs. `self` = Bewohnerportal: die Person selbst (ohne Kontakt, Einladung aus der Akte). */
export const PORTAL_ROLES = ['relative', 'legal_rep', 'self'] as const
export type PortalRole = (typeof PORTAL_ROLES)[number]
/** Rollen, die über eine Kontaktperson eingeladen werden können. `self` lädt das Team direkt aus der Akte ein. */
export const INVITABLE_ROLES: PortalRole[] = ['relative', 'legal_rep']
export const SELF_ROLE = 'self' satisfies PortalRole
/** Zugang der Person selbst (Bewohnerportal). */
export const isSelfAccess = (a: { role: string } | null | undefined) => a?.role === SELF_ROLE

/** Ärztliche Kontaktpersonen (Beziehung frei erfasst, DE/FR/IT/EN). Ärztinnen und Ärzte arbeiten im Ärzteportal (/md), nicht im Angehörigenportal. */
const PHYSICIAN_RELATION = /(a|ae)rzt|medecin|docteur|\bmedic[oa]\b|dottor|physician|doctor|\bgp\b|general practitioner|\bdr\.?\s?med\b/

export function isPhysicianContact(relation: string | null | undefined) {
  const s = (relation ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  return PHYSICIAN_RELATION.test(s)
}

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

/** Therapiearten (TherapyPlan.discipline). Die Person selbst sieht bei Therapieeinheiten die Art, nie Ziel oder Anleitung. */
export const THERAPY_DISCIPLINES = ['physio', 'ergo', 'speech', 'activation'] as const

/** Terminarten, deren Titel ins Portal darf. Ärztliche, Therapie- und Spitaltermine nur mit der Art (Titel kann Diagnosen enthalten). */
export const APPOINTMENT_TITLE_KINDS = ['relatives', 'other'] as const
export const APPOINTMENT_KINDS = ['physician', 'therapy', 'hospital', 'relatives', 'other'] as const

/**
 * Termin im Portal: Zeit, Art, Ort; Titel nur bei nicht klinischen Arten; nie Notizen.
 * `discipline` (nur Bewohnerportal): Therapieart einer Therapieeinheit, z. B. «Physiotherapie».
 */
export function portalAppointment(a: { id: string; at: Date; kind: string; title: string; place: string | null; done: boolean }, discipline?: string | null) {
  const kind = (APPOINTMENT_KINDS as readonly string[]).includes(a.kind) ? a.kind : 'other'
  return {
    id: a.id,
    at: a.at,
    kind,
    title: (APPOINTMENT_TITLE_KINDS as readonly string[]).includes(kind) ? a.title : null,
    place: a.place,
    done: a.done,
    discipline: kind === 'therapy' && (THERAPY_DISCIPLINES as readonly string[]).includes(discipline ?? '') ? discipline! : null,
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

// ───────── Bewohnerportal: was der Zugang der Person selbst sieht ─────────

/** Empfängerkreis einer Mitteilung. Bestehende Mitteilungen gelten für Angehörige. */
export const UPDATE_AUDIENCES = ['family', 'residents', 'all'] as const
export type UpdateAudience = (typeof UPDATE_AUDIENCES)[number]
export const normalizeAudience = (v: unknown): UpdateAudience => ((UPDATE_AUDIENCES as readonly unknown[]).includes(v) ? (v as UpdateAudience) : 'family')

/** Mitteilungen, die ein Zugang sieht: die Person selbst nur «für Bewohnende» und «für alle», Angehörige nie «für Bewohnende». */
export function updateAudiencesFor(role: string): UpdateAudience[] {
  return role === SELF_ROLE ? ['residents', 'all'] : ['family', 'all']
}

type Scope = { role: string; residentId: string; unitId: string }

/**
 * Filter der Mitteilungen eines Zugangs: an die Person, an ihren Bereich oder an die ganze Organisation – nie an
 * eine andere Person. Persönliche Mitteilungen (residentId gesetzt) sind immer an diese Person gebunden.
 */
export function updateWhere(orgId: string, cur: Scope, now: Date) {
  return {
    orgId,
    publishedAt: { lte: now },
    audience: { in: updateAudiencesFor(cur.role) },
    AND: [
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      { OR: [{ residentId: cur.residentId }, { residentId: null, unitId: cur.unitId }, { residentId: null, unitId: null }] },
    ],
  }
}

/** Besuchsstatus, die die Person selbst auch bei Besuchen anderer sieht (abgelehnte oder zurückgezogene Anfragen nicht). */
export const SELF_VISIBLE_VISIT_STATUS = ['requested', 'confirmed'] as const

/**
 * Filter der Besuche eines Zugangs. Immer an die Person gebunden.
 * - Angehörige: nur die eigenen Anfragen.
 * - Die Person selbst: eigene Anmeldungen und die offenen bzw. bestätigten Besuche ihrer Angehörigen.
 */
export function visitWhere(orgId: string, cur: Scope, accountId: string, since: Date) {
  const base = { orgId, residentId: cur.residentId, end: { gte: since } }
  if (cur.role !== SELF_ROLE) return { ...base, access: { accountId } }
  return { ...base, OR: [{ access: { accountId } }, { status: { in: [...SELF_VISIBLE_VISIT_STATUS] } }] }
}

/** Gespräche eines Zugangs: nur die eigenen, an die Person gebunden (auch für die Person selbst). */
export const threadWhere = (orgId: string, cur: Scope, accountId: string) => ({ orgId, residentId: cur.residentId, access: { accountId } })

export type VisitRow = {
  id: string; residentId: string; start: Date; end: Date; visitors: number; note: string | null; status: string; reply: string | null
  visitorName: string | null; decidedAt: Date | null; createdAt: Date; appointmentId: string | null
  access: { accountId: string | null; role: string; inviteName: string; account: { name: string } | null } | null
}

/**
 * Besuch im Portal. Eigene Anfragen vollständig (mit Notiz und Antwort des Teams); Besuche anderer nur Zeit,
 * Personenzahl, Status und wer kommt – nie deren Notiz an das Team oder die Antwort.
 * Gehört der Besuch nicht zur Person des Zugangs, gibt es nichts (null).
 */
export function portalVisit(v: VisitRow, cur: { residentId: string }, accountId: string) {
  if (v.residentId !== cur.residentId) return null
  const own = !!v.access && v.access.accountId === accountId
  if (!own && !(SELF_VISIBLE_VISIT_STATUS as readonly string[]).includes(v.status)) return null
  const by = v.access?.account?.name ?? v.access?.inviteName ?? null
  return {
    id: v.id,
    residentId: v.residentId,
    start: v.start,
    end: v.end,
    visitors: v.visitors,
    status: v.status,
    own,
    /** Wer kommt: bei Anmeldungen der Person selbst der erfasste Name, sonst die anfragende Person */
    who: v.access?.role === SELF_ROLE ? v.visitorName : by,
    note: own ? v.note : null,
    reply: own ? v.reply : null,
    decidedAt: own ? v.decidedAt : null,
    createdAt: v.createdAt,
    /** Termin «Angehörige» aus der Bestätigung – damit «Mein Tag» den Besuch nicht doppelt zeigt */
    appointmentId: v.status === 'confirmed' ? v.appointmentId : null,
  }
}
export type PortalVisit = NonNullable<ReturnType<typeof portalVisit>>

export const VISITOR_NAME_MAX = 120

/** «Mein Tag»: Termine und Besuche in eine Zeitleiste, getrennt nach heute und den nächsten Tagen. */
export type DayItem = { key: string; at: Date; until?: Date; kind: 'appointment' | 'visit'; residentId: string }
export function dayPlan<T extends DayItem>(items: T[], cur: { residentId: string }, now: Date, days = 7) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1)
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1 + days)
  // Doppelte Absicherung: nur Einträge der eigenen Person
  const mine = items.filter((i) => i.residentId === cur.residentId).sort((a, b) => a.at.getTime() - b.at.getTime())
  return {
    today: mine.filter((i) => i.at >= start && i.at < tomorrow).map((i) => ({ ...i, past: (i.until ?? i.at).getTime() < now.getTime() })),
    upcoming: mine.filter((i) => i.at >= tomorrow && i.at < end),
  }
}

// ───────── Nachrichten ─────────

export const THREAD_STATUS = ['open', 'answered', 'closed'] as const
export const MESSAGE_MAX = 4000
export const SUBJECT_MAX = 120

/** Status nach einer neuen Nachricht: Angehörige öffnen wieder, Antwort des Teams → beantwortet. */
export const threadStatusAfter = (side: 'family' | 'staff') => (side === 'family' ? 'open' : 'answered')
