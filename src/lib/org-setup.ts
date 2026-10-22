/**
 * Neue Organisation mit Standardkonfiguration anlegen – für den Erststart (prisma/bootstrap.ts, INIT_*)
 * und die optionale Registrierung neuer Organisationen (/register, ORG_SIGNUP=true).
 *
 * Bewusst ohne 'server-only' und mit relativen Importen: läuft auch unter tsx ausserhalb von Next.js.
 * Alles geschieht in einer Transaktion; bei Abbruch bleibt die Datenbank unverändert.
 * Optional werden Mitarbeitende (ohne Passwort, Zugang per Einladungslink) und Bewohnende (nur Stammdaten,
 * Akte leer) zufällig erzeugt (src/lib/generate/people.ts).
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { DEFAULT_ROLES } from './permissions'
import { ASSESSMENTS, CARE_DOMAINS, INCIDENT_TYPES } from './clinical-config'
import { DEFAULT_FORMS } from './forms'
import { VITALS, VITAL_KEYS } from './vitals'
import { generateResidents, generateStaff, makeRng, roomNumber, uniqueInitials } from './generate/people'

export type OrgSetupOptions = {
  orgName: string
  locationName?: string
  /** Name bei einer Wohngruppe, sonst Präfix («Wohngruppe» → Wohngruppe 1, 2 …) */
  unitName?: string
  units?: number
  admin: { email: string; firstName?: string; lastName?: string; passwordHash: string; locale?: 'de' | 'fr' | 'it' | 'en' }
  /** Anzahl zufälliger Mitarbeitender (ohne Passwort; Einladungslinks unter Admin → Benutzer → Einladungen) */
  staff?: number
  /** Platzhalter-Domain für die E-Mail-Adressen der Mitarbeitenden */
  staffDomain?: string
  /** Anzahl zufälliger Bewohnender (nur Stammdaten) */
  residents?: number
  /** Reproduzierbare Zufallsdaten */
  seed?: string | null
  /** Nur anlegen, wenn noch keine Organisation existiert (Erststart; mit Advisory Lock gegen parallele Instanzen). */
  onlyIfEmpty?: boolean
  source: 'bootstrap' | 'signup'
  today?: Date
}

export type OrgSetupResult = { orgId: string; adminId: string; counts: { units: number; rooms: number; staff: number; residents: number } }

export const MAX_UNITS = 50
export const MAX_STAFF = 2000
export const MAX_RESIDENTS = 5000

const clamp = (n: number | undefined, max: number, min = 0) => Math.min(max, Math.max(min, Math.floor(Number.isFinite(n) ? (n as number) : min)))

export const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'org'

const utcDate = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))

