import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base32Decode,
  base32Encode,
  decryptSecret,
  encryptSecret,
  hashRecoveryCode,
  matchTotp,
  mfaKey,
  newRecoveryCodes,
  newTotpSecret,
  otpauthUri,
  totpCode,
  totpStep,
} from "@/lib/mfa-core";

// RFC 6238, Anhang B (SHA1, Geheimnis "12345678901234567890"), auf 6 Stellen gekürzt.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));
test("TOTP entspricht den Testvektoren aus RFC 6238", () => {
  const vectors: Array<[number, string]> = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ];
  for (const [seconds, expected] of vectors) assert.equal(totpCode(RFC_SECRET, totpStep(seconds * 1000)), expected);
  assert.equal(base32Decode(RFC_SECRET).toString(), "12345678901234567890");
});

test("TOTP: Uhrabweichung um einen Schritt, kein zweites Mal derselbe Code", () => {
  const secret = newTotpSecret();
  const now = 1_800_000_000_000;
  const step = totpStep(now);
  assert.equal(matchTotp(secret, totpCode(secret, step), now), step);
  assert.equal(matchTotp(secret, totpCode(secret, step - 1), now), step - 1);
  assert.equal(matchTotp(secret, totpCode(secret, step + 1), now), step + 1);
  assert.equal(matchTotp(secret, totpCode(secret, step - 2), now), null);
  assert.equal(matchTotp(secret, totpCode(secret, step), now, step), null, "bereits verwendet");
  assert.equal(matchTotp(secret, "12345", now), null);
  assert.equal(
    matchTotp(secret, `${totpCode(secret, step).slice(0, 3)} ${totpCode(secret, step).slice(3)}`, now),
    step,
  );
});

test("Geheimnis verschlüsselt, Schlüssel geprüft, Wiederherstellungscodes gehasht", () => {
  assert.equal(mfaKey(undefined), null);
  assert.equal(mfaKey("zu-kurz"), null);
  const key = mfaKey(Buffer.alloc(32, 7).toString("base64"))!;
  assert.equal(mfaKey("ab".repeat(32))?.length, 32);
  const secret = newTotpSecret();
  const encrypted = encryptSecret(secret, key);
  assert.ok(!encrypted.includes(secret));
  assert.equal(decryptSecret(encrypted, key), secret);
  assert.throws(() => decryptSecret(encrypted, mfaKey(Buffer.alloc(32, 8).toString("base64"))!));

  const codes = newRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  assert.match(codes[0], /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  assert.equal(hashRecoveryCode(codes[0].toLowerCase().replace("-", " ")), hashRecoveryCode(codes[0]));
  assert.match(
    otpauthUri(secret, "anna", "CareOS"),
    /^otpauth:\/\/totp\/CareOS%3Aanna\?secret=[A-Z2-7]+&issuer=CareOS/,
  );
});
