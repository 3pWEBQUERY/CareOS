'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { assertCan, getCtx } from '@/lib/context'
import { fd, fdBool, fdNum, run } from '@/lib/action'
import { audit } from '@/lib/audit'
import { saveUpload, UploadError } from '@/lib/files'
import { notifyT } from '@/lib/notify-t'
import { COURSE_CATEGORIES, MODULE_KINDS, completeIfDone, isDone, loadCourse, parseQuiz, staffInScope, unlocked } from '@/lib/learn'
import { fmtDayMonth, parseDateKey } from '@/lib/time'

async function courseFor(courseId: string) {
  const ctx = await getCtx()
  assertCan(ctx, 'learn.read')
  const course = await loadCourse(ctx, courseId)
  return { ctx, course }
}

async function ensureEnrollment(courseId: string, userId: string) {
  return db.enrollment.upsert({
    where: { courseId_userId: { courseId, userId } },
    create: { courseId, userId, status: 'in_progress' },
    update: {},
  })
}

/** Schulung selbst starten (Katalog) oder nach Ablauf erneut absolvieren. */
export async function startCourse(courseId: string) {
  return run(async () => {
    const { ctx, course } = await courseFor(courseId)
    if (!course || (!course.published && !ctx.can('learn.manage'))) return { ok: false, error: 'common.notFound' }
    const e = await db.enrollment.findUnique({ where: { courseId_userId: { courseId, userId: ctx.user.id } } })
    if (!e) await db.enrollment.create({ data: { courseId, userId: ctx.user.id, status: 'in_progress' } })
    else if (e.status === 'completed' || e.status === 'expired') await db.enrollment.update({ where: { id: e.id }, data: { status: 'in_progress', doneModules: [], score: null, completedAt: null } })
    else if (e.status === 'assigned') await db.enrollment.update({ where: { id: e.id }, data: { status: 'in_progress' } })
    await audit(ctx, { action: 'learn.start', entityType: 'Course', entityId: courseId, before: e ? { status: e.status } : undefined })
    refresh()
  })
}

async function markDone(enrollmentId: string, done: string[], moduleId: string, extra: Prisma.EnrollmentUpdateInput = {}) {
  await db.enrollment.update({ where: { id: enrollmentId }, data: { doneModules: [...new Set([...done, moduleId])], status: 'in_progress', ...extra } })
  return completeIfDone(enrollmentId)
}

/** Text-, Video- und Dokumentmodule als erledigt markieren. */
export async function completeModule(courseId: string, moduleId: string) {
  return run(async () => {
    const { ctx, course } = await courseFor(courseId)
    if (!course) return { ok: false, error: 'common.notFound' }
    const idx = course.modules.findIndex((m) => m.id === moduleId)
    const mod = course.modules[idx]
    if (!mod || mod.kind === 'quiz' || mod.kind === 'practical') return { ok: false, error: 'common.notFound' }
    const e = await ensureEnrollment(courseId, ctx.user.id)
    if (e.status === 'completed') return { ok: true }
    if (!unlocked(course.modules, e.doneModules, idx)) return { ok: false, error: 'learn.errors.locked' }
    const cert = await markDone(e.id, e.doneModules, mod.id)
    if (cert) await audit(ctx, { action: 'learn.complete', entityType: 'Course', entityId: courseId, after: { certificateId: cert.id, expiresAt: cert.expiresAt } })
    refresh()
    return { ok: true, message: cert ? 'learn.completedToast' : 'learn.moduleDone' }
  })
}

export type QuizResult = { score: number; passed: boolean; wrong: number[]; pass: number }

