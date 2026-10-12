import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

// ZIP-Archiv (PKZIP, Deflate) für den Download mehrerer Dateien oder ganzer Ordner aus der Ablage.
// Dateinamen in UTF-8 (Bit 11), Pfade mit „/“; Zeitstempel im DOS-Format (lokale Zeit genügt für Downloads).
export type ZipEntry = { path: string; content: Buffer; modified?: Date };

function dosTime(date: Date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

export function createZip(entries: ZipEntry[]) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path.replace(/^\/+/, ""), "utf8");
    const packed = deflateRawSync(entry.content);
    // Kleine oder bereits komprimierte Dateien (Bilder, PDF) werden durch Deflate nicht kleiner: dann unverändert.
    const stored = packed.length >= entry.content.length;
    const data = stored ? entry.content : packed;
    const checksum = crc32(entry.content) >>> 0;
    const { time, day } = dosTime(entry.modified ?? new Date());
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(entry.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(entry.content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

// Eindeutige Pfade im Archiv: gleiche Namen im selben Ordner erhalten „ (2)“, „ (3)“ … vor der Endung.
export function uniquePath(path: string, taken: Set<string>) {
  let candidate = path;
  for (let index = 2; taken.has(candidate.toLowerCase()); index += 1) {
    const dot = path.lastIndexOf(".");
    const slash = path.lastIndexOf("/");
    candidate = dot > slash + 1 ? `${path.slice(0, dot)} (${index})${path.slice(dot)}` : `${path} (${index})`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

// ZIP-Archiv lesen (Office-Dateien sind ZIP-Pakete): Einträge über das zentrale Verzeichnis, Deflate oder unverpackt.
// Begrenzt die entpackte Grösse, damit eine präparierte Datei den Server nicht überlastet.
export function readZip(buffer: Buffer, maxBytes = 64 * 1024 * 1024) {
  const entries = new Map<string, Buffer>();
  let end = -1;
  for (let at = buffer.length - 22; at >= Math.max(0, buffer.length - 22 - 65_535); at -= 1)
    if (buffer.readUInt32LE(at) === 0x06054b50) {
      end = at;
      break;
    }
  if (end < 0) throw new Error("Kein ZIP-Archiv.");
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error("ZIP-Verzeichnis beschädigt.");
    const method = buffer.readUInt16LE(at + 10);
    const packedSize = buffer.readUInt32LE(at + 20);
    const size = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const offset = buffer.readUInt32LE(at + 42);
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    total += size;
    if (total > maxBytes) throw new Error("ZIP-Archiv zu gross.");
    const localName = buffer.readUInt16LE(offset + 26);
    const localExtra = buffer.readUInt16LE(offset + 28);
    const start = offset + 30 + localName + localExtra;
    const data = buffer.subarray(start, start + packedSize);
    if (method === 0) entries.set(name, Buffer.from(data));
    else if (method === 8) entries.set(name, inflateRawSync(data, { maxOutputLength: Math.max(1, size) }));
  }
  return entries;
}
