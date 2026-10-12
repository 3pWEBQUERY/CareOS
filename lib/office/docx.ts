import { createZip, readZip, type ZipEntry } from "@/lib/zip";
import {
  DEFAULT_PAGE,
  MARGINS_MM,
  cleanModel,
  emptyDoc,
  type DocMark,
  type DocNode,
  type DocumentModel,
  type PageSetup,
} from "./model";
import { initials, type CommentReply, type CommentThread } from "./comments";
import {
  MODEL_PART,
  REL,
  XML_HEAD,
  appProps,
  contentTypes,
  coreProps,
  dataImage,
  mediaDataUrl,
  packModel,
  relationships,
  resolvePart,
  rootRels,
  sha256,
  unpackModel,
  type Rel,
} from "./package";
import { child, childrenOf, esc, find, findAll, parseXml, textOf, type XmlNode } from "./xml";

// Word-Dokument (.docx) aus dem Dokument der Ablage schreiben und wieder lesen.

const W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const TWIPS_PER_MM = 56.6929;
const A4 = { width: 11906, height: 16838 };
const FONT = "Calibri";

const hex = (value: unknown) => {
  if (typeof value !== "string") return null;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short) return `${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  const long = /^#([0-9a-f]{6})$/i.exec(value);
  if (long) return long[1].toUpperCase();
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(value);
  if (rgb)
    return rgb
      .slice(1, 4)
      .map((part) => Number(part).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  return null;
};

// Schriftgrösse aus „14pt“ oder „18px“ in halben Punkten (so rechnet Word).
const halfPoints = (value: unknown) => {
  const match = typeof value === "string" ? /^([\d.]+)\s*(pt|px)$/.exec(value) : null;
  if (!match) return null;
  const points = match[2] === "px" ? Number(match[1]) * 0.75 : Number(match[1]);
  return Math.round(Math.min(144, Math.max(4, points)) * 2);
};

const ALIGN: Record<string, string> = { left: "left", center: "center", right: "right", justify: "both" };

type Writer = {
  rels: Rel[];
  media: ZipEntry[];
  mediaBySrc: Map<string, string>;
  nums: { id: number; start: number }[];
  drawings: number;
  contentWidth: number;
  footnotes: string[];
  headings: { level: number; text: string }[];
  // Kommentare: Nummer des Texts (in Lesereihenfolge), an dem ein Kommentarbereich beginnt bzw. endet.
  textIndex: number;
  commentStarts: Map<number, number[]>;
  commentEnds: Map<number, number[]>;
  // Änderungen nachverfolgen: laufende Nummer für <w:ins>/<w:del>.
  revisions: number;
};

function addRel(writer: Writer, type: string, target: string, external = false) {
  const id = `rId${writer.rels.length + 10}`;
  writer.rels.push({ id, type, target, external });
  return id;
}

function runProps(marks: DocMark[] | undefined, extra = "") {
  const has = (type: string) => marks?.find((mark) => mark.type === type);
  const style = has("textStyle")?.attrs ?? {};
  const parts: string[] = [];
  if (has("link")) parts.push('<w:rStyle w:val="Hyperlink"/>');
  if (typeof style.fontFamily === "string" && style.fontFamily) {
    const font = esc(style.fontFamily.split(",")[0].replace(/["']/g, "").trim());
    parts.push(`<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>`);
  }
  if (has("bold") || extra.includes("b")) parts.push("<w:b/>");
  if (has("italic")) parts.push("<w:i/>");
  if (has("strike")) parts.push("<w:strike/>");
  const color = hex(style.color);
  if (color) parts.push(`<w:color w:val="${color}"/>`);
  const size = halfPoints(style.fontSize);
  if (size) parts.push(`<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`);
  if (has("underline")) parts.push('<w:u w:val="single"/>');
  const fill =
    hex(has("highlight")?.attrs?.color ?? (has("highlight") ? "#fef08a" : null)) ?? hex(style.backgroundColor);
  if (fill) parts.push(`<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`);
  if (has("superscript")) parts.push('<w:vertAlign w:val="superscript"/>');
  else if (has("subscript")) parts.push('<w:vertAlign w:val="subscript"/>');
  return parts.length ? `<w:rPr>${parts.join("")}</w:rPr>` : "";
}

const textRun = (text: string, props: string, tag = "w:t") =>
  text
    .split("\t")
    .map(
      (piece, index) =>
        `${index ? `<w:r>${props}<w:tab/></w:r>` : ""}${piece ? `<w:r>${props}<${tag} xml:space="preserve">${esc(piece)}</${tag}></w:r>` : ""}`,
    )
    .join("");

// Nachverfolgte Änderung um einen Lauf legen (<w:ins> eingefügt, <w:del> gelöscht – wie in Word).
function revision(tag: "ins" | "del", mark: DocMark, content: string, writer: Writer) {
  writer.revisions += 1;
  const author = typeof mark.attrs?.author === "string" && mark.attrs.author ? mark.attrs.author : "CareOS";
  const date = typeof mark.attrs?.date === "string" ? wordDate(mark.attrs.date) : "";
  return `<w:${tag} w:id="${writer.revisions + 1000}" w:author="${esc(author)}"${date ? ` w:date="${date}"` : ""}>${content}</w:${tag}>`;
}

function inline(nodes: DocNode[] | undefined, writer: Writer, extra = "") {
  let out = "";
  for (const node of nodes ?? []) {
    if (node.type === "hardBreak") {
      out += "<w:r><w:br/></w:r>";
      continue;
    }
    if (node.type === "image") {
      out += image(node, writer);
      continue;
    }
    if (node.type === "footnote") {
      writer.footnotes.push(typeof node.attrs?.text === "string" ? node.attrs.text : "");
      out += `<w:r><w:rPr><w:rStyle w:val="Funotenzeichen"/></w:rPr><w:footnoteReference w:id="${writer.footnotes.length}"/></w:r>`;
      continue;
    }
    if (node.type !== "text" || !node.text) continue;
    const at = writer.textIndex++;
    const inserted = node.marks?.find((mark) => mark.type === "insertion");
    const deleted = node.marks?.find((mark) => mark.type === "deletion");
    let run = textRun(node.text, runProps(node.marks, extra), deleted ? "w:delText" : "w:t");
    if (deleted) run = revision("del", deleted, run, writer);
    if (inserted) run = revision("ins", inserted, run, writer);
    const link = node.marks?.find((mark) => mark.type === "link");
    const href = typeof link?.attrs?.href === "string" ? link.attrs.href : "";
    out += (writer.commentStarts.get(at) ?? []).map((id) => `<w:commentRangeStart w:id="${id}"/>`).join("");
    out += href
      ? `<w:hyperlink r:id="${addRel(writer, REL.hyperlink, href, true)}" w:history="1">${run}</w:hyperlink>`
      : run;
    out += (writer.commentEnds.get(at) ?? [])
      .map(
        (id) =>
          `<w:commentRangeEnd w:id="${id}"/><w:r><w:rPr><w:rStyle w:val="Kommentarzeichen"/></w:rPr><w:commentReference w:id="${id}"/></w:r>`,
      )
      .join("");
  }
  return out;
}

function image(node: DocNode, writer: Writer) {
  const picture = dataImage(node.attrs?.src);
  if (!picture) return "";
  writer.drawings += 1;
  const number = writer.drawings;
  const src = String(node.attrs?.src);
  let name = writer.mediaBySrc.get(src)?.replace("word/media/", "");
  if (!name) {
    name = `bild${number}.${picture.extension}`;
    writer.media.push({ path: `word/media/${name}`, content: picture.bytes });
    writer.mediaBySrc.set(src, `word/media/${name}`);
  }
  const rel = addRel(writer, REL.image, `media/${name}`);
  const wanted = typeof node.attrs?.width === "number" ? node.attrs.width : picture.width;
  // Pixel → EMU (96 dpi); nie breiter als der Satzspiegel.
  const maxWidth = (writer.contentWidth / 1440) * 914_400;
  let cx = Math.max(1, wanted) * 9525;
  let cy = (cx * picture.height) / Math.max(1, picture.width);
  if (cx > maxWidth) {
    cy = (cy * maxWidth) / cx;
    cx = maxWidth;
  }
  cx = Math.round(cx);
  cy = Math.round(cy);
  const alt = esc(typeof node.attrs?.alt === "string" ? node.attrs.alt : `Bild ${number}`);
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${number}" name="Bild ${number}" descr="${alt}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${number}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

// Zeilenabstand als Vielfaches („1.5“); Word rechnet in 240stel einer Zeile.
function lineSpacing(value: unknown) {
  const factor = typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(factor) && factor >= 0.5 && factor <= 5 ? factor : null;
}

// Reiner Text einer Überschrift fürs Inhaltsverzeichnis (ohne Fussnotenzahlen).
const plainText = (node: DocNode): string =>
  node.type === "text" ? (node.text ?? "") : (node.content ?? []).map(plainText).join("");

function collectHeadings(nodes: DocNode[] | undefined, out: { level: number; text: string }[]) {
  for (const node of nodes ?? []) {
    if (node.type === "heading")
      out.push({ level: Math.min(3, Math.max(1, Number(node.attrs?.level ?? 1))), text: plainText(node).trim() });
    else collectHeadings(node.content, out);
  }
  return out;
}

// Inhaltsverzeichnis als Word-Feld: Word zeigt die Einträge sofort und aktualisiert sie mit F9 (dann mit Seitenzahlen).
function tableOfContents(writer: Writer) {
  const begin = `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
  const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const title =
    '<w:p><w:pPr><w:pStyle w:val="Inhaltsverzeichnisberschrift"/></w:pPr><w:r><w:t>Inhaltsverzeichnis</w:t></w:r></w:p>';
  const entries = writer.headings.length ? writer.headings : [{ level: 1, text: "Keine Überschriften im Dokument." }];
  return (
    title +
    entries
      .map(
        (entry, index) =>
          `<w:p><w:pPr><w:pStyle w:val="Verzeichnis${entry.level}"/></w:pPr>${index === 0 ? begin : ""}<w:r><w:t xml:space="preserve">${esc(entry.text)}</w:t></w:r>${index === entries.length - 1 ? end : ""}</w:p>`,
      )
      .join("")
  );
}

