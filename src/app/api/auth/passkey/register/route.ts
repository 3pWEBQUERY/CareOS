import { NextResponse, type NextRequest } from 'next/server'
import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server'
import { db } from '@/lib/db'
import { CHALLENGE_COOKIE, rp } from '@/lib/auth/passkey'
import { getSession, requestMeta } from '@/lib/auth/session'
import { auditSystem } from '@/lib/audit'

export async function GET() {
  const s = await getSession()
  if (!s?.mfaPassed) return NextResponse.json({ error: 'auth' }, { status: 401 })
  const existing = await db.passkey.findMany({ where: { userId: s.userId } })
  const { rpID, rpName } = rp()
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: s.user.email,
    userDisplayName: `${s.user.firstName} ${s.user.lastName}`,
    userID: new TextEncoder().encode(s.userId),
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  })
  const ch = await db.authChallenge.create({ data: { userId: s.userId, challenge: options.challenge, kind: 'register', expiresAt: new Date(Date.now() + 5 * 60_000) } })
  const res = NextResponse.json(options)
  res.cookies.set(CHALLENGE_COOKIE, ch.id, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 300 })
  return res
}

export async function POST(req: NextRequest) {
  const s = await getSession()
  if (!s?.mfaPassed) return NextResponse.json({ error: 'auth' }, { status: 401 })
  const chId = req.cookies.get(CHALLENGE_COOKIE)?.value
  const ch = chId ? await db.authChallenge.findUnique({ where: { id: chId } }) : null
  if (!ch || ch.kind !== 'register' || ch.userId !== s.userId || ch.expiresAt < new Date()) return NextResponse.json({ error: 'challenge' }, { status: 400 })
  await db.authChallenge.delete({ where: { id: ch.id } })
  const { response, name } = await req.json()
  const { rpID, origin } = rp()
  try {
    const v = await verifyRegistrationResponse({ response, expectedChallenge: ch.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true })
    if (!v.verified) throw new Error('not_verified')
    const c = v.registrationInfo.credential
    const pk = await db.passkey.create({
      data: { userId: s.userId, credentialId: c.id, publicKey: Buffer.from(c.publicKey), counter: c.counter, transports: c.transports ?? [], name: String(name || 'Passkey').slice(0, 60) },
    })
    await auditSystem({ action: 'auth.passkey_added', entityType: 'Passkey', entityId: pk.id, orgId: s.user.orgId, userId: s.userId, ...(await requestMeta()) })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'verify' }, { status: 400 })
  }
}
