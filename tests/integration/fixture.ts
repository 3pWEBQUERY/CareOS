/**
 * Testrahmen für Integrationstests gegen Postgres (PRD §66 Maintainability).
 *
 * - Läuft nur mit DATABASE_URL (CI: Postgres-Service mit allen Migrationen); lokal z. B. gegen eine eigene Test-DB:
 *   `DATABASE_URL=postgresql://careos:careos@localhost:5432/careos_it TZ=Europe/Zurich npm test`.
 * - Jede Testdatei legt eine eigene Organisation an (zufälliger Slug) und löscht sie am Ende (Cascade). Audit-Einträge
 *   bleiben (Trigger), sie tragen nur die Kennung der Test-Organisation.
 * - `ctxFor(userId)` baut den Anfrage-Kontext wie getCtx() aus Rollen und Bereichen der Person – ohne Cookies und
 *   Sitzung. Damit lassen sich Berechtigungsgrenzen (residentInScope, ctx.can mit Bereich) und Server-Logik testen.
 *   Portale (Paket A, Ä) bauen ihre eigenen Kontexte; dieser Rahmen liefert Organisation, Bereiche und Personen.
 */
import { randomUUID } from 'node:crypto'
import { DEFAULT_ROLES, hasPermission, type Grant, type Permission } from '../../src/lib/permissions'
import { makeT } from '../../src/i18n/core'
import { dictionary } from '../../src/i18n'
import type { Ctx } from '../../src/lib/context'

export const hasDb = !!process.env.DATABASE_URL && process.env.SKIP_DB_TESTS !== 'true'
export const dbOpts = { skip: !hasDb, concurrency: false } as const

export async function getDb() {
  return (await import('../../src/lib/db')).db
}

export type Fixture = Awaited<ReturnType<typeof createFixture>>

/** Organisation mit Standort, zwei Bereichen (je zwei Zimmer), Schichtmodell, Rollen und Personen. */
export async function createFixture() {
  const db = await getDb()
  const tag = randomUUID().slice(0, 8)
  const org = await db.organization.create({ data: { name: 'IT ' + tag, slug: 'it-' + tag } })
  const loc = await db.location.create({ data: { orgId: org.id, name: 'Haus' } })
  const unitA = await db.unit.create({ data: { orgId: org.id, locationId: loc.id, name: 'WG A' } })
  const unitB = await db.unit.create({ data: { orgId: org.id, locationId: loc.id, name: 'WG B' } })
  const rooms = {
    a1: await db.room.create({ data: { unitId: unitA.id, number: 'A1' } }),
    a2: await db.room.create({ data: { unitId: unitA.id, number: 'A2' } }),
    b1: await db.room.create({ data: { unitId: unitB.id, number: 'B1' } }),
  }
  await db.shiftType.createMany({
    data: [
      { orgId: org.id, code: 'early', name: 'Frühdienst', start: '07:00', end: '15:30' },
      { orgId: org.id, code: 'late', name: 'Spätdienst', start: '14:45', end: '23:00' },
      { orgId: org.id, code: 'night', name: 'Nachtdienst', start: '22:45', end: '07:15' },
    ],
  })
  const role = async (key: string) => {
    const def = DEFAULT_ROLES.find((r) => r.key === key)!
    return db.role.create({ data: { orgId: org.id, key, name: def.name, permissions: def.permissions, system: true } })
  }
  const nurseRole = await role('nurse')
  const leadRole = await role('ward_lead')
  const user = async (first: string, assign: { roleId: string; unitId?: string; locationId?: string }) => {
    const u = await db.user.create({ data: { orgId: org.id, email: `${first.toLowerCase()}.${tag}@it.test`, firstName: first, lastName: 'Test', initials: first.slice(0, 2).toUpperCase() } })
    await db.roleAssignment.create({ data: { userId: u.id, roleId: assign.roleId, unitId: assign.unitId ?? null, locationId: assign.locationId ?? null } })
    return u
  }
  const nurseA = await user('Anna', { roleId: nurseRole.id, unitId: unitA.id })
  const lead = await user('Lea', { roleId: leadRole.id, locationId: loc.id })
  const resident = (unitId: string, roomId: string | null, lastName: string) =>
    db.resident.create({ data: { orgId: org.id, unitId, roomId, firstName: 'Test', lastName, birthDate: new Date(Date.UTC(1940, 0, 1)), episodes: { create: { start: new Date(Date.now() - 30 * 864e5), reason: 'Eintritt', kind: 'stay', unitId } } } })
  const resA = await resident(unitA.id, rooms.a1.id, 'Alpha')
  const resB = await resident(unitB.id, rooms.b1.id, 'Beta')
  return { db, tag, org, loc, unitA, unitB, rooms, nurseA, lead, resA, resB }
}

export async function dropFixture(f: Fixture) {
  await f.db.organization.delete({ where: { id: f.org.id } }).catch(() => {})
}

/** Anfrage-Kontext wie getCtx() (src/lib/context.ts), ohne Cookies und Sitzung. */
export async function ctxFor(f: Fixture, userId: string, unitId?: string): Promise<Ctx> {
  const db = f.db
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } })
  const org = await db.organization.findUniqueOrThrow({ where: { id: user.orgId } })
  const assignments = await db.roleAssignment.findMany({ where: { userId }, include: { role: true } })
  const grants: Grant[] = assignments.map((a) => ({ permissions: a.role.permissions, locationId: a.locationId, unitId: a.unitId }))
  const all = await db.unit.findMany({ where: { orgId: org.id }, include: { location: { select: { id: true, name: true } } }, orderBy: { name: 'asc' } })
  const orgWide = grants.some((g) => !g.unitId && !g.locationId)
  const units = orgWide ? all : all.filter((u) => grants.some((g) => g.unitId === u.id || (g.locationId && g.locationId === u.locationId)))
  const unit = units.find((u) => u.id === unitId) ?? units[0] ?? null
  const can = (perm: Permission, scope?: { unitId?: string | null; locationId?: string | null }) => hasPermission(grants, perm, scope)
  return {
    session: null, sessionId: 'it-' + f.tag, user, org, grants, roleNames: assignments.map((a) => a.role.name), units, unit, unitIds: units.map((u) => u.id),
    locale: 'de', terminology: 'resident', t: makeT(dictionary('de'), 'de', 'resident'), can,
    canHere: (perm: Permission) => hasPermission(grants, perm, unit ? { unitId: unit.id, locationId: unit.locationId } : undefined),
    modules: org.modules, hasModule: () => true, emergency: null, ip: null, userAgent: 'integration-test',
  } as unknown as Ctx
}
