import {
  importPrivateKey,
  importPublicKey,
  isSealed,
  isWrapped,
  seal,
  unseal,
  unwrapSecret,
  wrapSecret,
  type SealedValue,
} from "@/lib/offline-crypto";

// Offline erfasste Einträge (Dokumentation, Vitalwerte, Trinkmenge, Mahlzeit, persönliche Notizen …) warten auf diesem Gerät, bis die
// Verbindung zurück ist, und werden dann in der erfassten Reihenfolge gesendet. Jeder Eintrag trägt eine Kennung
// (x-carecore-request-id); der Server speichert dieselbe Anfrage nie doppelt. Gesendet wird nur mit der Sitzung
// der Person, die den Eintrag erfasst hat.
//
// Auf dem Gerät liegen die Einträge nur verschlüsselt (lib/offline-crypto.ts). Den privaten Schlüssel zum Lesen gibt
// der Server nur der angemeldeten Person; er bleibt im Arbeitsspeicher. Nach einem Neuladen ohne Verbindung lassen
// sich Einträge weiter erfassen (öffentlicher Schlüssel), die vorgemerkten aber erst mit Verbindung lesen und senden.

export const REQUEST_ID_HEADER = "x-carecore-request-id";
export const QUEUE_EVENT = "carecore-offline-queue";
// Gespeicherte Daten wurden ohne Verbindung mit dem Passwort entsperrt: Ansichten laden neu.
export const UNLOCK_EVENT = "carecore-offline-unlocked";
// Eine Antwort des Service Workers meldete gesperrte Daten (kein Schlüssel im Arbeitsspeicher).
export const LOCKED_EVENT = "carecore-offline-locked";

export type WriteMethod = "POST" | "PATCH" | "DELETE";

export type QueuedWrite = {
  id: string;
  userId: string;
  url: string;
  // Ohne Angabe POST; PATCH und DELETE z. B. für persönliche Notizen.
  method?: WriteMethod;
  body: unknown;
  label: string;
  createdAt: string;
  // Textfeld, das vor dem Senden noch korrigiert werden kann (z. B. der Dokumentationstext).
  editable?: { field: string; label: string };
  // Vom Server abgelehnt (z. B. Eingabe ungültig): bleibt sichtbar, bis die Person ihn verwirft.
  error?: string;
  // Abgelehnt, weil der Eintrag inzwischen anderswo geändert wurde (HTTP 409).
  conflict?: boolean;
  // Verschlüsselt und ohne Schlüssel im Arbeitsspeicher: wird mit Verbindung entschlüsselt und gesendet.
  locked?: boolean;
};

// So liegt ein Eintrag im Gerätespeicher: nur Kennung, Person und Zeitpunkt offen, der Rest verschlüsselt.
type StoredWrite = { id: string; userId: string; createdAt: string; sealed: SealedValue };
type Content = Omit<QueuedWrite, "id" | "userId" | "createdAt" | "locked">;

const DB = "carecore-offline";
const STORE = "outbox";

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

const changed = () => window.dispatchEvent(new Event(QUEUE_EVENT));

// ---------- Schlüssel ----------

const PUBLIC_KEY_STORAGE = (userId: string) => `carecore.offline.key.${userId}`;
// Privater Schlüssel, mit dem Passwort verschlüsselt (lib/offline-crypto.ts, wrapSecret).
const UNLOCK_STORAGE = (userId: string) => `carecore.offline.unlock.${userId}`;
// Zuletzt angemeldete Person (nur die Kennung), damit ohne Verbindung erfasst und entsperrt werden kann.
const LAST_USER_STORAGE = "carecore.offline.user";

function readLocal(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // ohne Gerätespeicher kein Entsperren ohne Verbindung
  }
}
let keys: { userId: string; publicKey: CryptoKey | null; privateKey: CryptoKey | null } | null = null;
let unlocking: Promise<void> | null = null;

function storedPublicKey(userId: string) {
  try {
    const raw = readLocal(PUBLIC_KEY_STORAGE(userId));
    return raw ? (JSON.parse(raw) as JsonWebKey) : null;
  } catch {
    return null;
  }
}

