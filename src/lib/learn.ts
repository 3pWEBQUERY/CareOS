import 'server-only'
import type { Certificate, Course, CourseModule, Enrollment } from '@prisma/client'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { addDays } from '@/lib/time'

/** Zertifikate gelten als "läuft bald ab", wenn sie innerhalb dieser Tage ablaufen. */
export const EXPIRING_DAYS = 60

export const COURSE_CATEGORIES = ['general', 'clinical', 'hygiene', 'safety', 'emergency', 'communication', 'hr'] as const
export const MODULE_KINDS = ['text', 'video', 'document', 'quiz', 'practical'] as const
export type ModuleKind = (typeof MODULE_KINDS)[number]

export type QuizQuestion = { q: string; options: string[]; answer: number }
export type Quiz = { pass: number; questions: QuizQuestion[] }

/** Quiz-JSON robust lesen: { pass: 0..1, questions: [{ q, options[], answer }] }. */
export function parseQuiz(raw: unknown): Quiz | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { pass?: unknown; questions?: unknown }
  if (!Array.isArray(r.questions)) return null
  const questions = r.questions
    .map((x) => x as { q?: unknown; options?: unknown; answer?: unknown })
    .filter((x) => typeof x.q === 'string' && Array.isArray(x.options) && x.options.length >= 2)
    .map((x) => ({ q: String(x.q), options: (x.options as unknown[]).map(String), answer: Number(x.answer) || 0 }))
  if (!questions.length) return null
  const pass = typeof r.pass === 'number' && r.pass > 0 && r.pass <= 1 ? r.pass : 0.8
  return { pass, questions }
}

/** Fortschritt: Module werden über ihre ID gespeichert; ältere Einträge über die Reihenfolge ("0", "1"). */
export const isDone = (done: string[], m: Pick<CourseModule, 'id' | 'order'>) => done.includes(m.id) || done.includes(String(m.order))

export function progress(modules: Pick<CourseModule, 'id' | 'order'>[], done: string[]) {
  const n = modules.filter((m) => isDone(done, m)).length
  return { done: n, total: modules.length, pct: modules.length ? Math.round((n / modules.length) * 100) : 0 }
}

/**
 * Ein Modul ist offen, wenn alle vorherigen Module erledigt sind.
 * Praktische Nachweise (Bestätigung durch Leitung) blockieren nachfolgende Module nicht.
 */
export function unlocked(modules: Pick<CourseModule, 'id' | 'order' | 'kind'>[], done: string[], index: number) {
  return modules.slice(0, index).every((m) => m.kind === 'practical' || isDone(done, m))
}

export type CertState = 'valid' | 'expiring' | 'expired'
export function certState(expiresAt: Date | null, now = new Date()): CertState {
  if (!expiresAt) return 'valid'
  if (expiresAt < now) return 'expired'
  if (expiresAt < addDays(now, EXPIRING_DAYS)) return 'expiring'
  return 'valid'
}

export function addMonths(d: Date, n: number) {
  const x = new Date(d)
  x.setMonth(x.getMonth() + n)
  return x
}

/**
 * Markiert abgeschlossene Schulungen, deren Zertifikat abgelaufen ist, als "expired" (berechnet, idempotent).
 * Damit erscheinen sie wieder als offen (Home, Meine Schulungen). Der Modulfortschritt wird zurückgesetzt,
 * Abschlussdatum und Ergebnis bleiben als Historie erhalten (Zertifikat ebenfalls).
 */
export async function syncExpired(orgId: string, userId?: string) {
  const now = new Date()
  const rows = await db.enrollment.findMany({
    where: { status: 'completed', course: { orgId, validityMonths: { not: null } }, ...(userId ? { userId } : {}) },
    select: { id: true, userId: true, courseId: true, completedAt: true, course: { select: { validityMonths: true } } },
  })
  if (!rows.length) return
  const certs = await db.certificate.findMany({
    where: { userId: { in: [...new Set(rows.map((r) => r.userId))] }, courseId: { in: [...new Set(rows.map((r) => r.courseId))] } },
    select: { userId: true, courseId: true, expiresAt: true },
  })
  const latest = new Map<string, Date | null>()
  for (const c of certs) {
    const k = c.userId + ':' + c.courseId
    const cur = latest.get(k)
    if (cur === undefined || (cur && (!c.expiresAt || c.expiresAt > cur))) latest.set(k, c.expiresAt)
  }
  const expired = rows.filter((r) => {
    const k = r.userId + ':' + r.courseId
    const exp = latest.has(k) ? latest.get(k)! : r.completedAt ? addMonths(r.completedAt, r.course.validityMonths!) : null
    return exp && exp < now
  })
  if (expired.length) await db.enrollment.updateMany({ where: { id: { in: expired.map((e) => e.id) } }, data: { status: 'expired', doneModules: [] } })
}

/** Abschluss prüfen: alle Module erledigt → completed, Zertifikat mit Ablaufdatum. */
export async function completeIfDone(enrollmentId: string) {
  const e = await db.enrollment.findUnique({ where: { id: enrollmentId }, include: { course: { include: { modules: true } } } })
  if (!e || e.status === 'completed') return null
  const p = progress(e.course.modules, e.doneModules)
  if (p.total === 0 || p.done < p.total) return null
  const now = new Date()
  const expiresAt = e.course.validityMonths ? addMonths(now, e.course.validityMonths) : null
  const [, cert] = await db.$transaction([
    db.enrollment.update({ where: { id: e.id }, data: { status: 'completed', completedAt: now, score: e.score ?? null } }),
    db.certificate.create({ data: { userId: e.userId, courseId: e.courseId, title: e.course.title, issuedAt: now, expiresAt } }),
  ])
  return cert
}

