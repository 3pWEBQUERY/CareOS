import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { importPrivateKey, importPublicKey } from "../lib/offline-crypto.ts";
import { offlineKeyPair } from "../lib/offline-key.ts";

// Service Worker (public/sw.js) in einer nachgebauten Umgebung: Daten werden nur verschlüsselt gespeichert und ohne
// Verbindung nur mit dem privaten Schlüssel aus dem Arbeitsspeicher gelesen.
type Handler = (event: Record<string, unknown>) => void;

async function worker() {
  const handlers = new Map<string, Handler>();
  const stores = new Map<string, Map<string, Response>>();
  let online = true;
  const posted: unknown[] = [];
  const client = { postMessage: (message: unknown) => posted.push(message) };
  const caches = {
    open: async (name: string) => {
      const store = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, store);
      return {
        match: async (request: Request) => store.get(new URL(request.url).pathname)?.clone(),
        put: async (request: Request, response: Response) => void store.set(new URL(request.url).pathname, response),
        delete: async (request: Request) => store.delete(new URL(request.url).pathname),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
  const self: Record<string, unknown> = {
    crypto: globalThis.crypto,
    location: { origin: "https://carecore.test" },
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    clients: { matchAll: async () => [client], get: async () => client, claim: async () => undefined },
    registration: {},
    skipWaiting: () => undefined,
  };
  const context = {
    self,
    caches,
    fetch: async () => {
      if (!online) throw new TypeError("offline");
      return new Response(JSON.stringify({ residents: ["Erna Muster"] }), {
        headers: { "content-type": "application/json" },
      });
    },
    importScripts: () => undefined,
    Response,
    URL,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    btoa,
    atob,
    JSON,
    String,
    Promise,
    setTimeout,
    console,
  };
  runInNewContext(await readFile(new URL("../public/sw-crypto.js", import.meta.url), "utf8"), context);
  runInNewContext(await readFile(new URL("../public/sw.js", import.meta.url), "utf8"), context);

  const request = async () => {
    let response: Promise<Response> | undefined;
    const waits: Promise<unknown>[] = [];
    handlers.get("fetch")!({
      request: new Request("https://carecore.test/api/residents"),
      clientId: "page",
      respondWith: (value: Promise<Response>) => (response = value),
      waitUntil: (value: Promise<unknown>) => waits.push(value),
    });
    const result = await response!;
    await Promise.all(waits);
    return result;
  };
  const message = (data: unknown) => handlers.get("message")!({ data, waitUntil: () => undefined });
  return {
    request,
    message,
    posted,
    setOnline: (value: boolean) => (online = value),
    stored: async () =>
      (await (await caches.open("carecore-data-v2")).match(new Request("https://carecore.test/api/residents")))?.text(),
  };
}

test("Service Worker: ohne Schlüssel nichts gespeichert, mit Schlüssel nur verschlüsselt", async () => {
  const sw = await worker();
  const pair = offlineKeyPair("user-a", randomBytes(32))!;
  // Ohne Schlüssel (das Fenster antwortet nicht): Antwort geht durch, gespeichert wird nichts.
  assert.equal((await sw.request()).status, 200);
  assert.equal(await sw.stored(), undefined);
  sw.message({
    type: "offline-keys",
    userId: "user-a",
    publicKey: await importPublicKey(pair.publicJwk),
    privateKey: null,
  });
  await sw.request();
  const stored = await sw.stored();
  assert.ok(stored);
  assert.equal(stored.includes("Erna"), false, "kein Klartext im Zwischenspeicher");
  assert.equal(JSON.parse(stored).v, 1);
});

test("Service Worker: ohne Verbindung gesperrt ohne privaten Schlüssel, lesbar mit ihm, fremde Person gesperrt", async () => {
  const sw = await worker();
  const pair = offlineKeyPair("user-a", randomBytes(32))!;
  const publicKey = await importPublicKey(pair.publicJwk);
  sw.message({ type: "offline-keys", userId: "user-a", publicKey, privateKey: null });
  await sw.request();
  sw.setOnline(false);

  const locked = await sw.request();
  assert.equal(locked.status, 503);
  assert.equal(((await locked.json()) as { locked: boolean }).locked, true);
  assert.equal((sw.posted.at(-1) as { locked: boolean }).locked, true);

  const privateKey = await importPrivateKey(pair.privateJwk);
  sw.message({ type: "offline-keys", userId: "user-a", publicKey, privateKey });
  const opened = await sw.request();
  assert.equal(opened.status, 200);
  assert.deepEqual(await opened.json(), { residents: ["Erna Muster"] });
  assert.ok(opened.headers.get("x-carecore-cached-at"));

  // Ein neues Fenster ohne Verbindung meldet nur den öffentlichen Schlüssel: der private bleibt erhalten.
  sw.message({ type: "offline-keys", userId: "user-a", publicKey, privateKey: null });
  assert.equal((await sw.request()).status, 200);

  // Andere Person: Daten der ersten bleiben gesperrt.
  const other = offlineKeyPair("user-b", randomBytes(32))!;
  sw.message({
    type: "offline-keys",
    userId: "user-b",
    publicKey: await importPublicKey(other.publicJwk),
    privateKey: await importPrivateKey(other.privateJwk),
  });
  assert.equal((await sw.request()).status, 503);

  // Abmelden: Schlüssel weg.
  sw.message({ type: "clear-data" });
  assert.equal((await sw.request()).status, 503);
});