/** Quiz serverseitig auswerten. Richtige Antworten werden nicht an den Client gegeben. */
export async function submitQuiz(courseId: string, moduleId: string, form: FormData) {
  return run<QuizResult>(async () => {
    const { ctx, course } = await courseFor(courseId)
    if (!course) return { ok: false, error: 'common.notFound' }
    const idx = course.modules.findIndex((m) => m.id === moduleId)
    const mod = course.modules[idx]
    const quiz = mod?.kind === 'quiz' ? parseQuiz(mod.quiz) : null
    if (!quiz) return { ok: false, error: 'common.notFound' }
    const e = await ensureEnrollment(courseId, ctx.user.id)
    if (!unlocked(course.modules, e.doneModules, idx)) return { ok: false, error: 'learn.errors.locked' }
    const answers = quiz.questions.map((_, i) => fd(form, 'q' + i))
    if (answers.some((a) => a === '')) return { ok: false, error: 'learn.errors.answerAll' }
    const wrong = quiz.questions.map((q, i) => (Number(answers[i]) === q.answer ? -1 : i)).filter((i) => i >= 0)
    const score = (quiz.questions.length - wrong.length) / quiz.questions.length
    const passed = score >= quiz.pass - 1e-9
    await audit(ctx, { action: 'learn.quiz', entityType: 'CourseModule', entityId: mod.id, after: { score, passed } })
    if (passed && e.status !== 'completed') {
      const cert = await markDone(e.id, e.doneModules, mod.id, { score })
      if (cert) await audit(ctx, { action: 'learn.complete', entityType: 'Course', entityId: courseId, after: { certificateId: cert.id, expiresAt: cert.expiresAt } })
      refresh()
    }
    return { ok: true, data: { score, passed, wrong, pass: quiz.pass } }
  })
}

/** Praktischer Kompetenznachweis: wird durch eine Leitung (learn.manage) für eine Person bestätigt. */
export async function confirmPractical(courseId: string, moduleId: string, form: FormData) {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'learn.manage')
    const course = await loadCourse(ctx, courseId)
    const mod = course?.modules.find((m) => m.id === moduleId && m.kind === 'practical')
    if (!course || !mod) return { ok: false, error: 'common.notFound' }
    const userId = fd(form, 'userId')
    const staff = await staffInScope(ctx)
    const person = staff.find((u) => u.id === userId)
    if (!person) return { ok: false, error: 'learn.errors.person', field: 'userId' }
    const e = await ensureEnrollment(courseId, person.id)
    if (isDone(e.doneModules, mod)) return { ok: false, error: 'learn.errors.alreadyConfirmed' }
    const cert = await markDone(e.id, e.doneModules, mod.id)
    await audit(ctx, { action: 'learn.practical.confirm', entityType: 'CourseModule', entityId: mod.id, after: { userId: person.id, note: fd(form, 'note') || undefined, completed: !!cert } })
    await notifyT({ orgId: ctx.org.id, userIds: [person.id], priority: 'info', kind: 'learn', titleKey: 'learn.notify.practical', vars: { title: course.title, by: `${ctx.user.firstName} ${ctx.user.lastName}` }, href: `/learn/${courseId}` })
    refresh()
    return { ok: true, message: ctx.t('learn.practical.confirmed', { name: `${person.firstName} ${person.lastName}` }) }
  })
}

/** Kurs zuweisen an Personen, eine Rolle oder einen Bereich – mit Frist. */
export async function assignCourse(form: FormData) {
  return run<{ n: number }>(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'learn.manage')
    const course = await loadCourse(ctx, fd(form, 'courseId'))
    if (!course) return { ok: false, error: 'learn.errors.course', field: 'courseId' }
    const due = fd(form, 'dueAt')
    const dueAt = /^\d{4}-\d{2}-\d{2}$/.test(due) ? parseDateKey(due) : null
    if (dueAt) dueAt.setHours(23, 59, 0, 0)
    const mode = fd(form, 'mode')
    const staff = await staffInScope(ctx)
    let targets: typeof staff = []
    if (mode === 'users') {
      const ids = new Set(form.getAll('userIds').map(String))
      targets = staff.filter((u) => ids.has(u.id))
    } else if (mode === 'role') {
      const role = await db.role.findFirst({ where: { id: fd(form, 'roleId'), orgId: ctx.org.id } })
      if (!role) return { ok: false, error: 'learn.errors.role', field: 'roleId' }
      targets = staff.filter((u) => u.roleKeys.has(role.key))
    } else if (mode === 'unit') {
      const unitId = fd(form, 'unitId')
      if (!ctx.unitIds.includes(unitId)) return { ok: false, error: 'learn.errors.unit', field: 'unitId' }
      targets = await staffInScope(ctx, unitId)
    }
    if (!targets.length) return { ok: false, error: 'learn.errors.noTargets' }
    const existing = await db.enrollment.findMany({ where: { courseId: course.id, userId: { in: targets.map((u) => u.id) } } })
    const byUser = new Map(existing.map((e) => [e.userId, e]))
    const notifyIds: string[] = []
    for (const u of targets) {
      const e = byUser.get(u.id)
      if (!e) {
        await db.enrollment.create({ data: { courseId: course.id, userId: u.id, status: 'assigned', dueAt } })
        notifyIds.push(u.id)
      } else if (e.status === 'expired' || (e.status === 'completed' && fdBool(form, 'renew'))) {
        await db.enrollment.update({ where: { id: e.id }, data: { status: 'assigned', dueAt, doneModules: [], score: null, completedAt: null, assignedAt: new Date() } })
        notifyIds.push(u.id)
      } else if (e.status !== 'completed') {
        await db.enrollment.update({ where: { id: e.id }, data: { dueAt } })
        notifyIds.push(u.id)
      }
    }
    await audit(ctx, { action: 'learn.assign', entityType: 'Course', entityId: course.id, after: { mode, users: notifyIds.length, dueAt } })
    await notifyT({
      orgId: ctx.org.id, userIds: notifyIds, priority: 'action', kind: 'learn',
      titleKey: dueAt ? 'learn.notify.assignedDue' : 'learn.notify.assigned', vars: { title: course.title, date: dueAt ? fmtDayMonth(dueAt) : '' },
      href: `/learn/${course.id}`, groupKey: `learn:${course.id}`,
    })
    refresh()
    return { ok: true, data: { n: notifyIds.length }, message: ctx.t('learn.assign.done', { n: notifyIds.length }) }
  })
}

