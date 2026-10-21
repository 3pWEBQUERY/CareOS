import 'server-only'
import { env } from '@/lib/env'

export function rp() {
  const url = new URL(env.appUrl)
  return { rpID: env.webauthnRpId || url.hostname, rpName: 'CareOS', origin: url.origin }
}
export const CHALLENGE_COOKIE = 'careos_webauthn'
