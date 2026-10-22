import 'server-only'
import type { Observation } from '@prisma/client'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { hm } from '@/lib/time'
import { asStructuredForm, readFields, type StructuredForm } from '@/lib/forms'
import { ackSettings, OBSERVATION_ACK } from '@/lib/acks'
import type { FormOption } from '@/components/forms/FormEntry'
import type { NoteAckInfo } from '@/components/forms/StructuredView'

/**
 * Ergänzungen für den Verlauf: aktive Formulare (Fokusdokumentation, PRD §10.3) und
 * Kenntnisnahmen wichtiger Einträge (Admin → Bestätigungen). Hält die Seite selbst schlank.
 */
export async function notesExtras(ctx: Ctx, obs: Pick<Observation, 'id' | 'important' | 'authorId' | 'structured'>[], canWrite: boolean) {
  const needAck = ackSettings(ctx.org.settings).residentImportantNoteRequiresAck
  const importantIds = needAck ? obs.filter((o) => o.important).map((o) => o.id) : []
  const [defs, acks] = await Promise.all([
    canWrite ? db.formDefinition.findMany({ where: { orgId: ctx.org.id, active: true }, orderBy: { name: 'asc' } }) : [],
    importantIds.length ? db.acknowledgement.findMany({ where: { subjectType: OBSERVATION_ACK, subjectId: { in: importantIds } }, select: { userId: true, subjectId: true, at: true } }) : [],
  ])
  const forms: FormOption[] = defs
    .map((d) => ({ id: d.id, name: d.name, description: d.description, version: d.version, fields: readFields(d.fields) }))
    .filter((f) => f.fields.length)
  const byId = new Map(obs.map((o) => [o.id, o]))
  const row = (id: string): { structured: StructuredForm | null; ack: NoteAckInfo | null } => {
    const o = byId.get(id)
    const structured = o ? asStructuredForm(o.structured) : null
    if (!o || !needAck || !o.important) return { structured, ack: null }
    const list = acks.filter((a) => a.subjectId === id)
    const mine = list.find((a) => a.userId === ctx.user.id)
    return { structured, ack: { done: !!mine, at: mine ? hm(mine.at) : null, count: list.length, own: o.authorId === ctx.user.id } }
  }
  return { forms, row }
}
