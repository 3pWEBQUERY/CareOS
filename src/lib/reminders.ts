import 'server-only'
import { db } from '@/lib/db'
import { auditSystem } from '@/lib/audit'
import { notifyT } from '@/lib/notify-t'
import { syncExpired } from '@/lib/learn'
import { dateKey } from '@/lib/time'
import {
  CERT_STAGES, DOC_STAGES, DUE_STAGES, GRACE_DAYS, RENEW_DAYS, daysUntil, latestCertificates, leadNotice, reminderPriority, reminderStage, renewalDue, shouldRemind,
} from '@/lib/reminder-policy'

/**
 * Täglicher Job `reminders` (src/lib/jobs.ts, 06:30 Europe/Zurich, je Organisation einmal):
 * 1. abgelaufene Schulungen markieren (syncExpired) und Pflichtschulungen mit Gültigkeit vor Ablauf neu zuweisen,
 * 2. Zertifikate und Qualifikationen vor Ablauf (Person; Zusammenfassung an Leitungen mit learn.manage im Bereich),
 * 3. offene Schulungen vor der Frist (Person),
 * 4. Gültigkeit freigegebener Dokumente (verantwortliche Person, sonst Freigabeberechtigte).
 * Jede gemeldete Stufe wird im Audit-Protokoll festgehalten (`reminder.*`) und dient zugleich als Merker,
 * damit keine Stufe doppelt gemeldet wird – auch nicht bei mehreren Instanzen oder Neustarts.
 */

const ACTIONS = { cert: 'reminder.certificate', qual: 'reminder.qualification', training: 'reminder.training', doc: 'reminder.document' } as const
type Kind = keyof typeof ACTIONS

type Lead = { userId: string; name: string; what: string; stage: number }

async function sentStages(orgId: string, kind: Kind, ids: string[]) {
  const out = new Map<string, number[]>()
  if (!ids.length) return out
  const rows = await db.auditLog.findMany({ where: { orgId, action: ACTIONS[kind], entityId: { in: ids } }, select: { entityId: true, context: true } })
  for (const r of rows) {
    const stage = (r.context as { stage?: unknown } | null)?.stage
    if (typeof stage === 'number' && r.entityId) out.set(r.entityId, [...(out.get(r.entityId) ?? []), stage])
  }
  return out
}

const mark = (orgId: string, kind: Kind, entityId: string, stage: number, context: Record<string, unknown>) =>
  auditSystem({ orgId, action: ACTIONS[kind], entityType: kind === 'doc' ? 'Document' : kind === 'cert' ? 'Certificate' : kind === 'qual' ? 'UserQualification' : 'Enrollment', entityId, context: { stage, ...context } })

