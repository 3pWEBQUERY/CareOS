import 'server-only'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { auditSystem } from '@/lib/audit'
import { deleteObject } from '@/lib/storage'
import { storageConfigured } from '@/lib/env'
import {
  ANONYMISED_NAME, DELETED_TEXT, DEFAULT_RETENTION, RETENTION_CATEGORIES, anonymisedBirthDate, retentionCutoffs, retentionPolicy,
  type RetentionCategory, type RetentionPolicy,
} from '@/lib/retention-policy'

/**
 * Löschkonzept (PRD §36). Bewohnerakten werden nach Ablauf der Frist anonymisiert (nicht gelöscht),
 * damit aggregierte Kennzahlen erhalten bleiben. Alle übrigen Kategorien werden gelöscht.
 * Jeder Lauf schreibt einen Audit-Eintrag "retention.run" mit den Anzahlen (Löschprotokoll).
 */
export type RetentionCounts = Record<RetentionCategory, number> & { files: number; filesFailed: number; missingDischarge: number }

const empty = (): RetentionCounts => ({ ...(Object.fromEntries(RETENTION_CATEGORIES.map((c) => [c, 0])) as Record<RetentionCategory, number>), files: 0, filesFailed: 0, missingDischarge: 0 })

const LEAVERS = ['discharged', 'deceased'] as const

/** Stichtag für das Audit-Protokoll, nie jünger als die gesetzliche Sperre von 10 Jahren (DB-Trigger). */
function auditCutoff(policyCutoff: Date, now: Date) {
  const hard = new Date(now)
  hard.setFullYear(hard.getFullYear() - 10)
  return policyCutoff < hard ? policyCutoff : hard
}

function where(orgId: string, policy: RetentionPolicy, now: Date) {
  const cut = retentionCutoffs(policy, now)
  return {
    cut,
    clinical: { orgId, status: { in: [...LEAVERS] }, anonymisedAt: null, dischargedAt: { lt: cut.clinical } } satisfies Prisma.ResidentWhereInput,
    chat: { conversation: { orgId }, createdAt: { lt: cut.chat } } satisfies Prisma.MessageWhereInput,
    notifications: { user: { orgId }, createdAt: { lt: cut.notifications } } satisfies Prisma.NotificationWhereInput,
    events: { orgId, createdAt: { lt: cut.events } } satisfies Prisma.DomainEventWhereInput,
    webhooks: { webhook: { orgId }, createdAt: { lt: cut.webhooks } } satisfies Prisma.WebhookDeliveryWhereInput,
    ai: { orgId, createdAt: { lt: cut.ai } } satisfies Prisma.AiInteractionWhereInput,
    sessions: { user: { orgId }, OR: [{ expiresAt: { lt: cut.sessions } }, { revokedAt: { lt: cut.sessions } }] } satisfies Prisma.SessionWhereInput,
    audit: { orgId, at: { lt: auditCutoff(cut.audit, now) } } satisfies Prisma.AuditLogWhereInput,
  }
}

/** Probelauf: was würde mit der aktuellen (oder einer übergebenen) Richtlinie anonymisiert bzw. gelöscht? */
export async function retentionPreview(orgId: string, policy?: RetentionPolicy, now = new Date()) {
  const p = policy ?? retentionPolicy((await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } })).settings)
  const w = where(orgId, p, now)
  const [clinical, missingDischarge, chat, notifications, events, webhooks, ai, sessions, audit] = await Promise.all([
    db.resident.count({ where: w.clinical }),
    db.resident.count({ where: { orgId, status: { in: [...LEAVERS] }, anonymisedAt: null, dischargedAt: null } }),
    db.message.count({ where: w.chat }),
    db.notification.count({ where: w.notifications }),
    db.domainEvent.count({ where: w.events }),
    db.webhookDelivery.count({ where: w.webhooks }),
    db.aiInteraction.count({ where: w.ai }),
    db.session.count({ where: w.sessions }),
    db.auditLog.count({ where: w.audit }),
  ])
  const counts: RetentionCounts = { ...empty(), clinical, missingDischarge, chat, notifications, events, webhooks, ai, sessions, audit }
  return { policy: p, cutoffs: w.cut, counts }
}

/**
 * Entfernt Dateien aus dem Bucket und die zugehörigen FileObject-Datensätze.
 * Schlägt das Löschen im Bucket fehl, bleibt der Datensatz bestehen, damit ein späterer Lauf es erneut versucht.
 */
export async function deleteFiles(orgId: string, ids: string[]) {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return { deleted: 0, failed: 0 }
  const files = await db.fileObject.findMany({ where: { id: { in: uniq }, orgId }, select: { id: true, key: true } })
  const gone: string[] = []
  let failed = 0
  const bucket = storageConfigured()
  for (const f of files) {
    if (bucket) {
      try {
        await deleteObject(f.key)
      } catch (e) {
        failed++
        console.error('[retention] bucket delete failed', f.id, String(e).slice(0, 200))
        continue
      }
    }
    gone.push(f.id)
  }
  if (gone.length) await db.fileObject.deleteMany({ where: { id: { in: gone } } })
  return { deleted: gone.length, failed }
}

