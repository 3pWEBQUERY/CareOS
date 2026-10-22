'use server'

import { cookies } from 'next/headers'
import { refresh } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { run, runSetup, fd, fdBool, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { rateLimit } from '@/lib/rate-limit'
import { encrypt, decrypt } from '@/lib/crypto'
import { newMfaSecret, verifyTotp } from '@/lib/auth/mfa'
import { hashPassword, passwordProblem, verifyPassword } from '@/lib/auth/password'
import { LOCALES } from '@/i18n/core'
import { normalizeTheme } from '@/lib/theme'
import { saveUpload, UploadError } from '@/lib/files'
import { deleteObject } from '@/lib/storage'

const MFA_SETUP = 'mfa_setup'

const PHONE_RE = /^[+\d][\d\s()./-]{3,}$/

/**
 * Kontaktangaben für das Personenverzeichnis (PRD §55) – die einzigen selbst änderbaren Stammdaten.
 * Dienstliche Nummer: für alle sichtbar. Private Nummer: nur für Person, Leitung und HR, ausser freigegeben.
 */
export async function updateContactAction(form: FormData): Promise<ActionResult> {
  return runSetup(async () => {
    const ctx = await getCtx()
    const workPhone = fd(form, 'workPhone').slice(0, 40)
    const phone = fd(form, 'phone').slice(0, 40)
    if (workPhone && !PHONE_RE.test(workPhone)) return { ok: false, error: 'people.me.errors.phone', field: 'workPhone' }
    if (phone && !PHONE_RE.test(phone)) return { ok: false, error: 'people.me.errors.phone', field: 'phone' }
    const after = { workPhone: workPhone || null, phone: phone || null, phoneShared: !!phone && fdBool(form, 'phoneShared') }
    const before = { workPhone: ctx.user.workPhone, phone: ctx.user.phone, phoneShared: ctx.user.phoneShared }
    await db.user.update({ where: { id: ctx.user.id }, data: after })
    await audit(ctx, { action: 'profile.contact', entityType: 'User', entityId: ctx.user.id, before, after })
    refresh()
  })
}

const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const AVATAR_MAX = 5 * 1024 * 1024

/** Altes Profilbild aus Ablage und Datenbank entfernen (nur eigene Profilbilder). */
async function dropAvatar(orgId: string, fileId: string | null) {
  if (!fileId) return
  const f = await db.fileObject.findFirst({ where: { id: fileId, orgId, purpose: 'avatar' } })
  if (!f) return
  await deleteObject(f.key).catch((e) => console.error('[avatar] delete', e))
  await db.fileObject.delete({ where: { id: f.id } }).catch(() => {})
}

/** Profilbild hochladen (im Browser auf 320 × 320 verkleinert, dadurch ohne EXIF-Standortdaten). */
export async function uploadAvatarAction(form: FormData): Promise<ActionResult> {
  return runSetup(async () => {
    const ctx = await getCtx()
    const file = form.get('photo')
    if (!(file instanceof File) || file.size === 0 || !AVATAR_TYPES.includes(file.type)) return { ok: false, error: 'people.me.errors.photoType', field: 'photo' }
    if (file.size > AVATAR_MAX) return { ok: false, error: 'people.me.errors.photoSize', field: 'photo' }
    let id: string
    try {
      id = (await saveUpload(ctx, file, 'avatar', false)).id
    } catch (e) {
      if (e instanceof UploadError) return { ok: false, error: e.message === 'storage_not_configured' ? 'people.me.errors.storage' : e.message === 'type' ? 'people.me.errors.photoType' : 'people.me.errors.upload', field: 'photo' }
      throw e
    }
    const before = ctx.user.avatarFileId
    await db.user.update({ where: { id: ctx.user.id }, data: { avatarFileId: id } })
    await dropAvatar(ctx.org.id, before)
    await audit(ctx, { action: 'profile.avatar', entityType: 'User', entityId: ctx.user.id, before: { avatarFileId: before }, after: { avatarFileId: id } })
    refresh()
    return { ok: true, message: 'people.me.photoSaved' }
  })
}

export async function removeAvatarAction(): Promise<ActionResult> {
  return runSetup(async () => {
    const ctx = await getCtx()
    const before = ctx.user.avatarFileId
    if (!before) return { ok: true }
    await db.user.update({ where: { id: ctx.user.id }, data: { avatarFileId: null } })
    await dropAvatar(ctx.org.id, before)
    await audit(ctx, { action: 'profile.avatar', entityType: 'User', entityId: ctx.user.id, before: { avatarFileId: before }, after: { avatarFileId: null } })
    refresh()
    return { ok: true, message: 'people.me.photoRemoved' }
  })
}

export async function setLocaleAction(locale: string): Promise<ActionResult> {
  return runSetup(async () => {
    const ctx = await getCtx()
    const v = z.enum(LOCALES).parse(locale)
    await db.user.update({ where: { id: ctx.user.id }, data: { locale: v } })
    ;(await cookies()).set('careos_locale', v, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
    await audit(ctx, { action: 'profile.locale', entityType: 'User', entityId: ctx.user.id, before: { locale: ctx.user.locale }, after: { locale: v } })
    refresh()
  })
}

/** Protokolliert die Änderung der Darstellung (die Speicherung erfolgt über setThemeAction der Shell). */
export async function auditThemeAction(theme: string): Promise<ActionResult> {
  return runSetup(async () => {
    const ctx = await getCtx()
    await audit(ctx, { action: 'profile.theme', entityType: 'User', entityId: ctx.user.id, before: { theme: ctx.user.theme }, after: { theme: normalizeTheme(theme) } })
  })
}

// ───────── MFA (TOTP) ─────────

async function pendingSetup(userId: string) {
  return db.authChallenge.findFirst({ where: { userId, kind: MFA_SETUP, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } })
}

async function createSetup(userId: string, email: string) {
  await db.authChallenge.deleteMany({ where: { userId, kind: MFA_SETUP } })
  const s = await newMfaSecret(email)
  await db.authChallenge.create({ data: { userId, kind: MFA_SETUP, challenge: s.encrypted, expiresAt: new Date(Date.now() + 10 * 60_000) } })
  return { qr: s.qr, secret: s.base32.replace(/(.{4})/g, '$1 ').trim() }
}

/** Startet die Einrichtung: neues Geheimnis (verschlüsselt, 10 Min. gültig), QR-Code und manueller Code. */
export async function startMfaSetupAction(): Promise<ActionResult<{ qr: string; secret: string }>> {
  return runSetup(async () => {
    const ctx = await getCtx()
    if (ctx.user.mfaEnabled) return { ok: false, error: 'profile.mfa.alreadyEnabled' }
    return { ok: true, data: await createSetup(ctx.user.id, ctx.user.email) }
  })
}

/** Neues Geheimnis erzeugen; erfordert einen gültigen Code des bisherigen Geheimnisses. */
export async function regenerateMfaAction(form: FormData): Promise<ActionResult<{ qr: string; secret: string }>> {
  return runSetup(async () => {
    const ctx = await getCtx()
    if (!(await rateLimit('mfa-profile:' + ctx.user.id, 8, 10 * 60_000)).ok) return { ok: false, error: 'profile.errors.rate' }
    if (!ctx.user.mfaEnabled || !ctx.user.mfaSecret) return { ok: false, error: 'common.genericError' }
    if (!verifyTotp(ctx.user.mfaSecret, fd(form, 'code'), ctx.user.email)) {
      await audit(ctx, { action: 'profile.mfa_code_failed', entityType: 'User', entityId: ctx.user.id })
      return { ok: false, error: 'profile.mfa.invalidCode', field: 'code' }
    }
    return { ok: true, data: await createSetup(ctx.user.id, ctx.user.email) }
  })
}

/** Bestätigt die Einrichtung mit einem Code aus der Authenticator-App und aktiviert MFA. */
export async function confirmMfaAction(form: FormData): Promise<ActionResult> {
  return runSetup(async () => {
    const ctx = await getCtx()
    if (!(await rateLimit('mfa-profile:' + ctx.user.id, 8, 10 * 60_000)).ok) return { ok: false, error: 'profile.errors.rate' }
    const ch = await pendingSetup(ctx.user.id)
    if (!ch) return { ok: false, error: 'profile.mfa.expired' }
    if (!verifyTotp(ch.challenge, fd(form, 'code'), ctx.user.email)) return { ok: false, error: 'profile.mfa.invalidCode', field: 'code' }
    // Neu verschlüsseln, damit das gespeicherte Geheimnis nicht identisch mit dem temporären Datensatz ist.
    const secret = encrypt(decrypt(ch.challenge))
    const regenerated = ctx.user.mfaEnabled
    await db.$transaction([
      db.user.update({ where: { id: ctx.user.id }, data: { mfaSecret: secret, mfaEnabled: true } }),
      db.authChallenge.deleteMany({ where: { userId: ctx.user.id, kind: MFA_SETUP } }),
      db.session.update({ where: { id: ctx.sessionId }, data: { mfaPassed: true } }),
    ])
    await audit(ctx, { action: regenerated ? 'profile.mfa_regenerated' : 'profile.mfa_enabled', entityType: 'User', entityId: ctx.user.id, before: { mfaEnabled: ctx.user.mfaEnabled }, after: { mfaEnabled: true } })
    refresh()
    return { ok: true, message: regenerated ? 'profile.mfa.regenerated' : 'profile.mfa.enabled' }
  })
}

export async function disableMfaAction(form: FormData): Promise<ActionResult> {
  return runSetup(async () => {
    const ctx = await getCtx()
    if (!(await rateLimit('mfa-profile:' + ctx.user.id, 8, 10 * 60_000)).ok) return { ok: false, error: 'profile.errors.rate' }
    if (!ctx.user.mfaEnabled || !ctx.user.mfaSecret) return { ok: true }
    if (!verifyTotp(ctx.user.mfaSecret, fd(form, 'code'), ctx.user.email)) {
      await audit(ctx, { action: 'profile.mfa_code_failed', entityType: 'User', entityId: ctx.user.id })
      return { ok: false, error: 'profile.mfa.invalidCode', field: 'code' }
    }
    const settings = (ctx.org.settings ?? {}) as { requireMfaForAdmins?: boolean; requireMfaForAll?: boolean }
    if (settings.requireMfaForAll || (settings.requireMfaForAdmins && ctx.grants.some((g) => g.permissions.some((p) => p.startsWith('admin.'))))) return { ok: false, error: 'profile.mfa.requiredByOrg' }
    await db.user.update({ where: { id: ctx.user.id }, data: { mfaEnabled: false, mfaSecret: null } })
    await audit(ctx, { action: 'profile.mfa_disabled', entityType: 'User', entityId: ctx.user.id, before: { mfaEnabled: true }, after: { mfaEnabled: false } })
    refresh()
    return { ok: true, message: 'profile.mfa.disabled' }
  })
}

// ───────── Passkeys ─────────

export async function renamePasskeyAction(form: FormData): Promise<ActionResult> {
  return runSetup(async () => {
    const ctx = await getCtx()
    const id = fd(form, 'id')
    const name = fd(form, 'name').slice(0, 60)
    if (!name) return { ok: false, error: 'profile.errors.name', field: 'name' }
    const pk = await db.passkey.findFirst({ where: { id, userId: ctx.user.id } })
    if (!pk) return { ok: false, error: 'common.notFound' }
    await db.passkey.update({ where: { id }, data: { name } })
    await audit(ctx, { action: 'profile.passkey_renamed', entityType: 'Passkey', entityId: id, before: { name: pk.name }, after: { name } })
    refresh()
  })
}

export async function deletePasskeyAction(id: string): Promise<ActionResult> {
  return runSetup(async () => {
    const ctx = await getCtx()
    const pk = await db.passkey.findFirst({ where: { id, userId: ctx.user.id } })
    if (!pk) return { ok: false, error: 'common.notFound' }
    await db.passkey.delete({ where: { id } })
    await audit(ctx, { action: 'profile.passkey_deleted', entityType: 'Passkey', entityId: id, before: { name: pk.name, createdAt: pk.createdAt } })
    refresh()
    return { ok: true, message: 'profile.passkeys.deleted' }
  })
}

// ───────── Sitzungen ─────────

export async function revokeSessionAction(id: string): Promise<ActionResult> {
  return runSetup(async () => {
    const ctx = await getCtx()
    if (id === ctx.sessionId) return { ok: false, error: 'profile.sessions.notCurrent' }
    const s = await db.session.findFirst({ where: { id, userId: ctx.user.id, revokedAt: null } })
    if (!s) return { ok: false, error: 'common.notFound' }
    await db.session.update({ where: { id }, data: { revokedAt: new Date() } })
    await audit(ctx, { action: 'profile.session_revoked', entityType: 'Session', entityId: id, before: { ip: s.ip, userAgent: s.userAgent, lastSeenAt: s.lastSeenAt } })
    refresh()
    return { ok: true, message: 'profile.sessions.revoked' }
  })
}

export async function revokeOtherSessionsAction(): Promise<ActionResult> {
  return runSetup(async () => {
    const ctx = await getCtx()
    const r = await db.session.updateMany({ where: { userId: ctx.user.id, revokedAt: null, id: { not: ctx.sessionId } }, data: { revokedAt: new Date() } })
    await audit(ctx, { action: 'profile.sessions_revoked_others', entityType: 'User', entityId: ctx.user.id, context: { count: r.count } })
    refresh()
    return { ok: true, message: 'profile.sessions.revokedOthers' }
  })
}

// ───────── Passwort ─────────

export async function changePasswordAction(form: FormData): Promise<ActionResult> {
  return runSetup(async () => {
    const ctx = await getCtx()
    if (!(await rateLimit('pw-change:' + ctx.user.id, 6, 15 * 60_000)).ok) return { ok: false, error: 'profile.errors.rate' }
    const current = String(form.get('current') ?? '')
    const next = String(form.get('next') ?? '')
    const repeat = String(form.get('repeat') ?? '')
    const user = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id } })
    if (user.passwordHash && !(await verifyPassword(user.passwordHash, current))) {
      await audit(ctx, { action: 'profile.password_change_failed', entityType: 'User', entityId: ctx.user.id })
      return { ok: false, error: 'profile.password.wrongCurrent', field: 'current' }
    }
    const problem = passwordProblem(next)
    if (problem) return { ok: false, error: 'profile.password.' + problem, field: 'next' }
    if (next !== repeat) return { ok: false, error: 'profile.password.mismatch', field: 'repeat' }
    if (current && current === next) return { ok: false, error: 'profile.password.same', field: 'next' }
    const hash = await hashPassword(next)
    const revoked = await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: ctx.user.id }, data: { passwordHash: hash } })
      const r = await tx.session.updateMany({ where: { userId: ctx.user.id, revokedAt: null, id: { not: ctx.sessionId } }, data: { revokedAt: new Date() } })
      return r.count
    })
    await audit(ctx, { action: 'profile.password_changed', entityType: 'User', entityId: ctx.user.id, context: { revokedSessions: revoked } })
    refresh()
    return { ok: true, message: 'profile.password.changed' }
  })
}
