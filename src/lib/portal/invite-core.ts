/** Einladungen ins Angehörigenportal – reine Regeln (testbar). */
export const PORTAL_INVITE_DAYS = 7
export const PORTAL_INVITE_MS = PORTAL_INVITE_DAYS * 86400_000

export type InviteLike = { inviteTokenHash: string | null; inviteExpiresAt: Date | null; acceptedAt: Date | null; revokedAt: Date | null }

/** Warum ein Einladungslink nicht (mehr) gilt – oder null, wenn er angenommen werden kann. */
export function inviteProblem(a: InviteLike | null, now = new Date()): 'invalid' | 'used' | 'revoked' | 'expired' | null {
  if (!a || !a.inviteTokenHash) return a?.acceptedAt ? 'used' : 'invalid'
  if (a.revokedAt) return 'revoked'
  if (a.acceptedAt) return 'used'
  if (!a.inviteExpiresAt || a.inviteExpiresAt <= now) return 'expired'
  return null
}

export const inviteExpiry = (now = new Date()) => new Date(now.getTime() + PORTAL_INVITE_MS)

/** Plausibler Token aus der URL (base64url, 43 Zeichen bei 32 Byte). */
export const tokenShapeOk = (t: unknown): t is string => typeof t === 'string' && /^[A-Za-z0-9_-]{32,64}$/.test(t)

/** E-Mail normalisieren (Konten sind je Organisation über die kleingeschriebene Adresse eindeutig). */
export const normalizeEmail = (e: string) => e.trim().toLowerCase()
