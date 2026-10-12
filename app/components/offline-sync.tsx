"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { loadWorkContext } from "./care-context";
import {
  LOCKED_EVENT,
  QUEUE_EVENT,
  answerKeyRequest,
  canUnlockOffline,
  lastOfflineUser,
  unlockOffline,
  canOverride,
  discardWrite,
  editWrite,
  overrideWrite,
  flushQueue,
  offlineUser,
  queuedWrites,
  setOfflineUser,
  type QueuedWrite,
} from "./offline-queue";

// Seiten, die nach der Anmeldung für die Arbeit ohne Verbindung vorab geladen werden.
const OFFLINE_PAGES = [
  "/c",
  "/c/betrieb/schicht",
  "/c/betrieb/uebergabe",
  "/c/betrieb/aufgaben",
  "/c/bewohner",
  "/c/pflegedokumentation",
  "/c/pflegedokumentation/lagerung",
  "/c/pflegedokumentation/ausscheidung",
  "/c/medikation/runde",
  "/c/medikation",
  "/c/vitalwerte",
  "/c/ernaehrung",
  "/c/ernaehrung/trinkprotokoll",
  "/c/wundmanagement",
  "/c/mein-dienstplan",
];
const WARM_KEY = "carecore.offline.warmed";
// Browserspeicher kann gesperrt sein (privates Fenster); dann wird eben erneut vorab geladen.
function readStorage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ohne Speicher kein Merker
  }
}
const time = (value: string) =>
  new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" }).format(
    new Date(value),
  );

