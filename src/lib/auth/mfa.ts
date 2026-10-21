import 'server-only'
import { Secret, TOTP } from 'otpauth'
import QRCode from 'qrcode'
import { decrypt, encrypt } from '@/lib/crypto'

const totp = (secret: Secret, label: string) => new TOTP({ issuer: 'CareOS', label, algorithm: 'SHA1', digits: 6, period: 30, secret })

export async function newMfaSecret(label: string) {
  const secret = new Secret({ size: 20 })
  const uri = totp(secret, label).toString()
  return { encrypted: encrypt(secret.base32), base32: secret.base32, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) }
}

/** Prüft einen 6-stelligen Code mit ±1 Zeitfenster Toleranz. */
export function verifyTotp(encryptedSecret: string, code: string, label = 'CareOS') {
  const clean = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(clean)) return false
  const secret = Secret.fromBase32(decrypt(encryptedSecret))
  return totp(secret, label).validate({ token: clean, window: 1 }) !== null
}
