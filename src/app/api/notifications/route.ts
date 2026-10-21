import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { SESSION_COOKIE, sessionFromToken } from '@/lib/auth/session'
import { fmtRel } from '@/lib/time'
import { dictionary } from '@/i18n'
import { makeT, type Locale } from '@/i18n/core'

export async function GET(req: NextRequest) {
  const s = await sessionFromToken(req.cookies.get(SESSION_COOKIE)?.value)
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const t = makeT(dictionary(s.user.locale as Locale), s.user.locale as Locale, 'resident')
  const rows = await db.notification.findMany({
    where: { userId: s.userId, OR: [{ readAt: null }, { createdAt: { gte: new Date(Date.now() - 3 * 864e5) } }] },
    orderBy: { createdAt: 'desc' },
    take: 60,
  })
  return NextResponse.json({
    items: rows.map((n) => ({ id: n.id, priority: n.priority, title: n.title, body: n.body, href: n.href, read: !!n.readAt, at: fmtRel(n.createdAt, { today: t('common.today'), yesterday: t('common.yesterday') }) })),
  })
}