function footnotesXml(notes: string[]) {
  const separator =
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>';
  return `${XML_HEAD}<w:footnotes ${W}>${separator}${notes
    .map(
      (text, index) =>
        `<w:footnote w:id="${index + 1}"><w:p><w:pPr><w:pStyle w:val="Funotentext"/></w:pPr><w:r><w:rPr><w:rStyle w:val="Funotenzeichen"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> ${esc(text)}</w:t></w:r></w:p></w:footnote>`,
    )
    .join("")}</w:footnotes>`;
}

// ---------- Kommentare ----------

const W14 = 'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"';
const W15 = 'xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"';
const paraId = (index: number) => (index + 1).toString(16).toUpperCase().padStart(8, "0");
const wordDate = (date: string) => (date ? `${date.slice(0, 19)}Z` : "");

// Wo jeder Kommentar im Text liegt: erster und letzter Text mit seiner Markierung (in Lesereihenfolge).
function commentPlaces(content: DocNode | undefined) {
  const places = new Map<string, { first: number; last: number }>();
  let index = 0;
  const walk = (node: DocNode) => {
    if (node.type === "text") {
      if (!node.text) return;
      const at = index++;
      for (const mark of node.marks ?? [])
        if (mark.type === "comment" && typeof mark.attrs?.id === "string") {
          const place = places.get(mark.attrs.id);
          if (place) place.last = at;
          else places.set(mark.attrs.id, { first: at, last: at });
        }
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  if (content) walk(content);
  return places;
}

// Nummern der Word-Kommentare: jeder Kommentar und jede Antwort eine eigene (Antworten am selben Textbereich).
function commentEntries(model: DocumentModel) {
  const places = commentPlaces(model.content);
  const entries: {
    id: number;
    parent: number | null;
    thread: CommentThread;
    entry: CommentReply;
    resolved: boolean;
  }[] = [];
  for (const thread of model.comments ?? []) {
    if (!places.has(thread.id)) continue;
    const head = entries.length;
    entries.push({ id: head, parent: null, thread, entry: thread, resolved: Boolean(thread.resolved) });
    for (const reply of thread.replies)
      entries.push({ id: entries.length, parent: head, thread, entry: reply, resolved: Boolean(thread.resolved) });
  }
  return { places, entries };
}

function commentsXml(entries: ReturnType<typeof commentEntries>["entries"]) {
  return `${XML_HEAD}<w:comments ${W} ${W14}>${entries
    .map(({ id, entry }) => {
      const lines = entry.text.split("\n");
      const paragraphs = lines
        .map(
          (line, index) =>
            `<w:p${index === lines.length - 1 ? ` w14:paraId="${paraId(id)}" w14:textId="77777777"` : ""}><w:pPr><w:pStyle w:val="Kommentartext"/></w:pPr>${index === 0 ? '<w:r><w:rPr><w:rStyle w:val="Kommentarzeichen"/></w:rPr><w:annotationRef/></w:r>' : ""}<w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`,
        )
        .join("");
      return `<w:comment w:id="${id}" w:author="${esc(entry.author)}"${entry.date ? ` w:date="${wordDate(entry.date)}"` : ""} w:initials="${esc(initials(entry.author))}">${paragraphs}</w:comment>`;
    })
    .join("")}</w:comments>`;
}

function commentsExtendedXml(entries: ReturnType<typeof commentEntries>["entries"]) {
  return `${XML_HEAD}<w15:commentsEx ${W15}>${entries
    .map(
      ({ id, parent, resolved }) =>
        `<w15:commentEx w15:paraId="${paraId(id)}"${parent === null ? "" : ` w15:paraIdParent="${paraId(parent)}"`} w15:done="${resolved ? 1 : 0}"/>`,
    )
    .join("")}</w15:commentsEx>`;
}

type ParagraphOptions = {
  style?: string;
  num?: { id: number; level: number };
  indent?: number;
  border?: boolean;
  extra?: string;
  prefix?: string;
};

function paragraph(node: DocNode, writer: Writer, options: ParagraphOptions = {}) {
  const props: string[] = [];
  if (options.style) props.push(`<w:pStyle w:val="${options.style}"/>`);
  if (options.num)
    props.push(`<w:numPr><w:ilvl w:val="${options.num.level}"/><w:numId w:val="${options.num.id}"/></w:numPr>`);
  if (options.border) props.push('<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="A0AEB0"/></w:pBdr>');
  const spacing = lineSpacing(node.attrs?.lineHeight);
  if (spacing) props.push(`<w:spacing w:line="${Math.round(spacing * 240)}" w:lineRule="auto"/>`);
  if (options.indent) props.push(`<w:ind w:left="${options.indent}"/>`);
  const align = ALIGN[String(node.attrs?.textAlign ?? "")];
  if (align && align !== "left") props.push(`<w:jc w:val="${align}"/>`);
  const prefix = options.prefix ? `<w:r><w:t xml:space="preserve">${esc(options.prefix)}</w:t></w:r>` : "";
  return `<w:p>${props.length ? `<w:pPr>${props.join("")}</w:pPr>` : ""}${prefix}${inline(node.content, writer, options.extra)}</w:p>`;
}

function blocks(
  nodes: DocNode[] | undefined,
  writer: Writer,
  context: { quote?: boolean; depth?: number } = {},
): string {
  let out = "";
  for (const node of nodes ?? []) out += block(node, writer, context);
  return out;
}

function listItems(node: DocNode, writer: Writer, depth: number, numId: number | null, task: boolean): string {
  let out = "";
  for (const item of node.content ?? []) {
    let first = true;
    for (const part of item.content ?? []) {
      if (part.type === "paragraph" || part.type === "heading") {
        const prefix = task && first ? (item.attrs?.checked ? "☒ " : "☐ ") : undefined;
        out += paragraph(part, writer, {
          style: "ListParagraph",
          num: first && numId !== null ? { id: numId, level: Math.min(8, depth) } : undefined,
          indent: first && numId !== null ? undefined : 720 * (depth + 1),
          prefix,
        });
        first = false;
      } else out += block(part, writer, { depth: depth + 1 });
    }
  }
  return out;
}

function table(node: DocNode, writer: Writer) {
  const rows = node.content ?? [];
  const columns = Math.max(
    1,
    ...rows.map((row) => (row.content ?? []).reduce((sum, cell) => sum + Number(cell.attrs?.colspan ?? 1), 0)),
  );
  const widths: number[] = Array.from({ length: columns }, () => Math.floor(writer.contentWidth / columns));
  const first = rows[0]?.content ?? [];
  let col = 0;
  for (const cell of first) {
    const span = Number(cell.attrs?.colspan ?? 1);
    const colwidth = Array.isArray(cell.attrs?.colwidth) ? (cell.attrs.colwidth as number[]) : [];
    for (let index = 0; index < span; index += 1)
      if (colwidth[index]) widths[col + index] = Math.round(colwidth[index] * 15);
    col += span;
  }
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total > writer.contentWidth)
    for (let index = 0; index < widths.length; index += 1)
      widths[index] = Math.floor((widths[index] * writer.contentWidth) / total);
  const pending = new Map<number, { remaining: number; span: number }>();
  let out = `<w:tbl><w:tblPr><w:tblStyle w:val="Tabellenraster"/><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>`;
  for (const row of rows) {
    const cells = [...(row.content ?? [])];
    const header = cells.length > 0 && cells.every((cell) => cell.type === "tableHeader");
    out += `<w:tr>${header ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}`;
    let position = 0;
    while (position < columns) {
      const merged = pending.get(position);
      if (merged && merged.remaining > 0) {
        merged.remaining -= 1;
        const width = widths.slice(position, position + merged.span).reduce((a, b) => a + b, 0);
        out += `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${merged.span > 1 ? `<w:gridSpan w:val="${merged.span}"/>` : ""}<w:vMerge/></w:tcPr><w:p/></w:tc>`;
        position += merged.span;
        continue;
      }
      const cell = cells.shift();
      if (!cell) {
        out += `<w:tc><w:tcPr><w:tcW w:w="${widths[position]}" w:type="dxa"/></w:tcPr><w:p/></w:tc>`;
        position += 1;
        continue;
      }
      const span = Math.max(1, Math.min(columns - position, Number(cell.attrs?.colspan ?? 1)));
      const rowspan = Math.max(1, Number(cell.attrs?.rowspan ?? 1));
      if (rowspan > 1) pending.set(position, { remaining: rowspan - 1, span });
      const width = widths.slice(position, position + span).reduce((a, b) => a + b, 0);
      const fill = hex(cell.attrs?.backgroundColor) ?? (cell.type === "tableHeader" ? "EAF1FF" : null);
      const content = (cell.content ?? []).length
        ? (cell.content ?? [])
            .map((part) =>
              part.type === "paragraph" || part.type === "heading"
                ? paragraph(part, writer, { extra: cell.type === "tableHeader" ? "b" : "" })
                : block(part, writer, {}),
            )
            .join("")
        : "<w:p/>";
      out += `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ""}${rowspan > 1 ? '<w:vMerge w:val="restart"/>' : ""}${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ""}</w:tcPr>${content.endsWith("</w:p>") ? content : `${content}<w:p/>`}</w:tc>`;
      position += span;
    }
    out += "</w:tr>";
  }
  // Word verlangt nach einer Tabelle am Zellende einen Absatz – im Fliesstext genügt die Tabelle selbst.
  return `${out}</w:tbl>`;
}

function block(node: DocNode, writer: Writer, context: { quote?: boolean; depth?: number }): string {
  const depth = context.depth ?? 0;
  switch (node.type) {
    case "paragraph":
      return paragraph(node, writer, { style: context.quote ? "Zitat" : undefined });
    case "heading": {
      const level = Math.min(3, Math.max(1, Number(node.attrs?.level ?? 1)));
      return paragraph(node, writer, { style: `berschrift${level}` });
    }
    case "blockquote":
      return blocks(node.content, writer, { ...context, quote: true });
    case "bulletList":
      return listItems(node, writer, depth, 1, false);
    case "orderedList": {
      const id = 2 + writer.nums.length;
      writer.nums.push({ id, start: Math.max(1, Number(node.attrs?.start ?? 1)) });
      return listItems(node, writer, depth, id, false);
    }
    case "taskList":
      return listItems(node, writer, depth, null, true);
    case "table":
      return table(node, writer);
    case "horizontalRule":
      return paragraph({ type: "paragraph" }, writer, { border: true });
    case "pageBreak":
      return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    case "tableOfContents":
      return tableOfContents(writer);
    case "image":
      return `<w:p>${image(node, writer)}</w:p>`;
    default:
      return "";
  }
}

function pageSize(page: PageSetup) {
  const landscape = page.orientation === "landscape";
  const width = landscape ? A4.height : A4.width;
  const height = landscape ? A4.width : A4.height;
  const margin = Math.round(MARGINS_MM[page.margins] * TWIPS_PER_MM);
  return { width, height, margin, contentWidth: width - 2 * margin, landscape };
}

const STYLES = `${XML_HEAD}<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${FONT}"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="de-CH"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Standard"><w:name w:val="Normal"/><w:qFormat/></w:style>${[
  [1, 36, "1D4ED8", 360],
  [2, 28, "102A43", 280],
  [3, 24, "102A43", 200],
]
  .map(
    ([level, size, color, before]) =>
      `<w:style w:type="paragraph" w:styleId="berschrift${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Standard"/><w:next w:val="Standard"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="120"/><w:outlineLvl w:val="${Number(level) - 1}"/></w:pPr><w:rPr><w:b/><w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`,
  )
  .join(
    "",
  )}<w:style w:type="paragraph" w:styleId="Zitat"><w:name w:val="Quote"/><w:basedOn w:val="Standard"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="2563EB"/></w:pBdr><w:ind w:left="360"/></w:pPr><w:rPr><w:i/><w:color w:val="5B6B6D"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Standard"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:contextualSpacing/></w:pPr></w:style><w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="2563EB"/><w:u w:val="single"/></w:rPr></w:style><w:style w:type="table" w:styleId="Tabellenraster"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="BFC9CA"/><w:left w:val="single" w:sz="4" w:space="0" w:color="BFC9CA"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="BFC9CA"/><w:right w:val="single" w:sz="4" w:space="0" w:color="BFC9CA"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="BFC9CA"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="BFC9CA"/></w:tblBorders><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style><w:style w:type="paragraph" w:styleId="Inhaltsverzeichnisberschrift"><w:name w:val="TOC Heading"/><w:basedOn w:val="berschrift1"/><w:next w:val="Standard"/><w:qFormat/><w:pPr><w:outlineLvl w:val="9"/></w:pPr></w:style>${[
  1, 2, 3,
]
  .map(
    (level) =>
      `<w:style w:type="paragraph" w:styleId="Verzeichnis${level}"><w:name w:val="toc ${level}"/><w:basedOn w:val="Standard"/><w:next w:val="Standard"/><w:pPr><w:spacing w:after="60"/><w:ind w:left="${(level - 1) * 220}"/></w:pPr></w:style>`,
  )
  .join(
    "",
  )}<w:style w:type="paragraph" w:styleId="Kommentartext"><w:name w:val="annotation text"/><w:basedOn w:val="Standard"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style><w:style w:type="character" w:styleId="Kommentarzeichen"><w:name w:val="annotation reference"/><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Funotentext"><w:name w:val="footnote text"/><w:basedOn w:val="Standard"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style><w:style w:type="character" w:styleId="Funotenzeichen"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Kopfzeile"><w:name w:val="header"/><w:basedOn w:val="Standard"/><w:rPr><w:color w:val="5B6B6D"/><w:sz w:val="18"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Fusszeile"><w:name w:val="footer"/><w:basedOn w:val="Standard"/><w:rPr><w:color w:val="5B6B6D"/><w:sz w:val="18"/></w:rPr></w:style></w:styles>`;

const BULLETS = ["•", "◦", "▪"];
function numbering(nums: { id: number; start: number }[]) {
  const levels = (ordered: boolean) =>
    Array.from({ length: 9 }, (_, level) => {
      const format = ordered ? (["decimal", "lowerLetter", "lowerRoman"][level % 3] as string) : "bullet";
      const text = ordered ? `%${level + 1}.` : BULLETS[level % 3];
      return `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (level + 1)}" w:hanging="360"/></w:pPr>${ordered ? "" : `<w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}"/></w:rPr>`}</w:lvl>`;
    }).join("");
  return `${XML_HEAD}<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${levels(false)}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${levels(true)}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>${nums
    .map(
      (num) =>
        `<w:num w:numId="${num.id}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="${num.start}"/></w:lvlOverride></w:num>`,
    )
    .join("")}</w:numbering>`;
}

const settingsXml = (track: boolean) =>
  `${XML_HEAD}<w:settings ${W}>${track ? "<w:trackRevisions/>" : ""}<w:defaultTabStop w:val="708"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

