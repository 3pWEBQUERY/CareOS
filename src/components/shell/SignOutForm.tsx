'use client'

import { logoutAction } from '@/app/login/actions'
import { clearOfflineData } from '@/lib/offline/client'

/** Lokale Gerätedaten löschen: Offline-Outbox, Lesestand, Schlüssel und Push-Abonnement dieses Geräts. */
async function clearDeviceData() {
  await clearOfflineData().catch(() => {})
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
    const sub = await reg?.pushManager?.getSubscription()
    if (sub) {
      await fetch('/api/push/subscription', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {})
      await sub.unsubscribe().catch(() => {})
    }
  } catch {}
}

/** Abmelden (PRD §39): vor dem Abmelden werden Offline-Daten auf dem Gerät gelöscht. */
export function SignOutForm({ label, className = 'btn' }: { label: string; className?: string }) {
  return (
    <form action={async () => { await clearDeviceData(); await logoutAction() }}>
      <button className={className} type="submit">{label}</button>
    </form>
  )
}