// Schlüssel an den Service Worker weitergeben (er verschlüsselt und entschlüsselt die gespeicherten Daten).
// Der private Schlüssel bleibt dabei ein nicht exportierbarer Schlüssel im Arbeitsspeicher.
function shareKeys() {
  if (!keys || typeof navigator === "undefined") return;
  navigator.serviceWorker?.controller?.postMessage({
    type: "offline-keys",
    userId: keys.userId,
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
  });
}

// Der Service Worker fragt nach Schlüsseln (z. B. nach seinem Neustart).
export async function answerKeyRequest() {
  // Gleich nach der Anmeldung steht die Person evtl. noch nicht fest: dann sagt es der Server.
  const userId =
    currentUserId ??
    readLocal(LAST_USER_STORAGE) ??
    (await fetch("/api/me/offline-key", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<{ userId?: string }>) : null))
      .then((pair) => pair?.userId ?? null)
      .catch(() => null));
  if (!userId) return;
  await keysFor(userId).catch(() => null);
  shareKeys();
}

// Mit Verbindung: Schlüsselpaar vom Server (privat nur im Arbeitsspeicher, öffentlich auf dem Gerät für später).
// Ohne Verbindung: nur der öffentliche Schlüssel vom Gerät – Erfassen geht, Lesen erst mit Verbindung.
async function unlock(userId: string) {
  let publicKey: CryptoKey | null = null;
  let privateKey: CryptoKey | null = null;
  try {
    const response = await fetch("/api/me/offline-key", { cache: "no-store" });
    const pair = response.ok
      ? ((await response.json()) as { userId?: string; publicJwk: JsonWebKey; privateJwk: JsonWebKey })
      : null;
    // Nur der Schlüssel der Person, deren Einträge gemeint sind (nicht der einer anderen Anmeldung).
    if (pair && (!pair.userId || pair.userId === userId)) {
      [publicKey, privateKey] = await Promise.all([importPublicKey(pair.publicJwk), importPrivateKey(pair.privateJwk)]);
      try {
        localStorage.setItem(PUBLIC_KEY_STORAGE(userId), JSON.stringify(pair.publicJwk));
        localStorage.setItem(LAST_USER_STORAGE, userId);
      } catch {
        // ohne Gerätespeicher: nach einem Neuladen offline kein Erfassen
      }
    }
  } catch {
    // keine Verbindung
  }
  if (!publicKey) {
    const stored = storedPublicKey(userId);
    if (stored) publicKey = await importPublicKey(stored).catch(() => null);
  }
  // Ohne Verbindung ggf. mit dem Passwort bereits entsperrt: den privaten Schlüssel behalten.
  if (!privateKey && keys?.userId === userId && keys.privateKey) privateKey = keys.privateKey;
  keys = { userId, publicKey, privateKey };
  shareKeys();
  if (privateKey) await sealLegacy(userId);
}

// Nach der Anmeldung mit Passwort: privaten Schlüssel mit dem Passwort verschlüsselt auf dem Gerät ablegen, damit sich
// die gespeicherten Daten nach einem Neuladen ohne Verbindung mit dem Passwort entsperren lassen.
export async function rememberOfflineUnlock(password: string) {
  const response = await fetch("/api/me/offline-key", { cache: "no-store" });
  if (!response.ok) return;
  const pair = (await response.json()) as { userId: string; publicJwk: JsonWebKey; privateJwk: JsonWebKey };
  writeLocal(UNLOCK_STORAGE(pair.userId), JSON.stringify(await wrapSecret(pair.privateJwk, password)));
  writeLocal(PUBLIC_KEY_STORAGE(pair.userId), JSON.stringify(pair.publicJwk));
  writeLocal(LAST_USER_STORAGE, pair.userId);
}

const offlineUnlockUser = () => currentUserId ?? readLocal(LAST_USER_STORAGE);

export function canUnlockOffline() {
  const userId = offlineUnlockUser();
  return Boolean(userId && readLocal(UNLOCK_STORAGE(userId)));
}

