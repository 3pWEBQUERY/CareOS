import { db } from '@/lib/db'
import { hashToken } from '@/lib/auth/session'
import { rateLimit } from '@/lib/rate-limit'
import { hasPermission, isExternalPhysician } from '@/lib/permissions'
import { normalizeModules, orgHasModule, stripDisabled } from '@/lib/modules'
import { dictionary } from '@/i18n'
import { makeT, type Locale, type Terminology } from '@/i18n/core'
import { shiftName } from '@/lib/shift-name'
import { addDays, dbDate, startOfDay } from '@/lib/time'
import { buildCalendar, FEED_AHEAD_DAYS, FEED_PAST_DAYS, hideDraftShifts } from '@/lib/ical'

export const dynamic = 'force-dynamic'

const FAIL_LIMIT = 30 // ungültige Adressen je Minute und IP
const FEED_LIMIT = 120 // Abrufe je Stunde und Abo

const notFound = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })

/**
 * GET /api/ical/<token>[.ics] – Kalender-Abo der eigenen Dienste (PRD §19), z. B. für Outlook, Apple oder Google Kalender.
 * Das Token ersetzt die Anmeldung (geheime Adresse, gespeichert nur als Hash; Profil → Kalender abonnieren).
 * Enthält Dienste eines Monats zurück und drei Monate voraus, ohne abgesagte und ohne Monate im Entwurf –
 * ausser die Person plant den Bereich selbst.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const raw = (await params).token.replace(/\.ics$/i, '')
  const tok = /^cal_[\w-]{20,}$/.test(raw) ? await db.calendarToken.findUnique({ where: { tokenHash: hashToken(raw) } }) : null
  if (!tok || tok.revokedAt) {
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
    const rl = await rateLimit('ical-fail:' + ip, FAIL_LIMIT, 60_000)
    if (!rl.ok) return new Response('Too many requests', { status: 429, headers: { 'retry-after': String(rl.retryAfter) } })
    return notFound()
  }
  const rl = await rateLimit('ical:' + tok.id, FEED_LIMIT, 60 * 60_000)
  if (!rl.ok) return new Response('Too many requests', { status: 429, headers: { 'retry-after': String(rl.retryAfter) } })
  const user = await db.user.findFirst({
    where: { id: tok.userId, orgId: tok.orgId, active: true },
    include: { org: { select: { name: true, modules: true, suspendedAt: true, terminology: true } }, roles: { include: { role: { select: { permissions: true } } } } },
  })
  const modules = normalizeModules(user?.org.modules)
  if (!user || user.org.suspendedAt || isExternalPhysician(user) || !orgHasModule(modules, 'schedule')) return notFound()

  const today = startOfDay(new Date())
  const from = addDays(today, -FEED_PAST_DAYS)
  const to = addDays(today, FEED_AHEAD_DAYS)
  const shifts = await db.shift.findMany({
    where: { userId: user.id, date: { gte: dbDate(from), lte: dbDate(to) }, status: { not: 'cancelled' } },
    include: { shiftType: true, unit: { select: { id: true, name: true, locationId: true } } },
    orderBy: { date: 'asc' },
  })
  const drafts = await db.schedulePeriod.findMany({
    where: { orgId: user.orgId, status: 'draft', unitId: { in: [...new Set(shifts.map((s) => s.unitId))] }, month: { gte: dbDate(new Date(from.getFullYear(), from.getMonth(), 1)), lte: dbDate(to) } },
    select: { unitId: true, month: true },
  })
  const grants = user.roles.map((a) => ({ permissions: stripDisabled(a.role.permissions, modules), unitId: a.unitId, locationId: a.locationId }))
  const unitOf = new Map(shifts.map((s) => [s.unitId, s.unit]))
  const visible = hideDraftShifts(
    shifts.map((s) => ({ ...s, day: s.date.toISOString().slice(0, 10) })),
    drafts.map((d) => ({ unitId: d.unitId, month: d.month.toISOString().slice(0, 7) })),
    (unitId) => hasPermission(grants, 'schedule.manage', { unitId, locationId: unitOf.get(unitId)?.locationId }),
  )

  const locale = user.locale as Locale
  const t = makeT(dictionary(locale), locale, user.org.terminology as Terminology)
  const ics = buildCalendar({
    name: t('profile.calendar.feedName', { org: user.org.name }),
    events: visible.map((s) => ({
      uid: `shift-${s.id}@careos`,
      day: s.day,
      start: s.shiftType.start,
      end: s.shiftType.end,
      summary: `${shiftName(t, s.shiftType)} (${s.shiftType.code})`,
      location: s.unit.name,
      description: [s.status === 'swap_requested' ? t('profile.calendar.swapRequested') : null, s.note].filter(Boolean).join('\n') || null,
      tentative: s.status === 'swap_requested',
    })),
  })
  if (!tok.lastUsedAt || Date.now() - tok.lastUsedAt.getTime() > 10 * 60_000) await db.calendarToken.update({ where: { id: tok.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
  return new Response(ics, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="careos-dienste.ics"',
      'cache-control': 'private, no-store',
    },
  })
}
