import 'server-only'
import { db } from '@/lib/db'
import { auditSystem } from '@/lib/audit'
import { usersWithPermission } from '@/lib/notify'
import { notifyT } from '@/lib/notify-t'
import { escalationPolicy, visitQuestionDue } from '@/lib/escalation-policy'
import { normalizeModules, orgHasModule } from '@/lib/modules'
import { EXTERNAL_PHYSICIAN } from '@/lib/permissions'

const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

/**
 * Escalate (PRD §49) für Visitenfragen (läuft im Job «escalations», einmal je Frage): unbeantwortet länger als
 * Organization.settings.escalation.visitQuestionHours → erneute Meldung an die zuständige Ärztin bzw. den
 * zuständigen Arzt (Hausärztin vor Konsiliarärztin; externe Konten mit Link ins Ärzteportal) und die Leitung des Bereichs.
 */
export async function escalateVisitQuestions(now = new Date()): Promise<number> {
  const orgs = await db.organization.findMany({ select: { id: true, settings: true, modules: true } })
  let n = 0
  for (const org of orgs) {
    const p = escalationPolicy(org.settings)
    if (!p.enabled || !orgHasModule(normalizeModules(org.modules), 'visit')) continue
    const qs = await db.visitQuestion.findMany({
      where: { orgId: org.id, status: 'open', escalatedAt: null, createdAt: { lte: new Date(now.getTime() - p.visitQuestionHours * 3600_000) }, resident: { status: { in: ['active', 'absent'] } } },
      include: { resident: { select: { id: true, unitId: true, firstName: true, lastName: true, room: { select: { number: true } } } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    })
    for (const q of qs) {
      if (!visitQuestionDue(q, p, now)) continue
      const claimed = await db.visitQuestion.updateMany({ where: { id: q.id, status: 'open', escalatedAt: null }, data: { escalatedAt: now } })
      if (!claimed.count) continue
      const r = q.resident
      const assigned = await db.residentPhysician.findMany({
        where: { residentId: r.id, OR: [{ until: null }, { until: { gt: now } }], user: { active: true, orgId: org.id } },
        select: { role: true, user: { select: { id: true, kind: true } } },
      })
      const primary = assigned.filter((a) => a.role === 'primary')
      const physicians = (primary.length ? primary : assigned).map((a) => a.user)
      const leads = await usersWithPermission(org.id, 'schedule.manage', r.unitId)
      const external = physicians.filter((u) => u.kind === EXTERNAL_PHYSICIAN).map((u) => u.id)
      const staff = [...new Set([...leads, ...physicians.filter((u) => u.kind !== EXTERNAL_PHYSICIAN).map((u) => u.id)])].filter((id) => !external.includes(id))
      const base = {
        orgId: org.id, priority: 'action' as const, kind: 'visit.question.overdue', unitId: r.unitId, dutyAware: false,
        titleKey: 'admin.escalation.notify.visitTitle', bodyKey: 'admin.escalation.notify.visitBody',
        vars: { who: `${r.lastName} ${r.firstName}${r.room ? ' (' + r.room.number + ')' : ''}`, hours: p.visitQuestionHours, text: short(q.text, 120) },
        groupKey: 'visit-q-esc:' + r.id,
      }
      await notifyT({ ...base, userIds: staff, href: `/tasks/visit?r=${r.id}` })
      if (external.length) await notifyT({ ...base, userIds: external, href: `/md/p/${r.id}` })
      await auditSystem({ orgId: org.id, action: 'visit.question.escalate', entityType: 'VisitQuestion', entityId: q.id, context: { residentId: r.id, hours: p.visitQuestionHours, physicians: physicians.length, notified: staff.length + external.length } })
      n++
    }
  }
  return n
}
