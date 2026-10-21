import { NextResponse, type NextRequest } from 'next/server'
import { createHash, randomBytes } from 'node:crypto'
import { discovery, redirectUri } from '@/lib/auth/oidc'
import { env, ssoConfigured } from '@/lib/env'

export async function GET(req: NextRequest) {
  if (!ssoConfigured()) return NextResponse.redirect(new URL('/login', env.appUrl))
  const d = await discovery()
  const verifier = randomBytes(32).toString('base64url')
  const state = randomBytes(16).toString('base64url')
  const nonce = randomBytes(16).toString('base64url')
  const next = req.nextUrl.searchParams.get('next') ?? '/'
  const url = new URL(d.authorization_endpoint)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: env.oidc.clientId,
    redirect_uri: redirectUri(),
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString()
  const res = NextResponse.redirect(url)
  res.cookies.set('careos_oidc', JSON.stringify({ verifier, state, nonce, next }), { httpOnly: true, sameSite: 'lax', secure: env.isProd, path: '/', maxAge: 600 })
  return res
}
