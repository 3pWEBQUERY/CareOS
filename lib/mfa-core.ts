import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

// Zwei-Faktor-Anmeldung: TOTP nach RFC 6238 (HMAC-SHA1, 30 s, 6 Stellen – das Format gängiger Authenticator-Apps),
// Verschlüsselung des Geheimnisses und Wiederherstellungscodes. Ohne Datenbank, damit es direkt testbar ist.

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
// Erlaubte Abweichung der Geräteuhr: ein Schritt davor oder danach.
export const TOTP_WINDOW = 1;
export const RECOVERY_CODE_COUNT = 10;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer: Buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string) {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("INVALID_BASE32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

export const totpStep = (at: number = Date.now()) => Math.floor(at / 1000 / TOTP_STEP_SECONDS);

export function totpCode(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

// Liefert den getroffenen Zeitschritt oder null. Schritte bis einschliesslich lastUsedStep gelten als verbraucht
// (derselbe Code kann nicht zweimal verwendet werden).
export function matchTotp(secret: string, code: string, at: number = Date.now(), lastUsedStep: number | null = null) {
  const clean = code.replace(/\s/g, "");
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(clean)) return null;
  const now = totpStep(at);
  for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset += 1) {
    const step = now + offset;
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (totpCode(secret, step) === clean) return step;
  }
  return null;
}

export function otpauthUri(secret: string, account: string, issuer: string) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

// Schlüssel aus CARECORE_MFA_KEY: 32 Bytes als Base64 oder 64 Hex-Zeichen. Ohne gültigen Schlüssel null.
export function mfaKey(raw: string | undefined = process.env.CARECORE_MFA_KEY) {
  if (!raw) return null;
  const value = raw.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  return key.length === 32 ? key : null;
}

export function encryptSecret(secret: string, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(encoded: string, key: Buffer) {
  const [version, iv, tag, data] = encoded.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("INVALID_SECRET");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

// Wiederherstellungscodes: 10 Zeichen (Gruppen zu 5), ohne verwechselbare Zeichen; gespeichert wird nur der Hash.
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(10);
    const chars = [...bytes].map((byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}
export const normalizeRecoveryCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const hashRecoveryCode = (code: string) =>
  createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
