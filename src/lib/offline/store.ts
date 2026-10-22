'use client'

/**
 * Lokaler, verschlüsselter Speicher auf dem Gerät (PRD §39: «Besonders sensible Daten werden nur minimal
 * und verschlüsselt lokal gespeichert»). IndexedDB mit AES-GCM; der Schlüssel wird pro Gerät erzeugt,
 * ist nicht exportierbar (WebCrypto) und liegt als CryptoKey-Objekt ebenfalls in IndexedDB.
 * Gelöscht beim Abmelden (clearOfflineData) sowie nach 24 h (Outbox) bzw. 12 h (Lesestand).
 */
import { OUTBOX_MAX_AGE_MS, SNAPSHOT_MAX_AGE_MS, type OfflineKind, type OfflineOpInput, type OpMeta, type OpResult, type ShiftSnapshot } from './types'

const DB_NAME = 'careos-offline'
const VERSION = 1
type Sealed = { iv: Uint8Array; ct: ArrayBuffer }

/** Datensatz in der Outbox. Unverschlüsselt nur technische Felder (IDs, Zeit, Status). */
export type OutboxRecord = {
  id: string
  userId: string
  kind: OfflineKind
  residentId: string
  at: string
  status: 'queued' | 'conflict'
  result?: Pick<OpResult, 'reason' | 'detail'>
  sealed: Sealed
}

export const offlineSupported = () =>
  typeof window !== 'undefined' && 'indexedDB' in window && !!window.crypto?.subtle && typeof crypto.randomUUID === 'function'

let dbp: Promise<IDBDatabase> | null = null
/** Nach dem Abmelden in diesem Dokument nichts mehr anlegen (die Seite wechselt zur Anmeldung). */
let cleared = false
function open(): Promise<IDBDatabase> {
  if (cleared) return Promise.reject(new Error('offline_cleared'))
  if (dbp) return dbp
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains('keys')) d.createObjectStore('keys')
      if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'id' })
      if (!d.objectStoreNames.contains('snapshot')) d.createObjectStore('snapshot')
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta')
    }
    req.onsuccess = () => {
      const d = req.result
      d.onversionchange = () => { d.close(); dbp = null }
      resolve(d)
    }
    req.onerror = () => { dbp = null; reject(req.error) }
    req.onblocked = () => { dbp = null; reject(new Error('blocked')) }
  })
  return dbp
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return open().then((d) => new Promise<T>((resolve, reject) => {
    const t = d.transaction(store, mode)
    const r = fn(t.objectStore(store))
    t.oncomplete = () => resolve(r ? r.result : (undefined as T))
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  }))
}

/** Geräteschlüssel: AES-GCM 256, nicht exportierbar. */
let keyp: Promise<CryptoKey> | null = null
function deviceKey(): Promise<CryptoKey> {
  if (keyp) return keyp
  keyp = (async () => {
    const existing = await tx<CryptoKey | undefined>('keys', 'readonly', (s) => s.get('device'))
    if (existing) return existing
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    await tx('keys', 'readwrite', (s) => s.put(key, 'device'))
    return key
  })().catch((e) => { keyp = null; throw e })
  return keyp
}

async function seal(value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deviceKey(), new TextEncoder().encode(JSON.stringify(value)))
  return { iv, ct }
}

async function unseal<T>(s: Sealed): Promise<T | null> {
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: s.iv as Uint8Array<ArrayBuffer> }, await deviceKey(), s.ct)
    return JSON.parse(new TextDecoder().decode(pt)) as T
  } catch {
    return null
  }
}

/* ───────── Aktive Person (Zuordnung der Offline-Einträge) ───────── */

export async function setOfflineUser(userId: string) {
  if (!offlineSupported()) return
  await tx('meta', 'readwrite', (s) => s.put(userId, 'user')).catch(() => {})
}
export async function getOfflineUser(): Promise<string | null> {
  if (!offlineSupported()) return null
  return (await tx<string | undefined>('meta', 'readonly', (s) => s.get('user')).catch(() => undefined)) ?? null
}

/* ───────── Outbox ───────── */

