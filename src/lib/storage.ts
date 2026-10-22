import 'server-only'
import { randomUUID } from 'node:crypto'
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client, type ServerSideEncryption } from '@aws-sdk/client-s3'
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

/**
 * Serverseitige Verschlüsselung (PRD §37): Railway Buckets verschlüsseln immer at rest und unterstützen den
 * SSE-Header nicht. Für andere S3-Anbieter S3_SSE=AES256 (oder aws:kms) setzen; dann wird jeder Upload mit Angabe gespeichert.
 */
const sse = () => (env.s3.sse ? { ServerSideEncryption: env.s3.sse as ServerSideEncryption } : {})

export async function putObject(key: string, body: Uint8Array, contentType: string) {
  await s3().send(new PutObjectCommand({ Bucket: env.s3.bucket, Key: key, Body: body, ContentType: contentType, ...sse() }))
}

/** Erreichbarkeit des Buckets für den Health Check (HeadBucket, mit Zeitlimit). */
export async function headBucket(timeoutMs = 2500) {
  const started = Date.now()
  await s3().send(new HeadBucketCommand({ Bucket: env.s3.bucket }), { abortSignal: AbortSignal.timeout(timeoutMs) })
  return Date.now() - started
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
  return getSignedUrl(s3(), new PutObjectCommand({ Bucket: env.s3.bucket, Key: key, ContentType: contentType, ...sse() }), { expiresIn: seconds })
}

export async function deleteObject(key: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: env.s3.bucket, Key: key }))
}