function headerFooter(tag: "hdr" | "ftr", text: string, pageNumbers: boolean) {
  const style = tag === "hdr" ? "Kopfzeile" : "Fusszeile";
  const field = (instr: string) =>
    `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const numbers = pageNumbers
    ? `<w:r><w:t xml:space="preserve">${text ? "   ·   " : ""}Seite </w:t></w:r>${field("PAGE")}<w:r><w:t xml:space="preserve"> von </w:t></w:r>${field("NUMPAGES")}`
    : "";
  return `${XML_HEAD}<w:${tag} ${W}><w:p><w:pPr><w:pStyle w:val="${style}"/><w:jc w:val="${tag === "hdr" ? "right" : "center"}"/></w:pPr>${text ? `<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r>` : ""}${numbers}</w:p></w:${tag}>`;
}

export function buildDocx(model: DocumentModel, meta: { title: string; author: string }) {
  const page = pageSize(model.page);
  const writer: Writer = {
    rels: [],
    media: [],
    mediaBySrc: new Map(),
    nums: [],
    drawings: 0,
    contentWidth: page.contentWidth,
    footnotes: [],
    headings: collectHeadings(model.content.content, []),
    textIndex: 0,
    commentStarts: new Map(),
    commentEnds: new Map(),
    revisions: 0,
  };
  const comments = commentEntries(model);
  for (const { id, thread } of comments.entries) {
    const place = comments.places.get(thread.id)!;
    writer.commentStarts.set(place.first, [...(writer.commentStarts.get(place.first) ?? []), id]);
    writer.commentEnds.set(place.last, [...(writer.commentEnds.get(place.last) ?? []), id]);
  }
  const body = blocks(model.content.content, writer) || "<w:p/>";
  const withHeader = Boolean(model.page.header);
  const withFooter = Boolean(model.page.footer) || model.page.pageNumbers;
  const references = `${withHeader ? '<w:headerReference w:type="default" r:id="rId4"/>' : ""}${withFooter ? '<w:footerReference w:type="default" r:id="rId5"/>' : ""}`;
  const document = `${XML_HEAD}<w:document ${W}><w:body>${body}<w:sectPr>${references}<w:pgSz w:w="${page.width}" w:h="${page.height}"${page.landscape ? ' w:orient="landscape"' : ""}/><w:pgMar w:top="${page.margin}" w:right="${page.margin}" w:bottom="${page.margin}" w:left="${page.margin}" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const rels: Rel[] = [
    { id: "rId1", type: REL.styles, target: "styles.xml" },
    { id: "rId2", type: REL.numbering, target: "numbering.xml" },
    { id: "rId3", type: REL.settings, target: "settings.xml" },
    ...(withHeader ? [{ id: "rId4", type: REL.header, target: "header1.xml" }] : []),
    ...(withFooter ? [{ id: "rId5", type: REL.footer, target: "footer1.xml" }] : []),
    ...(writer.footnotes.length ? [{ id: "rId6", type: REL.footnotes, target: "footnotes.xml" }] : []),
    ...(comments.entries.length
      ? [
          { id: "rId7", type: REL.comments, target: "comments.xml" },
          { id: "rId8", type: REL.commentsExtended, target: "commentsExtended.xml" },
        ]
      : []),
    ...writer.rels,
  ];
  const main = "application/vnd.openxmlformats-officedocument.wordprocessingml";
  const overrides: [string, string][] = [
    ["/word/document.xml", `${main}.document.main+xml`],
    ["/word/styles.xml", `${main}.styles+xml`],
    ["/word/numbering.xml", `${main}.numbering+xml`],
    ["/word/settings.xml", `${main}.settings+xml`],
    ...(withHeader ? ([["/word/header1.xml", `${main}.header+xml`]] as [string, string][]) : []),
    ...(withFooter ? ([["/word/footer1.xml", `${main}.footer+xml`]] as [string, string][]) : []),
    ...(writer.footnotes.length ? ([["/word/footnotes.xml", `${main}.footnotes+xml`]] as [string, string][]) : []),
    ...(comments.entries.length
      ? ([
          ["/word/comments.xml", `${main}.comments+xml`],
          ["/word/commentsExtended.xml", `${main}.commentsExtended+xml`],
        ] as [string, string][])
      : []),
  ];
  const entries: ZipEntry[] = [
    { path: "[Content_Types].xml", content: Buffer.from(contentTypes(overrides, writer.media.length > 0)) },
    { path: "_rels/.rels", content: Buffer.from(rootRels("word/document.xml")) },
    { path: "docProps/core.xml", content: Buffer.from(coreProps(meta.title, meta.author)) },
    { path: "docProps/app.xml", content: Buffer.from(appProps()) },
    { path: "word/document.xml", content: Buffer.from(document) },
    { path: "word/_rels/document.xml.rels", content: Buffer.from(relationships(rels)) },
    { path: "word/styles.xml", content: Buffer.from(STYLES) },
    { path: "word/numbering.xml", content: Buffer.from(numbering(writer.nums)) },
    { path: "word/settings.xml", content: Buffer.from(settingsXml(Boolean(model.track))) },
    ...(withHeader
      ? [{ path: "word/header1.xml", content: Buffer.from(headerFooter("hdr", model.page.header, false)) }]
      : []),
    ...(withFooter
      ? [
          {
            path: "word/footer1.xml",
            content: Buffer.from(headerFooter("ftr", model.page.footer, model.page.pageNumbers)),
          },
        ]
      : []),
    ...(writer.footnotes.length
      ? [{ path: "word/footnotes.xml", content: Buffer.from(footnotesXml(writer.footnotes)) }]
      : []),
    ...(comments.entries.length
      ? [
          { path: "word/comments.xml", content: Buffer.from(commentsXml(comments.entries)) },
          { path: "word/commentsExtended.xml", content: Buffer.from(commentsExtendedXml(comments.entries)) },
        ]
      : []),
    ...writer.media,
    { path: MODEL_PART, content: packModel(model, sha256(document), writer.mediaBySrc) },
  ];
  return createZip(entries);
}