/** Liefert null, wenn onlyIfEmpty gesetzt ist und bereits eine Organisation existiert. */
export async function setupOrganization(client: PrismaClient, o: OrgSetupOptions): Promise<OrgSetupResult | null> {
  const units = clamp(o.units ?? 1, MAX_UNITS, 1)
  const staffN = clamp(o.staff, MAX_STAFF)
  const residentsN = clamp(o.residents, MAX_RESIDENTS)
  const rng = makeRng(o.seed)
  const domain = (o.staffDomain || 'example.ch').trim().toLowerCase().replace(/^@/, '')
  const adminEmail = o.admin.email.trim().toLowerCase()
  const adminFirst = o.admin.firstName?.trim() || 'System'
  const adminLast = o.admin.lastName?.trim() || 'Administration'

  return client.$transaction(async (tx) => {
    if (o.onlyIfEmpty) {
      // Mehrere Instanzen starten gleichzeitig: nur eine legt an, die anderen sehen danach die Organisation.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('careos:org-bootstrap'))`
      if (await tx.organization.count()) return null
    }
    const name = o.orgName.trim().slice(0, 120) || 'Meine Organisation'
    let slug = slugify(name)
    for (let i = 2; await tx.organization.findUnique({ where: { slug }, select: { id: true } }); i++) slug = `${slugify(name)}-${i}`

    const settings: Record<string, unknown> = {}
    if (staffN) settings.placeholderDomain = domain
    const org = await tx.organization.create({ data: { name, slug, settings: settings as Prisma.InputJsonValue } })
    const loc = await tx.location.create({ data: { orgId: org.id, name: o.locationName?.trim() || 'Hauptstandort' } })
    const prefix = o.unitName?.trim() || 'Wohngruppe'
    const single = units === 1 && !!o.unitName?.trim()
    const unitNames = Array.from({ length: units }, (_, i) => (single ? prefix : `${prefix} ${i + 1}`))
    const unitIds: string[] = []
    for (const [i, unitName] of unitNames.entries()) {
      unitIds.push((await tx.unit.create({ data: { orgId: org.id, locationId: loc.id, name: unitName, shortName: !single && prefix === 'Wohngruppe' ? `WG ${i + 1}` : null } })).id)
    }

    const roles = new Map<string, string>()
    for (const r of DEFAULT_ROLES) roles.set(r.key, (await tx.role.create({ data: { orgId: org.id, key: r.key, name: r.name, permissions: r.permissions, system: true } })).id)
    await tx.shiftType.createMany({
      data: [
        { code: 'F', name: 'Frühdienst', start: '07:00', end: '15:30' },
        { code: 'S', name: 'Spätdienst', start: '14:45', end: '23:00' },
        { code: 'N', name: 'Nachtdienst', start: '22:45', end: '07:15' },
      ].map((s) => ({ orgId: org.id, ...s })),
    })
    await tx.careDomain.createMany({ data: CARE_DOMAINS.map((d, i) => ({ orgId: org.id, key: d.key, name: d.de, order: i })) })
    await tx.assessmentDefinition.createMany({ data: ASSESSMENTS.map((a) => ({ orgId: org.id, key: a.key, name: a.name, description: a.description, items: a.items as unknown as Prisma.InputJsonValue, intervalDays: a.intervalDays })) })
    await tx.formDefinition.createMany({ data: DEFAULT_FORMS.map((f) => ({ orgId: org.id, key: f.key, name: f.name, category: f.category, description: f.description, fields: f.fields as unknown as Prisma.InputJsonValue, active: true })) })
    await tx.incidentType.createMany({ data: INCIDENT_TYPES.map((it) => ({ orgId: org.id, key: it.key, name: it.de, workflow: it.workflow as unknown as Prisma.InputJsonValue })) })
    await tx.vitalThreshold.createMany({ data: VITAL_KEYS.filter((k) => k !== 'weight').map((k) => ({ orgId: org.id, key: k, lo: VITALS[k].lo, hi: VITALS[k].hi })) })
    await tx.channel.createMany({
      data: [
        { orgId: org.id, name, kind: 'company' as const },
        { orgId: org.id, name: loc.name, kind: 'location' as const, locationId: loc.id },
        ...unitIds.map((id, i) => ({ orgId: org.id, name: unitNames[i], kind: 'unit' as const, unitId: id })),
        { orgId: org.id, name: 'Pflege', kind: 'care' as const },
      ],
    })
    await tx.featureFlag.createMany({ data: ['ai', 'voice', 'medication'].map((key) => ({ orgId: org.id, key, enabled: true })) })

    // Systemadministration
    const initials = new Set<string>()
    const admin = await tx.user.create({
      data: {
        orgId: org.id, email: adminEmail, firstName: adminFirst, lastName: adminLast, initials: uniqueInitials(adminFirst, adminLast, initials),
        jobTitle: 'Systemadministration', passwordHash: o.admin.passwordHash, primaryUnitId: unitIds[0], locale: o.admin.locale ?? 'de',
      },
    })
    await tx.roleAssignment.create({ data: { userId: admin.id, roleId: roles.get('sysadmin')! } })

    // Mitarbeitende: kein Passwort, Zugang über Einladungslink (Admin → Benutzer → Einladungen)
    const staff = generateStaff(staffN, { units, rng, domain, takenEmails: [adminEmail], takenInitials: initials })
    if (staff.length) {
      const users = await tx.user.createManyAndReturn({
        data: staff.map((s) => ({ orgId: org.id, email: s.email, firstName: s.firstName, lastName: s.lastName, initials: s.initials, jobTitle: s.jobTitle, primaryUnitId: unitIds[s.unitIndex], passwordHash: null })),
        select: { id: true, email: true },
      })
      const idByEmail = new Map(users.map((u) => [u.email, u.id]))
      // Pflegedienstleitung für den ganzen Standort, alle anderen für ihre Wohngruppe
      await tx.roleAssignment.createMany({
        data: staff.map((s) => ({ userId: idByEmail.get(s.email)!, roleId: roles.get(s.role)!, ...(s.kind === 'director' ? { locationId: loc.id } : { unitId: unitIds[s.unitIndex] }) })),
      })
      const teams = await Promise.all(unitIds.map((unitId, i) => tx.team.create({ data: { orgId: org.id, unitId, name: `Team ${unitNames[i]}` } })))
      await tx.teamMember.createMany({ data: staff.map((s) => ({ teamId: teams[s.unitIndex].id, userId: idByEmail.get(s.email)! })) })
    }

    // Bewohnende: nur Stammdaten und Aufenthalt (Eintritt) – keine klinischen Daten
    let rooms = 0
    if (residentsN) {
      const perUnit = Math.ceil(residentsN / units)
      const roomRows = await tx.room.createManyAndReturn({
        data: unitIds.flatMap((unitId, ui) => Array.from({ length: perUnit }, (_, ri) => ({ unitId, number: roomNumber(ui, ri, perUnit) }))),
        select: { id: true, unitId: true, number: true },
      })
      rooms = roomRows.length
      const roomId = new Map(roomRows.map((r) => [r.unitId + ':' + r.number, r.id]))
      const people = generateResidents(residentsN, { units, rng, today: o.today })
      const created = await tx.resident.createManyAndReturn({
        data: people.map((p) => ({
          orgId: org.id, unitId: unitIds[p.unitIndex], roomId: roomId.get(unitIds[p.unitIndex] + ':' + p.room) ?? null,
          firstName: p.firstName, lastName: p.lastName, sex: p.sex, birthDate: utcDate(p.birthDate), careLevel: p.careLevel, admittedAt: p.admittedAt,
        })),
        select: { id: true, admittedAt: true },
      })
      await tx.careEpisode.createMany({ data: created.map((r) => ({ residentId: r.id, start: r.admittedAt, reason: 'Eintritt' })) })
    }

    const counts = { units, rooms, staff: staff.length, residents: residentsN }
    await tx.auditLog.create({
      data: { orgId: org.id, userId: admin.id, action: 'org.bootstrap', entityType: 'Organization', entityId: org.id, context: { source: o.source, ...counts, seeded: !!o.seed } },
    })
    return { orgId: org.id, adminId: admin.id, counts }
  }, { timeout: 180_000, maxWait: 30_000 })
}
