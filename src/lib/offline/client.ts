'use client'

/**
 * Offline-Erfassung im Client (PRD §39): Aktionen vormerken, wenn keine Verbindung besteht,
 * und nach Wiederherstellung synchronisieren. Konflikte bleiben zur Entscheidung auf dem Gerät.
 */
import { useEffect, useState } from 'react'
import { getOfflineUser, listRecords, markConflicts, offlineSupported, openRecord, OUTBOX_EVENT, putOp, removeOps } from './store'
import type { OfflineOp, OfflineOpInput, OpMeta, OpResult } from './types'

export { clearOfflineData, offlineSupported, setOfflineUser } from './store'

export type Queued = { ok: true; queued: true; message: string }
export const QUEUED_MESSAGE = 'common.offlineSync.queued'
const QUEUED: Queued = { ok: true, queued: true, message: QUEUED_MESSAGE }
export const isQueued = (r: unknown): r is Queued => !!r && typeof r === 'object' && (r as Queued).queued === true

/** Netzwerkfehler (Server nicht erreichbar) im Unterschied zu Fehlern der Anwendung. */
export const isNetworkError = (e: unknown) =>
  e instanceof TypeError || /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(String((e as Error)?.message ?? ''))

export const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

/** Vorgang in die verschlüsselte Outbox legen. */
export async function queueOp(op: OfflineOpInput, meta: OpMeta = {}, userId?: string) {
  const uid = userId ?? (await getOfflineUser())
  if (!uid) throw new Error('offline_user_unknown')
  return putOp(op, uid, meta)
}

/**
 * Online ausführen; ohne Verbindung (oder bei Netzwerkfehler) stattdessen vormerken.
 * Rückgabe Queued mit message = i18n-Schlüssel «Offline gespeichert – wird synchronisiert».
 */
export async function orQueue<R>(online: () => Promise<R>, op: OfflineOpInput, meta?: OpMeta): Promise<R | Queued> {
  if (offlineSupported() && isOffline()) {
    await queueOp(op, meta)
    return QUEUED
  }
  try {
    return await online()
  } catch (e) {
    if (offlineSupported() && isNetworkError(e)) {
      await queueOp(op, meta)
      return QUEUED
    }
    throw e
  }
}

export type SyncSummary = { applied: number; conflicts: number; failed: boolean }
let running: Promise<SyncSummary> | null = null

/** Wartende Vorgänge der angemeldeten Person an den Server senden (höchstens 50 pro Anfrage). */
export function syncOutbox(): Promise<SyncSummary> {
  if (running) return running
  running = (async () => {
    const sum: SyncSummary = { applied: 0, conflicts: 0, failed: false }
    if (!offlineSupported() || isOffline()) return sum
    const user = await getOfflineUser()
    const recs = (await listRecords()).filter((r) => r.status === 'queued' && r.userId === user)
    const ops: OfflineOp[] = []
    const broken: string[] = []
    for (const r of recs) {
      const v = await openRecord(r)
      if (!v) { broken.push(r.id); continue }
      ops.push({ id: r.id, kind: r.kind, residentId: r.residentId, at: r.at, data: v.data } as OfflineOp)
    }
    // Nicht mehr entschlüsselbar (z. B. Schlüssel gelöscht): verwerfen.
    await removeOps(broken)
    for (let i = 0; i < ops.length; i += 50) {
      const chunk = ops.slice(i, i + 50)
      const res = await fetch('/api/offline/sync', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ops: chunk }),
      }).catch(() => null)
      if (!res || !res.ok) { sum.failed = true; break }
      const { results } = (await res.json()) as { results: OpResult[] }
      const done = results.filter((x) => x.status === 'applied' || x.status === 'duplicate').map((x) => x.id)
      const conf = results.filter((x) => x.status === 'conflict' || x.status === 'rejected')
      await removeOps(done)
      await markConflicts(conf.map((x) => ({ id: x.id, result: { reason: x.reason, detail: x.detail } })))
      sum.applied += done.length
      sum.conflicts += conf.length
      if (results.some((x) => x.status === 'error')) sum.failed = true
    }
    return sum
  })().finally(() => { running = null })
  return running
}

export type OutboxCounts = { queued: number; conflicts: number; foreign: number }

/** Zähler der Outbox für Statusanzeige (aktualisiert sich bei jeder Änderung). */
export function useOutbox(userId?: string): OutboxCounts {
  const [c, setC] = useState<OutboxCounts>({ queued: 0, conflicts: 0, foreign: 0 })
  useEffect(() => {
    if (!offlineSupported()) return
    let alive = true
    const load = async () => {
      const recs = await listRecords()
      const uid = userId ?? (await getOfflineUser())
      if (!alive) return
      setC({
        queued: recs.filter((r) => r.userId === uid && r.status === 'queued').length,
        conflicts: recs.filter((r) => r.userId === uid && r.status === 'conflict').length,
        foreign: recs.filter((r) => r.userId !== uid).length,
      })
    }
    void load()
    window.addEventListener(OUTBOX_EVENT, load)
    return () => { alive = false; window.removeEventListener(OUTBOX_EVENT, load) }
  }, [userId])
  return c
}
