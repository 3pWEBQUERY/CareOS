import { createZip, readZip, type ZipEntry } from "@/lib/zip";
import {
  DECK_THEMES,
  ITEM_TEXT_SIZE,
  TABLE_TEXT_SIZE,
  SLIDE_BODY_SIZE,
  SLIDE_BOXES,
  SLIDE_SIZE,
  SLIDE_TRANSITIONS,
  TRANSITION_SPEEDS,
  cellKey,
  cleanModel,
  contrastText,
  emptyDoc,
  newId,
  newSheet,
  newSlide,
  type DeckModel,
  type DocMark,
  type DocNode,
  type Slide,
  type SlideBox,
  type SlideItem,
  type SlideShape,
  type SlideTransition,
  type SlideTransitionType,
  type TransitionSpeed,
} from "./model";
import { chartSpaceXml, readChartSpace } from "./chart-xml";
import { initials, type CommentReply, type CommentThread } from "./comments";
import { buildXlsx } from "./xlsx";
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
  relsPathOf,
  resolvePart,
  rootRels,
  sha256,
  unpackModel,
} from "./package";
import { child, childrenOf, esc, find, findAll, parseXml, textOf, type XmlNode } from "./xml";

// PowerPoint-Präsentation (.pptx) aus der Präsentation der Ablage schreiben und wieder lesen.

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const GROUP =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const FONT = "Calibri";
const rgb = (color: string) => color.replace("#", "").toUpperCase();
const xfrm = (box: SlideBox) =>
  `<a:xfrm><a:off x="${box.x}" y="${box.y}"/><a:ext cx="${box.w}" cy="${box.h}"/></a:xfrm>`;

