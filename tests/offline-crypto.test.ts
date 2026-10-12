import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  WRAP_ITERATIONS,
  importPrivateKey,
  importPublicKey,
  isSealed,
  isWrapped,
  seal,
  unseal,
  unwrapSecret,
  wrapSecret,
} from "../lib/offline-crypto.ts";
import { offlineKeyPair } from "../lib/offline-key.ts";

const entry = {
  url: "/api/vitals/measurements",
  body: { note: "Erna Muster klagt über Schwindel" },
  label: "Vitalwerte",
};

test("Offline: Schlüsselpaar je Person aus dem Serverschlüssel, stabil und verschieden", () => {
  const secret = randomBytes(32);
  const a = offlineKeyPair("user-a", secret)!;
  assert.deepEqual(offlineKeyPair("user-a", secret), a, "gleiche Person, gleicher Schlüssel");
  assert.notEqual(offlineKeyPair("user-b", secret)!.publicJwk.x, a.publicJwk.x);
  assert.notEqual(offlineKeyPair("user-a", randomBytes(32))!.publicJwk.x, a.publicJwk.x);
  assert.equal(offlineKeyPair("user-a", null), null, "ohne Serverschlüssel keine Offline-Speicherung");
  assert.equal("d" in a.publicJwk, false, "der öffentliche Teil enthält keinen privaten Schlüssel");
});

test("Offline: verschlüsselt ohne Klartext, nur mit dem privaten Schlüssel der Person lesbar", async () => {
  const secret = randomBytes(32);
  const mine = offlineKeyPair("user-a", secret)!;
  const other = offlineKeyPair("user-b", secret)!;
  const sealed = await seal(await importPublicKey(mine.publicJwk), entry);
  assert.ok(isSealed(sealed));
  assert.equal(JSON.stringify(sealed).includes("Schwindel"), false, "kein Klartext auf dem Gerät");
  assert.deepEqual(await unseal(await importPrivateKey(mine.privateJwk), sealed), entry);
  await assert.rejects(unseal(await importPrivateKey(other.privateJwk), sealed), "fremder Schlüssel scheitert");
  const tampered = { ...sealed, data: `${sealed.data.startsWith("A") ? "B" : "A"}${sealed.data.slice(1)}` };
  await assert.rejects(unseal(await importPrivateKey(mine.privateJwk), tampered), "veränderte Daten fallen auf");
  const again = await seal(await importPublicKey(mine.publicJwk), entry);
  assert.notEqual(again.data, sealed.data, "jeder Eintrag mit eigenem Einmalschlüssel");
});

// Service Worker (public/sw-crypto.js): dasselbe Verfahren, gegenseitig lesbar.
async function workerCrypto() {
  const { readFile } = await import("node:fs/promises");
  const { runInNewContext } = await import("node:vm");
  const self: Record<string, unknown> = { crypto: globalThis.crypto };
  runInNewContext(await readFile(new URL("../public/sw-crypto.js", import.meta.url), "utf8"), {
    self,
    btoa,
    atob,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    String,
    JSON,
  });
  return self.carecoreCrypto as {
    seal: (key: CryptoKey, value: unknown) => Promise<unknown>;
    unseal: (key: CryptoKey, sealed: unknown) => Promise<unknown>;
    importPublicKey: (jwk: JsonWebKey) => Promise<CryptoKey>;
  };
}

test("Offline: Service Worker verschlüsselt wie die App – auch grosse Antworten, gegenseitig lesbar", async () => {
  const worker = await workerCrypto();
  const pair = offlineKeyPair("user-a", randomBytes(32))!;
  const privateKey = await importPrivateKey(pair.privateJwk);
  const large = { body: "Bericht ".repeat(40_000), status: 200 };
  const fromWorker = await worker.seal(await worker.importPublicKey(pair.publicJwk), large);
  assert.ok(isSealed(fromWorker));
  assert.equal(JSON.stringify(fromWorker).includes("Bericht"), false);
  assert.deepEqual(await unseal(privateKey, fromWorker as Parameters<typeof unseal>[1]), large);
  const fromApp = await seal(await importPublicKey(pair.publicJwk), entry);
  assert.deepEqual(await worker.unseal(privateKey, fromApp), entry);
});

test("Offline entsperren: privater Schlüssel mit dem Passwort verpackt, nur mit richtigem Passwort lesbar", async () => {
  const pair = offlineKeyPair("user-a", randomBytes(32))!;
  const wrapped = await wrapSecret(pair.privateJwk, "Richtig-Passwort-2026", 1000);
  assert.ok(isWrapped(wrapped));
  assert.equal(JSON.stringify(wrapped).includes(pair.privateJwk.d), false, "Schlüssel nicht im Klartext");
  assert.equal(await unwrapSecret(wrapped, "falsch"), null);
  assert.deepEqual(await unwrapSecret(wrapped, "Richtig-Passwort-2026"), pair.privateJwk);
  assert.equal(WRAP_ITERATIONS >= 600_000, true, "Standard nach OWASP für PBKDF2-SHA-256");
});
