import { hash, verify } from '@node-rs/argon2'

const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 }

export const hashPassword = (pw: string) => hash(pw, OPTS)

export async function verifyPassword(stored: string | null | undefined, pw: string) {
  if (!stored) return false
  try {
    return await verify(stored, pw)
  } catch {
    return false
  }
}

/** Mindestanforderung: 10 Zeichen (Registrierung: 12), nicht nur Ziffern. */
export function passwordProblem(pw: string, min = 10): string | null {
  if (pw.length < min) return 'min_length'
  if (/^\d+$/.test(pw)) return 'only_digits'
  return null
}
