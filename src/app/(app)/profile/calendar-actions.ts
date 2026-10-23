'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { run, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { randomToken } from '@/lib/crypto'
import { hashToken } from '@/lib/auth/session'
import { env } from '@/lib/env'

/**
 * Kalender abonnieren (PRD §19): geheime Adresse /api/ical/<token> erzeugen. Höchstens ein aktives Token je Person –
 * eine neue Adresse widerruft die bisherige. Die Adresse wird nur jetzt angezeigt; gespeichert wird nur ein Hash.
 */
export async function createCalendarTokenAction(): Promise<ActionResult<{ secret: string }>> {
  return run(async () => {
    const ctx = await getCtx()
    if (!ctx.hasModule('schedule')) return { ok: false, error: 'common.moduleOff' }
    const token = 'cal_' + randomToken(32)
    const now = new Date()
    await db.$transaction(async (tx) => {
      const prev = await tx.calendarToken.updateMany({ where: { userId: ctx.user.id, revokedAt: null }, data: { revokedAt: now } })
      const created = await tx.calendarToken.create({ data: { orgId: ctx.org.id, userId: ctx.user.id, tokenHash: hashToken(token) } })
      await audit(ctx, { action: 'profile.calendar.create', entityType: 'CalendarToken', entityId: created.id, after: { prefix: token.slice(0, 8) }, context: { replaced: prev.count } }, tx)
    })
    refresh()
    return { ok: true, data: { secret: `${env.appUrl.replace(/\/$/, '')}/api/ical/${token}.ics` }, message: 'profile.calendar.created' }
  })
}

export async function revokeCalendarTokenAction(): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const active = await db.calendarToken.findMany({ where: { userId: ctx.user.id, revokedAt: null }, select: { id: true } })
    if (!active.length) return { ok: false, error: 'common.notFound' }
    const at = new Date()
    await db.calendarToken.updateMany({ where: { id: { in: active.map((a) => a.id) } }, data: { revokedAt: at } })
    for (const a of active) await audit(ctx, { action: 'profile.calendar.revoke', entityType: 'CalendarToken', entityId: a.id, after: { revokedAt: at } })
    refresh()
    return { ok: true, message: 'profile.calendar.revoked' }
  })
}