// ---------- Lesen ----------

type Reader = {
  files: Map<string, Buffer>;
  rels: Map<string, string>;
  styles: Map<string, string>;
  numFormats: Map<string, Map<number, string>>;
  footnotes: Map<string, string>;
  // Kommentare: Word-Nummer → Kommentar im Modell, offene Bereiche beim Lesen.
  commentMarks: Map<string, string>;
  openComments: Set<string>;
};

function readRels(files: Map<string, Buffer>, part: string) {
  const map = new Map<string, string>();
  const slash = part.lastIndexOf("/");
  const source = files.get(`${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`);
  if (!source) return map;
  for (const rel of findAll(parseXml(source.toString("utf8")), "Relationship"))
    map.set(rel.attrs.Id, rel.attrs.TargetMode === "External" ? rel.attrs.Target : resolvePart(part, rel.attrs.Target));
  return map;
}

function readMarks(props: XmlNode | undefined): DocMark[] {
  if (!props) return [];
  const on = (name: string) => {
    const node = child(props, name);
    return Boolean(node) && node?.attrs.val !== "0" && node?.attrs.val !== "false" && node?.attrs.val !== "none";
  };
  const marks: DocMark[] = [];
  if (on("b")) marks.push({ type: "bold" });
  if (on("i")) marks.push({ type: "italic" });
  if (on("u")) marks.push({ type: "underline" });
  if (on("strike")) marks.push({ type: "strike" });
  const vert = child(props, "vertAlign")?.attrs.val;
  if (vert === "superscript") marks.push({ type: "superscript" });
  if (vert === "subscript") marks.push({ type: "subscript" });
  const attrs: Record<string, unknown> = {};
  const color = child(props, "color")?.attrs.val;
  if (color && /^[0-9a-f]{6}$/i.test(color) && color.toUpperCase() !== "000000")
    attrs.color = `#${color.toLowerCase()}`;
  const size = Number(child(props, "sz")?.attrs.val);
  if (size && size !== 22) attrs.fontSize = `${size / 2}pt`;
  if (Object.keys(attrs).length) marks.push({ type: "textStyle", attrs });
  const fill = child(props, "shd")?.attrs.fill;
  const highlight = child(props, "highlight")?.attrs.val;
  const named: Record<string, string> = {
    yellow: "#fef08a",
    green: "#bbf7d0",
    cyan: "#a5f3fc",
    magenta: "#f5d0fe",
    red: "#fecaca",
    lightGray: "#e5e7eb",
  };
  if (fill && /^[0-9a-f]{6}$/i.test(fill) && fill.toUpperCase() !== "FFFFFF")
    marks.push({ type: "highlight", attrs: { color: `#${fill.toLowerCase()}` } });
  else if (highlight && named[highlight]) marks.push({ type: "highlight", attrs: { color: named[highlight] } });
  return marks;
}

