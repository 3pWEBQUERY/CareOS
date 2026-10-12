import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePhotoDataUrl } from "../lib/resident-photo.ts";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const dataUrl = (type: string, bytes: Buffer) => `data:${type};base64,${bytes.toString("base64")}`;

test("Bild der Person: gültige Daten-URL, Typ, Grösse und Dateisignatur", () => {
  const ok = parsePhotoDataUrl(dataUrl("image/png", png));
  assert.ok(ok.ok);
  assert.equal(ok.ok && ok.mimeType, "image/png");

  assert.deepEqual(parsePhotoDataUrl(undefined), { ok: false, status: 400, error: "Bitte ein Bild auswählen." });
  assert.deepEqual(parsePhotoDataUrl(dataUrl("image/gif", png)), {
    ok: false,
    status: 400,
    error: "Erlaubt sind JPEG-, PNG- und WebP-Bilder.",
  });
  assert.deepEqual(parsePhotoDataUrl(dataUrl("image/jpeg", png)), {
    ok: false,
    status: 400,
    error: "Die Bilddatei ist ungültig.",
  });
  const tooLarge = Buffer.concat([png, Buffer.alloc(1024 * 1024)]);
  assert.deepEqual(parsePhotoDataUrl(dataUrl("image/png", tooLarge)), {
    ok: false,
    status: 413,
    error: "Das optimierte Bild darf höchstens 1 MB gross sein.",
  });
});
