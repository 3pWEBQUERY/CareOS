import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { exchangeCode } from '@/lib/auth/oidc'
import { createSession, orgLoginBlock, requestMeta } from '@/lib/auth/session'
import { auditSystem } from '@/lib/audit'
import { env } from '@/lib/env'

export async function GET(req: NextRequest) {
  const fail = NextResponse.redirect(new URL('/login?error=sso', env.appUrl))
  try {
    const raw = req.cookies.get('careos_oidc')?.value
    if (!raw) return fail
    const st = JSON.parse(raw) as { verifier: string; state: string; nonce: string; next: string }
    const code = req.nextUrl.searchParams.get('code')
    if (!code || req.nextUrl.searchParams.get('state') !== st.state) return fail
    const { sub, email } = await exchangeCode(code, st.verifier, st.nonce)
    const user = (await db.user.findUnique({ where: { ssoSubject: sub } })) ?? (email ? await db.user.findUnique({ where: { email } }) : null)
    if (!user || !user.active) return fail
    if (!user.ssoSubject) await db.user.update({ where: { id: user.id }, data: { ssoSubject: sub } })
    const block = await orgLoginBlock(user.orgId)
    if (block) return NextResponse.redirect(new URL('/login?error=' + (block === 'pending' ? 'orgPending' : 'suspended'), env.appUrl))
    // Der Identity Provider ist für MFA zuständig.
    await createSession(user.id, true, 'sso')
    await auditSystem({ action: 'auth.login', entityType: 'User', entityId: user.id, orgId: user.orgId, userId: user.id, context: { method: 'oidc' }, ...(await requestMeta()) })
    const next = st.next?.startsWith('/') && !st.next.startsWith('//') ? st.next : '/'
    const res = NextResponse.redirect(new URL(next, env.appUrl))
    res.cookies.delete('careos_oidc')
    return res
  } catch {
    return fail
  }
}
