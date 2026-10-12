import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";

// Software-Authenticator für Tests: erzeugt echte ES256-Schlüssel und signierte Antworten wie ein Gerät.
// Flags: UP = Anwesenheit, UV = Bestätigung (Fingerabdruck/PIN), AT = neue Zugangsdaten.
const UP = 0x01;
const UV = 0x04;
const AT = 0x40;

const b64 = (bytes: Uint8Array) => isoBase64URL.fromBuffer(new Uint8Array(bytes));
const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest();
const counterBytes = (value: number) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
};

export type SoftCredential = { id: Buffer; privateKey: KeyObject; publicKey: KeyObject; counter: number };

function coseKey(publicKey: KeyObject) {
  const jwk = publicKey.export({ format: "jwk" });
  return isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, isoBase64URL.toBuffer(String(jwk.x))],
      [-3, isoBase64URL.toBuffer(String(jwk.y))],
    ]),
  );
}

const clientData = (type: string, challenge: string, origin: string) =>
  Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

export function createCredential(
  options: { rpID: string; origin: string; challenge: string },
  verified = true,
): { credential: SoftCredential; response: Record<string, unknown> } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const credential = { id: randomBytes(16), privateKey, publicKey, counter: 0 };
  const idLength = Buffer.alloc(2);
  idLength.writeUInt16BE(credential.id.length);
  const authData = Buffer.concat([
    sha256(options.rpID),
    Buffer.from([UP | (verified ? UV : 0) | AT]),
    counterBytes(0),
    Buffer.alloc(16),
    idLength,
    credential.id,
    Buffer.from(coseKey(publicKey)),
  ]);
  const attestationObject = isoCBOR.encode(
    new Map<string, string | Map<string, string> | Uint8Array>([
      ["fmt", "none"],
      ["attStmt", new Map<string, string>()],
      ["authData", new Uint8Array(authData)],
    ]),
  );
  const id = b64(credential.id);
  return {
    credential,
    response: {
      id,
      rawId: id,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64(clientData("webauthn.create", options.challenge, options.origin)),
        attestationObject: b64(attestationObject),
        transports: ["internal"],
      },
    },
  };
}

export function assertCredential(
  credential: SoftCredential,
  options: { rpID: string; origin: string; challenge: string },
  verified = true,
) {
  credential.counter += 1;
  const authData = Buffer.concat([
    sha256(options.rpID),
    Buffer.from([UP | (verified ? UV : 0)]),
    counterBytes(credential.counter),
  ]);
  const data = clientData("webauthn.get", options.challenge, options.origin);
  const signature = sign("sha256", Buffer.concat([authData, sha256(data)]), credential.privateKey);
  const id = b64(credential.id);
  return {
    id,
    rawId: id,
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: b64(data),
      authenticatorData: b64(authData),
      signature: b64(signature),
    },
  };
}
