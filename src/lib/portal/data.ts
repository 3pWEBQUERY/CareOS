import 'server-only'
import { db } from '@/lib/db'
import { addDays, startOfDay } from '@/lib/time'
import type { PortalCtx } from './context'
import { hasGrant, portalAppointment, portalFile, SHAREABLE_FILE_CATEGORIES } from './policy'

/**
 * Lesezugriffe des Portals. Jede Funktion prüft die Freigabe des aktuellen Zugangs und liefert nur die
 * Projektionen aus policy.ts – nie ganze Datensätze. Klinische Tabellen werden hier nicht abgefragt.
 */
type Cur = NonNullable<PortalCtx['current']>

export async function portalAppointments(p: PortalCtx, cur: Cur, opts: { from?: Date; days?: number; take?: number } = {}) {
  if (!hasGrant(cur.grants, 'appointments')) return []
  const from = opts.from ?? startOfDay(new Date())
  const rows = await db.appointment.findMany({
    where: { residentId: cur.residentId, resident: { orgId: p.org.id }, at: { gte: from, lt: addDays(from, opts.days ?? 60) } },
    select: { id: true, at: true, kind: true, title: true, place: true, done: true },
    orderBy: { at: 'asc' },
    take: opts.take ?? 50,
  })
  return rows.map(portalAppointment)
}

/** Mitteilungen für Angehörige: an die Person, an ihren Bereich oder an die ganze Organisation. */
export async function portalUpdates(p: PortalCtx, cur: Cur, take = 20) {
  if (!hasGrant(cur.grants, 'updates')) return []
  const now = new Date()
  return db.portalUpdate.findMany({
    where: {
      orgId: p.org.id,
      publishedAt: { lte: now },
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        { OR: [{ residentId: cur.residentId }, { residentId: null, unitId: cur.unitId }, { residentId: null, unitId: null }] },
      ],
    },
    select: { id: true, title: true, body: true, fileIds: true, publishedAt: true, residentId: true },
    orderBy: { publishedAt: 'desc' },
    take,
  })
}

export async function portalThreads(p: PortalCtx, cur: Cur) {
  if (!hasGrant(cur.grants, 'messages')) return []
  return db.portalThread.findMany({
    where: { orgId: p.org.id, residentId: cur.residentId, access: { accountId: p.account.id } },
    select: { id: true, subject: true, status: true, lastMessageAt: true, familyReadAt: true, _count: { select: { messages: true } } },
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
  })
}

/** Ein Gespräch mit Nachrichten; Namen des Teams nur als Vorname + Initiale des Nachnamens. */
export async function portalThread(p: PortalCtx, cur: Cur, id: string) {
  if (!hasGrant(cur.grants, 'messages')) return null
  const th = await db.portalThread.findFirst({
    where: { id, orgId: p.org.id, residentId: cur.residentId, access: { accountId: p.account.id } },
    select: { id: true, subject: true, status: true, lastMessageAt: true, familyReadAt: true, messages: { select: { id: true, side: true, userId: true, body: true, createdAt: true }, orderBy: { createdAt: 'asc' } } },
  })
  if (!th) return null
  const ids = [...new Set(th.messages.map((m) => m.userId).filter((x): x is string => !!x))]
  const staff = ids.length ? await db.user.findMany({ where: { id: { in: ids }, orgId: p.org.id }, select: { id: true, firstName: true, lastName: true, jobTitle: true } }) : []
  const name = new Map(staff.map((u) => [u.id, `${u.firstName} ${u.lastName.charAt(0)}.${u.jobTitle ? ', ' + u.jobTitle : ''}`]))
  return { ...th, messages: th.messages.map((m) => ({ id: m.id, side: m.side, body: m.body, createdAt: m.createdAt, author: m.userId ? name.get(m.userId) ?? null : null })) }
}

export async function portalVisits(p: PortalCtx, cur: Cur) {
  if (!hasGrant(cur.grants, 'visits')) return []
  return db.visitRequest.findMany({
    where: { orgId: p.org.id, residentId: cur.residentId, access: { accountId: p.account.id }, end: { gte: addDays(new Date(), -30) } },
    select: { id: true, start: true, end: true, visitors: true, note: true, status: true, reply: true, decidedAt: true, createdAt: true },
    orderBy: { start: 'asc' },
    take: 100,
  })
}

export async function portalFiles(p: PortalCtx, cur: Cur) {
  if (!hasGrant(cur.grants, 'files')) return []
  const rows = await db.residentFile.findMany({
    where: { residentId: cur.residentId, portalShared: true, category: { in: [...SHAREABLE_FILE_CATEGORIES] }, file: { orgId: p.org.id } },
    select: { id: true, title: true, category: true, createdAt: true, portalShared: true, file: { select: { contentType: true, size: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map(portalFile).filter((f): f is NonNullable<typeof f> => !!f)
}

/** Anhänge einer Mitteilung (nur Metadaten, Auslieferung über /portal/files/u/…). */
export async function updateAttachments(orgId: string, fileIds: string[]) {
  if (!fileIds.length) return []
  return db.fileObject.findMany({ where: { orgId, id: { in: fileIds }, purpose: 'portal', clinical: false }, select: { id: true, filename: true, contentType: true, size: true } })
}

/** Ungelesenes für die Navigation: Antworten des Teams, Entscheide zu Besuchen. */
export async function portalUnread(p: PortalCtx, cur: Cur) {
  const [threads] = await Promise.all([
    hasGrant(cur.grants, 'messages')
      ? db.portalThread.findMany({ where: { orgId: p.org.id, residentId: cur.residentId, access: { accountId: p.account.id } }, select: { lastMessageAt: true, familyReadAt: true, messages: { select: { side: true }, orderBy: { createdAt: 'desc' }, take: 1 } } })
      : Promise.resolve([]),
  ])
  return { messages: threads.filter((t) => t.messages[0]?.side === 'staff' && (!t.familyReadAt || t.familyReadAt < t.lastMessageAt)).length }
}