function readRuns(node: XmlNode, reader: Reader, link?: string, changes: DocMark[] = []): DocNode[] {
  const out: DocNode[] = [];
  for (const item of node.children) {
    if (item.name === "hyperlink") {
      const target = item.attrs.id ? reader.rels.get(item.attrs.id) : undefined;
      out.push(...readRuns(item, reader, target && /^(https?:|mailto:)/.test(target) ? target : undefined, changes));
      continue;
    }
    // Nachverfolgte Änderungen aus Word bleiben Änderungen (verschobener Text: alte Stelle gelöscht, neue eingefügt).
    if (item.name === "ins" || item.name === "del" || item.name === "moveTo" || item.name === "moveFrom") {
      const type = item.name === "ins" || item.name === "moveTo" ? "insertion" : "deletion";
      const mark: DocMark = { type, attrs: { author: item.attrs.author ?? "", date: item.attrs.date ?? "" } };
      out.push(...readRuns(item, reader, link, [...changes.filter((entry) => entry.type !== type), mark]));
      continue;
    }
    if (item.name === "smartTag" || item.name === "sdt" || item.name === "sdtContent") {
      out.push(...readRuns(item, reader, link, changes));
      continue;
    }
    if (item.name === "commentRangeStart" || item.name === "commentRangeEnd") {
      const thread = reader.commentMarks.get(item.attrs.id ?? "");
      if (thread && item.name === "commentRangeStart") reader.openComments.add(thread);
      else if (thread) reader.openComments.delete(thread);
      continue;
    }
    if (item.name !== "r") continue;
    const marks = readMarks(child(item, "rPr"));
    for (const thread of reader.openComments) marks.push({ type: "comment", attrs: { id: thread } });
    if (link) marks.push({ type: "link", attrs: { href: link } });
    marks.push(...changes);
    for (const part of item.children) {
      if (part.name === "t" || part.name === "delText") {
        const text = textOf(part);
        if (text) out.push({ type: "text", text, ...(marks.length ? { marks } : {}) });
      } else if (part.name === "tab") out.push({ type: "text", text: "\t", ...(marks.length ? { marks } : {}) });
      else if (part.name === "br" && part.attrs.type !== "page") out.push({ type: "hardBreak" });
      else if (part.name === "footnoteReference")
        out.push({ type: "footnote", attrs: { text: reader.footnotes.get(part.attrs.id) ?? "" } });
      else if (part.name === "drawing") {
        const blip = find(part, "blip");
        const target = blip?.attrs.embed ? reader.rels.get(blip.attrs.embed) : undefined;
        const src = target ? mediaDataUrl(target, reader.files.get(target)) : "";
        const extent = find(part, "extent");
        if (src)
          out.push({
            type: "image",
            attrs: { src, ...(extent ? { width: Math.round(Number(extent.attrs.cx) / 9525) } : {}) },
          });
      }
    }
  }
  // Benachbarte Texte mit gleicher Formatierung zusammenfassen.
  return out.reduce<DocNode[]>((list, node) => {
    const last = list[list.length - 1];
    if (
      last?.type === "text" &&
      node.type === "text" &&
      JSON.stringify(last.marks ?? []) === JSON.stringify(node.marks ?? [])
    ) {
      last.text = `${last.text}${node.text}`;
      return list;
    }
    list.push(node);
    return list;
  }, []);
}

