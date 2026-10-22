'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLocale, useT } from '@/i18n/client'
import { INTL_LOCALE } from '@/i18n/core'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { VITALS, type VitalKey } from '@/lib/vitals'
import { portionLabel } from '@/lib/care'
import { isOffline, offlineSupported, setOfflineUser, syncOutbox, useOutbox } from '@/lib/offline/client'
import { getOfflineUser, listEntries, loadSnapshot, removeOps, type OutboxEntry } from '@/lib/offline/store'
import type { IntakeData, NoteData, TaskData, VitalsData } from '@/lib/offline/types'

const TAB = { note: 'notes', vitals: 'vitals', task: 'day', intake: 'nutrition' } as const

/**
 * Offline-Status in der Shell (PRD §39): Hinweisleiste mit Anzahl wartender Einträge, automatische
 * Synchronisation bei wiederhergestellter Verbindung und Panel «Synchronisation» für Konflikte.
 */
export function OfflineSync({ userId, offline }: { userId: string; offline: boolean }) {
  const t = useT()
  const router = useRouter()
  const counts = useOutbox(userId)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const inflight = useRef(false)

  const sync = useCallback(async (manual = false) => {
    if (!offlineSupported() || isOffline() || inflight.current) return
    inflight.current = true
    setBusy(true)
    try {
      const s = await syncOutbox()
      if (s.applied) { toast(t('common.offlineSync.synced', { n: s.applied })); router.refresh() }
      if (s.conflicts) toast(t('common.offlineSync.conflictToast', { n: s.conflicts }), { kind: 'crit', ms: 8000 })
      if (s.failed && manual) toast(t('common.offlineSync.failed'), { kind: 'crit' })
    } finally {
      inflight.current = false
      setBusy(false)
    }
  }, [router, t])

  useEffect(() => { void setOfflineUser(userId) }, [userId])

  // Bei wiederhergestellter Verbindung und beim Start synchronisieren; danach alle 30 s, solange etwas wartet.
  useEffect(() => {
    const on = () => void sync()
    window.addEventListener('online', on)
    return () => window.removeEventListener('online', on)
  }, [sync])
  useEffect(() => {
    if (!counts.queued || offline) return
    void sync()
    const id = setInterval(() => void sync(), 30_000)
    return () => clearInterval(id)
  }, [counts.queued, offline, sync])

  const pending = counts.queued + counts.conflicts
  if (!offline && !pending) return <SyncPanel open={open} onClose={() => setOpen(false)} onSync={() => sync(true)} busy={busy} offline={offline} />
  return (
    <>
      <div className="offline-bar" role="status" data-conflict={!offline && counts.conflicts > 0 ? '' : undefined}>
        {offline && <span>{t('common.offline')}</span>}
        {counts.queued > 0 && <span>{t('common.offlineQueued', { n: counts.queued })}</span>}
        {counts.conflicts > 0 && <span>{t('common.offlineSync.conflicts', { n: counts.conflicts })}</span>}
        {pending > 0 && <button type="button" className="linkbtn" onClick={() => setOpen(true)}>{t('common.offlineSync.show')}</button>}
      </div>
      <SyncPanel open={open} onClose={() => setOpen(false)} onSync={() => sync(true)} busy={busy} offline={offline} />
    </>
  )
}

/** Panel «Synchronisation»: wartende Einträge und Konflikte mit Verwerfen / Neu erfassen. */
function SyncPanel({ open, onClose, onSync, busy, offline }: { open: boolean; onClose: () => void; onSync: () => void; busy: boolean; offline: boolean }) {
  const t = useT()
  const locale = useLocale()
  const [items, setItems] = useState<OutboxEntry[]>([])
  const [me, setMe] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    const load = async () => {
      const [list, uid, snap] = await Promise.all([listEntries(), getOfflineUser(), loadSnapshot().catch(() => null)])
      // Name aus dem Lesestand, falls beim Erfassen keiner mitgegeben wurde
      const names = new Map((snap?.residents ?? []).map((r) => [r.id, r.name]))
      if (alive) { setItems(list.map((e) => (e.meta.who ? e : { ...e, meta: { ...e.meta, who: names.get(e.residentId) } }))); setMe(uid) }
    }
    void load()
    window.addEventListener('careos:outbox', load)
    return () => { alive = false; window.removeEventListener('careos:outbox', load) }
  }, [open])

  const [ask, confirmDialog] = useConfirm()
  const discard = async (e: OutboxEntry) => {
    const ok = await ask({
      title: t('common.offlineSync.discardConfirm'),
      text: t('common.offlineSync.discardText'),
      context: <span><strong>{t('common.offlineSync.kind.' + e.kind)}</strong>{e.meta.who && <> · {e.meta.who}</>} · {t('common.offlineSync.captured', { at: fmtWhen(e.at, locale) })}</span>,
      confirmLabel: t('common.offlineSync.discard'),
      danger: true,
    })
    if (ok) await removeOps([e.id])
  }

  return (
    <Dialog
      open={open} onClose={onClose} title={t('common.offlineSync.title')} wide
      footer={<>
        <button type="button" className="btn" onClick={onClose}>{t('common.close')}</button>
        <button type="button" className="btn primary" onClick={onSync} disabled={offline || busy} data-loading={busy || undefined}>{busy ? t('common.offlineSync.syncing') : t('common.offlineSync.syncNow')}</button>
      </>}
    >
      <p className="small muted" style={{ margin: 0 }}>{t('common.offlineSync.hint')}</p>
      {items.length ? (
        <ul className="list" style={{ border: '1px solid var(--line)', borderRadius: 'var(--r)' }}>
          {items.map((e) => <EntryRow key={e.id} e={e} foreign={!!me && e.userId !== me} onDiscard={() => discard(e)} onNavigate={onClose} />)}
        </ul>
      ) : (
        <p className="empty" style={{ margin: 0 }}>{t('common.offlineSync.empty')}</p>
      )}
      {confirmDialog}
    </Dialog>
  )
}