// Ohne Verbindung mit dem Passwort entsperren; false bei falschem Passwort.
export async function unlockOffline(password: string) {
  const userId = offlineUnlockUser();
  const raw = userId ? readLocal(UNLOCK_STORAGE(userId)) : null;
  if (!userId || !raw) return false;
  let wrapped: unknown;
  try {
    wrapped = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!isWrapped(wrapped)) return false;
  const privateJwk = await unwrapSecret<JsonWebKey>(wrapped, password);
  if (!privateJwk) return false;
  const stored = storedPublicKey(userId);
  const [privateKey, publicKey] = await Promise.all([
    importPrivateKey(privateJwk),
    stored ? importPublicKey(stored) : Promise.resolve(null),
  ]);
  keys = { userId, publicKey, privateKey };
  if (!currentUserId) currentUserId = userId;
  shareKeys();
  changed();
  window.dispatchEvent(new Event(UNLOCK_EVENT));
  return true;
}

async function keysFor(userId: string) {
  if (unlocking) await unlocking;
  if (keys?.userId === userId && keys.privateKey) return keys;
  // Nach dem Wiederverbinden erneut versuchen, den privaten Schlüssel zu holen.
  unlocking = unlock(userId).finally(() => {
    unlocking = null;
  });
  await unlocking;
  return keys?.userId === userId ? keys : null;
}

// Einträge aus der Zeit vor der Verschlüsselung einmalig verschlüsseln.
async function sealLegacy(userId: string) {
  const all = await withStore<Array<StoredWrite | QueuedWrite>>("readonly", (store) => store.getAll());
  for (const item of all)
    if (item.userId === userId && !("sealed" in item && isSealed(item.sealed))) await putSealed(item as QueuedWrite);
}

async function putSealed(item: QueuedWrite) {
  const publicKey = keys?.userId === item.userId ? keys.publicKey : null;
  if (!publicKey) throw new Error("Keine Verbindung. Der Eintrag konnte nicht sicher vorgemerkt werden.");
  const { id, userId, createdAt, locked, ...content } = item;
  if (locked) return;
  const stored: StoredWrite = { id, userId, createdAt, sealed: await seal(publicKey, content satisfies Content) };
  await withStore("readwrite", (store) => store.put(stored));
}