// ── Kurs-Editor ──

const CourseSchema = z.object({
  title: z.string().min(2, 'learn.errors.title').max(200),
  category: z.enum(COURSE_CATEGORIES, { message: 'learn.errors.category' }),
})

export async function saveCourse(form: FormData) {
  return run<{ id: string }>(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'learn.manage')
    const base = CourseSchema.parse({ title: fd(form, 'title'), category: fd(form, 'category') })
    const validity = fdNum(form, 'validityMonths')
    const minutes = fdNum(form, 'estMinutes')
    if (Number.isNaN(validity) || (validity != null && (validity < 1 || validity > 120))) return { ok: false, error: 'learn.errors.validity', field: 'validityMonths' }
    if (Number.isNaN(minutes) || (minutes != null && (minutes < 1 || minutes > 1000))) return { ok: false, error: 'learn.errors.minutes', field: 'estMinutes' }
    const roleKeys = (await db.role.findMany({ where: { orgId: ctx.org.id }, select: { key: true } })).map((r) => r.key)
    const audienceRoles = form.getAll('audienceRoles').map(String).filter((k) => roleKeys.includes(k))
    const data = {
      ...base, description: fd(form, 'description') || null, mandatory: fdBool(form, 'mandatory'), published: fdBool(form, 'published'),
      validityMonths: validity == null ? null : Math.round(validity), estMinutes: minutes == null ? 30 : Math.round(minutes), audienceRoles,
    }
    const id = fd(form, 'id')
    if (id) {
      const before = await loadCourse(ctx, id)
      if (!before) return { ok: false, error: 'common.notFound' }
      await db.course.update({ where: { id }, data })
      await audit(ctx, { action: 'learn.course.update', entityType: 'Course', entityId: id, before: { title: before.title, mandatory: before.mandatory, validityMonths: before.validityMonths, published: before.published, audienceRoles: before.audienceRoles }, after: data })
      refresh()
      return { ok: true, data: { id } }
    }
    const c = await db.course.create({ data: { ...data, orgId: ctx.org.id } })
    await audit(ctx, { action: 'learn.course.create', entityType: 'Course', entityId: c.id, after: data })
    return { ok: true, data: { id: c.id } }
  })
}

const ModuleSchema = z.object({
  kind: z.enum(MODULE_KINDS, { message: 'learn.errors.kind' }),
  title: z.string().min(1, 'learn.errors.moduleTitle').max(200),
})

