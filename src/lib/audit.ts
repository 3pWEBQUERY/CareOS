import 'server-only'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

type AuditCtx = { org: { id: string }; user: { id: string }; sessionId: string; ip: string | null; userAgent: string | null }

export type AuditEntry = {
  action: string
  entityType: string
  entityId?: string | null
  before?: unknown
  after?: unknown
  context?: Record<string, unknown>
}

const json = (v: unknown) => (v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue))

/** Schreibt einen unveränderbaren Audit-Eintrag (PRD §35). */
export async function audit(ctx: AuditCtx, e: AuditEntry, tx: Prisma.TransactionClient = db) {
  await tx.auditLog.create({
    data: {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      sessionId: ctx.sessionId,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      before: json(e.before),
      after: json(e.after),
      context: json(e.context),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    },
  })
}

/** Für Vorgänge ohne Sitzung (Login, Systemjobs). */
export async function auditSystem(e: AuditEntry & { orgId?: string | null; userId?: string | null; ip?: string | null; userAgent?: string | null }) {
  await db.auditLog.create({
    data: {
      orgId: e.orgId ?? null,
      userId: e.userId ?? null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      before: json(e.before),
      after: json(e.after),
      context: json(e.context),
      ip: e.ip ?? null,
      userAgent: e.userAgent ?? null,
    },
  })
}
