import 'server-only'
import { createHmac } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

/**
 * Domain Events (PRD §44). Jede fachliche Änderung erzeugt ein Event in der Outbox-Tabelle.
 * pg_notify verteilt es an alle App-Instanzen (Echtzeit via SSE), Webhooks werden asynchron zugestellt.
 */
export type EventType =
  | 'task.created' | 'task.completed' | 'task.reopened' | 'task.escalated'
  | 'observation.created' | 'observation.corrected'
  | 'vitals.recorded' | 'vitals.abnormal' | 'vitals.corrected' | 'vitals.reviewed'
  | 'medication.administered' | 'medication.changed'
  | 'handover.updated' | 'handover.acknowledged'
  | 'incident.reported' | 'incident.updated'
  | 'careplan.updated' | 'assessment.recorded' | 'assessment.corrected' | 'wound.updated' | 'nutrition.recorded'
  | 'resident.updated' | 'visit.updated' | 'assignment.updated'
  | 'post.published' | 'message.created'
  | 'document.published' | 'schedule.changed' | 'notification.created'

export type EmitInput = {
  orgId: string
  type: EventType
  unitId?: string | null
  residentId?: string | null
  actorId?: string | null
  payload?: Record<string, unknown>
  /** Nur an diese Benutzer verteilen (z. B. Chat, Benachrichtigung). */
  userIds?: string[]
}

export type RealtimeEvent = {
  id: string
  orgId: string
  type: EventType
  unitId: string | null
  residentId: string | null
  actorId: string | null
  userIds?: string[]
  payload?: Record<string, unknown>
}

export async function emit(e: EmitInput) {
  const ev = await db.domainEvent.create({
    data: {
      orgId: e.orgId,
      type: e.type,
      unitId: e.unitId ?? null,
      residentId: e.residentId ?? null,
      actorId: e.actorId ?? null,
      payload: (e.payload ?? {}) as Prisma.InputJsonValue,
    },
  })
  const msg: RealtimeEvent = {
    id: ev.id,
    orgId: ev.orgId,
    type: e.type,
    unitId: ev.unitId,
    residentId: ev.residentId,
    actorId: ev.actorId,
    userIds: e.userIds,
  }
  // Payload nicht über NOTIFY senden (8 kB Grenze, keine Gesundheitsdaten im Broadcast).
  await db.$executeRaw`SELECT pg_notify('careos_events', ${JSON.stringify(msg)})`.catch(() => {})
  void deliverWebhooks(ev.orgId, ev.id, e.type, { ...msg, payload: e.payload ?? {}, createdAt: ev.createdAt })
  return ev
}

export function signPayload(secret: string, body: string) {
  return createHmac('sha256', secret).update(body).digest('hex')
}

async function deliverWebhooks(orgId: string, eventId: string, type: string, body: unknown) {
  try {
    const hooks = await db.webhook.findMany({ where: { orgId, active: true } })
    for (const h of hooks) {
      if (h.events.length && !h.events.includes(type) && !h.events.includes('*')) continue
      const raw = JSON.stringify({ event: type, data: body })
      let status: number | null = null
      let error: string | null = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await fetch(h.url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-careos-event': type,
              'x-careos-signature': 'sha256=' + signPayload(h.secret, raw),
            },
            body: raw,
            signal: AbortSignal.timeout(8000),
          })
          status = res.status
          error = null
          if (res.ok) break
        } catch (err) {
          error = String(err).slice(0, 300)
        }
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
      }
      await db.webhookDelivery.create({ data: { webhookId: h.id, eventId, status, error, attempts: 3 } })
    }
  } catch {
    /* Webhook-Zustellung darf fachliche Vorgänge nie blockieren. */
  }
}
