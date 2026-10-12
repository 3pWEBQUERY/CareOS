import { createECDH, hkdfSync } from "node:crypto";
import { mfaKey } from "@/lib/mfa-core";

// Schlüsselpaar für die offline vorgemerkten Einträge einer Person, abgeleitet (HKDF) aus dem Serverschlüssel
// CARECORE_MFA_KEY – nirgends gespeichert. Der private Teil geht nur an eine angemeldete Sitzung dieser Person.
const b64url = (bytes: Buffer) => bytes.toString("base64url");

export function offlineKeyPair(userId: string, secret: Buffer | null = mfaKey()) {
  if (!secret) return null;
  // Sehr selten liegt ein abgeleiteter Wert ausserhalb der Kurvengruppe; dann den nächsten Zähler nehmen.
  for (let counter = 0; counter < 16; counter += 1) {
    const d = Buffer.from(hkdfSync("sha256", secret, "carecore-offline", `v1:${userId}:${counter}`, 32));
    const ecdh = createECDH("prime256v1");
    try {
      ecdh.setPrivateKey(d);
    } catch {
      continue;
    }
    const point = ecdh.getPublicKey();
    const publicJwk = { kty: "EC", crv: "P-256", x: b64url(point.subarray(1, 33)), y: b64url(point.subarray(33, 65)) };
    return { publicJwk, privateJwk: { ...publicJwk, d: b64url(d) } };
  }
  return null;
}
