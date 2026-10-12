import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { isBlockedAddress, signatureHeader, validateWebhookUrl } from "../lib/webhooks.ts";

test("Webhooks: interne Adressen gesperrt, auch IPv6 und verpacktes IPv4", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
  ])
    assert.equal(isBlockedAddress(address), true, address);
  for (const address of ["::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"])
    assert.equal(isBlockedAddress(address), true, address);
  for (const address of ["8.8.8.8", "185.199.108.153", "2606:4700::1111"])
    assert.equal(isBlockedAddress(address), false, address);
  assert.equal(isBlockedAddress("kein-ip"), true);
});

test("Webhooks: nur https, keine Zugangsdaten, keine internen Ziele", () => {
  assert.equal(validateWebhookUrl(" https://example.org/hook#x "), "https://example.org/hook");
  for (const url of [
    "http://example.org/hook",
    "https://user:pw@example.org/",
    "https://localhost/hook",
    "https://127.0.0.1/hook",
    "https://[::1]/hook",
    "https://169.254.169.254/latest",
    "https://intranet.local/",
    "ftp://example.org",
    "kein link",
  ])
    assert.throws(() => validateWebhookUrl(url), url);
});

test("Webhooks: Signatur ist HMAC-SHA256 über Zeit und Inhalt", () => {
  const body = '{"type":"ping"}';
  const expected = createHmac("sha256", "whsec_test").update(`1700000000.${body}`).digest("hex");
  assert.equal(signatureHeader("whsec_test", 1700000000, body), `t=1700000000,v1=${expected}`);
});