type ReadParagraph = { node: DocNode; list?: { ordered: boolean; level: number; numId: string }; pageBreak: boolean };

function readParagraph(p: XmlNode, reader: Reader): ReadParagraph {
  const props = child(p, "pPr");
  const styleName = (reader.styles.get(child(props, "pStyle")?.attrs.val ?? "") ?? "").toLowerCase();
  const align = child(props, "jc")?.attrs.val;
  const attrs: Record<string, unknown> = {};
  if (align === "center" || align === "right") attrs.textAlign = align;
  if (align === "both" || align === "distribute") attrs.textAlign = "justify";
  const spacing = child(props, "spacing");
  const rule = spacing?.attrs.lineRule ?? "auto";
  const factor = Math.round((Number(spacing?.attrs.line) / 240) * 100) / 100;
  if (rule === "auto" && factor >= 0.5 && factor <= 5 && factor !== 1.15) attrs.lineHeight = String(factor);
  const content = readRuns(p, reader);
  const pageBreak = findAll(p, "br").some((br) => br.attrs.type === "page");
  const heading = /^(heading|überschrift) (\d)$/.exec(styleName);
  let node: DocNode;
  if (heading || styleName === "title")
    node = { type: "heading", attrs: { ...attrs, level: heading ? Math.min(3, Number(heading[2])) : 1 } };
  else node = { type: "paragraph", ...(Object.keys(attrs).length ? { attrs } : {}) };
  if (content.length) node.content = content;
  const numPr = child(props, "numPr");
  const numId = child(numPr, "numId")?.attrs.val;
  if (numId && numId !== "0") {
    const level = Number(child(numPr, "ilvl")?.attrs.val ?? 0);
    const format = reader.numFormats.get(numId)?.get(level) ?? "bullet";
    return { node, list: { ordered: format !== "bullet" && format !== "none", level, numId }, pageBreak };
  }
  if (styleName === "quote" || styleName === "intense quote")
    return { node: { type: "blockquote", content: [node] }, pageBreak };
  return { node, pageBreak };
}

