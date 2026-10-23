import 'server-only'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

/**
 * Löschkonzept für Portal-Daten (PRD §36), aufgerufen aus src/lib/retention.ts.
 * - Nachrichten, Besuchsanfragen und Mitteilungen: Frist «chat» (Kommunikation).
 * - Sitzungen: Frist «sessions».
 * - Konten ohne aktiven Zugang und nie angenommene Einladungen: nach PORTAL_ORPHAN_DAYS.
 * - Anonymisierung einer Person: alle Portal-Daten zu ihr werden gelöscht.
 * Das Audit-Protokoll bleibt unberührt (eigene Frist).
 */
export const PORTAL_ORPHAN_DAYS = 90

export type PortalRetentionCounts = { portalMessages: number; portalThreads: number; portalVisits: number; portalUpdates: number; portalAccounts: number; portalInvites: number; portalSessions: number }
export const PORTAL_RETENTION_KEYS = ['portalMessages', 'portalThreads', 'portalVisits', 'portalUpdates', 'portalSessions', 'portalInvites', 'portalAccounts'] as const satisfies readonly (keyof PortalRetentionCounts)[]

export function portalWhere(orgId: string, cut: { chat: Date; sessions: Date }, now: Date) {
  const orphan = new Date(now.getTime() - PORTAL_ORPHAN_DAYS * 86400_000)
  return {
    messages: { thread: { orgId }, createdAt: { lt: cut.chat } } satisfies Prisma.PortalMessageWhereInput,
    threads: { orgId, lastMessageAt: { lt: cut.chat } } satisfies Prisma.PortalThreadWhereInput,
    visits: { orgId, end: { lt: cut.chat } } satisfies Prisma.VisitRequestWhereInput,
    updates: { orgId, OR: [{ publishedAt: { lt: cut.chat } }, { expiresAt: { lt: cut.chat } }] } satisfies Prisma.PortalUpdateWhereInput,
    sessions: { account: { orgId }, OR: [{ expiresAt: { lt: cut.sessions } }, { revokedAt: { lt: cut.sessions } }] } satisfies Prisma.PortalSessionWhereInput,
    invites: { orgId, acceptedAt: null, OR: [{ inviteExpiresAt: { lt: orphan } }, { revokedAt: { lt: orphan } }] } satisfies Prisma.PortalAccessWhereInput,
    accounts: {
      orgId,
      accesses: { none: { revokedAt: null } },
      OR: [{ lastLoginAt: { lt: orphan } }, { lastLoginAt: null, createdAt: { lt: orphan } }],
    } satisfies Prisma.PortalAccountWhereInput,
  }
}

export async function portalRetentionPreview(orgId: string, cut: { chat: Date; sessions: Date }, now = new Date()) {
  const w = portalWhere(orgId, cut, now)
  const [portalMessages, portalThreads, portalVisits, portalUpdates, portalAccounts, portalInvites, portalSessions] = await Promise.all([
    db.portalMessage.count({ where: w.messages }), db.portalThread.count({ where: w.threads }), db.visitRequest.count({ where: w.visits }),
    db.portalUpdate.count({ where: w.updates }), db.portalAccount.count({ where: w.accounts }), db.portalAccess.count({ where: w.invites }), db.portalSession.count({ where: w.sessions }),
  ])
  return { portalMessages, portalThreads, portalVisits, portalUpdates, portalAccounts, portalInvites, portalSessions } satisfies PortalRetentionCounts
}

/** Fristen anwenden. Dateianhänge abgelaufener Mitteilungen gibt die Rückgabe zum Löschen im Bucket zurück. */
export async function runPortalRetention(orgId: string, cut: { chat: Date; sessions: Date }, now = new Date()): Promise<PortalRetentionCounts & { fileIds: string[] }> {
  const w = portalWhere(orgId, cut, now)
  const portalMessages = (await db.portalMessage.deleteMany({ where: w.messages })).count
  // Gespräche ohne verbleibende Nachricht bzw. ohne Aktivität seit der Frist
  const portalThreads = (await db.portalThread.deleteMany({ where: { OR: [w.threads, { orgId, messages: { none: {} } }] } })).count
  const portalVisits = (await db.visitRequest.deleteMany({ where: w.visits })).count
  const old = await db.portalUpdate.findMany({ where: w.updates, select: { id: true, fileIds: true } })
  const portalUpdates = old.length ? (await db.portalUpdate.deleteMany({ where: { id: { in: old.map((u) => u.id) } } })).count : 0
  const portalSessions = (await db.portalSession.deleteMany({ where: w.sessions })).count
  const portalInvites = (await db.portalAccess.deleteMany({ where: w.invites })).count
  const portalAccounts = (await db.portalAccount.deleteMany({ where: w.accounts })).count
  return { portalMessages, portalThreads, portalVisits, portalUpdates, portalAccounts, portalInvites, portalSessions, fileIds: old.flatMap((u) => u.fileIds) }
}

/** Bei Anonymisierung einer Person: alle Portal-Daten zu ihr entfernen (Zugänge, Gespräche, Besuche, persönliche Mitteilungen). */
export async function purgePortalForResident(tx: Prisma.TransactionClient, residentId: string) {
  const accounts = await tx.portalAccess.findMany({ where: { residentId, accountId: { not: null } }, select: { accountId: true } })
  await tx.portalThread.deleteMany({ where: { residentId } })
  await tx.visitRequest.deleteMany({ where: { residentId } })
  await tx.portalUpdate.deleteMany({ where: { residentId } })
  await tx.portalAccess.deleteMany({ where: { residentId } })
  await tx.residentFile.updateMany({ where: { residentId, portalShared: true }, data: { portalShared: false, portalSharedAt: null, portalSharedById: null } })
  // Konten ohne weitere Zugänge: Sitzungen beenden (Löschung folgt nach PORTAL_ORPHAN_DAYS)
  const ids = [...new Set(accounts.map((a) => a.accountId!))]
  if (ids.length) await tx.portalSession.updateMany({ where: { accountId: { in: ids }, revokedAt: null, account: { accesses: { none: { revokedAt: null } } } }, data: { revokedAt: new Date() } })
}

/** Stündliche Bereinigung: abgelaufene Portal-Sitzungen. */
export async function cleanupPortalSessions(orgId: string, sessionsCut: Date) {
  return (await db.portalSession.deleteMany({ where: { account: { orgId }, OR: [{ expiresAt: { lt: sessionsCut } }, { revokedAt: { lt: sessionsCut } }] } })).count
}
