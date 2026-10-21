import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { emit } from '@/lib/events'
import { apiAudit, apiAuth, apiError, isErr, readJson } from '@/lib/api-auth'
import { dictionary } from '@/i18n'
import { makeT, pickLocale } from '@/i18n/core'
import { taskJson } from '../../serialize'

const Patch = z.object({
  status: z.enum(['done', 'partial', 'skipped']),
  note: z.string().trim().max(2000).nullish(),
})

async function load(orgId: string, id: string) {
  return db.task.findFirst({ where: { id, orgId } })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const api = await apiAuth(req, 'tasks:read')
  if (isErr(api)) return api
  const task = await load(api.orgId, (await params).id)
  if (!task) return apiError(404, 'not_found', 'Task not found')
  const org = await db.organization.findUniqueOrThrow({ where: { id: api.orgId } })
  const locale = pickLocale(req.nextUrl.searchParams.get('lang') ?? org.defaultLocale)
  return NextResponse.json({ data: taskJson(task, makeT(dictionary(locale), locale, org.terminology)) })
}

/** PATCH /api/v1/tasks/{id} – Aufgabe quittieren: { status: done|partial|skipped, note? }. partial und skipped erfordern eine Begründung. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const api = await apiAuth(req, 'tasks:write')
  if (isErr(api)) return api
  const parsed = Patch.safeParse(await readJson(req))
  if (!parsed.success) return apiError(422, 'validation_failed', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  const { status, note } = parsed.data
  if (status !== 'done' && !note) return apiError(422, 'validation_failed', 'note is required for partial and skipped')
  const before = await load(api.orgId, (await params).id)
  if (!before) return apiError(404, 'not_found', 'Task not found')
  if (before.status === 'done' || before.status === 'partial' || before.status === 'skipped') return apiError(409, 'conflict', 'Task is already closed')
  const task = await db.task.update({ where: { id: before.id }, data: { status, note: note ?? before.note, completedAt: new Date(), completedById: api.actorId } })
  await apiAudit(api, { action: 'api.task.complete', entityType: 'Task', entityId: task.id, before: { status: before.status, note: before.note }, after: { status, note: task.note } })
  await emit({ orgId: api.orgId, type: 'task.completed', unitId: task.unitId, residentId: task.residentId, actorId: api.actorId, payload: { taskId: task.id, status, via: 'api' } })
  const org = await db.organization.findUniqueOrThrow({ where: { id: api.orgId } })
  const locale = pickLocale(req.nextUrl.searchParams.get('lang') ?? org.defaultLocale)
  return NextResponse.json({ data: taskJson(task, makeT(dictionary(locale), locale, org.terminology)) })
}
