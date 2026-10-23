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
  const obj = await storeFile({ orgId: ctx.org.id, uploadedById: ctx.user.id, filename: file.name, contentType: type, bytes: new Uint8Array(await file.arrayBuffer()), purpose, clinical })
  await audit(ctx, { action: 'file.upload', entityType: 'FileObject', entityId: obj.id, after: { filename: obj.filename, purpose, size: obj.size } })
  return obj
}

/**
 * Ablage ohne Sitzung (Schnittstellen, z. B. FHIR DocumentReference): Bytes in den Bucket, FileObject anlegen.
 * Prüfung von Typ und Grösse und das Audit übernimmt die aufrufende Stelle.
 */
export async function storeFile(f: { orgId: string; uploadedById: string; filename: string; contentType: string; bytes: Uint8Array; purpose: string; clinical: boolean }) {
  if (!storageConfigured()) throw new UploadError('storage_not_configured')
  const key = objectKey(f.orgId, f.purpose, f.filename)
  await putObject(key, f.bytes, f.contentType)
  return db.fileObject.create({
    data: { orgId: f.orgId, key, filename: f.filename.slice(0, 200), contentType: f.contentType, size: f.bytes.length, purpose: f.purpose, clinical: f.clinical, uploadedById: f.uploadedById },
  })
}

/** URL, unter der eine Datei mit Berechtigungsprüfung ausgeliefert wird. */
export const fileUrl = (id: string, download = false) => `/api/files/${id}${download ? '?download=1' : ''}`
