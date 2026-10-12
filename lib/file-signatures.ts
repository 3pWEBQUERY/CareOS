// Dateitypen anhand der ersten Bytes erkennen: Der vom Browser gemeldete Typ lässt sich beliebig setzen, der Inhalt
// muss dazu passen (z. B. keine HTML-Seite als „PDF“).

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((value, index) => bytes[offset + index] === value);
const ascii = (bytes: Uint8Array, text: string, offset = 0) =>
  startsWith(
    bytes,
    [...text].map((char) => char.charCodeAt(0)),
    offset,
  );

export function detectImageType(bytes: Uint8Array) {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(bytes, "RIFF") && ascii(bytes, "WEBP", 8)) return "image/webp";
  return null;
}

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

// Reiner Text: gültiges UTF-8 ohne Steuerzeichen ausser Tab, Zeilenumbruch und Wagenrücklauf.
function isPlainText(bytes: Uint8Array) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text);
  } catch {
    return false;
  }
}

export function contentMatchesType(type: string, bytes: Uint8Array) {
  switch (type) {
    case "application/pdf":
      return ascii(bytes, "%PDF-");
    case "image/jpeg":
    case "image/png":
    case "image/webp":
      return detectImageType(bytes) === type;
    case "text/plain":
      return isPlainText(bytes);
    // Ältere Office-Formate (Compound File).
    case "application/msword":
    case "application/vnd.ms-excel":
    case "application/vnd.ms-powerpoint":
      return startsWith(bytes, OLE);
    // Office Open XML und OpenDocument sind ZIP-Archive.
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    case "application/vnd.oasis.opendocument.text":
    case "application/vnd.oasis.opendocument.spreadsheet":
      return startsWith(bytes, ZIP);
    default:
      return false;
  }
}
