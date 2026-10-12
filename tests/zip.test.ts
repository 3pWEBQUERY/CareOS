import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { createZip, uniquePath } from "../lib/zip.ts";

// Liest ein Archiv über das zentrale Verzeichnis wieder ein (wie ein Entpackprogramm).
function readZip(zip: Buffer) {
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let position = zip.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    assert.equal(zip.readUInt32LE(position), 0x02014b50);
    const method = zip.readUInt16LE(position + 10);
    const packedSize = zip.readUInt32LE(position + 20);
    const size = zip.readUInt32LE(position + 24);
    const nameLength = zip.readUInt16LE(position + 28);
    const local = zip.readUInt32LE(position + 42);
    const name = zip.subarray(position + 46, position + 46 + nameLength).toString("utf8");
    const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(dataStart, dataStart + packedSize);
    const content = method === 8 ? inflateRawSync(data) : Buffer.from(data);
    assert.equal(content.length, size);
    files.set(name, content);
    position += 46 + nameLength;
  }
  return files;
}

test("ZIP: Ordner und Umlaute bleiben erhalten, Text wird gepackt, Inhalt identisch", () => {
  const text = Buffer.from("Händehygiene vor und nach jedem Kontakt.\n".repeat(200));
  const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const zip = createZip([
    { path: "Pflege/Händehygiene.txt", content: text },
    { path: "Pflege/Bilder/logo.png", content: binary },
    { path: "leer.txt", content: Buffer.alloc(0) },
  ]);
  assert.ok(zip.length < text.length, "Text wird komprimiert");
  const files = readZip(zip);
  assert.deepEqual([...files.keys()], ["Pflege/Händehygiene.txt", "Pflege/Bilder/logo.png", "leer.txt"]);
  assert.deepEqual(files.get("Pflege/Händehygiene.txt"), text);
  assert.deepEqual(files.get("Pflege/Bilder/logo.png"), binary);
  assert.equal(files.get("leer.txt")?.length, 0);
});

test("ZIP: gleiche Namen im selben Ordner erhalten eine Nummer", () => {
  const taken = new Set<string>();
  assert.equal(uniquePath("Plan.pdf", taken), "Plan.pdf");
  assert.equal(uniquePath("plan.pdf", taken), "plan (2).pdf");
  assert.equal(uniquePath("Plan.pdf", taken), "Plan (3).pdf");
  assert.equal(uniquePath("Ordner/Notiz", taken), "Ordner/Notiz");
  assert.equal(uniquePath("Ordner/Notiz", taken), "Ordner/Notiz (2)");
});
