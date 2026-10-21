import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { audit } from '@/lib/audit'
import { auditWhere } from '../filter'

const MAX = 20000
const cell = (v: unknown) => {
  if (v == null) return ''
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  // CSV-Injection verhindern (Formeln in Tabellenprogrammen)
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s
  return /[",;\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe
}

/** CSV-Export des Audit-Protokolls mit denselben Filtern wie die Ansicht. Der Export selbst wird protokolliert. */
export async function GET(req: NextRequest) {
  const ctx = await getCtx()
  if (!ctx.can('admin.audit')) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const sp = req.nextUrl.searchParams
  const f = { user: sp.get('user') ?? undefined, action: sp.get('action') ?? undefined, entity: sp.get('entity') ?? undefined, from: sp.get('from') ?? undefined, to: sp.get('to') ?? undefined }
  const rows = await db.auditLog.findMany({ where: auditWhere(ctx.org.id, f), orderBy: { at: 'desc' }, take: MAX })
  const users = await db.user.findMany({ where: { orgId: ctx.org.id }, select: { id: true, email: true } })
  const email = new Map(users.map((u) => [u.id, u.email]))
  const head = ['id', 'at', 'user', 'action', 'entityType', 'entityId', 'before', 'after', 'context', 'ip', 'userAgent', 'sessionId']
  const lines = [head.join(';')]
  for (const r of rows) lines.push([String(r.id), r.at.toISOString(), r.userId ? email.get(r.userId) ?? r.userId : '', r.action, r.entityType, r.entityId, r.before, r.after, r.context, r.ip, r.userAgent, r.sessionId].map(cell).join(';'))
  await audit(ctx, { action: 'admin.audit.export', entityType: 'AuditLog', context: { filter: f, rows: rows.length } })
  const name = `careos-audit-${new Date().toISOString().slice(0, 10)}.csv`
  return new NextResponse('﻿' + lines.join('\r\n'), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'private, no-store' },
  })
}
