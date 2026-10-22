// CareOS Service Worker (PRD §18, §25, §39)
// - Statische Build-Assets (/_next/static) cachen, Offline-Ansicht /offline vorab speichern.
// - Navigation ohne Verbindung: /offline (liest den verschlüsselten Lesestand im Browser), zuletzt /offline.html.
// - Gesundheitsdaten (angemeldete HTML-Seiten, API-Antworten) werden bewusst NICHT zwischengespeichert.
// - Web Push: Anzeige der Benachrichtigung (Inhalt ohne Gesundheitsdaten) und Öffnen des Links.
const VERSION = 'v2'
const STATIC = 'careos-static-' + VERSION
const OFFLINE = 'careos-offline-' + VERSION
const OFFLINE_PAGE = '/offline'
const OFFLINE_HTML = '/offline.html'
// «?dev=1»: Entwicklungsmodus ohne Caching (nur Push).
const LITE = new URL(self.location.href).searchParams.has('dev')

/** /offline ohne Cookies laden (keine Personendaten im Cache) und die referenzierten Assets mitspeichern. */
async function precacheOffline() {
  const res = await fetch(OFFLINE_PAGE, { credentials: 'omit', cache: 'no-store' })
  if (!res.ok || !(res.headers.get('content-type') || '').includes('text/html')) throw new Error('offline page ' + res.status)
  const html = await res.clone().text()
  const assets = [...new Set([...html.matchAll(/\/_next\/static\/[^"'\s)\\]+/g)].map((m) => m[0].replace(/&amp;/g, '&')))]
  const cache = await caches.open(OFFLINE)
  await Promise.all(assets.map((u) => cache.match(u).then((hit) => hit || cache.add(u).catch(() => {}))))
  await cache.put(OFFLINE_PAGE, res)
}

let lastPrecache = 0
self.addEventListener('install', (e) => {
  if (LITE) return self.skipWaiting()
  e.waitUntil(
    caches.open(STATIC)
      .then((c) => c.addAll([OFFLINE_HTML, '/icon.svg', '/manifest.webmanifest']))
      .then(() => precacheOffline().then(() => (lastPrecache = Date.now())).catch(() => {})),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('careos-') && k !== STATIC && k !== OFFLINE).map((k) => caches.delete(k)))))
  self.clients.claim()
})

self.addEventListener('message', (e) => {
  if (LITE || !e.data || e.data.type !== 'precache-offline') return
  if (Date.now() - lastPrecache < 30 * 60_000) return
  lastPrecache = Date.now()
  e.waitUntil(precacheOffline().catch(() => (lastPrecache = 0)))
})

self.addEventListener('fetch', (e) => {
  if (LITE) return
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return
  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(STATIC).then((c) => c.put(req, copy)) }
        return res
      })),
    )
    return
  }
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(async () => (await caches.match(OFFLINE_PAGE, { ignoreSearch: true })) || (await caches.match(OFFLINE_HTML)) || Response.error()),
    )
  }
})

/* ───────── Web Push ───────── */

self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { title: e.data ? e.data.text() : '' } }
  const critical = d.priority === 'critical'
  e.waitUntil(
    self.registration.showNotification(d.title || 'CareOS', {
      body: d.body || '',
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: d.tag || undefined,
      renotify: !!d.tag && critical,
      requireInteraction: critical,
      data: { href: typeof d.href === 'string' && d.href.startsWith('/') && !d.href.startsWith('//') ? d.href : '/' },
    }),
  )
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const target = new URL((e.notification.data && e.notification.data.href) || '/', self.location.origin).href
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of wins) {
      if (new URL(w.url).origin !== self.location.origin) continue
      await w.focus()
      if ('navigate' in w) { try { await w.navigate(target); return } catch {} }
      w.postMessage({ type: 'navigate', href: target })
      return
    }
    await self.clients.openWindow(target)
  })())
})
