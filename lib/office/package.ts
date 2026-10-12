import { createHash } from "node:crypto";
import { esc } from "./xml";

// Gemeinsame Teile der Office-Pakete (OPC): Inhaltstypen, Beziehungen, Dokumenteigenschaften, eingebettetes Modell.
export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
export const MODEL_PART = "carecore/model.json";

export const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

export function contentTypes(overrides: [string, string][], images: boolean) {
  return `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="json" ContentType="application/json"/>${
    images
      ? '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>'
      : ""
  }${overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join("")}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
}

export type Rel = { id: string; type: string; target: string; external?: boolean };
export const REL = {
  office: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
  core: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
  app: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",
  styles: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
  numbering: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering",
  settings: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings",
  header: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header",
  footer: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer",
  image: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
  hyperlink: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
  worksheet: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
  theme: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
  slide: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide",
  slideLayout: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout",
  slideMaster: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster",
  notesSlide: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide",
  notesMaster: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster",
  presProps: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps",
  viewProps: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps",
  tableStyles: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles",
  footnotes: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes",
  chart: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
  comments: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
  commentsExtended: "http://schemas.microsoft.com/office/2011/relationships/commentsExtended",
  commentAuthors: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors",
  package: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/package",
};

export const relationships = (rels: Rel[]) =>
  `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels
    .map(
      (rel) =>
        `<Relationship Id="${rel.id}" Type="${rel.type}" Target="${esc(rel.target)}"${rel.external ? ' TargetMode="External"' : ""}/>`,
    )
    .join("")}</Relationships>`;

export const rootRels = (main: string) =>
  relationships([
    { id: "rId1", type: REL.office, target: main },
    { id: "rId2", type: REL.core, target: "docProps/core.xml" },
    { id: "rId3", type: REL.app, target: "docProps/app.xml" },
  ]);

export function coreProps(title: string, author: string) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  return `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>${esc(author)}</dc:creator><cp:lastModifiedBy>${esc(author)}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}

export const appProps = () =>
  `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>CareOS</Application></Properties>`;

// Bild aus einer data:-Adresse (nur PNG, JPEG, GIF – diese kennen Word, Excel und PowerPoint).
export function dataImage(src: unknown) {
  if (typeof src !== "string") return null;
  const match = /^data:image\/(png|jpeg|gif);base64,([A-Za-z0-9+/=]+)$/.exec(src);
  if (!match) return null;
  const bytes = Buffer.from(match[2], "base64");
  const size = imageSize(bytes);
  if (!size) return null;
  return { extension: match[1], bytes, ...size };
}

// Pixelmasse aus dem Dateikopf (PNG, JPEG, GIF).
export function imageSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47)
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes.length > 10 && bytes.toString("ascii", 0, 3) === "GIF")
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1];
      const length = bytes.readUInt16BE(at + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) };
      at += 2 + length;
    }
  }
  return null;
}

export function mediaDataUrl(name: string, bytes: Buffer | undefined) {
  if (!bytes) return "";
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const type =
    extension === "png"
      ? "png"
      : extension === "jpg" || extension === "jpeg"
        ? "jpeg"
        : extension === "gif"
          ? "gif"
          : null;
  return type ? `data:image/${type};base64,${bytes.toString("base64")}` : "";
}

// Ziel einer Beziehung relativ zum Teil auflösen („../media/bild.png“ von „word/document.xml“).
export function resolvePart(base: string, target: string) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const piece of target.split("/")) {
    if (piece === "..") parts.pop();
    else if (piece !== ".") parts.push(piece);
  }
  return parts.join("/");
}

export const relsPathOf = (part: string) => {
  const slash = part.lastIndexOf("/");
  return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
};

// Eingebettetes Modell ohne doppelte Bilder: Bilder liegen ohnehin als Mediendatei im Paket und werden im Modell
// nur verknüpft („carecore-media:word/media/bild1.png“).
const MEDIA_PREFIX = "carecore-media:";

export function packModel(model: unknown, check: string, media: Map<string, string>) {
  return Buffer.from(
    JSON.stringify({ format: 1, check, model }, (_key, value) =>
      typeof value === "string" && media.has(value) ? `${MEDIA_PREFIX}${media.get(value)}` : value,
    ),
  );
}

export function unpackModel(json: Buffer, files: Map<string, Buffer>) {
  return JSON.parse(json.toString("utf8"), (_key, value) =>
    typeof value === "string" && value.startsWith(MEDIA_PREFIX)
      ? mediaDataUrl(value.slice(MEDIA_PREFIX.length), files.get(value.slice(MEDIA_PREFIX.length)))
      : value,
  ) as { check?: string; model?: unknown };
}
