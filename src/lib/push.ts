import 'server-only'
import webpush from 'web-push'
import type { NotificationPriority } from '@prisma/client'
import { db } from '@/lib/db'
import { env, pushConfigured } from '@/lib/env'
import { dictionary } from '@/i18n'
import { makeT, type Locale, type Terminology } from '@/i18n/core'
import { pushText, PUSH_PRIORITIES } from '@/lib/push-shared'

export { PUSH_PRIORITIES }

/**
 * Web Push (PRD §18, §25). Datenschutz: Push-Nachrichten laufen über Dienste Dritter (Google, Apple, Mozilla).
 * Sie enthalten deshalb nie Gesundheitsdaten – klinische Benachrichtigungen nur als allgemeiner Hinweis
 * mit Bereich und Link; der Inhalt ist erst nach der Anmeldung sichtbar.
 */
export type PushMessage = { title: string; body?: string; href?: string; tag?: string; priority: NotificationPriority }

let configured = false
function setup() {
  if (!pushConfigured()) return false
  if (!configured) {
    webpush.setVapidDetails(env.push.subject, env.push.publicKey, env.push.privateKey)
    configured = true
  }
  return true
}

const URGENCY: Record<NotificationPriority, 'high' | 'normal' | 'low'> = { critical: 'high', action: 'normal', info: 'low', social: 'low' }

/** Sendet an alle registrierten Geräte der Personen. Abgelaufene Abonnements (404/410) werden gelöscht. */
export async function sendPush(userIds: string[], msg: PushMessage) {
  if (!setup()) return { sent: 0, failed: 0 }
  const subs = await db.pushSubscription.findMany({ where: { userId: { in: [...new Set(userIds)] } } })
  return deliver(subs, () => msg)
}

async function deliver(subs: { id: string; userId: string; endpoint: string; p256dh: string; auth: string }[], build: (userId: string) => PushMessage | null) {
  let sent = 0
  let failed = 0
  const gone: string[] = []
  await Promise.all(
    subs.map(async (s) => {
      const msg = build(s.userId)
      if (!msg) return
      const payload = JSON.stringify({ title: msg.title, body: msg.body ?? '', href: safeHref(msg.href), tag: msg.tag, priority: msg.priority })
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          TTL: msg.priority === 'critical' ? 3600 : 4 * 3600,
          urgency: URGENCY[msg.priority],
          topic: msg.tag ? topic(msg.tag) : undefined,
        })
        sent++
      } catch (e) {
        failed++
        const code = (e as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) gone.push(s.id)
        else console.error('[push]', code ?? (e as Error).message)
      }
    }),
  )
  if (gone.length) await db.pushSubscription.deleteMany({ where: { id: { in: gone } } })
  return { sent, failed }
}

/** Nur relative Pfade innerhalb von CareOS. */
const safeHref = (h?: string) => (h && /^\/(?!\/)/.test(h) ? h.slice(0, 300) : '/')
/** Web-Push-Topic: max. 32 Zeichen aus dem URL-sicheren Base64-Alphabet. */
const topic = (tag: string) => tag.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32)

/**
 * Aus notify(): Push an Personen, deren Einstellung die Priorität zulässt.
 * Texte in der Sprache der empfangenden Person, ohne Gesundheitsdaten.
 */
export async function pushForNotification(n: { orgId: string; userIds: string[]; priority: NotificationPriority; kind: string; title: string; href?: string; groupKey?: string }) {
  if (!setup() || !n.userIds.length) return
  const users = await db.user.findMany({
    where: { id: { in: n.userIds }, orgId: n.orgId, active: true, pushPriorities: { has: n.priority }, pushSubscriptions: { some: {} } },
    select: { id: true, locale: true, pushSubscriptions: true },
  })
  if (!users.length) return
  const [org, unit] = await Promise.all([
    db.organization.findUnique({ where: { id: n.orgId }, select: { terminology: true } }),
    unitNameFor(n.orgId, n.href),
  ])
  const byUser = new Map<string, PushMessage>()
  for (const u of users) {
    const locale = u.locale as Locale
    const t = makeT(dictionary(locale), locale, (org?.terminology ?? 'resident') as Terminology)
    const text = pushText(t, { priority: n.priority, kind: n.kind, title: n.title, href: n.href, unit })
    byUser.set(u.id, { ...text, href: n.href, tag: n.groupKey ?? n.kind, priority: n.priority })
  }
  await deliver(users.flatMap((u) => u.pushSubscriptions), (id) => byUser.get(id) ?? null)
}

/** Bereichsname für den allgemeinen Hinweis («Kritische Meldung in Wohngruppe 2»), abgeleitet aus dem Link. */
async function unitNameFor(orgId: string, href?: string) {
  if (!href) return null
  const res = /^\/residents\/([\w-]+)/.exec(href)
  if (res) return (await db.resident.findFirst({ where: { id: res[1], orgId }, select: { unit: { select: { name: true } } } }))?.unit.name ?? null
  const inc = /^\/quality\/([\w-]+)/.exec(href)
  if (inc) return (await db.incident.findFirst({ where: { id: inc[1], orgId }, select: { unit: { select: { name: true } } } }).catch(() => null))?.unit?.name ?? null
  return null
}

/** Testnachricht an die eigenen Geräte (Profil → Test senden). */
export async function sendTestPush(userId: string, t: (k: string) => string) {
  return sendPush([userId], { title: t('common.push.testTitle'), body: t('common.push.testBody'), href: '/profile', tag: 'test', priority: 'info' })
}