function EntryRow({ e, foreign, onDiscard, onNavigate }: { e: OutboxEntry; foreign: boolean; onDiscard: () => void; onNavigate: () => void }) {
  const t = useT()
  const locale = useLocale()
  const when = fmtWhen(e.at, locale)
  const conflict = e.status === 'conflict'
  const reason = e.result?.reason
  const detail = e.result?.detail
  return (
    <li>
      <div className="li" style={{ flexWrap: 'wrap' }}>
        <div className="grow" style={{ minWidth: 200 }}>
          <div className="row" style={{ gap: 8 }}>
            <span>{t('common.offlineSync.kind.' + e.kind)}</span>
            {e.meta.who && <span className="muted">· {e.meta.who}</span>}
            {conflict ? <span className="tag crit">{t('common.offlineSync.statusConflict')}</span> : <span className="tag warn">{t('common.offlineSync.statusQueued')}</span>}
          </div>
          <div className="small muted">{t('common.offlineSync.captured', { at: when })}</div>
          <div className="small fg2" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 2 }}>{summary(t, e)}</div>
          {conflict && reason && (
            <div className="small" style={{ color: 'var(--crit)', marginTop: 2 }} role="note">
              {t('common.offlineSync.reason.' + reason, { by: detail?.by ?? '–', at: detail?.at ? fmtWhen(detail.at, locale) : '–' })}
            </div>
          )}
          {foreign && <div className="small muted" style={{ marginTop: 2 }}>{t('common.offlineSync.otherUser')}</div>}
        </div>
        <div className="row" style={{ gap: 6 }}>
          {conflict && !foreign && reason !== 'discharged' && reason !== 'forbidden' && (
            <Link className="btn sm" href={`/residents/${e.residentId}/${TAB[e.kind]}`} onClick={onNavigate}>{t('common.offlineSync.reenter')}</Link>
          )}
          <button type="button" className="btn sm danger" onClick={onDiscard}>{t('common.offlineSync.discard')}</button>
        </div>
      </div>
    </li>
  )
}

function fmtWhen(iso: string, locale: keyof typeof INTL_LOCALE) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '–'
  const today = new Date().toDateString() === d.toDateString()
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], today ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d)
}

/** Kurzinhalt des Eintrags, damit er bei einem Konflikt neu erfasst werden kann. */
function summary(t: (k: string, v?: Record<string, string | number>) => string, e: OutboxEntry) {
  switch (e.kind) {
    case 'note': {
      const d = e.data as NoteData
      return `${t('chart.cat.' + d.category)}: ${d.text}`
    }
    case 'vitals': {
      const d = e.data as VitalsData
      const parts = Object.entries(d.values).map(([k, v]) => `${t('common.vitals.' + k)} ${v} ${VITALS[k as VitalKey]?.unit ?? ''}`.trim())
      return [parts.join(' · '), d.note].filter(Boolean).join(' – ')
    }
    case 'task': {
      const d = e.data as TaskData
      return [e.meta.label, t('chart.day.statusText.' + d.status), d.reason, d.note].filter(Boolean).join(' – ')
    }
    case 'intake': {
      const d = e.data as IntakeData
      return d.type === 'drink' ? `+${d.ml} ml${d.item ? ' ' + d.item : ''}` : `${t('care.nutrition.mealNames.' + d.meal)} ${portionLabel(d.portion)}`
    }
  }
}
