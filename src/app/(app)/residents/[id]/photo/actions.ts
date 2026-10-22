'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { fdBool, run, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { storageConfigured } from '@/lib/env'
import { saveUpload, UploadError } from '@/lib/files'
import { deleteObject } from '@/lib/storage'
import type { Ctx } from '@/lib/context'
import { actionResident } from '../../_lib/resident'

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_PHOTO_BYTES = 5 * 1024 * 1024

/** Foto aufnehmen/ändern: Stammdaten (resident.edit) oder Pflegefachperson (resident.careplan.edit). */
async function load(residentId: string) {
  const { ctx, r, can } = await actionResident(residentId, 'resident.read')
  if (!can('resident.edit') && !can('resident.careplan.edit')) return { ctx, r, allowed: false as const }
  return { ctx, r, allowed: true as const }
}

/** Vorheriges Foto aus der Ablage entfernen (Datenminimierung, PRD §36); Fehler verhindern den Wechsel nicht. */
async function dropFile(ctx: Ctx, fileId: string | null) {
  if (!fileId) return
  const f = await db.fileObject.findFirst({ where: { id: fileId, orgId: ctx.org.id } })
  if (!f) return
  try {
    if (storageConfigured()) await deleteObject(f.key)
    await db.fileObject.delete({ where: { id: f.id } })
  } catch (e) {
    console.error('[photo] alte Datei nicht entfernt', e)
  }
}

/**
 * Bewohnerfoto zur Identifikation (PRD §32). Aufnahme in der App (kontrollierte Kamera, keine Kopie in der Galerie),
 * Einwilligung der Person bzw. Vertretung wird bestätigt und protokolliert.
 */
export async function setResidentPhoto(residentId: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const { ctx, r, allowed } = await load(residentId)
    if (!allowed) return { ok: false, error: 'common.notAllowed' }
    if (!storageConfigured()) return { ok: false, error: 'residents.photo.errors.storage' }
    if (!fdBool(form, 'consent')) return { ok: false, error: 'residents.photo.errors.consent', field: 'consent' }
    const file = form.get('photo')
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'residents.photo.errors.empty' }
    if (!PHOTO_TYPES.includes(file.type)) return { ok: false, error: 'residents.photo.errors.type' }
    if (file.size > MAX_PHOTO_BYTES) return { ok: false, error: 'residents.photo.errors.size' }
    let id: string
    try {
      id = (await saveUpload(ctx, file, 'resident-photo', true)).id
    } catch (e) {
      if (e instanceof UploadError) return { ok: false, error: e.message === 'storage_not_configured' ? 'residents.photo.errors.storage' : 'residents.photo.errors.upload' }
      throw e
    }
    const before = r.photoFileId
    await db.resident.update({ where: { id: r.id }, data: { photoFileId: id } })
    await dropFile(ctx, before)
    await audit(ctx, { action: 'resident.photo.set', entityType: 'Resident', entityId: r.id, before: { photoFileId: before }, after: { photoFileId: id, consent: true, source: form.get('source') === 'file' ? 'file' : 'camera' }, context: { residentId: r.id } })
    await emit({ orgId: ctx.org.id, type: 'resident.updated', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { photo: true } })
    refresh()
    return { ok: true, message: 'residents.photo.saved' }
  })
}

export async function removeResidentPhoto(residentId: string): Promise<ActionResult> {
  return run(async () => {
    const { ctx, r, allowed } = await load(residentId)
    if (!allowed) return { ok: false, error: 'common.notAllowed' }
    if (!r.photoFileId) return { ok: true }
    await db.resident.update({ where: { id: r.id }, data: { photoFileId: null } })
    await dropFile(ctx, r.photoFileId)
    await audit(ctx, { action: 'resident.photo.remove', entityType: 'Resident', entityId: r.id, before: { photoFileId: r.photoFileId }, after: { photoFileId: null }, context: { residentId: r.id } })
    await emit({ orgId: ctx.org.id, type: 'resident.updated', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { photo: false } })
    refresh()
    return { ok: true, message: 'residents.photo.removed' }
  })
}
