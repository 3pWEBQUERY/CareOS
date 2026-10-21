/**
 * Erststart ohne Demodaten: legt Organisation, Standort, Bereich, Standardkonfiguration und
 * einen Systemadministrator an – nur wenn die Datenbank leer ist.
 * Variablen: INIT_ORG_NAME, INIT_LOCATION_NAME, INIT_UNIT_NAME, INIT_ADMIN_EMAIL, INIT_ADMIN_PASSWORD
 */
import { PrismaClient, type Prisma } from '@prisma/client'
import { hash } from '@node-rs/argon2'
import { DEFAULT_ROLES } from '../src/lib/permissions'
import { ASSESSMENTS, CARE_DOMAINS, INCIDENT_TYPES } from '../src/lib/clinical-config'
import { VITALS, VITAL_KEYS } from '../src/lib/vitals'

const db = new PrismaClient()

async function main() {
  if (await db.organization.count()) return console.log('Bootstrap übersprungen: Datenbank enthält bereits eine Organisation.')
  const email = (process.env.INIT_ADMIN_EMAIL ?? '').trim().toLowerCase()
  const password = process.env.INIT_ADMIN_PASSWORD ?? ''
  if (!email || password.length < 12) return console.log('Bootstrap übersprungen: INIT_ADMIN_EMAIL und INIT_ADMIN_PASSWORD (min. 12 Zeichen) setzen.')

  const name = process.env.INIT_ORG_NAME || 'Meine Organisation'
  const org = await db.organization.create({ data: { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'org' } })
  const loc = await db.location.create({ data: { orgId: org.id, name: process.env.INIT_LOCATION_NAME || 'Hauptstandort' } })
  const unit = await db.unit.create({ data: { orgId: org.id, locationId: loc.id, name: process.env.INIT_UNIT_NAME || 'Bereich 1' } })

  let adminRole = ''
  for (const r of DEFAULT_ROLES) {
    const role = await db.role.create({ data: { orgId: org.id, key: r.key, name: r.name, permissions: r.permissions, system: true } })
    if (r.key === 'sysadmin') adminRole = role.id
  }
  for (const s of [
    { code: 'F', name: 'Frühdienst', start: '07:00', end: '15:30' },
    { code: 'S', name: 'Spätdienst', start: '14:45', end: '23:00' },
    { code: 'N', name: 'Nachtdienst', start: '22:45', end: '07:15' },
  ]) await db.shiftType.create({ data: { orgId: org.id, ...s } })
  for (const [i, d] of CARE_DOMAINS.entries()) await db.careDomain.create({ data: { orgId: org.id, key: d.key, name: d.de, order: i } })
  for (const a of ASSESSMENTS) await db.assessmentDefinition.create({ data: { orgId: org.id, key: a.key, name: a.name, description: a.description, items: a.items as unknown as Prisma.InputJsonValue, intervalDays: a.intervalDays } })
  for (const it of INCIDENT_TYPES) await db.incidentType.create({ data: { orgId: org.id, key: it.key, name: it.de, workflow: it.workflow as unknown as Prisma.InputJsonValue } })
  for (const k of VITAL_KEYS.filter((k) => k !== 'weight')) await db.vitalThreshold.create({ data: { orgId: org.id, key: k, lo: VITALS[k].lo, hi: VITALS[k].hi } })
  for (const c of [
    { name, kind: 'company' as const },
    { name: loc.name, kind: 'location' as const, locationId: loc.id },
    { name: unit.name, kind: 'unit' as const, unitId: unit.id },
    { name: 'Pflege', kind: 'care' as const },
  ]) await db.channel.create({ data: { orgId: org.id, ...c } })
  await db.featureFlag.createMany({ data: [{ orgId: org.id, key: 'ai', enabled: true }, { orgId: org.id, key: 'voice', enabled: true }, { orgId: org.id, key: 'medication', enabled: true }] })

  const user = await db.user.create({
    data: { orgId: org.id, email, firstName: 'System', lastName: 'Administration', initials: 'SA', jobTitle: 'Systemadministration', passwordHash: await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 }), primaryUnitId: unit.id },
  })
  await db.roleAssignment.create({ data: { userId: user.id, roleId: adminRole } })
  await db.auditLog.create({ data: { orgId: org.id, userId: user.id, action: 'org.bootstrap', entityType: 'Organization', entityId: org.id } })
  console.log(`Organisation "${name}" angelegt. Anmeldung: ${email}`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