export async function saveModule(form: FormData) {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'learn.manage')
    const course = await loadCourse(ctx, fd(form, 'courseId'))
    if (!course) return { ok: false, error: 'common.notFound' }
    const m = ModuleSchema.parse({ kind: fd(form, 'kind'), title: fd(form, 'title') })
    const videoUrl = fd(form, 'videoUrl') || null
    if (m.kind === 'video' && (!videoUrl || !/^https:\/\//.test(videoUrl))) return { ok: false, error: 'learn.errors.videoUrl', field: 'videoUrl' }
    let quiz: Prisma.InputJsonValue | undefined
    if (m.kind === 'quiz') {
      let raw: unknown
      try { raw = JSON.parse(fd(form, 'quiz') || 'null') } catch { raw = null }
      const q = parseQuiz(raw)
      if (!q || q.questions.some((x) => x.options.some((o) => !o.trim()) || !x.q.trim() || x.answer < 0 || x.answer >= x.options.length)) return { ok: false, error: 'learn.errors.quiz' }
      quiz = q as unknown as Prisma.InputJsonValue
    }
    const moduleId = fd(form, 'moduleId')
    const existing = moduleId ? course.modules.find((x) => x.id === moduleId) : null
    let fileId = existing?.fileId ?? null
    const file = form.get('file')
    if (m.kind === 'document' && file instanceof File && file.size > 0) {
      try {
        fileId = (await saveUpload(ctx, file, 'learn', false)).id
      } catch (e) {
        if (e instanceof UploadError) return { ok: false, error: 'docs.errors.upload_' + e.message, field: 'file' }
        throw e
      }
    }
    const data = { kind: m.kind, title: m.title, body: fd(form, 'body') || null, videoUrl: m.kind === 'video' ? videoUrl : null, fileId: m.kind === 'document' ? fileId : null, quiz: m.kind === 'quiz' ? quiz : undefined }
    if (existing) {
      await db.courseModule.update({ where: { id: existing.id }, data })
      await audit(ctx, { action: 'learn.module.update', entityType: 'CourseModule', entityId: existing.id, before: { kind: existing.kind, title: existing.title }, after: { kind: data.kind, title: data.title } })
    } else {
      const order = (course.modules.at(-1)?.order ?? -1) + 1
      const created = await db.courseModule.create({ data: { ...data, courseId: course.id, order } })
      await audit(ctx, { action: 'learn.module.create', entityType: 'CourseModule', entityId: created.id, after: { kind: data.kind, title: data.title, order } })
    }
    refresh()
  })
}

export async function deleteModule(courseId: string, moduleId: string) {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'learn.manage')
    const course = await loadCourse(ctx, courseId)
    const mod = course?.modules.find((m) => m.id === moduleId)
    if (!course || !mod) return { ok: false, error: 'common.notFound' }
    await normalizeProgress(courseId, course.modules)
    await db.courseModule.delete({ where: { id: mod.id } })
    await audit(ctx, { action: 'learn.module.delete', entityType: 'CourseModule', entityId: mod.id, before: { kind: mod.kind, title: mod.title, order: mod.order } })
    refresh()
  })
}

/** Ältere Fortschritte (Reihenfolge als Schlüssel) vor Strukturänderungen auf Modul-IDs umstellen. */
async function normalizeProgress(courseId: string, modules: { id: string; order: number }[]) {
  const enrollments = await db.enrollment.findMany({ where: { courseId }, select: { id: true, doneModules: true } })
  const legacy = enrollments.filter((e) => e.doneModules.some((k) => /^\d+$/.test(k)))
  if (!legacy.length) return
  await db.$transaction(legacy.map((e) => db.enrollment.update({ where: { id: e.id }, data: { doneModules: modules.filter((m) => isDone(e.doneModules, m)).map((m) => m.id) } })))
}

/** Reihenfolge ändern. Bestehender Fortschritt wird über Modul-IDs gehalten. */
export async function moveModule(courseId: string, moduleId: string, dir: -1 | 1) {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'learn.manage')
    const course = await loadCourse(ctx, courseId)
    if (!course) return { ok: false, error: 'common.notFound' }
    const i = course.modules.findIndex((m) => m.id === moduleId)
    const j = i + dir
    if (i < 0 || j < 0 || j >= course.modules.length) return { ok: true }
    const a = course.modules[i]
    const b = course.modules[j]
    await normalizeProgress(courseId, course.modules)
    await db.$transaction([
      db.courseModule.update({ where: { id: a.id }, data: { order: b.order } }),
      db.courseModule.update({ where: { id: b.id }, data: { order: a.order } }),
    ])
    await audit(ctx, { action: 'learn.module.move', entityType: 'CourseModule', entityId: a.id, before: { order: a.order }, after: { order: b.order } })
    refresh()
  })
}
