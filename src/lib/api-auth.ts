import 'server-only'
import { NextResponse } from 'next/server'
import type { ApiToken } from '@prisma/client'
import { db } from '@/lib/db'
import { hashToken } from '@/lib/auth/session'
import { rateLimit } from '@/lib/rate-limit'
import { auditSystem, type AuditEntry } from '@/lib/audit'
import type { ApiScope } from '@/lib/admin-shared'
import { moduleOfApiPath, normalizeModules, stripDisabled } from '@/lib/modules'
import { scopesBeyond } from '@/lib/api-tokens'

export type { ApiScope } from '@/lib/admin-shared'

/** Kontext eines authentifizierten API-Aufrufs. Schreibende Aufrufe werden der Person zugeordnet, die das Token erstellt hat. */
export type ApiCtx = { token: ApiToken; orgId: string; actorId: string; ip: string | null; userAgent: string | null }

const TOKEN_LIMIT = 600 // Anfragen je Minute und Token
const FAIL_LIMIT = 30 // fehlgeschlagene Anmeldungen je Minute und IP

function meta(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || null
  return { ip, userAgent: req.headers.get('user-agent')?.slice(0, 400) ?? null }
}

export function apiError(status: number, code: string, message: string, fhir = false, headers?: Record<string, string>) {
  if (fhir)
    return NextResponse.json(
      { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: status === 401 ? 'login' : status === 403 ? 'forbidden' : status === 404 ? 'not-found' : status === 429 ? 'throttled' : 'invalid', diagnostics: message }] },
      { status, headers: { 'content-type': 'application/fhir+json; charset=utf-8', ...headers } },
    )
  return NextResponse.json({ error: { code, message } }, { status, headers })
}

/**
 * Authentifiziert `Authorization: Bearer <token>` gegen ApiToken (SHA-256-Hash, nicht widerrufen) und prüft den Scope.
 * Liefert entweder den Kontext oder eine fertige Fehlerantwort.
 */
export async function apiAuth(req: Request, scope: ApiScope, opts: { fhir?: boolean } = {}): Promise<ApiCtx | NextResponse> {
  const m = meta(req)
  const h = req.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(\S+)$/i.exec(h)
  if (!match) return apiError(401, 'unauthorized', 'Missing bearer token', opts.fhir, { 'www-authenticate': 'Bearer' })
  // Suche über den Hash: das Klartext-Token wird nie verglichen oder gespeichert (keine Timing-Seitenkanäle).
  const token = await db.apiToken.findUnique({ where: { tokenHash: hashToken(match[1]) } })
  if (!token || token.revokedAt || (token.expiresAt && token.expiresAt <= new Date())) {
    const rl = await rateLimit('api-fail:' + (m.ip ?? 'unknown'), FAIL_LIMIT, 60_000)
    if (!rl.ok) return apiError(429, 'rate_limited', 'Too many failed attempts', opts.fhir, { 'retry-after': String(rl.retryAfter) })
    if (token) await auditSystem({ action: 'api.auth_failed', entityType: 'ApiToken', entityId: token.id, orgId: token.orgId, context: { reason: token.revokedAt ? 'revoked' : 'expired' }, ...m })
    return apiError(401, 'unauthorized', 'Invalid, expired or revoked token', opts.fhir, { 'www-authenticate': 'Bearer error="invalid_token"' })
  }
  const rl = await rateLimit('api:' + token.id, TOKEN_LIMIT, 60_000)
  if (!rl.ok) return apiError(429, 'rate_limited', 'Rate limit exceeded', opts.fhir, { 'retry-after': String(rl.retryAfter) })
  if (!token.scopes.includes(scope)) return apiError(403, 'insufficient_scope', `Token lacks scope ${scope}`, opts.fhir, { 'www-authenticate': `Bearer error="insufficient_scope", scope="${scope}"` })
  const creator = await db.user.findUnique({ where: { id: token.createdById }, select: { active: true, orgId: true, org: { select: { suspendedAt: true, modules: true } } } })
  if (!creator?.active || creator.orgId !== token.orgId) return apiError(401, 'unauthorized', 'Token owner is inactive', opts.fhir)
  // Plattform (PRD §42): gesperrte Organisation
  if (creator.org.suspendedAt) return apiError(403, 'org_suspended', 'Organization is suspended', opts.fhir)
  // Module (PRD §69): Endpunkte abgeschalteter Module
  const modules = normalizeModules(creator.org.modules)
  const mod = moduleOfApiPath(new URL(req.url).pathname)
  if (mod && !modules.includes(mod)) return apiError(403, 'module_inactive', `Module ${mod} is not active`, opts.fhir)
  // Persönliche Tokens: Scopes nur innerhalb der aktuellen, organisationsweiten Berechtigungen (keine Rechteausweitung)
  if (token.personal) {
    const assignments = await db.roleAssignment.findMany({ where: { userId: token.createdById }, include: { role: { select: { permissions: true } } } })
    const grants = assignments.map((a) => ({ permissions: stripDisabled(a.role.permissions, modules), unitId: a.unitId, locationId: a.locationId }))
    if (scopesBeyond([scope], grants).length) return apiError(403, 'insufficient_permission', `Token owner lacks the permissions for ${scope}`, opts.fhir, { 'www-authenticate': `Bearer error="insufficient_scope", scope="${scope}"` })
  }
  if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > 60_000) {
    await db.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
  }
  return { token, orgId: token.orgId, actorId: token.createdById, ...m }
}

export const isErr = (x: ApiCtx | NextResponse): x is NextResponse => x instanceof NextResponse

/** Audit für schreibende API-Aufrufe. */
export function apiAudit(api: ApiCtx, e: AuditEntry) {
  return auditSystem({ ...e, orgId: api.orgId, userId: api.actorId, ip: api.ip, userAgent: api.userAgent, context: { ...e.context, via: 'api', tokenId: api.token.id, tokenName: api.token.name } })
}

/** JSON-Body sicher lesen. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    return null
  }
}

export const clampInt = (v: string | null, def: number, min: number, max: number) => {
  if (v == null || v.trim() === '') return def
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def
}
