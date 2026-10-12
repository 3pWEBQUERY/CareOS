// Verschlüsselung für den Service Worker (klassisches Skript, per importScripts geladen). Gleiches Verfahren wie
// lib/offline-crypto.ts: je Eintrag ein Einmal-Schlüsselpaar (ECDH P-256) mit dem öffentlichen Schlüssel der Person,
// HKDF-SHA-256, AES-256-GCM. Zum Lesen braucht es den privaten Schlüssel, den nur die geöffnete App im Arbeitsspeicher
// hält; der Service Worker bekommt ihn von dort und behält ihn ebenfalls nur im Arbeitsspeicher.
self.carecoreCrypto = (() => {
  const subtle = () => self.crypto.subtle;
  const ECDH = { name: "ECDH", namedCurve: "P-256" };
  const INFO = new TextEncoder().encode("carecore-offline-v1");
  const toBase64 = (bytes) => {
    let text = "";
    for (let index = 0; index < bytes.length; index += 0x8000)
      text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return btoa(text);
  };
  const fromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  const importPublicKey = (jwk) => subtle().importKey("jwk", jwk, ECDH, false, []);

  async function aesKey(privateKey, publicKey, usage) {
    const shared = await subtle().deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
    const material = await subtle().importKey("raw", shared, "HKDF", false, ["deriveKey"]);
    return subtle().deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: INFO },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      [usage],
    );
  }

  async function seal(publicKey, value) {
    const ephemeral = await subtle().generateKey(ECDH, true, ["deriveBits"]);
    const key = await aesKey(ephemeral.privateKey, publicKey, "encrypt");
    const iv = self.crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify(value));
    const data = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, key, plain));
    const epk = await subtle().exportKey("jwk", ephemeral.publicKey);
    return { v: 1, epk: { kty: epk.kty, crv: epk.crv, x: epk.x, y: epk.y }, iv: toBase64(iv), data: toBase64(data) };
  }

  async function unseal(privateKey, sealed) {
    const key = await aesKey(privateKey, await importPublicKey(sealed.epk), "decrypt");
    const plain = await subtle().decrypt({ name: "AES-GCM", iv: fromBase64(sealed.iv) }, key, fromBase64(sealed.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  return { seal, unseal, importPublicKey };
})();
