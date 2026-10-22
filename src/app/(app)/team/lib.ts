import 'server-only'
import type { Channel, ChannelKind } from '@prisma/client'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { inAudience } from '@/lib/audience'

/** Reihenfolge der Kanalarten in der Navigation (PRD §17.2). */
export const KIND_ORDER: ChannelKind[] = ['company', 'location', 'unit', 'care', 'admin', 'events', 'offers', 'custom']

/** Kanäle, die der Benutzer sehen darf: ohne Bereich für alle, mit Standort/Bereich nur bei Zugriff darauf. */
export async function visibleChannels(ctx: Ctx, opts: { includeArchived?: boolean } = {}) {
  const locIds = [...new Set(ctx.units.map((u) => u.locationId))]
  const rows = await db.channel.findMany({
    where: {
      orgId: ctx.org.id,
      ...(opts.includeArchived ? {} : { archived: false }),
      OR: [{ unitId: null, locationId: null }, { unitId: { in: ctx.unitIds } }, { locationId: { in: locIds } }],
    },
    orderBy: { createdAt: 'asc' },
  })
  return rows.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
}

export function channelScope(ctx: Ctx, ch: Pick<Channel, 'unitId' | 'locationId'>) {
  if (ch.unitId) return { unitId: ch.unitId, locationId: ctx.units.find((u) => u.id === ch.unitId)?.locationId ?? null }
  if (ch.locationId) return { locationId: ch.locationId }
  return undefined
}

export function channelVisible(ctx: Ctx, ch: Pick<Channel, 'unitId' | 'locationId' | 'orgId'>) {
  if (ch.orgId !== ctx.org.id) return false
  if (ch.unitId) return ctx.unitIds.includes(ch.unitId)
  if (ch.locationId) return ctx.units.some((u) => u.locationId === ch.locationId)
  return true
}

export async function myRoleKeys(userId: string) {
  const rows = await db.roleAssignment.findMany({ where: { userId }, select: { role: { select: { key: true } } } })
  return rows.map((r) => r.role.key)
}

/** Darf in den Kanal schreiben: team.post im Kanalbereich und – falls gesetzt – eine der postRoles. Moderation darf immer. */
export function canPostTo(ctx: Ctx, ch: Channel, roleKeys: string[]) {
  if (ch.archived || !channelVisible(ctx, ch)) return false
  if (ctx.can('team.moderate', channelScope(ctx, ch))) return true
  if (!ctx.can('team.post', channelScope(ctx, ch))) return false
  if (ch.postRoles.length && !ch.postRoles.some((r) => roleKeys.includes(r))) return false
  return true
}

export const canModerate = (ctx: Ctx, ch?: Pick<Channel, 'unitId' | 'locationId'>) => ctx.can('team.moderate', ch ? channelScope(ctx, ch) : undefined)

/**
 * Zielgruppe eines Kanals (für Lesebestätigungen und Benachrichtigungen):
 * aktive Mitarbeitende mit team.read, deren Rolle den Kanalbereich abdeckt.
 * Mit audienceRoles (Zielgruppe der Mitteilung, PRD §45) zusätzlich nur Personen mit einer dieser Rollen.
 */
export async function channelAudience(orgId: string, ch: Pick<Channel, 'unitId' | 'locationId'>, audienceRoles: readonly string[] = []) {
  const [rows, units] = await Promise.all([
    db.roleAssignment.findMany({
      where: { role: { orgId }, user: { orgId, active: true } },
      select: { unitId: true, locationId: true, role: { select: { key: true, permissions: true } }, user: { select: { id: true, firstName: true, lastName: true, initials: true, jobTitle: true } } },
    }),
    db.unit.findMany({ where: { orgId }, select: { id: true, locationId: true } }),
  ])
  const unitLoc = new Map(units.map((u) => [u.id, u.locationId]))
  const chLoc = ch.unitId ? unitLoc.get(ch.unitId) : ch.locationId
  const covers = (a: { unitId: string | null; locationId: string | null }) => {
    if (!a.unitId && !a.locationId) return true
    if (ch.unitId) return a.unitId === ch.unitId || (!!a.locationId && a.locationId === chLoc)
    if (ch.locationId) return a.locationId === ch.locationId || (!!a.unitId && unitLoc.get(a.unitId) === ch.locationId)
    return true
  }
  const keys = new Map<string, Set<string>>()
  for (const r of rows) keys.set(r.user.id, (keys.get(r.user.id) ?? new Set()).add(r.role.key))
  const out = new Map<string, (typeof rows)[number]['user']>()
  for (const r of rows) if (r.role.permissions.includes('team.read') && covers(r) && inAudience(audienceRoles, keys.get(r.user.id) ?? [])) out.set(r.user.id, r.user)
  return [...out.values()].sort((a, b) => a.lastName.localeCompare(b.lastName))
}

/**
 * Sichtbarkeit von Mitteilungen mit Zielgruppe (Prisma-Bedingung): ohne Zielgruppe für alle im Kanal,
 * sonst für Personen mit passender Rolle, Verfassende und die Moderation der übergebenen Kanäle.
 */
export function postAudienceWhere(ctx: Ctx, roleKeys: string[], moderatedChannelIds: string[] = []) {
  return {
    OR: [
      { audienceRoles: { isEmpty: true } },
      ...(roleKeys.length ? [{ audienceRoles: { hasSome: roleKeys } }] : []),
      { authorId: ctx.user.id },
      ...(moderatedChannelIds.length ? [{ channelId: { in: moderatedChannelIds } }] : []),
    ],
  }
}

/** Darf die Person diese Mitteilung sehen (Kanal sichtbar und in der Zielgruppe bzw. verfassend/moderierend)? */
export function postVisible(ctx: Ctx, post: { authorId: string; audienceRoles: string[]; channel: Pick<Channel, 'unitId' | 'locationId' | 'orgId'> }, roleKeys: string[]) {
  if (!channelVisible(ctx, post.channel)) return false
  return post.authorId === ctx.user.id || inAudience(post.audienceRoles, roleKeys) || canModerate(ctx, post.channel)
}

/** Sichtbare, nicht abgelaufene Mitteilungen. */
export const liveFilter = (now = new Date()) => ({ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] })

export function channelLabel(t: Ctx['t'], ch: Pick<Channel, 'kind' | 'name'>, all: Pick<Channel, 'kind'>[]) {
  if (ch.kind === 'custom') return ch.name
  return all.filter((c) => c.kind === ch.kind).length > 1 ? ch.name : t('team.kinds.' + ch.kind)
}
