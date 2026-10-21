import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { TaskStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { emit } from '@/lib/events'
import { apiAudit, apiAuth, apiError, isErr, readJson } from '@/lib/api-auth'
import { ensureTasksForDay } from '@/lib/tasks'
import { addDays, parseDateKey, startOfDay } from '@/lib/time'
import { dictionary } from '@/i18n'
import { makeT, pickLocale } from '@/i18n/core'
import { taskJson } from '../serialize'

const STATUSES: TaskStatus[] = ['planned', 'ready', 'in_progress', 'done', 'partial', 'skipped', 'escalated']

async function translator(orgId: string, lang: string | null) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { terminology: true, defaultLocale: true } })
  const locale = pickLocale(lang ?? org.defaultLocale)
  return makeT(dictionary(locale), locale, org.terminology)
}

/** GET /api/v1/tasks?unitId=&date=YYYY-MM-DD&status=&lang= */
export async function GET(req: NextRequest) {
  const api = await apiAuth(req, 'tasks:read')
  if (isErr(api)) return api
  const sp = req.nextUrl.searchParams
  const dateParam = sp.get('date')
  const day = dateParam ? (/^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? parseDateKey(dateParam) : null) : startOfDay(new Date())
  if (!day || Number.isNaN(day.getTime())) return apiError(400, 'bad_request', 'date must be YYYY-MM-DD')
  const unitId = sp.get('unitId')
  const units = await db.unit.findMany({ where: { orgId: api.orgId, ...(unitId ? { id: unitId } : {}) }, select: { id: true } })
  if (unitId && !units.length) return apiError(404, 'not_found', 'Unit not found')
  for (const u of units) await ensureTasksForDay(u.id, day)
  const status = sp.get('status')
  if (status && !STATUSES.includes(status as TaskStatus)) return apiError(400, 'bad_request', 'Invalid status')
  const rows = await db.task.findMany({
    where: { orgId: api.orgId, unitId: { in: units.map((u) => u.id) }, dueAt: { gte: startOfDay(day), lt: addDays(startOfDay(day), 1) }, ...(status ? { status: status as TaskStatus } : {}) },
    orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
    take: 2000,
  })
  const t = await translator(api.orgId, sp.get('lang'))
  return NextResponse.json({ data: rows.map((k) => taskJson(k, t)) })
}

const Create = z.object({
  unitId: z.string().min(1),
  residentId: z.string().min(1).nullish(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
  category: z.string().trim().max(60).default('Allgemein'),
  dueAt: z.iso.datetime({ offset: true }),
  durationMin: z.number().int().min(1).max(480).default(10),
  priority: z.enum(['critical', 'important', 'routine']).default('routine'),
  assigneeId: z.string().min(1).nullish(),
})

/** POST /api/v1/tasks – manuelle Aufgabe anlegen. */
export async function POST(req: NextRequest) {
  const api = await apiAuth(req, 'tasks:write')
  if (isErr(api)) return api
  const parsed = Create.safeParse(await readJson(req))
  if (!parsed.success) return apiError(422, 'validation_failed', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  const b = parsed.data
  const unit = await db.unit.findFirst({ where: { id: b.unitId, orgId: api.orgId } })
  if (!unit) return apiError(404, 'not_found', 'Unit not found')
  if (b.residentId && !(await db.resident.findFirst({ where: { id: b.residentId, orgId: api.orgId, unitId: unit.id } }))) return apiError(422, 'validation_failed', 'residentId is not in this unit')
  if (b.assigneeId && !(await db.user.findFirst({ where: { id: b.assigneeId, orgId: api.orgId, active: true } }))) return apiError(422, 'validation_failed', 'assigneeId unknown')
  const task = await db.task.create({
    data: {
      orgId: api.orgId, unitId: unit.id, residentId: b.residentId ?? null, title: b.title, description: b.description ?? null, category: b.category,
      dueAt: new Date(b.dueAt), durationMin: b.durationMin, priority: b.priority, assigneeId: b.assigneeId ?? null, source: 'manual', createdById: api.actorId, status: 'planned',
    },
  })
  await apiAudit(api, { action: 'api.task.create', entityType: 'Task', entityId: task.id, after: b })
  await emit({ orgId: api.orgId, type: 'task.created', unitId: unit.id, residentId: task.residentId, actorId: api.actorId, payload: { taskId: task.id, via: 'api' } })
  const t = await translator(api.orgId, req.nextUrl.searchParams.get('lang'))
  return NextResponse.json({ data: taskJson(task, t) }, { status: 201, headers: { location: `/api/v1/tasks/${task.id}` } })
}