/**
 * Anonymisiert eine Person: Namen, Geburtsdatum (nur Jahr), Kontakte, Versicherungsnummer, Foto,
 * Dokumente und Wundfotos, Freitexte. Strukturierte Werte (Vitalwerte, Scores, Daten, Status) bleiben
 * für Statistiken erhalten. Idempotent; anonymisedAt wird erst gesetzt, wenn alle Dateien gelöscht sind.
 */
export async function anonymiseResident(residentId: string) {
  const r = await db.resident.findUniqueOrThrow({
    where: { id: residentId },
    select: {
      id: true, orgId: true, birthDate: true, photoFileId: true,
      files: { select: { fileId: true } },
      wounds: { select: { entries: { select: { photoIds: true } } } },
    },
  })
  const fileIds = [...(r.photoFileId ? [r.photoFileId] : []), ...r.files.map((f) => f.fileId), ...r.wounds.flatMap((w) => w.entries.flatMap((e) => e.photoIds))]
  const T = DELETED_TEXT
  const txt = (v: string | null) => (v ? T : v)

  await db.$transaction(async (tx) => {
    await tx.resident.update({
      where: { id: r.id },
      data: {
        firstName: '#' + r.id.slice(-6), lastName: ANONYMISED_NAME, birthDate: anonymisedBirthDate(r.birthDate),
        insuranceNo: null, photoFileId: null, physician: null, importantNotes: null, primaryNurseId: null, roomId: null,
      },
    })
    await tx.contact.deleteMany({ where: { residentId: r.id } })
    await tx.observation.updateMany({ where: { residentId: r.id }, data: { text: T, structured: Prisma.DbNull } })
    await tx.vitalSign.updateMany({ where: { residentId: r.id, note: { not: null } }, data: { note: T } })
    await tx.appointment.updateMany({ where: { residentId: r.id }, data: { title: T, notes: null, place: null } })
    await tx.careEpisode.updateMany({ where: { residentId: r.id }, data: { reason: T } })
    await tx.intakeLog.updateMany({ where: { residentId: r.id, item: { not: null } }, data: { item: null } })
    await tx.nutritionProfile.updateMany({ where: { residentId: r.id }, data: { notes: null, supplements: null } })
    await tx.medication.updateMany({ where: { residentId: r.id }, data: { notes: null, prescriber: null } })
    await tx.medicationAdministration.updateMany({ where: { residentId: r.id }, data: { note: null, effectNote: null } })
    await tx.intervention.updateMany({ where: { residentId: r.id }, data: { instructions: null } })
    await tx.assessment.updateMany({ where: { residentId: r.id }, data: { answers: {} } })
    await tx.task.updateMany({ where: { residentId: r.id }, data: { description: null, note: null } })
    await tx.handoverEntry.updateMany({ where: { residentId: r.id }, data: { watch: null, open: null } })
    const plans = await tx.carePlan.findMany({ where: { residentId: r.id }, select: { id: true } })
    const areas = await tx.carePlanArea.findMany({ where: { carePlanId: { in: plans.map((p) => p.id) } } })
    for (const a of areas) {
      await tx.carePlanArea.update({
        where: { id: a.id },
        data: { situation: txt(a.situation), resources: txt(a.resources), needs: txt(a.needs), risks: txt(a.risks), goal: txt(a.goal), evaluation: txt(a.evaluation) },
      })
    }
    const wounds = await tx.wound.findMany({ where: { residentId: r.id }, select: { id: true } })
    await tx.woundAssessment.updateMany({ where: { woundId: { in: wounds.map((w) => w.id) } }, data: { description: null, treatment: null, photoIds: [] } })
    await tx.wound.updateMany({ where: { residentId: r.id }, data: { origin: null } })
    // Ereignisse bleiben für die Qualitätsstatistik bestehen, Freitexte werden entfernt.
    const incidents = await tx.incident.findMany({ where: { residentId: r.id }, select: { id: true, immediateActions: true, assessment: true, analysis: true, conclusion: true } })
    for (const i of incidents) {
      await tx.incident.update({
        where: { id: i.id },
        data: { description: T, place: null, immediateActions: txt(i.immediateActions), assessment: txt(i.assessment), analysis: txt(i.analysis), conclusion: txt(i.conclusion) },
      })
    }
    await tx.residentFile.updateMany({ where: { residentId: r.id }, data: { title: T } })
  })

  const files = await deleteFiles(r.orgId, fileIds)
  if (!files.failed) await db.resident.update({ where: { id: r.id }, data: { anonymisedAt: new Date() } })
  return files
}

const BATCH = 500

