import 'server-only'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { env } from '@/lib/env'

/**
 * Single Sign-on über OpenID Connect (Authorization Code + PKCE), z. B. Microsoft Entra ID, Google, Keycloak.
 * Benutzer werden über die E-Mail-Adresse zugeordnet; es werden keine Konten automatisch angelegt.
 */
type Discovery = { authorization_endpoint: string; token_endpoint: string; jwks_uri: string; issuer: string }
let disco: Promise<Discovery> | null = null

export function discovery() {
  disco ??= fetch(env.oidc.issuer.replace(/\/$/, '') + '/.well-known/openid-configuration').then((r) => {
    if (!r.ok) throw new Error('oidc_discovery_failed')
    return r.json() as Promise<Discovery>
  })
  return disco
}

export const redirectUri = () => new URL('/api/auth/sso/callback', env.appUrl).toString()

export async function exchangeCode(code: string, verifier: string, nonce: string) {
  const d = await discovery()
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    client_id: env.oidc.clientId,
    code_verifier: verifier,
  })
  if (env.oidc.clientSecret) body.set('client_secret', env.oidc.clientSecret)
  const res = await fetch(d.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
  if (!res.ok) throw new Error('oidc_token_failed')
  const tok = (await res.json()) as { id_token?: string }
  if (!tok.id_token) throw new Error('oidc_no_id_token')
  const { payload } = await jwtVerify(tok.id_token, createRemoteJWKSet(new URL(d.jwks_uri)), { issuer: d.issuer, audience: env.oidc.clientId })
  if (payload.nonce !== nonce) throw new Error('oidc_nonce')
  const email = String(payload.email ?? payload.preferred_username ?? payload.upn ?? '').toLowerCase()
  return { sub: String(payload.sub), email }
}
