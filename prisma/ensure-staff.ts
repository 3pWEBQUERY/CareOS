/**
 * Mitarbeitende auf eine Zielzahl auffüllen (bestehende Organisation): ENSURE_STAFF=<Anzahl>.
 * Ergänzt nur fehlende Plätze nach dem Rollen-Mix von planStaff (keine zweite PDL/Leitung), verändert oder
 * entfernt nie bestehende Personen. Neue Konten haben kein Passwort – Zugang über Admin → Benutzer → Einladungen.
 * Läuft bei jedem Start, tut aber nichts, sobald die Zahl erreicht ist. Bei mehreren Organisationen: ENSURE_STAFF_ORG=<slug>.
 */
import { PrismaClient } from '@prisma/client'
import { generateStaffFor, makeRng } from '../src/lib/generate/people'
import { kindOf, topUpPlan } from '../src/lib/staff-topup'

const db = new PrismaClient()
const MAX = 1000

async function main() {
  const target = Math.min(MAX, Number.parseInt(process.env.ENSURE_STAFF ?? '', 10) || 0)
  if (target <= 0) return
  const slug = process.env.ENSURE_STAFF_ORG?.trim()
  const orgs = await db.organization.findMany({ where: slug ? { slug } : {}, select: { id: true, settings: true } })
  if (orgs.length !== 1) return console.log(`Mitarbeitende auffüllen übersprungen: ${orgs.length} Organisationen gefunden${slug ? '' : ' – ENSURE_STAFF_ORG setzen'}.`)
  const org = orgs[0]

  await db.$transaction(async (tx) => {
    // Nur eine Instanz arbeitet (mehrere Replikas starten gleichzeitig)
    const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext('careos.ensure-staff')) AS locked`
    if (!locked) return console.log('Mitarbeitende auffüllen: läuft bereits in einer anderen Instanz.')

    const units = await tx.unit.findMany({ where: { orgId: org.id }, orderBy: [{ createdAt: 'asc' }, { name: 'asc' }], select: { id: true, name: true, locationId: true } })
    if (!units.length) return console.log('Mitarbeitende auffüllen übersprungen: keine Wohngruppen.')
    const unitIndex = new Map(units.map((u, i) => [u.id, i]))
    const users = await tx.user.findMany({
      where: { orgId: org.id, pendingSince: null },
      select: { id: true, email: true, initials: true, firstName: true, lastName: true, jobTitle: true, primaryUnitId: true, roles: { select: { role: { select: { key: true } } } } },
    })
    // Mitarbeitende = alle mit einer Pflege-/Leitungsrolle (ohne reine Administration)
    const staff = users.flatMap((u) => {
      const kind = kindOf(u.roles.map((r) => r.role.key), u.jobTitle)
      return kind ? [{ kind, unitIndex: unitIndex.get(u.primaryUnitId ?? '') ?? 0 }] : []
    })
    const missing = topUpPlan(target, units.length, staff)
    if (!missing.length) return console.log(`Mitarbeitende: ${staff.length} vorhanden, Ziel ${target} erreicht.`)

    const domain = ((org.settings ?? {}) as { placeholderDomain?: string }).placeholderDomain || process.env.INIT_STAFF_DOMAIN || 'example.ch'
    const gen = generateStaffFor(missing, {
      rng: makeRng(process.env.INIT_SEED ? process.env.INIT_SEED + ':topup' : null),
      domain,
      takenEmails: users.map((u) => u.email),
      takenInitials: users.map((u) => u.initials),
      takenNames: users.map((u) => `${u.firstName} ${u.lastName}`),
    })
    const roles = new Map((await tx.role.findMany({ where: { orgId: org.id }, select: { id: true, key: true } })).map((r) => [r.key, r.id]))
    const created = await tx.user.createManyAndReturn({
      data: gen.map((s) => ({ orgId: org.id, email: s.email, firstName: s.firstName, lastName: s.lastName, initials: s.initials, jobTitle: s.jobTitle, primaryUnitId: units[s.unitIndex].id, passwordHash: null })),
      select: { id: true, email: true },
    })
    const idByEmail = new Map(created.map((u) => [u.email, u.id]))
    await tx.roleAssignment.createMany({
      data: gen.flatMap((s) => {
        const roleId = roles.get(s.role)
        if (!roleId) return []
        return [{ userId: idByEmail.get(s.email)!, roleId, ...(s.kind === 'director' ? { locationId: units[s.unitIndex].locationId } : { unitId: units[s.unitIndex].id }) }]
      }),
    })
    // Teams je Wohngruppe (anlegen, falls es keines gibt)
    const teams = await tx.team.findMany({ where: { orgId: org.id, unitId: { in: units.map((u) => u.id) } }, select: { id: true, unitId: true } })
    const teamByUnit = new Map(teams.map((t) => [t.unitId!, t.id]))
    for (const u of units) if (!teamByUnit.has(u.id)) teamByUnit.set(u.id, (await tx.team.create({ data: { orgId: org.id, unitId: u.id, name: `Team ${u.name}` } })).id)
    await tx.teamMember.createMany({ data: gen.map((s) => ({ teamId: teamByUnit.get(units[s.unitIndex].id)!, userId: idByEmail.get(s.email)! })), skipDuplicates: true })
    await tx.auditLog.create({ data: { orgId: org.id, action: 'org.staff_topup', entityType: 'Organization', entityId: org.id, after: { target, before: staff.length, added: gen.length } } })
    console.log(`Mitarbeitende aufgefüllt: ${staff.length} → ${staff.length + gen.length} (Ziel ${target}). Einladungslinks: Admin → Benutzer → Einladungen.`)
  }, { timeout: 60_000 })
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
