import 'server-only'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { audit } from '@/lib/audit'
import { storageConfigured } from '@/lib/env'
import { ALLOWED_TYPES, MAX_UPLOAD_BYTES, objectKey, putObject } from '@/lib/storage'

export class UploadError extends Error {}

/**
 * Speichert eine hochgeladene Datei im Railway Bucket und legt einen FileObject-Datensatz an.
 * purpose: 'wound' | 'resident' | 'document' | 'attachment' | 'learn' | 'avatar' | 'logo'
 * clinical=true: Zugriff nur mit resident.read (Gesundheitsdaten, PRD §15, §36).
 */
export async function saveUpload(ctx: Ctx, file: File, purpose: string, clinical: boolean) {
  if (!storageConfigured()) throw new UploadError('storage_not_configured')
  if (!file || file.size === 0) throw new UploadError('empty')
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError('too_large')
  const type = file.type || 'application/octet-stream'
  if (!ALLOWED_TYPES.includes(type)) throw new UploadError('type')
  const key = objectKey(ctx.org.id, purpose, file.name)
  await putObject(key, new Uint8Array(await file.arrayBuffer()), type)
  const obj = await db.fileObject.create({
    data: { orgId: ctx.org.id, key, filename: file.name.slice(0, 200), contentType: type, size: file.size, purpose, clinical, uploadedById: ctx.user.id },
  })
  await audit(ctx, { action: 'file.upload', entityType: 'FileObject', entityId: obj.id, after: { filename: obj.filename, purpose, size: obj.size } })
  return obj
}

/** URL, unter der eine Datei mit Berechtigungsprüfung ausgeliefert wird. */
export const fileUrl = (id: string, download = false) => `/api/files/${id}${download ? '?download=1' : ''}`
