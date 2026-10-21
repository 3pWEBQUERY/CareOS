'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getCtx, assertCan } from '@/lib/context'
import { run, fd, fdBool, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { saveUpload, UploadError } from '@/lib/files'
import { orgSettings } from '@/lib/admin'
import { DATA_REGIONS, HEX_RE, contrastRatio } from '@/lib/admin-shared'
import { LOCALES } from '@/i18n/core'

const pick = <T extends object, K extends keyof T>(o: T, keys: K[]) => Object.fromEntries(keys.map((k) => [k, o[k]])) as Pick<T, K>

export async function updateOrgAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'admin.org')
    const name = fd(form, 'name')
    if (name.length < 2) return { ok: false, error: 'admin.errors.name', field: 'name' }
    const terminology = z.enum(['resident', 'patient', 'client']).parse(fd(form, 'terminology'))
    const defaultLocale = z.enum(LOCALES).parse(fd(form, 'defaultLocale'))
    const timezone = fd(form, 'timezone')
    if (!Intl.supportedValuesOf('timeZone').includes(timezone) && timezone !== 'UTC') return { ok: false, error: 'admin.org.badTimezone', field: 'timezone' }
    const dataRegion = z.enum(DATA_REGIONS).parse(fd(form, 'dataRegion'))
    const settings = orgSettings(ctx.org.settings)
    const nextSettings = { ...settings, requireMfaForAdmins: fdBool(form, 'requireMfaForAdmins') }
    const before = { ...pick(ctx.org, ['name', 'terminology', 'defaultLocale', 'timezone', 'dataRegion']), requireMfaForAdmins: !!settings.requireMfaForAdmins }
    const after = { name: name.slice(0, 120), terminology, defaultLocale, timezone, dataRegion }
    await db.organization.update({ where: { id: ctx.org.id }, data: { ...after, settings: nextSettings as Prisma.InputJsonValue } })
    await audit(ctx, { action: 'admin.org.update', entityType: 'Organization', entityId: ctx.org.id, before, after: { ...after, requireMfaForAdmins: nextSettings.requireMfaForAdmins } })
    refresh()
  })
}

export async function updateBrandingAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'admin.org')
    const brandName = fd(form, 'brandName').slice(0, 40) || null
    const brandColor: string | null = fd(form, 'brandColor').toUpperCase() || null
    if (brandColor) {
      if (!HEX_RE.test(brandColor)) return { ok: false, error: 'admin.org.badColor', field: 'brandColor' }
      const ratio = contrastRatio(brandColor, '#FFFFFF')
      if (ratio < 4.5) return { ok: false, error: ctx.t('admin.org.lowContrast', { ratio: ratio.toFixed(2) }), field: 'brandColor' }
    }
    const before = pick(ctx.org, ['brandName', 'brandColor'])
    await db.organization.update({ where: { id: ctx.org.id }, data: { brandName, brandColor } })
    await audit(ctx, { action: 'admin.org.branding', entityType: 'Organization', entityId: ctx.org.id, before, after: { brandName, brandColor } })
    refresh()
  })
}

export async function resetBrandColorAction(): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'admin.org')
    await db.organization.update({ where: { id: ctx.org.id }, data: { brandColor: null } })
    await audit(ctx, { action: 'admin.org.branding', entityType: 'Organization', entityId: ctx.org.id, before: { brandColor: ctx.org.brandColor }, after: { brandColor: null } })
    refresh()
    return { ok: true, message: 'admin.org.colorReset' }
  })
}

export async function uploadLogoAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'admin.org')
    const file = form.get('logo')
    if (!(file instanceof File) || !file.size) return { ok: false, error: 'admin.org.uploadErrors.empty', field: 'logo' }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return { ok: false, error: 'admin.org.uploadErrors.type', field: 'logo' }
    try {
      const obj = await saveUpload(ctx, file, 'logo', false)
      await db.organization.update({ where: { id: ctx.org.id }, data: { logoFileId: obj.id } })
      await audit(ctx, { action: 'admin.org.logo', entityType: 'Organization', entityId: ctx.org.id, before: { logoFileId: ctx.org.logoFileId }, after: { logoFileId: obj.id } })
    } catch (e) {
      if (e instanceof UploadError) return { ok: false, error: 'admin.org.uploadErrors.' + e.message, field: 'logo' }
      throw e
    }
    refresh()
  })
}

export async function removeLogoAction(): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'admin.org')
    await db.organization.update({ where: { id: ctx.org.id }, data: { logoFileId: null } })
    await audit(ctx, { action: 'admin.org.logo', entityType: 'Organization', entityId: ctx.org.id, before: { logoFileId: ctx.org.logoFileId }, after: { logoFileId: null } })
    refresh()
  })
}
