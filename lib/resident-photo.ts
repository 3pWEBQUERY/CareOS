// Bild einer betreuten Person (Server): Prüfung der übermittelten Daten-URL. Gemeinsam für die Aufnahme und die
// Bild-Schnittstelle der Akte.

export const MAX_PHOTO_BYTES = 1024 * 1024;
export const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function hasValidImageSignature(bytes: Buffer, mimeType: string) {
  if (mimeType === "image/jpeg")
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png")
    return (
      bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    );
  if (mimeType === "image/webp")
    return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  return false;
}

// Daten-URL prüfen: JPEG, PNG oder WebP, höchstens 1 MB, gültige Dateisignatur.
export function parsePhotoDataUrl(
  value: unknown,
): { ok: true; mimeType: string; image: Buffer } | { ok: false; status: number; error: string } {
  if (typeof value !== "string") return { ok: false, status: 400, error: "Bitte ein Bild auswählen." };
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || !PHOTO_TYPES.has(match[1]))
    return { ok: false, status: 400, error: "Erlaubt sind JPEG-, PNG- und WebP-Bilder." };
  const image = Buffer.from(match[2], "base64");
  if (!image.length || image.length > MAX_PHOTO_BYTES)
    return { ok: false, status: 413, error: "Das optimierte Bild darf höchstens 1 MB gross sein." };
  if (!hasValidImageSignature(image, match[1])) return { ok: false, status: 400, error: "Die Bilddatei ist ungültig." };
  return { ok: true, mimeType: match[1], image };
}