// Offline-Betrieb: registriert den Service Worker, sendet vorgemerkte Einträge, sobald die Verbindung zurück ist,
// und zeigt den Zustand unten links an (nur wenn es etwas zu melden gibt).
export default function OfflineSync() {
  const pathname = usePathname();
  const inApp = pathname?.startsWith("/c") ?? false;
  const [online, setOnline] = useState(true);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [items, setItems] = useState<QueuedWrite[]>([]);
  const [notice, setNotice] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  // Gespeicherte Daten gesperrt (kein Schlüssel im Arbeitsspeicher); Entsperren mit dem Passwort.
  const [locked, setLocked] = useState(false);
  const [unlocking, setUnlocking] = useState<{ password: string; error: string; busy: boolean } | null>(null);

  const refresh = useCallback(async () => setItems(await queuedWrites(offlineUser()).catch(() => [])), []);

  const flush = useCallback(async () => {
    if (!navigator.onLine || !offlineUser()) return;
    const result = await flushQueue().catch(() => null);
    if (!result) return;
    setSignedOut(result.signedOut);
    if (result.sent)
      setNotice(`${result.sent} offline erfasste${result.sent === 1 ? "r Eintrag" : " Einträge"} gesendet`);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator)
      void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
    const update = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) {
        setCachedAt(null);
        setLocked(false);
        setUnlocking(null);
        void flush();
      }
    };
    const markLocked = () => !navigator.onLine && setLocked(true);
    const fromWorker = (event: MessageEvent) => {
      if (event.data?.type === "need-offline-keys") return void answerKeyRequest();
      if (event.data?.type !== "offline-data") return;
      setOnline(false);
      setCachedAt((current) => current ?? event.data.cachedAt ?? null);
      if (event.data.locked) setLocked(true);
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    window.addEventListener(QUEUE_EVENT, refresh);
    window.addEventListener(LOCKED_EVENT, markLocked);
    navigator.serviceWorker?.addEventListener("message", fromWorker);
    const timer = window.setInterval(() => void flush(), 30_000);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener(QUEUE_EVENT, refresh);
      window.removeEventListener(LOCKED_EVENT, markLocked);
      navigator.serviceWorker?.removeEventListener("message", fromWorker);
      window.clearInterval(timer);
    };
  }, [flush, refresh]);

  // Angemeldete Person ermitteln (auch offline aus dem Speicher), dann Einträge senden und Seiten vorab laden.
  useEffect(() => {
    if (!inApp) return;
    let cancelled = false;
    fetch("/api/work-context", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (payload?.locked === true && !navigator.onLine) setLocked(true);
        return response.ok ? payload : null;
      })
      .then(async (context: { profile?: { userId?: string } } | null) => {
        if (cancelled) return;
        // Ohne Verbindung und gesperrten Daten: zuletzt angemeldete Person des Geräts (zum Erfassen und Entsperren).
        const userId = context?.profile?.userId ?? (navigator.onLine ? null : lastOfflineUser());
        if (!userId) return;
        setOfflineUser(userId);
        if (!context?.profile?.userId) return void refresh();
        await refresh();
        await flush();
        // Einmal täglich je Person vorab laden.
        const warmed = `${userId}:${new Date().toISOString().slice(0, 10)}`;
        const worker = navigator.serviceWorker?.controller;
        if (navigator.onLine && worker && readStorage(WARM_KEY) !== warmed) {
          worker.postMessage({ type: "warm", urls: OFFLINE_PAGES });
          writeStorage(WARM_KEY, warmed);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [inApp, flush, refresh]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const pending = items.filter((item) => !item.error);
  const rejected = items.filter((item) => item.error);
  if (!inApp || (online && !pending.length && !rejected.length && !notice)) return null;
  const showUnlock = !online && (locked || items.some((item) => item.locked)) && canUnlockOffline();

  const unlock = async () => {
    if (!unlocking) return;
    setUnlocking({ ...unlocking, busy: true, error: "" });
    if (await unlockOffline(unlocking.password).catch(() => false)) {
      setUnlocking(null);
      setLocked(false);
      void loadWorkContext(true);
      await refresh();
    } else setUnlocking({ password: "", busy: false, error: "Das Passwort stimmt nicht." });
  };

  const message = !online
    ? `Offline${locked ? " · Gespeicherte Daten gesperrt" : cachedAt ? ` · Stand der Daten ${time(cachedAt)}` : ""}${
        pending.length ? ` · ${pending.length} Eintr${pending.length === 1 ? "ag wartet" : "äge warten"}` : ""
      }`
    : signedOut && pending.length
      ? `Bitte erneut anmelden, um ${pending.length} offline erfasste Eintr${pending.length === 1 ? "ag" : "äge"} zu senden`
      : pending.length
        ? `${pending.length} Eintr${pending.length === 1 ? "ag wird" : "äge werden"} gesendet …`
        : rejected.length
          ? `${rejected.length} offline erfasste${rejected.length === 1 ? "r Eintrag wurde" : " Einträge wurden"} abgelehnt`
          : notice;

  return (
    <div className={`offline-status ${online ? "" : "offline"}`} role="status" aria-live="polite">
      <span className="offline-status-dot" aria-hidden="true" />
      <span>{message}</span>
      {showUnlock && !unlocking && (
        <button type="button" onClick={() => setUnlocking({ password: "", error: "", busy: false })}>
          Entsperren
        </button>
      )}
      {(pending.length > 0 || rejected.length > 0) && (
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {open ? "Ausblenden" : "Anzeigen"}
        </button>
      )}
      {showUnlock && unlocking && (
        <form
          className="offline-status-edit"
          onSubmit={(event) => {
            event.preventDefault();
            void unlock();
          }}
        >
          <label>
            <span>Passwort (ohne Verbindung entsperren)</span>
            <input
              type="password"
              autoComplete="current-password"
              value={unlocking.password}
              onChange={(event) => setUnlocking({ ...unlocking, password: event.target.value })}
              autoFocus
            />
          </label>
          {unlocking.error && <small role="alert">{unlocking.error}</small>}
          <span className="offline-status-actions">
            <button type="button" onClick={() => setUnlocking(null)}>
              Abbrechen
            </button>
            <button type="submit" disabled={unlocking.busy || !unlocking.password}>
              {unlocking.busy ? "Entsperren …" : "Entsperren"}
            </button>
          </span>
        </form>
      )}
      {open && (
        <ul className="offline-status-list">
          {items.map((item) => (
            <li key={item.id}>
              <span>
                <strong>{item.label}</strong>
                <small>
                  erfasst {time(item.createdAt)}
                  {item.error
                    ? ` · ${item.conflict ? "Konflikt" : "abgelehnt"}: ${item.error}`
                    : item.locked
                      ? " · verschlüsselt, lesbar und gesendet mit Verbindung"
                      : " · wartet auf Verbindung"}
                </small>
              </span>
              <span className="offline-status-actions">
                {item.editable && editing?.id !== item.id && (
                  <button
                    type="button"
                    onClick={() => {
                      const body = (item.body ?? {}) as Record<string, unknown>;
                      setEditing({ id: item.id, value: String(body[item.editable!.field] ?? "") });
                    }}
                  >
                    Bearbeiten
                  </button>
                )}
                {canOverride(item) && (
                  <button type="button" onClick={() => void overrideWrite(item).then(() => void flush())}>
                    Meine Fassung übernehmen
                  </button>
                )}
                {item.error && (
                  <button type="button" onClick={() => void discardWrite(item.id)}>
                    Verwerfen
                  </button>
                )}
              </span>
              {item.editable && editing?.id === item.id && (
                <form
                  className="offline-status-edit"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void editWrite(item, editing.value).then(() => {
                      setEditing(null);
                      void flush();
                    });
                  }}
                >
                  <label>
                    <span>{item.editable.label}</span>
                    <textarea
                      rows={3}
                      value={editing.value}
                      onChange={(event) => setEditing({ id: item.id, value: event.target.value })}
                    />
                  </label>
                  <span className="offline-status-actions">
                    <button type="button" onClick={() => setEditing(null)}>
                      Abbrechen
                    </button>
                    <button type="submit" disabled={editing.value.trim().length < 3}>
                      Speichern
                    </button>
                  </span>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