export type OutboxEntry = Omit<OutboxRecord, 'sealed'> & { data: unknown; meta: OpMeta }

export async function putOp(op: OfflineOpInput, userId: string, meta: OpMeta = {}): Promise<string> {
  const id = crypto.randomUUID()
  const rec: OutboxRecord = {
    id, userId, kind: op.kind, residentId: op.residentId, at: new Date().toISOString(), status: 'queued',
    sealed: await seal({ data: op.data, meta }),
  }
  await tx('outbox', 'readwrite', (s) => s.put(rec))
  notifyChange()
  return id
}

/** Alle Einträge, ältere als 24 h werden dabei gelöscht. */
export async function listRecords(): Promise<OutboxRecord[]> {
  if (!offlineSupported()) return []
  const all = await tx<OutboxRecord[]>('outbox', 'readonly', (s) => s.getAll()).catch(() => [] as OutboxRecord[])
  const limit = Date.now() - OUTBOX_MAX_AGE_MS
  const old = all.filter((r) => new Date(r.at).getTime() < limit)
  if (old.length) {
    await tx('outbox', 'readwrite', (s) => { for (const r of old) s.delete(r.id) }).catch(() => {})
    notifyChange()
  }
  return all.filter((r) => !old.includes(r)).sort((a, b) => a.at.localeCompare(b.at))
}

export async function listEntries(): Promise<OutboxEntry[]> {
  const recs = await listRecords()
  const out: OutboxEntry[] = []
  for (const { sealed, ...r } of recs) {
    const v = await unseal<{ data: unknown; meta: OpMeta }>(sealed)
    if (v) out.push({ ...r, data: v.data, meta: v.meta ?? {} })
  }
  return out
}

export async function openRecord(rec: OutboxRecord) {
  return unseal<{ data: unknown; meta: OpMeta }>(rec.sealed)
}

export async function removeOps(ids: string[]) {
  if (!ids.length) return
  await tx('outbox', 'readwrite', (s) => { for (const id of ids) s.delete(id) })
  notifyChange()
}

export async function markConflicts(items: { id: string; result: OutboxRecord['result'] }[]) {
  if (!items.length) return
  const d = await open()
  await new Promise<void>((resolve, reject) => {
    const t = d.transaction('outbox', 'readwrite')
    const s = t.objectStore('outbox')
    for (const it of items) {
      const g = s.get(it.id)
      g.onsuccess = () => { if (g.result) s.put({ ...g.result, status: 'conflict', result: it.result }) }
    }
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
  })
  notifyChange()
}

/* ───────── Lesestand der Schicht ───────── */

export async function saveSnapshot(snap: ShiftSnapshot) {
  if (!offlineSupported()) return
  const sealed = await seal(snap)
  await tx('snapshot', 'readwrite', (s) => s.put({ savedAt: snap.savedAt, sealed }, 'shift'))
}

/** Lesestand, höchstens 12 h alt – sonst gelöscht. */
export async function loadSnapshot(): Promise<ShiftSnapshot | null> {
  if (!offlineSupported()) return null
  const row = await tx<{ savedAt: string; sealed: Sealed | null } | undefined>('snapshot', 'readonly', (s) => s.get('shift')).catch(() => undefined)
  if (!row?.sealed) return null
  if (Date.now() - new Date(row.savedAt).getTime() > SNAPSHOT_MAX_AGE_MS) {
    await tx('snapshot', 'readwrite', (s) => s.delete('shift')).catch(() => {})
    return null
  }
  return unseal<ShiftSnapshot>(row.sealed)
}

/* ───────── Abmelden ───────── */

/** Löscht alle Offline-Daten dieses Geräts inkl. Schlüssel (beim Abmelden). */
export async function clearOfflineData() {
  if (!offlineSupported()) return
  try {
    const d = await open()
    d.close()
  } catch {}
  cleared = true
  dbp = null
  keyp = null
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
  notifyChange()
}

/* ───────── Änderungen an die Oberfläche melden ───────── */

export const OUTBOX_EVENT = 'careos:outbox'
function notifyChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OUTBOX_EVENT))
}