export type CellState = 'valid' | 'expiring' | 'expired' | 'missing' | 'overdue' | 'na'

/** Compliance-Status einer Person für einen Kurs (PRD §21). */
export function complianceCell(opts: { applicable: boolean; cert?: Pick<Certificate, 'expiresAt'> | null; enrollment?: Pick<Enrollment, 'status' | 'dueAt' | 'completedAt'> | null; course: Pick<Course, 'validityMonths'> }, now = new Date()): { state: CellState; date: Date | null } {
  if (!opts.applicable) return { state: 'na', date: null }
  const { cert, enrollment, course } = opts
  let exp: Date | null | undefined = cert ? cert.expiresAt : undefined
  if (exp === undefined && enrollment?.completedAt && (enrollment.status === 'completed' || enrollment.status === 'expired')) {
    exp = course.validityMonths ? addMonths(enrollment.completedAt, course.validityMonths) : null
  }
  if (exp !== undefined) {
    const s = certState(exp, now)
    if (s !== 'expired') return { state: s, date: exp }
    // abgelaufen; eine neue Zuweisung mit Frist zeigt "überfällig" erst nach der Frist
    return { state: 'expired', date: exp }
  }
  if (enrollment?.dueAt && enrollment.dueAt < now) return { state: 'overdue', date: enrollment.dueAt }
  return { state: 'missing', date: enrollment?.dueAt ?? null }
}

/** Rollen-Schlüssel je Benutzer der Organisation. */
export async function roleKeysByUser(orgId: string) {
  const rows = await db.roleAssignment.findMany({ where: { role: { orgId } }, select: { userId: true, unitId: true, role: { select: { key: true, permissions: true } } } })
  const map = new Map<string, { keys: Set<string>; learn: boolean; units: Set<string> }>()
  for (const r of rows) {
    const cur = map.get(r.userId) ?? { keys: new Set<string>(), learn: false, units: new Set<string>() }
    cur.keys.add(r.role.key)
    if (r.role.permissions.includes('learn.read')) cur.learn = true
    if (r.unitId) cur.units.add(r.unitId)
    map.set(r.userId, cur)
  }
  return map
}

export const applicableTo = (course: Pick<Course, 'audienceRoles'>, keys: Set<string> | undefined) =>
  !course.audienceRoles.length || (!!keys && course.audienceRoles.some((k) => keys.has(k)))

/** Mitarbeitende, die eine Leitung in Learn sehen darf (org-weit oder in ihren Bereichen). */
export async function staffInScope(ctx: Ctx, unitId?: string | null) {
  const orgWide = ctx.grants.some((g) => g.permissions.includes('learn.manage') && !g.unitId && !g.locationId)
  const roles = await roleKeysByUser(ctx.org.id)
  const users = await db.user.findMany({
    where: { orgId: ctx.org.id, active: true },
    select: { id: true, firstName: true, lastName: true, initials: true, jobTitle: true, primaryUnitId: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  })
  const inUnit = (u: (typeof users)[number], unit: string) => u.primaryUnitId === unit || roles.get(u.id)?.units.has(unit)
  return users
    .filter((u) => roles.get(u.id)?.learn)
    .filter((u) => orgWide || ctx.unitIds.some((id) => inUnit(u, id)))
    .filter((u) => !unitId || inUnit(u, unitId))
    .map((u) => ({ ...u, roleKeys: roles.get(u.id)?.keys ?? new Set<string>() }))
}

/** Kurs der Organisation laden (inkl. Module in Reihenfolge). */
export async function loadCourse(ctx: Ctx, id: string) {
  return db.course.findFirst({ where: { id, orgId: ctx.org.id }, include: { modules: { orderBy: { order: 'asc' } } } })
}

/** YouTube/Vimeo als datensparsames Embed, sonst direkte Videodatei. Nur https. */
export function videoEmbed(url: string | null | undefined): { kind: 'iframe' | 'video' | 'link'; src: string } | null {
  if (!url) return null
  let u: URL
  try { u = new URL(url) } catch { return null }
  if (u.protocol !== 'https:') return null
  const host = u.hostname.replace(/^www\./, '')
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const id = u.searchParams.get('v') ?? (u.pathname.startsWith('/embed/') ? u.pathname.split('/')[2] : null)
    if (id && /^[\w-]{6,20}$/.test(id)) return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${id}` }
  }
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1)
    if (/^[\w-]{6,20}$/.test(id)) return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${id}` }
  }
  if (host === 'vimeo.com') {
    const id = u.pathname.split('/').filter(Boolean)[0]
    if (id && /^\d+$/.test(id)) return { kind: 'iframe', src: `https://player.vimeo.com/video/${id}?dnt=1` }
  }
  if (host === 'player.vimeo.com' || host === 'youtube-nocookie.com') return { kind: 'iframe', src: u.toString() }
  if (/\.(mp4|webm|ogg|mov)$/i.test(u.pathname)) return { kind: 'video', src: u.toString() }
  return { kind: 'link', src: u.toString() }
}