function readTable(tbl: XmlNode, reader: Reader): DocNode {
  const rows: DocNode[] = [];
  const origins: (DocNode | null)[][] = [];
  childrenOf(tbl, "tr").forEach((tr, rowIndex) => {
    const header = Boolean(child(child(tr, "trPr"), "tblHeader"));
    const cells: DocNode[] = [];
    origins[rowIndex] = [];
    let col = 0;
    for (const tc of childrenOf(tr, "tc")) {
      const props = child(tc, "tcPr");
      const span = Number(child(props, "gridSpan")?.attrs.val ?? 1);
      const vMerge = child(props, "vMerge");
      if (vMerge && vMerge.attrs.val !== "restart") {
        // Fortsetzung einer verbundenen Zelle: die Zelle darüber wird höher.
        for (let up = rowIndex - 1; up >= 0; up -= 1) {
          const origin = origins[up]?.[col];
          if (origin) {
            origin.attrs = { ...origin.attrs, rowspan: Number(origin.attrs?.rowspan ?? 1) + 1 };
            break;
          }
        }
        col += span;
        continue;
      }
      const content = readBody(tc, reader);
      const fill = child(props, "shd")?.attrs.fill;
      const cell: DocNode = {
        type: header ? "tableHeader" : "tableCell",
        attrs: {
          colspan: span,
          rowspan: 1,
          ...(fill && /^[0-9a-f]{6}$/i.test(fill) && fill.toUpperCase() !== "FFFFFF"
            ? { backgroundColor: `#${fill.toLowerCase()}` }
            : {}),
        },
        content: content.length ? content : [{ type: "paragraph" }],
      };
      origins[rowIndex][col] = cell;
      cells.push(cell);
      col += span;
    }
    if (cells.length) rows.push({ type: "tableRow", content: cells });
  });
  return { type: "table", content: rows };
}

const paragraphStyle = (p: XmlNode, reader: Reader) =>
  (reader.styles.get(child(child(p, "pPr"), "pStyle")?.attrs.val ?? "") ?? "").toLowerCase();

// Felder öffnen (begin) und schliessen (end) sich auch über mehrere Absätze.
const fieldBalance = (p: XmlNode) =>
  findAll(p, "fldChar").reduce(
    (sum, field) => sum + (field.attrs.fldCharType === "begin" ? 1 : field.attrs.fldCharType === "end" ? -1 : 0),
    0,
  );
const isTocField = (p: XmlNode) =>
  findAll(p, "instrText").some((instr) => /^\s*TOC\b/i.test(textOf(instr))) ||
  findAll(p, "fldSimple").some((field) => /^\s*TOC\b/i.test(field.attrs.instr ?? ""));

function readBody(parent: XmlNode, reader: Reader): DocNode[] {
  const out: DocNode[] = [];
  // Offene Listen je Ebene (verschachtelt wie im Dokument).
  let stack: { node: DocNode; level: number; ordered: boolean; numId: string }[] = [];
  const closeLists = () => {
    stack = [];
  };
  // Offenes Inhaltsverzeichnis-Feld: seine Einträge erzeugt der Editor selbst neu.
  let tocDepth = 0;
  for (const item of parent.children) {
    if (item.name === "p" && tocDepth > 0) {
      tocDepth += fieldBalance(item);
      continue;
    }
    if (item.name === "p" && isTocField(item)) {
      closeLists();
      out.push({ type: "tableOfContents" });
      tocDepth = Math.max(0, fieldBalance(item));
      continue;
    }
    if (item.name === "p" && /^(toc heading|inhaltsverzeichnisüberschrift)$/.test(paragraphStyle(item, reader)))
      continue;
    if (item.name === "sdt") {
      out.push(...readBody(child(item, "sdtContent") ?? item, reader));
      continue;
    }
    if (item.name === "tbl") {
      closeLists();
      out.push(readTable(item, reader));
      continue;
    }
    if (item.name !== "p") continue;
    const read = readParagraph(item, reader);
    if (!read.list) {
      closeLists();
      // Absätze, die nur ein Bild enthalten, werden zu einem Bildblock.
      if (read.node.content?.length === 1 && read.node.content[0].type === "image") out.push(read.node.content[0]);
      else if (!(read.pageBreak && !read.node.content?.length)) out.push(read.node);
      if (read.pageBreak) out.push({ type: "pageBreak" });
      continue;
    }
    const { level, ordered, numId } = read.list;
    while (stack.length && stack[stack.length - 1].level > level) stack.pop();
    let top = stack[stack.length - 1];
    if (top && top.level === level && (top.ordered !== ordered || top.numId !== numId)) {
      stack.pop();
      top = stack[stack.length - 1];
    }
    if (!top || top.level < level) {
      const list: DocNode = {
        type: ordered ? "orderedList" : "bulletList",
        content: [],
        ...(ordered ? { attrs: { start: 1 } } : {}),
      };
      if (top) {
        const parentItem = top.node.content?.[top.node.content.length - 1];
        if (parentItem) parentItem.content = [...(parentItem.content ?? []), list];
        else out.push(list);
      } else out.push(list);
      stack.push({ node: list, level, ordered, numId });
      top = stack[stack.length - 1];
    }
    const paragraphNode =
      read.node.type === "heading" ? { ...read.node, type: "paragraph", attrs: undefined } : read.node;
    top.node.content = [...(top.node.content ?? []), { type: "listItem", content: [paragraphNode] }];
  }
  return out;
}

