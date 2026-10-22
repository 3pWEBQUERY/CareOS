import 'server-only'
import { db } from '@/lib/db'
import { ASSESSMENTS, type AssessmentDef } from '@/lib/clinical-config'

/** Assessment-Definitionen der Organisation; ohne Konfiguration die Standarddefinitionen. */
export async function loadAssessmentDefs(orgId: string): Promise<AssessmentDef[]> {
  const rows = await db.assessmentDefinition.findMany({ where: { orgId, active: true } })
  if (!rows.length) return ASSESSMENTS
  const order = ASSESSMENTS.map((a) => a.key)
  return rows
    .map((d) => ({ key: d.key, name: d.name, description: d.description ?? '', intervalDays: d.intervalDays, items: d.items as AssessmentDef['items'] }))
    .filter((d) => Array.isArray(d.items?.questions) && Array.isArray(d.items?.ranges))
    .sort((a, b) => (order.indexOf(a.key) < 0 ? 99 : order.indexOf(a.key)) - (order.indexOf(b.key) < 0 ? 99 : order.indexOf(b.key)))
}
