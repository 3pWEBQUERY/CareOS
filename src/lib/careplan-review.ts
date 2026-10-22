import 'server-only'
import { db } from './db'
import type { Ctx } from './context'
import { careplanChanges, type CarePlanChanges } from './careplan-diff'

/**
 * Freigabeliste der Pflegeplanung (PRD §9): eingereichte Entwürfe in den Bereichen, in denen die Person
 * `resident.careplan.approve` hat. «Eingereicht» heisst wie in der Akte (`careplan/data.ts`): die letzte
 * Aktion am Entwurf ist `careplan.submit` – wurde danach weiter bearbeitet, ist er wieder ein Entwurf.
 */

/** Bereiche, in denen die Person Pflegeplanungen freigeben darf. */
export function approvalUnitIds(ctx: Ctx) {
  return ctx.units.filter((u) => ctx.can('resident.careplan.approve', { unitId: u.id, locationId: u.locationId })).map((u) => u.id)
}

/** Einreichung (Zeitpunkt, Person) je Entwurf, sofern die letzte Aktion die Einreichung ist. */
export async function submittedDrafts(orgId: string, drafts: { id: string; createdAt: Date }[]) {
  const out = new Map<string, { at: Date; userId: string | null }>()
  if (!drafts.length) return out
  const since = new Date(Math.min(...drafts.map((d) => d.createdAt.getTime())) - 60_000)
  const rows = await db.$queryRaw<{ planId: string; action: string; at: Date; userId: string | null }[]>`
    SELECT DISTINCT ON (context->>'carePlanId') context->>'carePlanId' AS "planId", action, at, "userId"
    FROM "AuditLog"
    WHERE "orgId" = ${orgId} AND at >= ${since}
      AND context->>'carePlanId' = ANY(${drafts.map((d) => d.id)}::text[])
      AND action <> 'careplan.suggestion.dismiss'
    ORDER BY context->>'carePlanId', at DESC, id DESC`
  for (const r of rows) if (r.action === 'careplan.submit') out.set(r.planId, { at: r.at, userId: r.userId })
  return out
}

const draftWhere = (orgId: string, unitIds: string[]) => ({
  status: 'draft' as const,
  resident: { orgId, unitId: { in: unitIds }, status: { in: ['active' as const, 'absent' as const] } },
})

/** Anzahl eingereichter Entwürfe (Leitungs-Startseite). */
export async function approvalCount(ctx: Ctx, unitIds: string[]) {
  if (!unitIds.length) return 0
  const drafts = await db.carePlan.findMany({ where: draftWhere(ctx.org.id, unitIds), select: { id: true, createdAt: true } })
  return (await submittedDrafts(ctx.org.id, drafts)).size
}

export type ApprovalRow = {
  planId: string
  version: number
  resident: { id: string; name: string; room: string | null; unit: string }
  submittedAt: Date
  submittedBy: string | null
  activeVersion: number | null
  changes: CarePlanChanges
}

/** Eingereichte Entwürfe mit Änderungen gegenüber der freigegebenen Version, älteste Einreichung zuerst. */
export async function approvalQueue(ctx: Ctx, unitIds: string[]): Promise<ApprovalRow[]> {
  if (!unitIds.length) return []
  const drafts = await db.carePlan.findMany({
    where: draftWhere(ctx.org.id, unitIds),
    include: {
      areas: { include: { interventions: true } },
      resident: { select: { id: true, firstName: true, lastName: true, room: { select: { number: true } }, unit: { select: { name: true } } } },
    },
  })
  const subs = await submittedDrafts(ctx.org.id, drafts)
  const queued = drafts.filter((d) => subs.has(d.id))
  if (!queued.length) return []
  const [actives, users] = await Promise.all([
    db.carePlan.findMany({ where: { status: 'active', residentId: { in: queued.map((d) => d.residentId) } }, include: { areas: { include: { interventions: true } } } }),
    db.user.findMany({ where: { orgId: ctx.org.id, id: { in: [...subs.values()].map((s) => s.userId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } }),
  ])
  const name = (id: string | null) => {
    const u = users.find((x) => x.id === id)
    return u ? `${u.firstName} ${u.lastName}` : null
  }
  return queued
    .map((d) => {
      const active = actives.find((a) => a.residentId === d.residentId) ?? null
      const sub = subs.get(d.id)!
      return {
        planId: d.id,
        version: d.version,
        resident: { id: d.resident.id, name: `${d.resident.lastName} ${d.resident.firstName}`, room: d.resident.room?.number ?? null, unit: d.resident.unit.name },
        submittedAt: sub.at,
        submittedBy: name(sub.userId),
        activeVersion: active?.version ?? null,
        changes: careplanChanges(
          active ? active.areas.map((a) => ({ ...a, interventions: a.interventions.filter((i) => i.active) })) : null,
          d.areas,
        ),
      }
    })
    .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime())
}