export async function runReminders(orgId: string, now = new Date()) {
  const summary = { renewed: 0, certificates: 0, qualifications: 0, trainings: 0, documents: 0, leads: 0 }
  const horizon = new Date(now.getTime() + (CERT_STAGES[0] + 1) * 86_400_000)
  const since = new Date(now.getTime() - (GRACE_DAYS + 1) * 86_400_000)
  const leads: Lead[] = []
  const name = (u: { firstName: string; lastName: string }) => `${u.lastName} ${u.firstName}`

  // 1. Abgelaufene Schulungen wieder öffnen; Pflichtschulungen mit Gültigkeit vor Ablauf neu zuweisen
  await syncExpired(orgId)
  const certs = latestCertificates(
    await db.certificate.findMany({
      where: { user: { orgId, active: true } },
      select: { id: true, userId: true, courseId: true, title: true, issuedAt: true, expiresAt: true, user: { select: { firstName: true, lastName: true, primaryUnitId: true } } },
    }),
  )
  const renewable = certs.filter((c) => c.courseId && renewalDue(c.expiresAt, now, RENEW_DAYS))
  if (renewable.length) {
    const enrollments = await db.enrollment.findMany({
      where: { status: 'completed', course: { orgId, mandatory: true, published: true, validityMonths: { not: null } }, OR: renewable.map((c) => ({ userId: c.userId, courseId: c.courseId! })) },
      select: { id: true, userId: true, courseId: true },
    })
    for (const e of enrollments) {
      const cert = renewable.find((c) => c.userId === e.userId && c.courseId === e.courseId)!
      await db.enrollment.update({ where: { id: e.id }, data: { status: 'assigned', dueAt: cert.expiresAt, doneModules: [], assignedAt: now } })
      await auditSystem({ orgId, action: 'learn.enrollment.renew', entityType: 'Enrollment', entityId: e.id, after: { status: 'assigned', dueAt: cert.expiresAt }, context: { userId: e.userId, courseId: e.courseId, certificateId: cert.id } })
      summary.renewed++
    }
  }

  // 2a. Zertifikate
  const certDue = certs.filter((c) => c.expiresAt && c.expiresAt >= since && c.expiresAt <= horizon)
  const certSent = await sentStages(orgId, 'cert', certDue.map((c) => c.id))
  for (const c of certDue) {
    const left = daysUntil(c.expiresAt!, now)
    const stage = reminderStage(left, CERT_STAGES)
    const sent = certSent.get(c.id) ?? []
    if (!shouldRemind(stage, sent)) continue
    const expired = left < 0 || stage === 0
    await notifyT({
      orgId, userIds: [c.userId], priority: reminderPriority(stage!), kind: 'learn.expiry',
      titleKey: expired ? 'learn.reminders.certExpired' : 'learn.reminders.certSoon',
      bodyKey: c.courseId ? 'learn.reminders.certRenew' : 'learn.reminders.certExternal',
      vars: { title: c.title, days: Math.max(0, left) },
      href: c.courseId ? `/learn/${c.courseId}` : '/learn/certificates', groupKey: `cert-exp:${c.id}`,
    })
    if (leadNotice(stage, sent)) leads.push({ userId: c.userId, name: name(c.user), what: c.title, stage: stage! })
    await mark(orgId, 'cert', c.id, stage!, { userId: c.userId, expiresAt: c.expiresAt })
    summary.certificates++
  }

  // 2b. Qualifikationen mit Ablaufdatum (z. B. BLS-AED, Berufsausübungsbewilligung)
  const quals = await db.userQualification.findMany({
    where: { validUntil: { gte: since, lte: horizon }, user: { orgId, active: true } },
    select: { userId: true, qualificationId: true, validUntil: true, qualification: { select: { name: true } }, user: { select: { firstName: true, lastName: true } } },
  })
  const qualId = (q: (typeof quals)[number]) => `${q.userId}:${q.qualificationId}:${dateKey(q.validUntil!)}`
  const qualSent = await sentStages(orgId, 'qual', quals.map(qualId))
  for (const q of quals) {
    const left = daysUntil(q.validUntil!, now)
    const stage = reminderStage(left, CERT_STAGES)
    const sent = qualSent.get(qualId(q)) ?? []
    if (!shouldRemind(stage, sent)) continue
    await notifyT({
      orgId, userIds: [q.userId], priority: reminderPriority(stage!), kind: 'learn.qualification',
      titleKey: left < 0 || stage === 0 ? 'learn.reminders.qualExpired' : 'learn.reminders.qualSoon', bodyKey: 'learn.reminders.qualBody',
      vars: { title: q.qualification.name, days: Math.max(0, left) }, href: '/profile#p-quals', groupKey: `qual-exp:${qualId(q)}`,
    })
    if (leadNotice(stage, sent)) leads.push({ userId: q.userId, name: name(q.user), what: q.qualification.name, stage: stage! })
    await mark(orgId, 'qual', qualId(q), stage!, { userId: q.userId })
    summary.qualifications++
  }

  // 3. Offene Schulungen mit Frist
  const open = await db.enrollment.findMany({
    where: { status: { in: ['assigned', 'in_progress', 'expired'] }, dueAt: { gte: since, lte: new Date(now.getTime() + (DUE_STAGES[0] + 1) * 86_400_000) }, course: { orgId, published: true }, user: { active: true } },
    select: { id: true, userId: true, courseId: true, dueAt: true, course: { select: { title: true, mandatory: true } }, user: { select: { firstName: true, lastName: true } } },
  })
  const trId = (e: (typeof open)[number]) => `${e.id}:${dateKey(e.dueAt!)}`
  const trSent = await sentStages(orgId, 'training', open.map(trId))
  for (const e of open) {
    const left = daysUntil(e.dueAt!, now)
    const stage = reminderStage(left, DUE_STAGES)
    const sent = trSent.get(trId(e)) ?? []
    if (!shouldRemind(stage, sent)) continue
    const overdue = left < 0
    await notifyT({
      orgId, userIds: [e.userId], priority: reminderPriority(stage!), kind: 'learn.due',
      titleKey: overdue ? 'learn.reminders.overdue' : left === 0 ? 'learn.reminders.dueToday' : 'learn.reminders.dueSoon',
      bodyKey: e.course.mandatory ? 'learn.reminders.mandatory' : undefined,
      vars: { title: e.course.title, days: Math.max(0, left) }, href: `/learn/${e.courseId}`, groupKey: `learn-due:${e.id}`,
    })
    // Leitungen nur bei überfälligen Pflichtschulungen
    if (e.course.mandatory && overdue && stage === 0) leads.push({ userId: e.userId, name: name(e.user), what: e.course.title, stage: -1 })
    await mark(orgId, 'training', trId(e), stage!, { userId: e.userId, courseId: e.courseId })
    summary.trainings++
  }

  // Zusammenfassung an Leitungen (learn.manage im Bereich der Person), eine Benachrichtigung pro Leitung
  if (leads.length) {
    const [grants, people] = await Promise.all([
      db.roleAssignment.findMany({ where: { role: { orgId, permissions: { has: 'learn.manage' } }, user: { active: true } }, select: { userId: true, unitId: true, locationId: true } }),
      db.user.findMany({ where: { id: { in: [...new Set(leads.map((l) => l.userId))] } }, select: { id: true, primaryUnitId: true, roles: { select: { unitId: true, locationId: true } } } }),
    ])
    const units = await db.unit.findMany({ where: { orgId }, select: { id: true, locationId: true } })
    const loc = new Map(units.map((u) => [u.id, u.locationId]))
    const covers = (g: { unitId: string | null; locationId: string | null }, personId: string) => {
      if (!g.unitId && !g.locationId) return true
      const p = people.find((x) => x.id === personId)
      if (!p) return false
      const pUnits = [p.primaryUnitId, ...p.roles.map((r) => r.unitId)].filter((x): x is string => !!x)
      const pLocs = [...pUnits.map((u) => loc.get(u)), ...p.roles.map((r) => r.locationId)].filter(Boolean)
      return g.unitId ? pUnits.includes(g.unitId) : pLocs.includes(g.locationId)
    }
    const perLead = new Map<string, Lead[]>()
    for (const l of leads)
      for (const g of grants) {
        if (g.userId === l.userId || !covers(g, l.userId)) continue
        const list = perLead.get(g.userId) ?? []
        if (!list.includes(l)) perLead.set(g.userId, [...list, l])
      }
    for (const [leadId, items] of perLead) {
      const names = [...new Set(items.map((i) => i.name))]
      await notifyT({
        orgId, userIds: [leadId], priority: items.some((i) => i.stage <= 0) ? 'action' : 'info', kind: 'learn.compliance',
        titleKey: 'learn.reminders.leadTitle', bodyKey: 'learn.reminders.leadBody',
        vars: { n: items.length, names: names.slice(0, 6).join(', ') + (names.length > 6 ? ' …' : '') }, href: '/learn/compliance', groupKey: `learn-lead:${dateKey(now)}`,
      })
      summary.leads++
    }
  }

  // 4. Dokument-Gültigkeit
  const docs = await db.document.findMany({
    where: { orgId, status: 'approved', validUntil: { gte: since, lte: new Date(now.getTime() + (DOC_STAGES[0] + 1) * 86_400_000) } },
    select: { id: true, title: true, validUntil: true, ownerId: true },
  })
  if (docs.length) {
    const docId = (d: (typeof docs)[number]) => `${d.id}:${dateKey(d.validUntil!)}`
    const docSent = await sentStages(orgId, 'doc', docs.map(docId))
    const owners = new Set((await db.user.findMany({ where: { id: { in: docs.map((d) => d.ownerId) }, orgId, active: true }, select: { id: true } })).map((u) => u.id))
    let approvers: string[] | null = null
    for (const d of docs) {
      const left = daysUntil(d.validUntil!, now)
      const stage = reminderStage(left, DOC_STAGES)
      if (!shouldRemind(stage, docSent.get(docId(d)) ?? [])) continue
      approvers ??= [...new Set((await db.roleAssignment.findMany({ where: { role: { orgId, permissions: { has: 'docs.approve' } }, user: { active: true } }, select: { userId: true } })).map((r) => r.userId))]
      const to = owners.has(d.ownerId) ? [d.ownerId] : approvers
      await notifyT({
        orgId, userIds: to, priority: reminderPriority(stage!), kind: 'docs.expiry',
        titleKey: left < 0 || stage === 0 ? 'docs.reminders.expired' : 'docs.reminders.soon', bodyKey: 'docs.reminders.body',
        vars: { title: d.title, days: Math.max(0, left) }, href: `/docs/${d.id}`, groupKey: `doc-valid:${d.id}`,
      })
      await mark(orgId, 'doc', docId(d), stage!, { recipients: to.length })
      summary.documents++
    }
  }
  return summary
}
