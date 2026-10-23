import { NextResponse, type NextRequest } from 'next/server'
import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server'
import { db } from '@/lib/db'
import { CHALLENGE_COOKIE, rp } from '@/lib/auth/passkey'
import { createSession, orgLoginBlock, requestMeta } from '@/lib/auth/session'
import { auditSystem } from '@/lib/audit'
import { rateLimit } from '@/lib/rate-limit'

/** Passkey-Anmeldung ohne Benutzernamen (discoverable credentials). */
export async function GET() {
  const { rpID } = rp()
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' })
  const ch = await db.authChallenge.create({ data: { challenge: options.challenge, kind: 'login', expiresAt: new Date(Date.now() + 5 * 60_000) } })
  const res = NextResponse.json(options)
  res.cookies.set(CHALLENGE_COOKIE, ch.id, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 300 })
  return res
}

export async function POST(req: NextRequest) {
  const meta = await requestMeta()
  if (!(await rateLimit('passkey:' + meta.ip, 20, 10 * 60_000)).ok) return NextResponse.json({ error: 'rate' }, { status: 429 })
  const chId = req.cookies.get(CHALLENGE_COOKIE)?.value
  const ch = chId ? await db.authChallenge.findUnique({ where: { id: chId } }) : null
  if (!ch || ch.kind !== 'login' || ch.expiresAt < new Date()) return NextResponse.json({ error: 'challenge' }, { status: 400 })
  await db.authChallenge.delete({ where: { id: ch.id } })

  const body = await req.json()
  const pk = await db.passkey.findUnique({ where: { credentialId: String(body.id) }, include: { user: true } })
  if (!pk || !pk.user.active) return NextResponse.json({ error: 'unknown' }, { status: 401 })
  const { rpID, origin } = rp()
  try {
    const v = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: ch.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: { id: pk.credentialId, publicKey: new Uint8Array(pk.publicKey), counter: pk.counter, transports: pk.transports as never },
      requireUserVerification: true,
    })
    if (!v.verified) throw new Error('not_verified')
    await db.passkey.update({ where: { id: pk.id }, data: { counter: v.authenticationInfo.newCounter, lastUsedAt: new Date() } })
  } catch {
    await auditSystem({ action: 'auth.login_failed', entityType: 'User', entityId: pk.userId, orgId: pk.user.orgId, context: { method: 'passkey' }, ...meta })
    return NextResponse.json({ error: 'verify' }, { status: 401 })
  }
  // Organisation gesperrt / Registrierung nicht freigegeben (PRD §42)
  const block = await orgLoginBlock(pk.user.orgId)
  if (block) return NextResponse.json({ error: block === 'pending' ? 'orgPending' : 'suspended' }, { status: 403 })
  // Passkey mit Benutzerverifikation gilt als starker zweiter Faktor.
  await createSession(pk.userId, true, 'passkey')
  await auditSystem({ action: 'auth.login', entityType: 'User', entityId: pk.userId, orgId: pk.user.orgId, userId: pk.userId, context: { method: 'passkey' }, ...meta })
  const res = NextResponse.json({ ok: true })
  res.cookies.delete(CHALLENGE_COOKIE)
  return res
}
