'use client'

import { useEffect, useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { swScriptUrl } from '@/components/shell/ServiceWorker'
import { PUSH_PRIORITIES } from '@/lib/push-shared'
import { savePushPrioritiesAction } from './push-actions'

type Support = 'checking' | 'ok' | 'unsupported' | 'ios'

/** Push-Dienst nicht erreichbar (z. B. Firmennetz): nicht endlos warten. */
const within = <T,>(p: Promise<T>, ms = 20_000) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

const b64ToBytes = (s: string) => {
  const b = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(b.length))
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i)
  return out
}

/** Profil → Push-Benachrichtigungen (PRD §18, §25): pro Gerät aktivieren, Prioritäten wählen, Test senden. */
export function PushSettings({ configured, priorities, devices: initialDevices }: { configured: boolean; priorities: string[]; devices: number }) {
  const t = useT()
  const [support, setSupport] = useState<Support>('checking')
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [subscribed, setSubscribed] = useState(false)
  const [devices, setDevices] = useState(initialDevices)
  const [prios, setPrios] = useState<string[]>(priorities)
  const [busy, setBusy] = useState(false)
  const [, start] = useTransition()

  useEffect(() => {
    const ua = navigator.userAgent
    const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
    const ok = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    if (!ok) { setSupport(ios && !standalone ? 'ios' : 'unsupported'); return }
    setSupport('ok')
    setPermission(Notification.permission)
    void navigator.serviceWorker.getRegistration().then((reg) => reg?.pushManager.getSubscription()).then((sub) => setSubscribed(!!sub)).catch(() => {})
  }, [])

  const enable = async () => {
    setBusy(true)
    try {
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm !== 'granted') return
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register(swScriptUrl()))
      await within(navigator.serviceWorker.ready)
      const k = await fetch('/api/push/key').then((r) => (r.ok ? r.json() : null)) as { key?: string } | null
      if (!k?.key) throw new Error('key')
      const sub = (await reg.pushManager.getSubscription()) ?? (await within(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(k.key) })))
      const res = await fetch('/api/push/subscription', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub.toJSON()) })
      if (!res.ok) throw new Error('subscribe')
      setDevices(((await res.json()) as { devices: number }).devices)
      setSubscribed(true)
      toast(t('profile.push.enabled'))
    } catch {
      toast(t('profile.push.failed'), { kind: 'crit' })
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    setBusy(true)
    try {
      const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription()
      if (sub) {
        const res = await fetch('/api/push/subscription', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) })
        if (res.ok) setDevices(((await res.json()) as { devices: number }).devices)
        await sub.unsubscribe()
      }
      setSubscribed(false)
      toast(t('profile.push.disabled'))
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/push/test', { method: 'POST' })
      const r = (await res.json().catch(() => ({}))) as { sent?: number }
      if (!res.ok) throw new Error('test')
      toast(t('profile.push.testSent', { n: r.sent ?? 0 }), r.sent ? {} : { kind: 'crit' })
    } catch {
      toast(t('common.genericError'), { kind: 'crit' })
    } finally {
      setBusy(false)
    }
  }

  const toggle = (p: string, on: boolean) => {
    const next = on ? [...prios, p] : prios.filter((x) => x !== p)
    setPrios(next)
    start(async () => {
      const r = await savePushPrioritiesAction(next)
      if (r.ok) toast(t('profile.push.prioritiesSaved'))
      else { setPrios(prios); toast(t(r.error), { kind: 'crit' }) }
    })
  }

  if (!configured) return <p className="small muted" style={{ margin: 0 }}>{t('profile.push.notConfigured')}</p>

  return (
    <div className="stack-sm">
      <p className="fg2" style={{ margin: 0 }}>{t('profile.push.hint')}</p>
      {support === 'ios' && <div className="alert info" role="note"><div className="grow">{t('profile.push.ios')}</div></div>}
      {support === 'unsupported' && <p className="small muted" style={{ margin: 0 }}>{t('profile.push.unsupported')}</p>}
      {support === 'ok' && permission === 'denied' && <div className="alert warn" role="note"><div className="grow">{t('profile.push.denied')}</div></div>}
      {support === 'ok' && (
        <div className="row">
          <span className={'tag ' + (subscribed ? 'ok' : 'outline')}>{t(subscribed ? 'profile.push.on' : 'profile.push.off')}</span>
          <span className="small muted">{t('profile.push.devices', { n: devices })}</span>
        </div>
      )}
      {support === 'ok' && permission !== 'denied' && (
        <div className="row">
          {subscribed
            ? <button type="button" className="btn" onClick={disable} disabled={busy} data-loading={busy || undefined}>{t('profile.push.disable')}</button>
            : <button type="button" className="btn primary" onClick={enable} disabled={busy} data-loading={busy || undefined}>{t('profile.push.enable')}</button>}
          {devices > 0 && <button type="button" className="btn" onClick={test} disabled={busy}>{t('profile.push.test')}</button>}
        </div>
      )}
      <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: '4px 0 0' }}>
        <legend className="lbl" style={{ padding: 0, marginBottom: 4 }}>{t('profile.push.priorities')}</legend>
        <div className="row" style={{ gap: '4px 16px' }}>
          {PUSH_PRIORITIES.map((p) => (
            <label key={p} className="check" style={{ minHeight: 40 }}>
              <input type="checkbox" checked={prios.includes(p)} onChange={(e) => toggle(p, e.target.checked)} />
              {t('profile.push.prio.' + p)}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  )
}
