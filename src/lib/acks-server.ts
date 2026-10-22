import 'server-only'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { addDays } from '@/lib/time'
import { ackSettings, OBSERVATION_ACK, OBSERVATION_ACK_DAYS } from '@/lib/acks'

/**
 * Wichtige Verlaufseinträge, die die Person noch zur Kenntnis nehmen muss (Startseite "Zu bestätigen").
 * Nur wenn Admin → Bestätigungen es verlangt; eigene und korrigierte Einträge zählen nicht.
 */
export async function observationsToAck(ctx: Ctx, residentIds: string[], now = new Date(), take = 8) {
  if (!residentIds.length || !ackSettings(ctx.org.settings).residentImportantNoteRequiresAck) return []
  const rows = await db.observation.findMany({
    where: { residentId: { in: residentIds }, important: true, authorId: { not: ctx.user.id }, at: { gte: addDays(now, -OBSERVATION_ACK_DAYS) }, correctedBy: { none: {} } },
    orderBy: { at: 'desc' },
    select: { id: true, residentId: true, text: true, at: true },
    take: 50,
  })
  if (!rows.length) return []
  const mine = await db.acknowledgement.findMany({ where: { userId: ctx.user.id, subjectType: OBSERVATION_ACK, subjectId: { in: rows.map((r) => r.id) } }, select: { subjectId: true } })
  const done = new Set(mine.map((a) => a.subjectId))
  return rows.filter((r) => !done.has(r.id)).slice(0, take)
}
