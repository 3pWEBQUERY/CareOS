import 'server-only'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * Verschlüsselung gespeicherter Geheimnisse (z. B. MFA-Seeds) mit AES-256-GCM.
 * Schlüssel aus APP_SECRET (Railway-Variable, mindestens 32 Zeichen).
 */
function key() {
  const secret = process.env.APP_SECRET
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === 'production') throw new Error('APP_SECRET fehlt oder ist kürzer als 32 Zeichen')
    return createHash('sha256').update('careos-dev-only-secret').digest()
  }
  return createHash('sha256').update(secret).digest()
}

export function encrypt(plain: string) {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.')
}

export function decrypt(payload: string) {
  const [v, iv, tag, data] = payload.split('.')
  if (v !== 'v1') throw new Error('unknown_cipher')
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
  d.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8')
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')
