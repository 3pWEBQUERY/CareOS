import 'server-only'
import type { Prisma } from '@prisma/client'

export type AuditFilter = { user?: string; action?: string; entity?: string; from?: string; to?: string; page?: string }

const day = (s: string | undefined, end = false) => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(s + (end ? 'T23:59:59.999' : 'T00:00:00'))
  return Number.isNaN(d.getTime()) ? null : d
}

/** Gemeinsame Filterlogik für Tabelle und CSV-Export. Immer auf die Organisation beschränkt. */
export function auditWhere(orgId: string, f: AuditFilter): Prisma.AuditLogWhereInput {
  const from = day(f.from)
  const to = day(f.to, true)
  return {
    orgId,
    ...(f.user ? { userId: f.user } : {}),
    ...(f.action ? { action: { startsWith: f.action.trim().slice(0, 80) } } : {}),
    ...(f.entity ? { entityType: f.entity } : {}),
    ...(from || to ? { at: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  }
}
