import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { audit } from '@/lib/audit'
import { exportRateLimit } from '@/lib/rate-limit'

/**
 * Datenexport der Organisation als JSON (Datenportabilität, PRD §36).
 * Enthält Struktur, Konfiguration, Mitarbeitende (ohne Geheimnisse) und alle Bewohnerdaten.
 * Nicht enthalten: Passwort-Hashes, MFA-Geheimnisse, Passkeys, Sitzungen, API-Token-Hashes, Webhook-Secrets.
 */
export async function GET() {
  const ctx = await getCtx()
  if (!ctx.can('admin.org')) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const rl = await exportRateLimit('org', ctx.user.id)
  if (!rl.ok) return NextResponse.json({ error: 'rate' }, { status: 429, headers: { 'retry-after': String(rl.retryAfter) } })
  const orgId = ctx.org.id
  const [org, locations, units, teams, roles, users, qualifications, shiftTypes, careDomains, assessmentDefs, incidentTypes, vitalThresholds, channels, featureFlags, residents, incidents, documents, courses] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: orgId } }),
    db.location.findMany({ where: { orgId } }),
    db.unit.findMany({ where: { orgId }, include: { rooms: true } }),
    db.team.findMany({ where: { orgId }, include: { members: { select: { userId: true } } } }),
    db.role.findMany({ where: { orgId } }),
    db.user.findMany({
      where: { orgId },
      select: {
        id: true, email: true, firstName: true, lastName: true, initials: true, jobTitle: true, employeeNo: true, phone: true, locale: true,
        active: true, primaryUnitId: true, createdAt: true, lastLoginAt: true, mfaEnabled: true,
        roles: { select: { roleId: true, unitId: true, locationId: true } },
        qualifications: { select: { qualificationId: true, validUntil: true } },
        certificates: true,
      },
    }),
    db.qualification.findMany({ where: { orgId } }),
    db.shiftType.findMany({ where: { orgId } }),
    db.careDomain.findMany({ where: { orgId } }),
    db.assessmentDefinition.findMany({ where: { orgId } }),
    db.incidentType.findMany({ where: { orgId } }),
    db.vitalThreshold.findMany({ where: { orgId, residentId: null } }),
    db.channel.findMany({ where: { orgId } }),
    db.featureFlag.findMany({ where: { orgId } }),
    db.resident.findMany({
      where: { orgId },
      include: {
        contacts: true, episodes: true, appointments: true, observations: true, vitals: true, vitalLimits: true,
        carePlans: { include: { areas: true } }, interventions: true, assessments: true, wounds: { include: { entries: true } },
        nutrition: true, intake: true, medications: true, administrations: true, files: { include: { file: { select: { id: true, filename: true, contentType: true, size: true, createdAt: true } } } },
      },
    }),
    db.incident.findMany({ where: { orgId }, include: { actions: true } }),
    db.document.findMany({ where: { orgId }, include: { versions: true } }),
    db.course.findMany({ where: { orgId }, include: { modules: true } }),
  ])
  const { settings, ...orgData } = org
  const body = {
    format: 'careos-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: ctx.user.email,
    organization: { ...orgData, settings },
    locations, units, teams, roles, users, qualifications, shiftTypes,
    clinicalConfiguration: { careDomains, assessmentDefinitions: assessmentDefs, incidentTypes, vitalThresholds, featureFlags },
    channels, residents, incidents, documents, courses,
  }
  await audit(ctx, { action: 'admin.export.org', entityType: 'Organization', entityId: orgId, context: { residents: residents.length, users: users.length, incidents: incidents.length, documents: documents.length } })
  const name = `careos-export-${org.slug}-${new Date().toISOString().slice(0, 10)}.json`
  return new NextResponse(JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? undefined : v), 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'private, no-store' },
  })
}
