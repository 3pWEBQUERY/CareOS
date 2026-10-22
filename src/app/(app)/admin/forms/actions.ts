'use server'

import { refresh } from 'next/cache'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getCtx, assertCan } from '@/lib/context'
import { run, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { slugKey } from '@/lib/admin-shared'
import { fieldsChanged, normalizeFields, readFields } from '@/lib/forms'
import { formUsage } from './usage'

const CATEGORIES = ['care', 'observation', 'physician', 'relatives', 'incident', 'handover'] as const
type Category = (typeof CATEGORIES)[number]

export type FormPayload = { id?: string; name: string; category: string; description?: string; active: boolean; fields: unknown }

async function admin() {
  const ctx = await getCtx()
  assertCan(ctx, 'admin.config')
  return ctx
}

/**
 * Formular speichern (Admin → Formulare, PRD §45). Ändern sich die Felder eines aktiven oder bereits
 * verwendeten Formulars, steigt die Version; bestehende Einträge behalten ihre Momentaufnahme.
 */
export async function saveFormAction(p: FormPayload): Promise<ActionResult<{ id: string; version: number; index?: number }>> {
  return run(async () => {
    const ctx = await admin()
    const name = String(p.name ?? '').trim().slice(0, 80)
    if (name.length < 2) return { ok: false, error: 'admin.errors.name', field: 'name' }
    const category = (CATEGORIES as readonly string[]).includes(p.category) ? (p.category as Category) : 'care'
    const description = String(p.description ?? '').trim().slice(0, 300) || null
    const active = p.active === true
    const norm = normalizeFields(p.fields)
    if (!norm.ok) return { ok: false, error: norm.index != null ? ctx.t('forms.errors.atField', { n: norm.index + 1, error: ctx.t(norm.error) }) : norm.error }
    const fields = norm.fields

    if (p.id) {
      const before = await db.formDefinition.findFirst({ where: { id: p.id, orgId: ctx.org.id } })
      if (!before) return { ok: false, error: 'common.notFound' }
      const oldFields = readFields(before.fields)
      const changed = fieldsChanged(oldFields, fields)
      const used = changed ? (await formUsage(ctx.org.id, [before.key])).get(before.key) ?? 0 : 0
      const version = changed && (before.active || used > 0) ? before.version + 1 : before.version
      await db.formDefinition.update({ where: { id: before.id }, data: { name, category, description, active, fields: fields as unknown as Prisma.InputJsonValue, version } })
      await audit(ctx, {
        action: 'admin.config.form', entityType: 'FormDefinition', entityId: before.id,
        before: { name: before.name, category: before.category, active: before.active, version: before.version, fields: before.fields },
        after: { name, category, active, version, fields },
      })
      refresh()
      return { ok: true, data: { id: before.id, version }, message: version !== before.version ? ctx.t('forms.admin.savedVersion', { v: version }) : 'common.saved' }
    }

    const base = slugKey(name) || 'formular'
    let key = base
    for (let i = 2; await db.formDefinition.findUnique({ where: { orgId_key: { orgId: ctx.org.id, key } } }); i++) key = `${base}_${i}`
    try {
      const def = await db.formDefinition.create({ data: { orgId: ctx.org.id, key, name, category, description, active, fields: fields as unknown as Prisma.InputJsonValue } })
      await audit(ctx, { action: 'admin.config.form_create', entityType: 'FormDefinition', entityId: def.id, after: { key, name, category, active, fields } })
      refresh()
      return { ok: true, data: { id: def.id, version: def.version }, message: 'forms.admin.created' }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ok: false, error: 'forms.errors.keyTaken' }
      throw e
    }
  })
}

export async function setFormActiveAction(id: string, active: boolean): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const before = await db.formDefinition.findFirst({ where: { id, orgId: ctx.org.id } })
    if (!before) return { ok: false, error: 'common.notFound' }
    if (!readFields(before.fields).length && active) return { ok: false, error: 'forms.errors.noFields' }
    await db.formDefinition.update({ where: { id }, data: { active } })
    await audit(ctx, { action: 'admin.config.form_active', entityType: 'FormDefinition', entityId: id, before: { active: before.active }, after: { active } })
    refresh()
    return { ok: true, message: active ? 'forms.admin.activated' : 'forms.admin.deactivated' }
  })
}

/** Nur nie verwendete Formulare dürfen gelöscht werden; sonst deaktivieren (Nachvollziehbarkeit). */
export async function deleteFormAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await admin()
    const before = await db.formDefinition.findFirst({ where: { id, orgId: ctx.org.id } })
    if (!before) return { ok: false, error: 'common.notFound' }
    if ((await formUsage(ctx.org.id, [before.key])).get(before.key)) return { ok: false, error: 'forms.errors.inUse' }
    await db.formDefinition.delete({ where: { id } })
    await audit(ctx, { action: 'admin.config.form_delete', entityType: 'FormDefinition', entityId: id, before: { key: before.key, name: before.name, version: before.version, fields: before.fields } })
    refresh()
    return { ok: true, message: 'admin.common.deleted' }
  })
}
