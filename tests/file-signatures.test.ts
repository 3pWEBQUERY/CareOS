import { test } from "node:test";
import assert from "node:assert/strict";
import { contentMatchesType, detectImageType } from "../lib/file-signatures.ts";

// Zahlen sind einzelne Bytes, Texte werden als UTF-8 kodiert.
const bytes = (...values: Array<number | string>) =>
  new Uint8Array(
    values.flatMap((value) => (typeof value === "string" ? [...new TextEncoder().encode(value)] : [value])),
  );

test("Dateiinhalt muss zum gemeldeten Typ passen", () => {
  assert.equal(contentMatchesType("application/pdf", bytes("%PDF-1.7\n")), true);
  assert.equal(contentMatchesType("application/pdf", bytes("<html><script>")), false, "HTML als PDF");
  assert.equal(detectImageType(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a)), "image/png");
  assert.equal(contentMatchesType("image/jpeg", bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a)), false);
  assert.equal(contentMatchesType("image/webp", bytes("RIFF", 0, 0, 0, 0, "WEBP")), true);
  assert.equal(contentMatchesType("text/plain", bytes("Übergabe\r\nZeile 2\t")), true);
  assert.equal(contentMatchesType("text/plain", bytes("MZ", 0, 0x90)), false, "Programmdatei");
  assert.equal(
    contentMatchesType("application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes("PK", 3, 4)),
    true,
  );
  assert.equal(contentMatchesType("application/msword", bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)), true);
  assert.equal(contentMatchesType("application/msword", bytes("PK", 3, 4)), false);
  assert.equal(contentMatchesType("image/svg+xml", bytes("<svg")), false, "unbekannter Typ");
});