// Kommentare aus comments.xml; Antworten und „erledigt“ aus commentsExtended.xml (neuere Word-Versionen).
function readComments(files: Map<string, Buffer>, relsXml: Buffer | undefined) {
  const marks = new Map<string, string>();
  const relations = relsXml ? findAll(parseXml(relsXml.toString("utf8")), "Relationship") : [];
  const part = (type: string) => {
    const rel = relations.find((item) => item.attrs.Type === type);
    return rel ? files.get(resolvePart("word/document.xml", rel.attrs.Target)) : undefined;
  };
  const xml = part(REL.comments);
  if (!xml) return { marks, threads: [] as CommentThread[] };
  const extended = new Map<string, { parent?: string; done: boolean }>();
  const extendedXml = part(REL.commentsExtended);
  if (extendedXml)
    for (const entry of findAll(parseXml(extendedXml.toString("utf8")), "commentEx"))
      extended.set(entry.attrs.paraId ?? "", { parent: entry.attrs.paraIdParent, done: entry.attrs.done === "1" });
  const byPara = new Map<string, CommentThread>();
  const threads: CommentThread[] = [];
  for (const comment of findAll(parseXml(xml.toString("utf8")), "comment")) {
    const paragraphs = childrenOf(comment, "p");
    const text = paragraphs
      .map((p) =>
        findAll(p, "t")
          .map((t) => textOf(t))
          .join(""),
      )
      .join("\n")
      .trim();
    const id = `w${comment.attrs.id}`;
    if (!text || !/^w\d{1,9}$/.test(id)) continue;
    const date = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/.exec(comment.attrs.date ?? "")?.[0];
    const entry = { id, author: (comment.attrs.author ?? "").slice(0, 120), date: date ? `${date}Z` : "", text };
    const para = paragraphs[paragraphs.length - 1]?.attrs.paraId ?? "";
    const info = extended.get(para);
    const parent = info?.parent ? byPara.get(info.parent) : undefined;
    if (parent) {
      parent.replies.push(entry);
      continue;
    }
    const thread: CommentThread = { ...entry, ...(info?.done ? { resolved: true } : {}), replies: [] };
    threads.push(thread);
    if (para) byPara.set(para, thread);
    marks.set(comment.attrs.id ?? "", id);
  }
  return { marks, threads };
}

// In Word eingeschaltetes „Änderungen nachverfolgen“ bleibt eingeschaltet.
function trackRevisions(xml: Buffer | undefined) {
  const flag = xml ? find(parseXml(xml.toString("utf8")), "trackRevisions") : undefined;
  return Boolean(flag) && !["false", "0", "off"].includes(flag?.attrs.val ?? "");
}

export function readDocx(bytes: Buffer): { model: DocumentModel; imported: boolean } {
  const files = readZip(bytes);
  const documentXml = files.get("word/document.xml");
  if (!documentXml) throw new Error("Kein Word-Dokument.");
  const stored = files.get(MODEL_PART);
  if (stored) {
    try {
      const parsed = unpackModel(stored, files);
      // Nur wenn die Datei seither nicht in Word geändert wurde (sonst gilt der Inhalt der Datei).
      if (parsed.check === sha256(documentXml))
        return { model: cleanModel("document", parsed.model) as DocumentModel, imported: false };
    } catch {
      // Beschädigtes Modell: aus der Datei lesen.
    }
  }
  const styles = new Map<string, string>();
  const stylesXml = files.get("word/styles.xml");
  if (stylesXml)
    for (const style of findAll(parseXml(stylesXml.toString("utf8")), "style"))
      styles.set(style.attrs.styleId, child(style, "name")?.attrs.val ?? "");
  const numFormats = new Map<string, Map<number, string>>();
  const numberingXml = files.get("word/numbering.xml");
  if (numberingXml) {
    const root = parseXml(numberingXml.toString("utf8"));
    const abstracts = new Map<string, Map<number, string>>();
    for (const abstract of findAll(root, "abstractNum")) {
      const levels = new Map<number, string>();
      for (const lvl of childrenOf(abstract, "lvl"))
        levels.set(Number(lvl.attrs.ilvl), child(lvl, "numFmt")?.attrs.val ?? "bullet");
      abstracts.set(abstract.attrs.abstractNumId, levels);
    }
    for (const num of findAll(root, "num")) {
      const levels = abstracts.get(child(num, "abstractNumId")?.attrs.val ?? "");
      if (levels) numFormats.set(num.attrs.numId, levels);
    }
  }
  const rels = readRels(files, "word/document.xml");
  const footnotes = new Map<string, string>();
  const relsXml = files.get("word/_rels/document.xml.rels");
  const footnotesRel = relsXml
    ? findAll(parseXml(relsXml.toString("utf8")), "Relationship").find((rel) => rel.attrs.Type === REL.footnotes)
    : undefined;
  const footnotesXml = footnotesRel
    ? files.get(resolvePart("word/document.xml", footnotesRel.attrs.Target))
    : undefined;
  if (footnotesXml)
    for (const note of findAll(parseXml(footnotesXml.toString("utf8")), "footnote"))
      if (!note.attrs.type || note.attrs.type === "normal")
        footnotes.set(
          note.attrs.id,
          findAll(note, "p")
            .map((p) =>
              findAll(p, "t")
                .map((t) => textOf(t))
                .join(""),
            )
            .join(" ")
            .trim(),
        );
  const comments = readComments(files, relsXml);
  const reader: Reader = {
    files,
    rels,
    styles,
    numFormats,
    footnotes,
    commentMarks: comments.marks,
    openComments: new Set(),
  };
  const root = parseXml(documentXml.toString("utf8"));
  const body = find(root, "body");
  const content = body ? readBody(body, reader) : [];
  const sect = child(body, "sectPr");
  const size = child(sect, "pgSz");
  const margin = Number(child(sect, "pgMar")?.attrs.left ?? 1417) / TWIPS_PER_MM;
  const page: PageSetup = {
    ...DEFAULT_PAGE,
    orientation:
      size?.attrs.orient === "landscape" || Number(size?.attrs.w) > Number(size?.attrs.h) ? "landscape" : "portrait",
    margins: margin < 18 ? "narrow" : margin > 32 ? "wide" : "normal",
    pageNumbers: false,
  };
  return {
    model: cleanModel("document", {
      kind: "document",
      page,
      content: { type: "doc", content: content.length ? content : emptyDoc().content },
      comments: comments.threads,
      track: trackRevisions(files.get("word/settings.xml")),
    }) as DocumentModel,
    imported: true,
  };
}