function themeXml(name: string, colors: { dark: string; light: string; accent: string }) {
  const scheme = ["4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47"];
  return `${XML_HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${esc(name)}"><a:themeElements><a:clrScheme name="${esc(name)}"><a:dk1><a:srgbClr val="${rgb(colors.dark)}"/></a:dk1><a:lt1><a:srgbClr val="${rgb(colors.light)}"/></a:lt1><a:dk2><a:srgbClr val="1C2B2D"/></a:dk2><a:lt2><a:srgbClr val="E7ECEC"/></a:lt2><a:accent1><a:srgbClr val="${rgb(colors.accent)}"/></a:accent1>${scheme
    .slice(1)
    .map((color, index) => `<a:accent${index + 2}><a:srgbClr val="${color}"/></a:accent${index + 2}>`)
    .join(
      "",
    )}<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="CareOS"><a:majorFont><a:latin typeface="${FONT}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${FONT}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="CareOS"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}

const CLR_MAP =
  'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"';

const MASTER = `${XML_HEAD}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMap ${CLR_MAP}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;
const LAYOUT = `${XML_HEAD}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Leer"><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
const NOTES_MASTER = `${XML_HEAD}<p:notesMaster ${NS}><p:cSld><p:spTree>${GROUP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notizen"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="de-CH"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMap ${CLR_MAP}/></p:notesMaster>`;

type Colors = { text: string; accent: string; muted: string };

function runXml(text: string, marks: DocMark[] | undefined, size: number, color: string, bold = false) {
  const has = (type: string) => marks?.some((mark) => mark.type === type);
  const style = marks?.find((mark) => mark.type === "textStyle")?.attrs ?? {};
  const own = typeof style.color === "string" && /^#[0-9a-f]{6}$/i.test(style.color) ? style.color : color;
  const highlight = marks?.find((mark) => mark.type === "highlight")?.attrs?.color;
  return `<a:r><a:rPr lang="de-CH" sz="${size * 100}"${bold || has("bold") ? ' b="1"' : ""}${has("italic") ? ' i="1"' : ""}${has("underline") ? ' u="sng"' : ""}${has("strike") ? ' strike="sngStrike"' : ""} dirty="0"><a:solidFill><a:srgbClr val="${rgb(own)}"/></a:solidFill>${typeof highlight === "string" && /^#[0-9a-f]{6}$/i.test(highlight) ? `<a:highlight><a:srgbClr val="${rgb(highlight)}"/></a:highlight>` : ""}<a:latin typeface="${FONT}"/></a:rPr><a:t>${esc(text)}</a:t></a:r>`;
}

const ALIGN: Record<string, string> = { center: "ctr", right: "r", justify: "just" };

function paragraphXml(node: DocNode | null, size: number, color: string, bullet: string, level: number, bold = false) {
  const align = ALIGN[String(node?.attrs?.textAlign ?? "")];
  const indent = bullet
    ? ` marL="${342_900 + level * 457_200}" indent="-342900"`
    : level
      ? ` marL="${level * 457_200}"`
      : "";
  const props = `<a:pPr${indent}${level ? ` lvl="${Math.min(8, level)}"` : ""}${align ? ` algn="${align}"` : ""}><a:spcBef><a:spcPts val="600"/></a:spcBef>${bullet || "<a:buNone/>"}</a:pPr>`;
  const runs = (node?.content ?? [])
    .map((part) =>
      part.type === "text" && part.text
        ? runXml(part.text, part.marks, size, color, bold)
        : part.type === "hardBreak"
          ? "<a:br/>"
          : "",
    )
    .join("");
  return `<a:p>${props}${runs}<a:endParaRPr lang="de-CH" sz="${size * 100}" dirty="0"/></a:p>`;
}

function bodyParagraphs(nodes: DocNode[] | undefined, size: number, colors: Colors, level = 0): string {
  let out = "";
  for (const node of nodes ?? []) {
    if (node.type === "paragraph" || node.type === "heading") {
      const heading = node.type === "heading";
      out += paragraphXml(node, heading ? size + 4 : size, heading ? colors.accent : colors.text, "", level, heading);
    } else if (node.type === "bulletList" || node.type === "orderedList" || node.type === "taskList") {
      (node.content ?? []).forEach((item) => {
        let first = true;
        for (const part of item.content ?? []) {
          if (part.type === "paragraph") {
            const bullet = !first
              ? ""
              : node.type === "orderedList"
                ? `<a:buClr><a:srgbClr val="${rgb(colors.accent)}"/></a:buClr><a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"${Number(node.attrs?.start ?? 1) > 1 ? ` startAt="${Number(node.attrs?.start)}"` : ""}/>`
                : `<a:buClr><a:srgbClr val="${rgb(colors.accent)}"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="${node.type === "taskList" ? (item.attrs?.checked ? "☒" : "☐") : level % 2 ? "–" : "•"}"/>`;
            out += paragraphXml(part, Math.max(12, size - level * 2), colors.text, bullet, level);
            first = false;
          } else out += bodyParagraphs([part], size, colors, level + 1);
        }
      });
    } else if (node.type === "blockquote")
      out += bodyParagraphs(node.content, size, { ...colors, text: colors.muted }, level);
  }
  return out || `<a:p><a:endParaRPr lang="de-CH" sz="${size * 100}"/></a:p>`;
}

function textShape(id: number, name: string, box: SlideBox, paragraphs: string, anchor: string) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

// ---------- Freie Objekte (Textfeld, Form, Tabelle, Diagramm) ----------

const fillXml = (color: string) =>
  color ? `<a:solidFill><a:srgbClr val="${rgb(color)}"/></a:solidFill>` : "<a:noFill/>";
const lineXml = (color: string, width = 12700) =>
  color ? `<a:ln w="${width}">${fillXml(color)}</a:ln>` : "<a:ln><a:noFill/></a:ln>";
const frameXfrm = (item: SlideBox) =>
  `<p:xfrm><a:off x="${item.x}" y="${item.y}"/><a:ext cx="${item.w}" cy="${item.h}"/></p:xfrm>`;

function itemXml(item: SlideItem, id: number, colors: Colors & { background: string }, chartRel: () => string) {
  switch (item.type) {
    case "text":
      return textShape(id, `Textfeld ${id}`, item, bodyParagraphs(item.body.content, ITEM_TEXT_SIZE, colors), "t");
    case "shape": {
      if (item.shape === "line")
        return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="Linie ${id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(item)}<a:prstGeom prst="line"><a:avLst/></a:prstGeom>${lineXml(item.line || colors.accent, 28575)}</p:spPr></p:cxnSp>`;
      const textColor = item.fill ? contrastText(item.fill) : colors.text;
      const text = item.text
        .split("\n")
        .map(
          (line) =>
            `<a:p><a:pPr algn="ctr"><a:buNone/></a:pPr>${line ? runXml(line, undefined, ITEM_TEXT_SIZE, textColor) : ""}<a:endParaRPr lang="de-CH" sz="${ITEM_TEXT_SIZE * 100}"/></a:p>`,
        )
        .join("");
      return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Form ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(item)}<a:prstGeom prst="${item.shape}"><a:avLst/></a:prstGeom>${fillXml(item.fill)}${lineXml(item.line)}</p:spPr><p:txBody><a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="ctr"><a:normAutofit/></a:bodyPr><a:lstStyle/>${text}</p:txBody></p:sp>`;
    }
    case "table": {
      const cols = item.rows[0]?.length ?? 1;
      const width = Math.floor(item.w / cols);
      const height = Math.floor(item.h / Math.max(1, item.rows.length));
      const border = (side: string) =>
        `<a:${side} w="9525"><a:solidFill><a:srgbClr val="${rgb(colors.muted)}"/></a:solidFill></a:${side}>`;
      const rows = item.rows
        .map((row, index) => {
          const head = item.header && index === 0;
          const cells = row
            .map(
              (cell) =>
                `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${cell
                  .split("\n")
                  .map(
                    (line) =>
                      `<a:p>${line ? runXml(line, undefined, TABLE_TEXT_SIZE, head ? contrastText(colors.accent) : colors.text, head) : ""}<a:endParaRPr lang="de-CH" sz="${TABLE_TEXT_SIZE * 100}"/></a:p>`,
                  )
                  .join(
                    "",
                  )}</a:txBody><a:tcPr marL="91440" marR="91440" marT="45720" marB="45720">${border("lnL")}${border("lnR")}${border("lnT")}${border("lnB")}${head ? fillXml(colors.accent) : "<a:noFill/>"}</a:tcPr></a:tc>`,
            )
            .join("");
          return `<a:tr h="${height}">${cells}</a:tr>`;
        })
        .join("");
      return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Tabelle ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>${frameXfrm(item)}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="${item.header ? 1 : 0}" bandRow="0"/><a:tblGrid>${Array.from({ length: cols }, () => `<a:gridCol w="${width}"/>`).join("")}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    }
    case "chart":
      return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Diagramm ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>${frameXfrm(item)}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${chartRel()}"/></a:graphicData></a:graphic></p:graphicFrame>`;
  }
}

// Daten des Diagramms als kleine Arbeitsmappe (PowerPoint öffnet sie mit „Daten bearbeiten“).
function chartWorkbook(item: Extract<SlideItem, { type: "chart" }>) {
  const sheet = newSheet("Tabelle1");
  item.series.forEach((series, col) => {
    sheet.cells[cellKey(col + 1, 0)] = { v: series.name, s: { b: true } };
    series.values.forEach((value, row) => {
      sheet.cells[cellKey(col + 1, row + 1)] = { v: String(value) };
    });
  });
  item.categories.forEach((category, row) => {
    sheet.cells[cellKey(0, row + 1)] = { v: /^[-+\d.,\s]+$/.test(category) ? `'${category}` : category };
  });
  return buildXlsx({ kind: "sheet", sheets: [sheet] }, { title: item.title || "Diagramm", author: "" });
}

const columnLetter = (index: number) => String.fromCharCode(65 + index);

function chartPart(item: Extract<SlideItem, { type: "chart" }>, workbookRel: string) {
  const last = item.categories.length + 1;
  return chartSpaceXml({
    type: item.chart,
    title: item.title,
    categories: item.categories,
    catRef: item.categories.length ? `Tabelle1!$A$2:$A$${last}` : undefined,
    series: item.series.map((series, index) => ({
      name: series.name,
      values: series.values,
      nameRef: `Tabelle1!$${columnLetter(index + 1)}$1`,
      valRef: `Tabelle1!$${columnLetter(index + 1)}$2:$${columnLetter(index + 1)}$${last}`,
    })),
    externalRel: workbookRel,
  });
}

// Übergang der Folie; Richtung „von rechts“ (dir="l") wie die Vorgabe in PowerPoint.
function transitionXml(slide: Slide) {
  const transition = slide.transition;
  if (!transition) return "";
  const effect = transition.type === "fade" ? "<p:fade/>" : `<p:${transition.type} dir="l"/>`;
  return `<p:transition spd="${transition.speed}">${effect}</p:transition>`;
}

// Übergang aus PowerPoint lesen; bei neueren Effekten (mc:AlternateContent) gilt der Ersatz für ältere Versionen.
function readTransition(root: XmlNode): SlideTransition | undefined {
  for (const node of findAll(root, "transition")) {
    const effect = node.children.find((item) => item.name in SLIDE_TRANSITIONS);
    if (!effect) continue;
    const speed = node.attrs.spd in TRANSITION_SPEEDS ? (node.attrs.spd as TransitionSpeed) : "med";
    return { type: effect.name as SlideTransitionType, speed };
  }
  return undefined;
}

function slideXml(
  slide: Slide,
  model: DeckModel,
  imageRel: string | null,
  picture: { width: number; height: number } | null,
  chartRel: () => string = () => "",
) {
  const theme = DECK_THEMES[model.theme];
  const section = slide.layout === "section";
  const background = section ? theme.accent : theme.background;
  const colors: Colors = section
    ? { text: "#ffffff", accent: "#ffffff", muted: "#ffffff" }
    : { text: theme.text, accent: theme.accent, muted: theme.muted };
  const boxes = SLIDE_BOXES[slide.layout];
  const shapes: string[] = [];
  let id = 2;
  shapes.push(
    textShape(
      id++,
      "Titel",
      boxes.title,
      `<a:p><a:pPr><a:buNone/></a:pPr>${slide.title ? runXml(slide.title, undefined, boxes.titleSize, section ? "#ffffff" : theme.text, true) : ""}<a:endParaRPr lang="de-CH" sz="${boxes.titleSize * 100}"/></a:p>`,
      boxes.anchor,
    ),
  );
  if (boxes.bar)
    shapes.push(
      `<p:sp><p:nvSpPr><p:cNvPr id="${id++}" name="Linie"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(boxes.bar)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${rgb(theme.accent)}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`,
    );
  if (boxes.subtitle)
    shapes.push(
      textShape(
        id++,
        "Untertitel",
        boxes.subtitle,
        `<a:p><a:pPr><a:buNone/></a:pPr>${slide.subtitle ? runXml(slide.subtitle, undefined, 20, colors.muted) : ""}<a:endParaRPr lang="de-CH" sz="2000"/></a:p>`,
        "t",
      ),
    );
  if (boxes.body)
    shapes.push(
      textShape(id++, "Inhalt", boxes.body, bodyParagraphs(slide.body.content, SLIDE_BODY_SIZE, colors), "t"),
    );
  if (boxes.body2)
    shapes.push(
      textShape(id++, "Inhalt 2", boxes.body2, bodyParagraphs(slide.body2.content, SLIDE_BODY_SIZE, colors), "t"),
    );
  if (boxes.image && imageRel && picture) {
    // Bild in den Rahmen einpassen (Seitenverhältnis bleibt).
    const scale = Math.min(boxes.image.w / picture.width, boxes.image.h / picture.height);
    const w = Math.round(picture.width * scale);
    const h = Math.round(picture.height * scale);
    const box = {
      x: boxes.image.x + Math.round((boxes.image.w - w) / 2),
      y: boxes.image.y + Math.round((boxes.image.h - h) / 2),
      w,
      h,
    };
    shapes.push(
      `<p:pic><p:nvPicPr><p:cNvPr id="${id++}" name="Bild"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${imageRel}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`,
    );
  }
  for (const item of slide.items) shapes.push(itemXml(item, id++, { ...colors, background }, chartRel));
  return `${XML_HEAD}<p:sld ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${rgb(background)}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${GROUP}${shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${transitionXml(slide)}</p:sld>`;
}

function notesXml(text: string) {
  const paragraphs = text
    .split("\n")
    .map(
      (line) =>
        `<a:p>${line ? `<a:r><a:rPr lang="de-CH" dirty="0"/><a:t>${esc(line)}</a:t></a:r>` : '<a:endParaRPr lang="de-CH"/>'}</a:p>`,
    )
    .join("");
  return `${XML_HEAD}<p:notes ${NS}><p:cSld><p:spTree>${GROUP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notizen"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}

const checkOf = (files: Map<string, Buffer> | ZipEntry[]) => {
  const list = Array.isArray(files) ? files.map((entry) => [entry.path, entry.content] as const) : [...files.entries()];
  return sha256(
    Buffer.concat(
      list
        .filter(
          ([path]) =>
            path === "ppt/presentation.xml" ||
            /^ppt\/slides\/slide\d+\.xml$/.test(path) ||
            /^ppt\/charts\/chart\d+\.xml$/.test(path) ||
            /^ppt\/comments\/[^/]+\.xml$/.test(path),
        )
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([, content]) => content),
    ),
  );
};

// ---------- Kommentare ----------

type Authors = Map<string, { id: number; lastIdx: number }>;
const P15 = 'xmlns:p15="http://schemas.microsoft.com/office/powerpoint/2012/main"';
const THREADING = "{C676402C-5697-4E1C-873F-D02D1690AC5C}";

// Personen mit Kommentaren (PowerPoint nummeriert die Kommentare je Person).
function commentAuthors(model: DeckModel): Authors {
  const authors: Authors = new Map();
  for (const slide of model.slides)
    for (const thread of slide.comments ?? [])
      for (const entry of [thread, ...thread.replies]) {
        const name = entry.author || "Kommentar";
        if (!authors.has(name)) authors.set(name, { id: authors.size, lastIdx: 0 });
      }
  return authors;
}

function slideComments(slide: Slide, authors: Authors) {
  const list: string[] = [];
  (slide.comments ?? []).forEach((thread, position) => {
    const cm = (entry: CommentReply, parent: { authorId: number; idx: number } | null) => {
      const author = authors.get(entry.author || "Kommentar")!;
      author.lastIdx += 1;
      const threading = parent
        ? `<p:extLst><p:ext uri="${THREADING}"><p15:threadingInfo ${P15} timeZoneBias="0"><p15:parentCm authorId="${parent.authorId}" idx="${parent.idx}"/></p15:threadingInfo></p:ext></p:extLst>`
        : "";
      list.push(
        `<p:cm authorId="${author.id}" dt="${(entry.date || new Date().toISOString()).slice(0, 19)}.000" idx="${author.lastIdx}"><p:pos x="${10 + position * 40}" y="10"/><p:text>${esc(entry.text)}</p:text>${threading}</p:cm>`,
      );
      return { authorId: author.id, idx: author.lastIdx };
    };
    const head = cm(thread, null);
    for (const reply of thread.replies) cm(reply, head);
  });
  return `${XML_HEAD}<p:cmLst ${NS}>${list.join("")}</p:cmLst>`;
}

const commentAuthorsXml = (authors: Authors) =>
  `${XML_HEAD}<p:cmAuthorLst ${NS}>${[...authors]
    .map(
      ([name, author]) =>
        `<p:cmAuthor id="${author.id}" name="${esc(name)}" initials="${esc(initials(name))}" lastIdx="${author.lastIdx}" clrIdx="${author.id % 8}"/>`,
    )
    .join("")}</p:cmAuthorLst>`;

export function buildPptx(model: DeckModel, meta: { title: string; author: string }) {
  const theme = DECK_THEMES[model.theme];
  const entries: ZipEntry[] = [];
  const overrides: [string, string][] = [];
  const pml = "application/vnd.openxmlformats-officedocument.presentationml";
  let images = false;
  let charts = 0;
  const authors = commentAuthors(model);
  const media = new Map<string, string>();
  model.slides.forEach((slide, index) => {
    const number = index + 1;
    const picture = SLIDE_BOXES[slide.layout].image ? dataImage(slide.image) : null;
    const rels = [{ id: "rId1", type: REL.slideLayout, target: "../slideLayouts/slideLayout1.xml" }];
    if (slide.comments?.length) {
      rels.push({ id: "rId4", type: REL.comments, target: `../comments/comment${number}.xml` });
      entries.push({ path: `ppt/comments/comment${number}.xml`, content: Buffer.from(slideComments(slide, authors)) });
      overrides.push([`/ppt/comments/comment${number}.xml`, `${pml}.comments+xml`]);
    }
    if (picture) {
      images = true;
      entries.push({ path: `ppt/media/folie${number}.${picture.extension}`, content: picture.bytes });
      media.set(slide.image, `ppt/media/folie${number}.${picture.extension}`);
      rels.push({ id: "rId2", type: REL.image, target: `../media/folie${number}.${picture.extension}` });
    }
    if (slide.notes.trim()) {
      rels.push({ id: "rId3", type: REL.notesSlide, target: `../notesSlides/notesSlide${number}.xml` });
      entries.push({ path: `ppt/notesSlides/notesSlide${number}.xml`, content: Buffer.from(notesXml(slide.notes)) });
      entries.push({
        path: `ppt/notesSlides/_rels/notesSlide${number}.xml.rels`,
        content: Buffer.from(
          relationships([
            { id: "rId1", type: REL.notesMaster, target: "../notesMasters/notesMaster1.xml" },
            { id: "rId2", type: REL.slide, target: `../slides/slide${number}.xml` },
          ]),
        ),
      });
      overrides.push([`/ppt/notesSlides/notesSlide${number}.xml`, `${pml}.notesSlide+xml`]);
    }
    // Diagramme: eigener Teil je Diagramm mit eingebetteter Arbeitsmappe.
    const chartItems = slide.items.filter((item) => item.type === "chart");
    let nextChart = 0;
    const chartRel = () => {
      const item = chartItems[nextChart];
      nextChart += 1;
      charts += 1;
      const rel = `rId${10 + nextChart}`;
      rels.push({ id: rel, type: REL.chart, target: `../charts/chart${charts}.xml` });
      entries.push({ path: `ppt/charts/chart${charts}.xml`, content: Buffer.from(chartPart(item, "rId1")) });
      entries.push({
        path: `ppt/charts/_rels/chart${charts}.xml.rels`,
        content: Buffer.from(
          relationships([
            { id: "rId1", type: REL.package, target: `../embeddings/Microsoft_Excel_Worksheet${charts}.xlsx` },
          ]),
        ),
      });
      entries.push({ path: `ppt/embeddings/Microsoft_Excel_Worksheet${charts}.xlsx`, content: chartWorkbook(item) });
      overrides.push([
        `/ppt/charts/chart${charts}.xml`,
        "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
      ]);
      overrides.push([
        `/ppt/embeddings/Microsoft_Excel_Worksheet${charts}.xlsx`,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ]);
      return rel;
    };
    entries.push({
      path: `ppt/slides/slide${number}.xml`,
      content: Buffer.from(slideXml(slide, model, picture ? "rId2" : null, picture, chartRel)),
    });
    entries.push({ path: `ppt/slides/_rels/slide${number}.xml.rels`, content: Buffer.from(relationships(rels)) });
    overrides.push([`/ppt/slides/slide${number}.xml`, `${pml}.slide+xml`]);
  });
  const count = model.slides.length;
  const presentation = `${XML_HEAD}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId${count + 6}"/></p:notesMasterIdLst><p:sldIdLst>${model.slides
    .map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`)
    .join(
      "",
    )}</p:sldIdLst><p:sldSz cx="${SLIDE_SIZE.width}" cy="${SLIDE_SIZE.height}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
  const presentationRels = relationships([
    { id: "rId1", type: REL.slideMaster, target: "slideMasters/slideMaster1.xml" },
    ...model.slides.map((_, index) => ({
      id: `rId${index + 2}`,
      type: REL.slide,
      target: `slides/slide${index + 1}.xml`,
    })),
    { id: `rId${count + 2}`, type: REL.theme, target: "theme/theme1.xml" },
    { id: `rId${count + 3}`, type: REL.presProps, target: "presProps.xml" },
    { id: `rId${count + 4}`, type: REL.viewProps, target: "viewProps.xml" },
    { id: `rId${count + 5}`, type: REL.tableStyles, target: "tableStyles.xml" },
    { id: `rId${count + 6}`, type: REL.notesMaster, target: "notesMasters/notesMaster1.xml" },
    ...(authors.size ? [{ id: `rId${count + 7}`, type: REL.commentAuthors, target: "commentAuthors.xml" }] : []),
  ]);
  const all: ZipEntry[] = [
    {
      path: "[Content_Types].xml",
      content: Buffer.from(
        contentTypes(
          [
            ["/ppt/presentation.xml", `${pml}.presentation.main+xml`],
            ["/ppt/slideMasters/slideMaster1.xml", `${pml}.slideMaster+xml`],
            ["/ppt/slideLayouts/slideLayout1.xml", `${pml}.slideLayout+xml`],
            ["/ppt/notesMasters/notesMaster1.xml", `${pml}.notesMaster+xml`],
            ["/ppt/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml"],
            ["/ppt/theme/theme2.xml", "application/vnd.openxmlformats-officedocument.theme+xml"],
            ["/ppt/presProps.xml", `${pml}.presProps+xml`],
            ["/ppt/viewProps.xml", `${pml}.viewProps+xml`],
            ["/ppt/tableStyles.xml", `${pml}.tableStyles+xml`],
            ...(authors.size ? ([["/ppt/commentAuthors.xml", `${pml}.commentAuthors+xml`]] as [string, string][]) : []),
            ...overrides,
          ],
          images,
        ),
      ),
    },
    { path: "_rels/.rels", content: Buffer.from(rootRels("ppt/presentation.xml")) },
    { path: "docProps/core.xml", content: Buffer.from(coreProps(meta.title, meta.author)) },
    { path: "docProps/app.xml", content: Buffer.from(appProps()) },
    { path: "ppt/presentation.xml", content: Buffer.from(presentation) },
    { path: "ppt/_rels/presentation.xml.rels", content: Buffer.from(presentationRels) },
    { path: "ppt/slideMasters/slideMaster1.xml", content: Buffer.from(MASTER) },
    {
      path: "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      content: Buffer.from(
        relationships([
          { id: "rId1", type: REL.slideLayout, target: "../slideLayouts/slideLayout1.xml" },
          { id: "rId2", type: REL.theme, target: "../theme/theme1.xml" },
        ]),
      ),
    },
    { path: "ppt/slideLayouts/slideLayout1.xml", content: Buffer.from(LAYOUT) },
    {
      path: "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      content: Buffer.from(
        relationships([{ id: "rId1", type: REL.slideMaster, target: "../slideMasters/slideMaster1.xml" }]),
      ),
    },
    { path: "ppt/notesMasters/notesMaster1.xml", content: Buffer.from(NOTES_MASTER) },
    {
      path: "ppt/notesMasters/_rels/notesMaster1.xml.rels",
      content: Buffer.from(relationships([{ id: "rId1", type: REL.theme, target: "../theme/theme2.xml" }])),
    },
    {
      path: "ppt/theme/theme1.xml",
      content: Buffer.from(
        themeXml(`CareOS ${theme.label}`, { dark: theme.text, light: theme.background, accent: theme.accent }),
      ),
    },
    {
      path: "ppt/theme/theme2.xml",
      content: Buffer.from(themeXml("Notizen", { dark: "#000000", light: "#ffffff", accent: theme.accent })),
    },
    {
      path: "ppt/presProps.xml",
      content: Buffer.from(`${XML_HEAD}<p:presentationPr ${NS}/>`),
    },
    {
      path: "ppt/viewProps.xml",
      content: Buffer.from(`${XML_HEAD}<p:viewPr ${NS}><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`),
    },
    {
      path: "ppt/tableStyles.xml",
      content: Buffer.from(
        `${XML_HEAD}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`,
      ),
    },
    ...(authors.size ? [{ path: "ppt/commentAuthors.xml", content: Buffer.from(commentAuthorsXml(authors)) }] : []),
    ...entries,
  ];
  all.push({ path: MODEL_PART, content: packModel(model, checkOf(all), media) });
  return createZip(all);
}

// ---------- Lesen ----------

function readParagraphs(body: XmlNode | undefined): DocNode {
  const content: DocNode[] = [];
  let list: DocNode | null = null;
  for (const p of childrenOf(body, "p")) {
    const props = child(p, "pPr");
    const runs: DocNode[] = [];
    for (const part of p.children) {
      if (part.name === "r") {
        const text = textOf(child(part, "t"));
        if (!text) continue;
        const rPr = child(part, "rPr");
        const marks: DocMark[] = [];
        if (rPr?.attrs.b === "1") marks.push({ type: "bold" });
        if (rPr?.attrs.i === "1") marks.push({ type: "italic" });
        if (rPr?.attrs.u && rPr.attrs.u !== "none") marks.push({ type: "underline" });
        if (rPr?.attrs.strike && rPr.attrs.strike !== "noStrike") marks.push({ type: "strike" });
        runs.push({ type: "text", text, ...(marks.length ? { marks } : {}) });
      } else if (part.name === "br") runs.push({ type: "hardBreak" });
    }
    const paragraph: DocNode = runs.length ? { type: "paragraph", content: runs } : { type: "paragraph" };
    const bulleted = Boolean(child(props, "buChar") || child(props, "buAutoNum"));
    if (bulleted && runs.length) {
      const ordered = Boolean(child(props, "buAutoNum"));
      const type = ordered ? "orderedList" : "bulletList";
      if (!list || list.type !== type) {
        list = { type, content: [] };
        content.push(list);
      }
      list.content!.push({ type: "listItem", content: [paragraph] });
    } else {
      list = null;
      if (runs.length || content.length) content.push(paragraph);
    }
  }
  return content.length ? { type: "doc", content } : emptyDoc();
}

const SHAPE_OF: Record<string, SlideShape> = {
  rect: "rect",
  roundRect: "roundRect",
  snipRect: "roundRect",
  ellipse: "ellipse",
  triangle: "triangle",
  rtTriangle: "triangle",
  rightArrow: "rightArrow",
  leftArrow: "rightArrow",
  line: "line",
};

// Formen auch aus Gruppen holen (Reihenfolge = Stapelreihenfolge).
function shapesOf(tree: XmlNode): XmlNode[] {
  return tree.children.flatMap((node) => (node.name === "grpSp" ? shapesOf(node) : [node]));
}

function frameOf(props: XmlNode | undefined) {
  const transform = child(props, "xfrm");
  const off = child(transform, "off");
  const ext = child(transform, "ext");
  if (!off || !ext) return null;
  const x = Math.max(0, Math.min(SLIDE_SIZE.width, Number(off.attrs.x) || 0));
  const y = Math.max(0, Math.min(SLIDE_SIZE.height, Number(off.attrs.y) || 0));
  return {
    id: newId(),
    x,
    y,
    w: Math.max(0, Math.min(SLIDE_SIZE.width - x, Number(ext.attrs.cx) || 0)),
    h: Math.max(0, Math.min(SLIDE_SIZE.height - y, Number(ext.attrs.cy) || 0)),
  };
}

const colorOf = (node: XmlNode | undefined) => {
  const value = child(child(node, "solidFill"), "srgbClr")?.attrs.val;
  return value && /^[0-9a-f]{6}$/i.test(value) ? `#${value.toLowerCase()}` : "";
};

const isLayoutBar = (frame: SlideBox) =>
  Object.values(SLIDE_BOXES).some(
    (layout) =>
      layout.bar &&
      Math.abs(layout.bar.x - frame.x) < 2 &&
      Math.abs(layout.bar.y - frame.y) < 2 &&
      Math.abs(layout.bar.w - frame.w) < 2 &&
      Math.abs(layout.bar.h - frame.h) < 2,
  );

function readFrame(
  shape: XmlNode,
  slideRels: Map<string, { target: string; type: string }>,
  files: Map<string, Buffer>,
): SlideItem | null {
  const transform = child(shape, "xfrm");
  const frame = frameOf({ ...shape, children: transform ? [transform] : [] });
  if (!frame) return null;
  const table = find(shape, "tbl");
  if (table) {
    const rows = childrenOf(table, "tr").map((tr) =>
      childrenOf(tr, "tc")
        .filter((tc) => tc.attrs.hMerge !== "1" && tc.attrs.vMerge !== "1")
        .map((tc) => childrenOf(child(tc, "txBody"), "p").map(textOf).join("\n").slice(0, 500)),
    );
    if (!rows.length) return null;
    return { ...frame, type: "table", rows, header: child(table, "tblPr")?.attrs.firstRow === "1" };
  }
  const chartId = find(shape, "chart")?.attrs.id;
  const chartPath = chartId ? slideRels.get(chartId)?.target : undefined;
  const chartXml = chartPath ? files.get(chartPath) : undefined;
  const chart = chartXml ? readChartSpace(chartXml.toString("utf8")) : null;
  if (!chart) return null;
  return {
    ...frame,
    type: "chart",
    chart: chart.type,
    title: chart.title,
    categories: chart.categories,
    series: chart.series,
  };
}

// ---------- Kommentare aus PowerPoint-Dateien ----------

const MODERN_COMMENTS = "http://schemas.microsoft.com/office/2018/10/relationships/comments";
const MODERN_AUTHORS = "http://schemas.microsoft.com/office/2018/10/relationships/authors";

const pptDate = (value: string | undefined) => {
  const match = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/.exec(value ?? "");
  return match ? `${match[0]}Z` : "";
};
const paragraphsText = (node: XmlNode | undefined) =>
  childrenOf(node, "p")
    .map((p) => textOf(p))
    .join("\n")
    .trim()
    .slice(0, 2000);

// Personen: klassisch (commentAuthors.xml) und neu (authors.xml, PowerPoint 365).
function readAuthors(files: Map<string, Buffer>, presentationRels: Map<string, { target: string; type: string }>) {
  const legacy = new Map<string, string>();
  const modern = new Map<string, string>();
  for (const rel of presentationRels.values()) {
    const xml = files.get(rel.target);
    if (!xml) continue;
    if (rel.type === REL.commentAuthors)
      for (const author of findAll(parseXml(xml.toString("utf8")), "cmAuthor"))
        legacy.set(author.attrs.id ?? "", (author.attrs.name ?? "").slice(0, 120));
    if (rel.type === MODERN_AUTHORS)
      for (const author of findAll(parseXml(xml.toString("utf8")), "author"))
        modern.set(author.attrs.id ?? "", (author.attrs.name ?? "").slice(0, 120));
  }
  return { legacy, modern };
}

function readSlideComments(
  files: Map<string, Buffer>,
  slideRels: Map<string, { target: string; type: string }>,
  authors: ReturnType<typeof readAuthors>,
  slideNumber: number,
): CommentThread[] {
  const threads: CommentThread[] = [];
  for (const rel of slideRels.values()) {
    const xml = files.get(rel.target);
    if (!xml) continue;
    if (rel.type === MODERN_COMMENTS) {
      for (const [index, cm] of findAll(parseXml(xml.toString("utf8")), "cm").entries()) {
        const text = paragraphsText(child(cm, "txBody"));
        if (!text) continue;
        const id = `m${slideNumber}x${index + 1}`;
        threads.push({
          id,
          author: authors.modern.get(cm.attrs.authorId ?? "") ?? "",
          date: pptDate(cm.attrs.created),
          text,
          ...(cm.attrs.status === "resolved" ? { resolved: true } : {}),
          replies: findAll(child(cm, "replyLst"), "reply").flatMap((reply, position) => {
            const body = paragraphsText(child(reply, "txBody"));
            return body
              ? [
                  {
                    id: `${id}r${position + 1}`,
                    author: authors.modern.get(reply.attrs.authorId ?? "") ?? "",
                    date: pptDate(reply.attrs.created),
                    text: body,
                  },
                ]
              : [];
          }),
        });
      }
    } else if (rel.type === REL.comments) {
      const byKey = new Map<string, CommentThread>();
      for (const cm of findAll(parseXml(xml.toString("utf8")), "cm")) {
        const text = textOf(child(cm, "text")).trim().slice(0, 2000);
        if (!text) continue;
        const key = `${cm.attrs.authorId}-${cm.attrs.idx}`;
        const entry = {
          id: `c${slideNumber}x${key}`.replace(/[^A-Za-z0-9_-]/g, ""),
          author: authors.legacy.get(cm.attrs.authorId ?? "") ?? "",
          date: pptDate(cm.attrs.dt),
          text,
        };
        const parentCm = find(cm, "parentCm");
        const parent = parentCm ? byKey.get(`${parentCm.attrs.authorId}-${parentCm.attrs.idx}`) : undefined;
        if (parent) parent.replies.push(entry);
        else {
          const thread: CommentThread = { ...entry, replies: [] };
          byKey.set(key, thread);
          threads.push(thread);
        }
      }
    }
  }
  return threads;
}

export function readPptx(bytes: Buffer): { model: DeckModel; imported: boolean } {
  const files = readZip(bytes);
  const presentationXml = files.get("ppt/presentation.xml");
  if (!presentationXml) throw new Error("Keine PowerPoint-Präsentation.");
  const stored = files.get(MODEL_PART);
  if (stored) {
    try {
      const parsed = unpackModel(stored, files);
      if (parsed.check === checkOf(files))
        return { model: cleanModel("deck", parsed.model) as DeckModel, imported: false };
    } catch {
      // Beschädigtes Modell: aus der Datei lesen.
    }
  }
  const rels = (part: string) => {
    const map = new Map<string, { target: string; type: string }>();
    const xml = files.get(relsPathOf(part));
    if (xml)
      for (const rel of findAll(parseXml(xml.toString("utf8")), "Relationship"))
        map.set(rel.attrs.Id, { target: resolvePart(part, rel.attrs.Target), type: rel.attrs.Type });
    return map;
  };
  const presentationRels = rels("ppt/presentation.xml");
  const authors = readAuthors(files, presentationRels);
  const slides = findAll(parseXml(presentationXml.toString("utf8")), "sldId").flatMap((entry, position): Slide[] => {
    const path = presentationRels.get(entry.attrs.id ?? "")?.target;
    const xml = path ? files.get(path) : undefined;
    if (!path || !xml) return [];
    const slideRels = rels(path);
    const root = parseXml(xml.toString("utf8"));
    const slide = newSlide("content");
    const bodies: XmlNode[] = [];
    const tree = find(root, "spTree");
    for (const shape of tree ? shapesOf(tree) : []) {
      if (shape.name === "graphicFrame") {
        const item = readFrame(shape, slideRels, files);
        if (item) slide.items.push(item);
        continue;
      }
      if (shape.name === "cxnSp") {
        const frame = frameOf(child(shape, "spPr"));
        if (frame)
          slide.items.push({
            ...frame,
            type: "shape",
            shape: "line",
            fill: "",
            line: colorOf(child(child(shape, "spPr"), "ln")) || "#2563eb",
            text: "",
          });
        continue;
      }
      if (shape.name !== "sp") continue;
      const nv = child(shape, "nvSpPr");
      const placeholder = find(nv, "ph");
      const type = placeholder?.attrs.type;
      const name = child(nv, "cNvPr")?.attrs.name ?? "";
      const body = child(shape, "txBody");
      const text = childrenOf(body, "p").map(textOf).join("\n").trim();
      const props = child(shape, "spPr");
      const geometry = child(props, "prstGeom")?.attrs.prst ?? "rect";
      const fill = colorOf(props);
      const frame = frameOf(props);
      // Farbige Fläche oder besondere Form: als Form übernehmen (die Akzentlinie unter dem Titel gehört zum Layout).
      const filled = Boolean(fill) || (geometry !== "rect" && Boolean(colorOf(child(props, "ln"))));
      if (!placeholder && frame && filled && !isLayoutBar(frame)) {
        slide.items.push({
          ...frame,
          type: "shape",
          shape: SHAPE_OF[geometry] ?? "rect",
          fill,
          line: colorOf(child(props, "ln")),
          text: text.slice(0, 2000),
        });
        continue;
      }
      if (!body || !text) continue;
      if ((type === "title" || type === "ctrTitle") && !slide.title) {
        slide.title = text.replace(/\n/g, " ");
        if (type === "ctrTitle") slide.layout = "title";
      } else if (type === "subTitle" && !slide.subtitle) slide.subtitle = text.replace(/\n/g, " ");
      else if (name === "Titel" && !slide.title) slide.title = text.replace(/\n/g, " ");
      else if (name === "Untertitel" && !slide.subtitle) slide.subtitle = text.replace(/\n/g, " ");
      else if (placeholder || name === "Inhalt" || name === "Inhalt 2") bodies.push(body);
      else if (!slide.title && bodies.length === 0 && text.length < 120 && !text.includes("\n") && !frame)
        slide.title = text;
      else if (frame) slide.items.push({ ...frame, type: "text", body: readParagraphs(body) });
      else bodies.push(body);
    }
    if (bodies[0]) slide.body = readParagraphs(bodies[0]);
    if (bodies[1]) {
      slide.body2 = readParagraphs(bodies[1]);
      slide.layout = "two";
    }
    const pic = find(root, "pic");
    const embed = find(pic, "blip")?.attrs.embed;
    const target = embed ? slideRels.get(embed)?.target : undefined;
    const image = target ? mediaDataUrl(target, files.get(target)) : "";
    if (image && slide.layout !== "title") {
      slide.image = image;
      slide.layout = "image";
    }
    for (const rel of slideRels.values())
      if (rel.type === REL.notesSlide) {
        const notes = files.get(rel.target);
        if (!notes) continue;
        const notesRoot = parseXml(notes.toString("utf8"));
        const shape = findAll(notesRoot, "sp").find((item) => find(child(item, "nvSpPr"), "ph")?.attrs.type === "body");
        slide.notes = childrenOf(child(shape, "txBody"), "p").map(textOf).join("\n").trim();
      }
    const comments = readSlideComments(files, slideRels, authors, position + 1);
    if (comments.length) slide.comments = comments;
    const transition = readTransition(root);
    if (transition) slide.transition = transition;
    return [slide];
  });
  return { model: cleanModel("deck", { kind: "deck", theme: "carecore", slides }) as DeckModel, imported: true };
}