/** Führt die Aufbewahrungsrichtlinie einer Organisation aus. Rückgabe: Anzahl je Kategorie. */
export async function runRetention(orgId: string, opts: { now?: Date; actorId?: string | null; trigger?: string } = {}) {
  const now = opts.now ?? new Date()
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } })
  const policy = retentionPolicy(org.settings)
  const w = where(orgId, policy, now)
  const counts = empty()

  // 1. Bewohnerakten anonymisieren
  const residents = await db.resident.findMany({ where: w.clinical, select: { id: true } })
  for (const r of residents) {
    const f = await anonymiseResident(r.id)
    counts.clinical++
    counts.files += f.deleted
    counts.filesFailed += f.failed
  }
  counts.missingDischarge = await db.resident.count({ where: { orgId, status: { in: [...LEAVERS] }, anonymisedAt: null, dischargedAt: null } })

  // 2. Chatnachrichten inkl. Anhänge
  for (;;) {
    const msgs = await db.message.findMany({ where: w.chat, select: { id: true, fileIds: true }, take: BATCH })
    if (!msgs.length) break
    const f = await deleteFiles(orgId, msgs.flatMap((m) => m.fileIds))
    counts.files += f.deleted
    counts.filesFailed += f.failed
    counts.chat += (await db.message.deleteMany({ where: { id: { in: msgs.map((m) => m.id) } } })).count
    if (msgs.length < BATCH) break
  }

  // 3. Technische Daten
  counts.notifications = (await db.notification.deleteMany({ where: w.notifications })).count
  counts.events = (await db.domainEvent.deleteMany({ where: w.events })).count
  counts.webhooks = (await db.webhookDelivery.deleteMany({ where: w.webhooks })).count
  counts.ai = (await db.aiInteraction.deleteMany({ where: w.ai })).count
  counts.sessions = (await db.session.deleteMany({ where: w.sessions })).count

  // 4. Audit-Protokoll: nur mit Freigabe des Triggers und nur älter als 10 Jahre (siehe Migration audit_retention).
  counts.audit = await deleteAuditBefore(orgId, w.audit.at.lt)

  await auditSystem({
    orgId,
    userId: opts.actorId ?? null,
    action: 'retention.run',
    entityType: 'Organization',
    entityId: orgId,
    after: counts,
    context: { trigger: opts.trigger ?? 'schedule', policy, cutoffs: Object.fromEntries(Object.entries(w.cut).map(([k, v]) => [k, v.toISOString()])) },
  })
  return counts
}

/** Audit-Einträge ohne Organisation (z. B. fehlgeschlagene Anmeldungen unbekannter Konten) nach Standardfrist. */
export async function runSystemRetention(now = new Date()) {
  const audit = await deleteAuditBefore(null, auditCutoff(retentionCutoffs(DEFAULT_RETENTION, now).audit, now))
  await auditSystem({ action: 'retention.run', entityType: 'System', after: { audit }, context: { trigger: 'schedule', scope: 'system' } })
  return { audit }
}

/** Löscht Audit-Einträge vor dem Stichtag. orgId null = Einträge ohne Organisation (z. B. fehlgeschlagene Anmeldungen). */
export async function deleteAuditBefore(orgId: string | null, cutoff: Date) {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL careos.retention = 'on'`)
    // Gleiche Bedingung wie im Trigger, damit keine Zeile abgewiesen wird und die Transaktion abbricht.
    return orgId
      ? tx.$executeRaw`DELETE FROM "AuditLog" WHERE "orgId" = ${orgId} AND "at" < ${cutoff} AND "at" < now() - interval '10 years'`
      : tx.$executeRaw`DELETE FROM "AuditLog" WHERE "orgId" IS NULL AND "at" < ${cutoff} AND "at" < now() - interval '10 years'`
  }, { timeout: 120_000 })
}

/** Stündliche Bereinigung: abgelaufene Anmelde-Challenges und Sitzungen gemäss Richtlinie, alte Jobläufe. */
export async function runCleanup(now = new Date()) {
  const challenges = (await db.authChallenge.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 3600_000) } } })).count
  let sessions = 0
  const orgs = await db.organization.findMany({ select: { id: true, settings: true } })
  for (const o of orgs) {
    const cut = retentionCutoffs(retentionPolicy(o.settings), now).sessions
    sessions += (await db.session.deleteMany({ where: { user: { orgId: o.id }, OR: [{ expiresAt: { lt: cut } }, { revokedAt: { lt: cut } }] } })).count
  }
  // Protokoll der häufigen Jobs nach 30 Tagen kürzen; Retention-Läufe bleiben als Löschprotokoll erhalten.
  const jobRuns = (await db.jobRun.deleteMany({ where: { name: { in: ['escalations', 'cleanup'] }, startedAt: { lt: new Date(now.getTime() - 30 * 86400_000) } } })).count
  return { challenges, sessions, jobRuns }
}
