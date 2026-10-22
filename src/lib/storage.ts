import 'server-only'
import { randomUUID } from 'node:crypto'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env, storageConfigured } from '@/lib/env'

/**
 * Railway Bucket (S3-kompatibel). Dateien werden nie öffentlich ausgeliefert:
 * Downloads laufen über /api/files/[id] mit Berechtigungsprüfung und kurzlebiger Presigned URL.
 */
let client: S3Client | null = null
function s3() {
  if (!storageConfigured()) throw new Error('storage_not_configured')
  client ??= new S3Client({
    endpoint: env.s3.endpoint,
    region: env.s3.region,
    forcePathStyle: env.s3.forcePathStyle,
    credentials: { accessKeyId: env.s3.accessKeyId, secretAccessKey: env.s3.secretAccessKey },
  })
  return client
}

export { MAX_UPLOAD_BYTES, ALLOWED_TYPES } from './upload-limits'

export function objectKey(orgId: string, purpose: string, filename: string) {
  const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : 'bin'
  return `${orgId}/${purpose}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`
}

export async function putObject(key: string, body: Uint8Array, contentType: string) {
  await s3().send(new PutObjectCommand({ Bucket: env.s3.bucket, Key: key, Body: body, ContentType: contentType }))
}

export async function signedGetUrl(key: string, filename: string, inline = true, seconds = 120) {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: env.s3.bucket,
      Key: key,
      ResponseContentDisposition: `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`,
    }),
    { expiresIn: seconds },
  )
}

export async function signedPutUrl(key: string, contentType: string, seconds = 300) {
  return getSignedUrl(s3(), new PutObjectCommand({ Bucket: env.s3.bucket, Key: key, ContentType: contentType }), { expiresIn: seconds })
}

export async function deleteObject(key: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: env.s3.bucket, Key: key }))
}