export async function queuedWrites(userId: string | null) {
  if (!userId) return [];
  const current = await keysFor(userId);
  const all = await withStore<Array<StoredWrite | QueuedWrite>>("readonly", (store) => store.getAll());
  const mine = all.filter((item) => item.userId === userId);
  const items = await Promise.all(
    mine.map(async (item): Promise<QueuedWrite> => {
      if (!("sealed" in item) || !isSealed(item.sealed)) return item as QueuedWrite;
      const base = { id: item.id, userId: item.userId, createdAt: item.createdAt };
      if (!current?.privateKey) return { ...base, url: "", body: null, label: "Verschlüsselter Eintrag", locked: true };
      try {
        return { ...base, ...(await unseal<Content>(current.privateKey, item.sealed)) };
      } catch {
        return {
          ...base,
          url: "",
          body: null,
          label: "Verschlüsselter Eintrag",
          error: "Lässt sich nicht mehr entschlüsseln (Schlüssel des Servers geändert).",
        };
      }
    }),
  );
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function discardWrite(id: string) {
  await withStore("readwrite", (store) => store.delete(id));
  changed();
}

async function saveWrite(item: QueuedWrite) {
  await keysFor(item.userId);
  await putSealed(item);
  changed();
}

// Vorgemerkten Eintrag korrigieren: neuer Text im bearbeitbaren Feld; ein abgelehnter Eintrag wird damit erneut
// gesendet (die Kennung bleibt, der Server hat ihn ja nicht gespeichert).
export async function editWrite(item: QueuedWrite, value: string) {
  if (!item.editable || !item.body || typeof item.body !== "object") return;
  await saveWrite({
    ...item,
    body: { ...(item.body as Record<string, unknown>), [item.editable.field]: value },
    error: undefined,
    conflict: undefined,
  });
}

// Konflikt: die eigene Fassung trotzdem übernehmen – ohne Vergleichsstand erneut senden.
export const canOverride = (item: QueuedWrite) =>
  !!item.conflict && !!item.body && typeof item.body === "object" && "baseUpdatedAt" in item.body;

export async function overrideWrite(item: QueuedWrite) {
  if (!canOverride(item)) return;
  const body = { ...(item.body as Record<string, unknown>) };
  delete body.baseUpdatedAt;
  await saveWrite({ ...item, body, error: undefined, conflict: undefined });
}

// Angemeldete Person (von OfflineSync gesetzt), damit Einträge nur mit ihrer Sitzung gesendet werden.
let currentUserId: string | null = null;
// Sobald die Person feststeht (nach dem Neuladen ohne Verbindung oft erst nach der ersten Datenabfrage),
// lesen die Ansichten ihre vorgemerkten Einträge neu.
export const setOfflineUser = (userId: string | null) => {
  if (currentUserId === userId) return;
  currentUserId = userId;
  if (userId) writeLocal(LAST_USER_STORAGE, userId);
  changed();
};
// Ohne Verbindung nach einem Neuladen: die zuletzt angemeldete Person dieses Geräts.
export const lastOfflineUser = () => readLocal(LAST_USER_STORAGE);
export const offlineUser = () => currentUserId;

async function post(url: string, body: unknown, requestId: string, method: WriteMethod = "POST") {
  const response = await fetch(url, {
    method,
    cache: "no-store",
    headers: { "content-type": "application/json", [REQUEST_ID_HEADER]: requestId },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

// Sendet den Eintrag; ohne Verbindung wird er auf dem Gerät vorgemerkt ({ queued: true }).
// `body` enthält den erfassten Zeitpunkt, damit der Eintrag später mit der richtigen Zeit gespeichert wird.
export async function sendOrQueue<T>(
  url: string,
  body: unknown,
  label: string,
  editable?: { field: string; label: string },
  method: WriteMethod = "POST",
): Promise<{ queued: false; data: T } | { queued: true }> {
  const requestId = crypto.randomUUID();
  try {
    const { response, payload } = await post(url, body, requestId, method);
    if (!response.ok) throw new Error(payload?.error || "Die Anfrage ist fehlgeschlagen.");
    return { queued: false, data: payload as T };
  } catch (error) {
    // Nur Verbindungsfehler werden vorgemerkt; Ablehnungen des Servers zeigt das Formular direkt.
    if (!(error instanceof TypeError)) throw error;
    if (!currentUserId) throw new Error("Keine Verbindung. Der Eintrag konnte nicht gespeichert werden.");
    await saveWrite({
      id: requestId,
      userId: currentUserId,
      url,
      method,
      body,
      label,
      createdAt: new Date().toISOString(),
      editable,
    });
    return { queued: true };
  }
}

// Sendet die vorgemerkten Einträge der angemeldeten Person der Reihe nach.
// Ergebnis: gesendet, abgelehnt, und ob die Anmeldung abgelaufen ist.
// Nur ein Sendevorgang gleichzeitig: sonst schicken zwei Auslöser (z. B. „online“ und Intervall) denselben Eintrag
// doppelt, und der zweite scheitert an der bereits vergebenen Quittung.
let flushing: Promise<{ sent: number; rejected: number; signedOut: boolean }> | null = null;

export function flushQueue() {
  flushing ??= sendQueued().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function sendQueued() {
  const result = { sent: 0, rejected: 0, signedOut: false };
  if (!currentUserId) return result;
  for (const item of await queuedWrites(currentUserId)) {
    if (item.error || item.locked) continue;
    let outcome: Awaited<ReturnType<typeof post>>;
    try {
      outcome = await post(item.url, item.body, item.id, item.method ?? "POST");
    } catch {
      break;
    }
    if (outcome.response.ok) {
      await discardWrite(item.id);
      result.sent += 1;
    } else if (outcome.response.status === 401) {
      result.signedOut = true;
      break;
    } else if (outcome.response.status >= 500 || outcome.response.status === 429) {
      // Serverfehler oder Drossel: später erneut senden, nicht als abgelehnt markieren.
      break;
    } else {
      await saveWrite({
        ...item,
        error: outcome.payload?.error || "Der Eintrag wurde abgelehnt.",
        conflict: outcome.response.status === 409 || undefined,
      });
      result.rejected += 1;
    }
  }
  return result;
}

// Service Worker: Seiten und Daten des Geräts löschen (Abmelden, Personenwechsel).
export function clearOfflineData() {
  keys = null;
  navigator.serviceWorker?.controller?.postMessage({ type: "clear-data" });
  try {
    for (const key of Object.keys(localStorage))
      if (key.startsWith("carecore.offline.unlock.") || key === LAST_USER_STORAGE) localStorage.removeItem(key);
  } catch {
    // ohne Gerätespeicher nichts zu löschen
  }
}
