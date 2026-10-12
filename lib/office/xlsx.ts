import { createZip, readZip, type ZipEntry } from "@/lib/zip";
import {
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  cleanModel,
  decimalsOf,
  evaluateWorkbook,
  formatValue,
  newSheet,
  type CellStyle,
  type RuleOp,
  type RuleStyle,
  type SheetChart,
  type SheetRule,
  type Spill,
  type NumberFormat,
  type Sheet,
  type SheetModel,
} from "./model";
import {
  areaName,
  cellKey,
  columnName,
  fromExcelFormula,
  parseArea,
  isError,
  parseCellKey,
  parseInput,
  shiftFormula,
  toExcelFormula,
  type Area,
  type Value,
} from "./formula";
import {
  MODEL_PART,
  REL,
  XML_HEAD,
  appProps,
  contentTypes,
  coreProps,
  packModel,
  relationships,
  relsPathOf,
  resolvePart,
  rootRels,
  sha256,
  unpackModel,
  type Rel,
} from "./package";
import { type CommentThread } from "./comments";
import { child, childrenOf, esc, find, findAll, parseXml, textOf, type XmlNode } from "./xml";
import { DEFAULT_BORDER_COLOR, chartData, filteredRows, sidesOf } from "./sheet-features";
import { CHART_KINDS, chartSpaceXml, chartTexts } from "./chart-xml";

// Excel-Arbeitsmappe (.xlsx) aus der Tabelle der Ablage schreiben und wieder lesen.

const MAIN =
  'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function numberFormatCode(style: CellStyle): string | null {
  const fmt = style.fmt ?? "general";
  const decimals = decimalsOf(style);
  const fraction = decimals > 0 ? `.${"0".repeat(decimals)}` : "";
  switch (fmt) {
    case "number":
      return `#,##0${fraction}`;
    case "integer":
      return "#,##0";
    case "percent":
      return `0${fraction}%`;
    case "chf":
      return `"CHF "#,##0${fraction}`;
    case "eur":
      return `#,##0${fraction}" €"`;
    case "date":
      return "dd.mm.yyyy";
    case "time":
      return "hh:mm";
    case "datetime":
      return "dd.mm.yyyy hh:mm";
    case "text":
      return "@";
    default:
      return style.dec !== undefined ? `0${fraction}` : null;
  }
}

const argb = (color: string) => `FF${color.slice(1).toUpperCase()}`;

class StyleTable {
  fonts = ['<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>'];
  fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  borders = ["<border><left/><right/><top/><bottom/><diagonal/></border>"];
  numFmts: string[] = [];
  dxfs: string[] = [];
  xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  private index = new Map<string, number>();

  private add(list: string[], value: string) {
    const found = list.indexOf(value);
    if (found >= 0) return found;
    list.push(value);
    return list.length - 1;
  }

  id(style: CellStyle | undefined) {
    if (!style || !Object.keys(style).length) return 0;
    const key = JSON.stringify(style);
    const known = this.index.get(key);
    if (known !== undefined) return known;
    const font = this.add(
      this.fonts,
      `<font>${style.b ? "<b/>" : ""}${style.i ? "<i/>" : ""}${style.s ? "<strike/>" : ""}${style.u ? "<u/>" : ""}<sz val="${style.size ?? 11}"/>${style.color ? `<color rgb="${argb(style.color)}"/>` : '<color theme="1"/>'}<name val="${esc(style.font ?? "Calibri")}"/>${style.font && style.font !== "Calibri" ? "" : '<family val="2"/>'}</font>`,
    );
    const sides = sidesOf(style);
    const lineStyle = style.bw ?? "thin";
    const line = (name: string, on: boolean) =>
      on
        ? `<${name} style="${lineStyle}"><color rgb="${argb(style.bc ?? DEFAULT_BORDER_COLOR)}"/></${name}>`
        : `<${name}/>`;
    const hasBorder = sides.top || sides.bottom || sides.left || sides.right;
    const border = hasBorder
      ? this.add(
          this.borders,
          `<border>${line("left", sides.left)}${line("right", sides.right)}${line("top", sides.top)}${line("bottom", sides.bottom)}<diagonal/></border>`,
        )
      : 0;
    const fill = style.fill
      ? this.add(
          this.fills,
          `<fill><patternFill patternType="solid"><fgColor rgb="${argb(style.fill)}"/><bgColor indexed="64"/></patternFill></fill>`,
        )
      : 0;
    const code = numberFormatCode(style);
    let numFmt = 0;
    if (code === "@") numFmt = 49;
    else if (code) numFmt = 164 + this.add(this.numFmts, code);
    const horizontal = style.align ?? (style.indent ? "left" : undefined);
    const alignment =
      horizontal || style.valign || style.wrap || style.indent
        ? `<alignment${horizontal ? ` horizontal="${horizontal}"` : ""}${style.valign ? ` vertical="${style.valign === "middle" ? "center" : style.valign}"` : ""}${style.wrap ? ' wrapText="1"' : ""}${style.indent ? ` indent="${style.indent}"` : ""}/>`
        : "";
    // Blattschutz: Zelle nicht gesperrt (Excel: Format › Schutz › „Gesperrt“ aus).
    const protection = style.unlocked ? '<protection locked="0"/>' : "";
    const inner = alignment + protection;
    const xf = `<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${numFmt ? ' applyNumberFormat="1"' : ""}${font ? ' applyFont="1"' : ""}${fill ? ' applyFill="1"' : ""}${border ? ' applyBorder="1"' : ""}${alignment ? ' applyAlignment="1"' : ""}${protection ? ' applyProtection="1"' : ""}${inner ? `>${inner}</xf>` : "/>"}`;
    this.xfs.push(xf);
    this.index.set(key, this.xfs.length - 1);
    return this.xfs.length - 1;
  }

  xml() {
    const numFmts = this.numFmts.length
      ? `<numFmts count="${this.numFmts.length}">${this.numFmts.map((code, index) => `<numFmt numFmtId="${164 + index}" formatCode="${esc(code)}"/>`).join("")}</numFmts>`
      : "";
    return `${XML_HEAD}<styleSheet ${MAIN}>${numFmts}<fonts count="${this.fonts.length}">${this.fonts.join("")}</fonts><fills count="${this.fills.length}">${this.fills.join("")}</fills><borders count="${this.borders.length}">${this.borders.join("")}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${this.xfs.length}">${this.xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Standard" xfId="0" builtinId="0"/></cellStyles>${this.dxfs.length ? `<dxfs count="${this.dxfs.length}">${this.dxfs.join("")}</dxfs>` : ""}</styleSheet>`;
  }

  // Formatierung einer Regel der bedingten Formatierung.
  dxf(style: RuleStyle) {
    const font =
      style.b || style.color
        ? `<font>${style.b ? "<b/>" : ""}${style.color ? `<color rgb="${argb(style.color)}"/>` : ""}</font>`
        : "";
    const fill = style.fill
      ? `<fill><patternFill patternType="solid"><fgColor rgb="${argb(style.fill)}"/><bgColor rgb="${argb(style.fill)}"/></patternFill></fill>`
      : "";
    return this.add(this.dxfs, `<dxf>${font}${fill}</dxf>`);
  }
}

const excelWidth = (px: number) => Math.round(((px - 5) / 7) * 100) / 100;
const pxWidth = (chars: number) => Math.round(chars * 7 + 5);

// Wert ohne Formel (auch Zellen, in die eine Formel übergelaufen ist).
function valueXml(ref: string, style: string, value: Value) {
  if (value === null) return `<c r="${ref}"${style}/>`;
  if (typeof value === "number") return `<c r="${ref}"${style}><v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c r="${ref}"${style} t="b"><v>${value ? 1 : 0}</v></c>`;
  if (isError(value))
    return EXCEL_ERRORS.has(value.error)
      ? `<c r="${ref}"${style} t="e"><v>${esc(value.error)}</v></c>`
      : `<c r="${ref}"${style}/>`;
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}
// Fehlerwerte, die jede Excel-Version kennt (neuere wie #ÜBERLAUF! werden beim Öffnen neu berechnet).
const EXCEL_ERRORS = new Set(["#DIV/0!", "#NAME?", "#REF!", "#VALUE!", "#N/A", "#NUM!"]);

function cellXml(
  ref: string,
  raw: string,
  style: number,
  value: Value,
  spill: string | null = null,
  defined?: Set<string>,
) {
  const s = style ? ` s="${style}"` : "";
  const input = parseInput(raw);
  if (input.type === "formula") {
    const formula = toExcelFormula(input.formula, defined);
    if (formula === null) return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(raw)}</t></is></c>`;
    let cached = "";
    let type = "";
    if (isError(value)) {
      if (EXCEL_ERRORS.has(value.error)) {
        type = ' t="e"';
        cached = `<v>${esc(value.error)}</v>`;
      }
    } else if (typeof value === "number") cached = `<v>${value}</v>`;
    else if (typeof value === "boolean") {
      type = ' t="b"';
      cached = `<v>${value ? 1 : 0}</v>`;
    } else if (typeof value === "string") {
      type = ' t="str"';
      cached = `<v>${esc(value)}</v>`;
    }
    // Überlaufende Formel: dynamische Matrixformel (cm="1" verweist auf metadata.xml).
    if (spill) return `<c r="${ref}"${s}${type} cm="1"><f t="array" ref="${spill}">${esc(formula)}</f>${cached}</c>`;
    return `<c r="${ref}"${s}${type}><f>${esc(formula)}</f>${cached}</c>`;
  }
  if (input.type === "empty") return `<c r="${ref}"${s}/>`;
  if (typeof value === "number") return `<c r="${ref}"${s}><v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c r="${ref}"${s} t="b"><v>${value ? 1 : 0}</v></c>`;
  const text = typeof value === "string" ? value : raw;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
}

const OPERATORS: Partial<Record<RuleOp, string>> = {
  gt: "greaterThan",
  lt: "lessThan",
  ge: "greaterThanOrEqual",
  le: "lessThanOrEqual",
  eq: "equal",
  ne: "notEqual",
  between: "between",
};
// Vergleichswert als Formel: Zahl bleibt Zahl, Text in Anführungszeichen.
const operand = (value: string) => {
  const parsed = parseInput(value.trim());
  return parsed.type === "number" ? String(parsed.value) : `"${value.replace(/"/g, '""')}"`;
};

// Kopf- und Fusszeile im Code von Excel: &C Mitte, &L links, &R rechts, &P Seite, &N Seitenzahl.
const headerText = (text: string) => text.replace(/&/g, "&&");
function headerFooterXml(print: Sheet["print"]) {
  const header = print.header ? `&C${headerText(print.header)}` : "";
  const footer = `${print.footer ? `&L${headerText(print.footer)}` : ""}${print.pageNumbers ? "&RSeite &P von &N" : ""}`;
  if (!header && !footer) return "";
  return `<headerFooter>${header ? `<oddHeader>${esc(header)}</oddHeader>` : ""}${footer ? `<oddFooter>${esc(footer)}</oddFooter>` : ""}</headerFooter>`;
}

// Text einer Kopf-/Fusszeile aus Excel (ohne Schrift-Codes); Seitenzahlen werden zur Einstellung „Seitenzahlen“.
function readHeaderFooter(code: string) {
  const sections = code.split(/&[LCR]/).filter((part) => part.trim());
  const pageNumbers = /&[PN]/.test(code);
  const text = sections
    .filter((part) => !/&[PN]/.test(part))
    .map((part) =>
      part
        .replace(/&"[^"]*"/g, "")
        .replace(/&\d+/g, "")
        .replace(/&[BIUSXYEKDTFAGHZ]/g, "")
        .replace(/&&/g, "&")
        .trim(),
    )
    .filter(Boolean)
    .join(" ");
  return { text: text.slice(0, 200), pageNumbers };
}

function ruleXml(rule: SheetRule, priority: number, styles: StyleTable) {
  const area = parseArea(rule.range);
  if (!area) return "";
  // Farbskala und Datenbalken brauchen keine Formatierung (dxf), nur Farben.
  if (rule.op === "scale" || rule.op === "bar") {
    const colors = rule.colors?.length
      ? rule.colors
      : rule.op === "bar"
        ? ["#638ec6"]
        : ["#f8696b", "#ffeb84", "#63be7b"];
    const body =
      rule.op === "scale"
        ? `<colorScale><cfvo type="min"/>${colors.length > 2 ? '<cfvo type="percentile" val="50"/>' : ""}<cfvo type="max"/>${colors.map((color) => `<color rgb="${argb(color)}"/>`).join("")}</colorScale>`
        : `<dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="${argb(colors[0])}"/></dataBar>`;
    return `<conditionalFormatting sqref="${rule.range}"><cfRule type="${rule.op === "scale" ? "colorScale" : "dataBar"}" priority="${priority}">${body}</cfRule></conditionalFormatting>`;
  }
  const dxf = styles.dxf(rule.style);
  const first = cellKey(area.c1, area.r1);
  const head = `<cfRule dxfId="${dxf}" priority="${priority}"`;
  let body: string;
  switch (rule.op) {
    case "contains":
      body = `${head} type="containsText" operator="containsText" text="${esc(rule.value)}"><formula>${esc(`NOT(ISERROR(SEARCH(${operand(rule.value)},${first})))`)}</formula></cfRule>`;
      break;
    case "empty":
      body = `${head} type="containsBlanks"><formula>LEN(TRIM(${first}))=0</formula></cfRule>`;
      break;
    case "notEmpty":
      body = `${head} type="notContainsBlanks"><formula>LEN(TRIM(${first}))&gt;0</formula></cfRule>`;
      break;
    case "duplicate":
      body = `${head} type="duplicateValues"/>`;
      break;
    default:
      body = `${head} type="cellIs" operator="${OPERATORS[rule.op]}"><formula>${esc(operand(rule.value))}</formula>${rule.op === "between" ? `<formula>${esc(operand(rule.value2))}</formula>` : ""}</cfRule>`;
  }
  return `<conditionalFormatting sqref="${rule.range}">${body}</conditionalFormatting>`;
}

// Auswahlliste der Datenüberprüfung: Excel erlaubt höchstens 255 Zeichen und keine Kommas in den Werten.
function validationXml(item: { range: string; values: string[] }) {
  const values = item.values.filter((value) => !value.includes(","));
  let list = "";
  for (const value of values) {
    const next = list ? `${list},${value}` : value;
    if (next.length > 255) break;
    list = next;
  }
  if (!list) return "";
  return `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorTitle="Ungültiger Wert" error="Bitte einen Wert aus der Liste wählen." sqref="${item.range}"><formula1>${esc(`"${list.replace(/"/g, '""')}"`)}</formula1></dataValidation>`;
}

function sheetXml(
  sheet: Sheet,
  index: number,
  styles: StyleTable,
  values: Map<string, Value>,
  drawing: string | null,
  spills: Map<string, Spill>,
  defined: Set<string>,
  legacy: string | null = null,
) {
  const display = (col: number, row: number) => {
    const key = cellKey(col, row);
    return formatValue(values.get(key) ?? null, sheet.cells[key]?.s);
  };
  const hiddenRows = new Set([...sheet.hiddenRows, ...filteredRows(sheet, display)]);
  const byRow = new Map<number, { col: number; key: string }[]>();
  for (const key of Object.keys(sheet.cells)) {
    const ref = parseCellKey(key);
    if (!ref) continue;
    if (!byRow.has(ref.row)) byRow.set(ref.row, []);
    byRow.get(ref.row)!.push({ col: ref.col, key });
  }
  // Zellen, in die eine Formel überläuft, stehen mit ihrem Wert in der Datei.
  for (const spill of spills.values())
    for (let row = spill.area.r1; row <= spill.area.r2; row += 1)
      for (let col = spill.area.c1; col <= spill.area.c2; col += 1) {
        const key = cellKey(col, row);
        if (sheet.cells[key]) continue;
        if (!byRow.has(row)) byRow.set(row, []);
        byRow.get(row)!.push({ col, key });
      }
  for (const key of Object.keys(sheet.rows)) if (!byRow.has(Number(key))) byRow.set(Number(key), []);
  for (const row of hiddenRows) if (!byRow.has(row)) byRow.set(row, []);
  const rows = [...byRow.entries()].sort((a, b) => a[0] - b[0]);
  const data = rows
    .map(([row, cells]) => {
      const height = sheet.rows[String(row)];
      const content = cells
        .sort((a, b) => a.col - b.col)
        .map(({ key }) => {
          const cell = sheet.cells[key];
          if (!cell) return valueXml(key, "", values.get(key) ?? null);
          const raw = cell.s?.fmt === "text" && !cell.v.startsWith("=") ? `'${cell.v}` : cell.v;
          const spill = spills.get(key);
          return cellXml(
            key,
            raw,
            styles.id(cell.s),
            values.get(key) ?? null,
            spill ? areaName(spill.area) : null,
            defined,
          );
        })
        .join("");
      return `<row r="${row + 1}"${height ? ` ht="${Math.round(height * 0.75 * 100) / 100}" customHeight="1"` : ""}${hiddenRows.has(row) ? ' hidden="1"' : ""}>${content}</row>`;
    })
    .join("");
  const hiddenCols = new Set(sheet.hiddenCols);
  const colIndexes = [...new Set([...Object.keys(sheet.cols).map(Number), ...sheet.hiddenCols])].sort((a, b) => a - b);
  const cols = colIndexes
    .map((col) => {
      const width = sheet.cols[String(col)] ?? DEFAULT_COL_WIDTH;
      return `<col min="${col + 1}" max="${col + 1}" width="${excelWidth(width)}"${sheet.cols[String(col)] ? ' customWidth="1"' : ""}${hiddenCols.has(col) ? ' hidden="1"' : ""}/>`;
    })
    .join("");
  const { rows: frozenRows, cols: frozenCols } = sheet.freeze;
  let pane = "";
  if (frozenRows || frozenCols) {
    const active = frozenRows && frozenCols ? "bottomRight" : frozenRows ? "bottomLeft" : "topRight";
    pane = `<pane${frozenCols ? ` xSplit="${frozenCols}"` : ""}${frozenRows ? ` ySplit="${frozenRows}"` : ""} topLeftCell="${cellKey(frozenCols, frozenRows)}" activePane="${active}" state="frozen"/><selection pane="${active}"/>`;
  }
  const merges = sheet.merges.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>`
    : "";
  let autoFilter = "";
  const filterArea = sheet.filter ? parseArea(sheet.filter.range) : null;
  if (sheet.filter && filterArea) {
    // In der Datei stehen die sichtbaren Werte je gefilterter Spalte.
    const columns = Object.entries(sheet.filter.hidden)
      .map(([col, hidden]) => ({ col: Number(col), hidden: new Set(hidden) }))
      .filter((entry) => entry.hidden.size && entry.col >= filterArea.c1 && entry.col <= filterArea.c2)
      .map(({ col, hidden }) => {
        const visible = new Set<string>();
        let blank = false;
        for (let row = filterArea.r1 + 1; row <= filterArea.r2; row += 1) {
          const text = display(col, row);
          if (hidden.has(text)) continue;
          if (text === "") blank = true;
          else visible.add(text);
        }
        return `<filterColumn colId="${col - filterArea.c1}"><filters${blank ? ' blank="1"' : ""}>${[...visible].map((text) => `<filter val="${esc(text)}"/>`).join("")}</filters></filterColumn>`;
      })
      .join("");
    autoFilter = `<autoFilter ref="${areaName(filterArea)}">${columns}</autoFilter>`;
  }
  const conditional = sheet.rules.map((rule, position) => ruleXml(rule, position + 1, styles)).join("");
  const validationItems = sheet.validations.map(validationXml).filter(Boolean);
  const validations = validationItems.length
    ? `<dataValidations count="${validationItems.length}">${validationItems.join("")}</dataValidations>`
    : "";
  const print = sheet.print;
  const sheetPr = print.fit ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : "";
  const pageSetup = `<pageSetup paperSize="9" orientation="${print.orientation}"${print.fit ? ' fitToWidth="1" fitToHeight="0"' : ""}/>${headerFooterXml(print)}`;
  return `${XML_HEAD}<worksheet ${MAIN}>${sheetPr}<sheetViews><sheetView${sheet.showGrid ? "" : ' showGridLines="0"'} workbookViewId="0"${index === 0 ? ' tabSelected="1"' : ""}>${pane}</sheetView></sheetViews><sheetFormatPr defaultColWidth="${excelWidth(DEFAULT_COL_WIDTH)}" defaultRowHeight="${DEFAULT_ROW_HEIGHT * 0.75}"/>${cols ? `<cols>${cols}</cols>` : ""}<sheetData>${data}</sheetData>${sheet.protected ? '<sheetProtection sheet="1" objects="1" scenarios="1"/>' : ""}${autoFilter}${merges}${conditional}${validations}${print.gridlines ? '<printOptions gridLines="1"/>' : ""}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>${pageSetup}${drawing ? `<drawing r:id="${drawing}"/>` : ""}${legacy ? `<legacyDrawing r:id="${legacy}"/>` : ""}</worksheet>`;
}

// ---------- Diagramme ----------

const EMU = 9525;
const absolute = (sheetName: string, c1: number, r1: number, c2: number, r2: number) => {
  const name = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(sheetName) ? sheetName : `'${sheetName.replace(/'/g, "''")}'`;
  const start = `$${columnName(c1)}$${r1 + 1}`;
  return c1 === c2 && r1 === r2 ? `${name}!${start}` : `${name}!${start}:$${columnName(c2)}$${r2 + 1}`;
};

function chartXml(sheet: Sheet, chart: Sheet["charts"][number], values: Map<string, Value>) {
  const area = parseArea(chart.range);
  if (!area) return null;
  const valueAt = (col: number, row: number) => values.get(cellKey(col, row)) ?? null;
  const text = (col: number, row: number) => formatValue(valueAt(col, row), sheet.cells[cellKey(col, row)]?.s);
  const data = chartData(area, valueAt, text);
  const { headerRow, labelCol, firstRow } = data.layout;
  return chartSpaceXml({
    type: chart.type,
    title: chart.title,
    xTitle: chart.xTitle,
    yTitle: chart.yTitle,
    labels: chart.labels,
    categories: data.categories,
    catRef: labelCol ? absolute(sheet.name, area.c1, firstRow, area.c1, area.r2) : undefined,
    series: data.series.map((item) => ({
      name: item.name,
      values: item.values,
      nameRef: headerRow ? absolute(sheet.name, item.col, area.r1, item.col, area.r1) : undefined,
      valRef: absolute(sheet.name, item.col, firstRow, item.col, area.r2),
    })),
  });
}

// ---------- Kommentare (Notizen) ----------

// Text einer Notiz wie in Excel: „Name:“ fett, darunter der Text, Antworten mit Namen angehängt.
function noteRuns(thread: CommentThread) {
  const run = (text: string, bold = false) =>
    `<r><rPr>${bold ? "<b/>" : ""}<sz val="9"/><color indexed="81"/><rFont val="Tahoma"/><family val="2"/></rPr><t xml:space="preserve">${esc(text)}</t></r>`;
  return [
    run(`${thread.author || "Kommentar"}:`, true),
    run(`\n${thread.text}`),
    ...thread.replies.flatMap((reply) => [run(`\n\n${reply.author || "Antwort"}:`, true), run(`\n${reply.text}`)]),
    ...(thread.resolved ? [run("\n\n(erledigt)")] : []),
  ].join("");
}

function notesXml(notes: [string, CommentThread][]) {
  const authors = [...new Set(notes.map(([, thread]) => thread.author || "Kommentar"))];
  return `${XML_HEAD}<comments ${MAIN}><authors>${authors.map((author) => `<author>${esc(author)}</author>`).join("")}</authors><commentList>${notes
    .map(
      ([key, thread]) =>
        `<comment ref="${key}" authorId="${authors.indexOf(thread.author || "Kommentar")}"><text>${noteRuns(thread)}</text></comment>`,
    )
    .join("")}</commentList></comments>`;
}

// Notizfelder für Excel (VML): ausgeblendet, erscheinen beim Zeigen auf die Zelle.
function notesVml(notes: [string, CommentThread][], number: number) {
  const shapes = notes
    .map(([key], index) => {
      const at = parseCellKey(key)!;
      return `<v:shape id="_x0000_s${number * 1024 + index + 1}" type="#_x0000_t202" style="position:absolute;margin-left:59.25pt;margin-top:1.5pt;width:144pt;height:72pt;z-index:${index + 1};visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto"><v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox><x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>${at.col + 1}, 15, ${Math.max(0, at.row - 1)}, 2, ${at.col + 3}, 15, ${at.row + 4}, 2</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>${at.row}</x:Row><x:Column>${at.col}</x:Column></x:ClientData></v:shape>`;
    })
    .join("");
  return `<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="${number}"/></o:shapelayout><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>${shapes}</xml>`;
}

// Pixelposition im Blatt → Zelle und Versatz (für die Verankerung des Diagramms).
function anchorOf(sheet: Sheet, x: number, y: number) {
  let col = 0;
  let left = 0;
  while (col < 16_000) {
    const width = sheet.hiddenCols.includes(col) ? 0 : (sheet.cols[String(col)] ?? DEFAULT_COL_WIDTH);
    if (left + width > x) break;
    left += width;
    col += 1;
  }
  let row = 0;
  let top = 0;
  while (row < 1_000_000) {
    const height = sheet.hiddenRows.includes(row) ? 0 : (sheet.rows[String(row)] ?? DEFAULT_ROW_HEIGHT);
    if (top + height > y) break;
    top += height;
    row += 1;
  }
  return `<xdr:col>${col}</xdr:col><xdr:colOff>${Math.round((x - left) * EMU)}</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>${Math.round((y - top) * EMU)}</xdr:rowOff>`;
}

function drawingXml(sheet: Sheet, charts: { rel: string; chart: Sheet["charts"][number] }[]) {
  const anchors = charts
    .map(
      ({ rel, chart }, index) =>
        `<xdr:twoCellAnchor editAs="oneCell"><xdr:from>${anchorOf(sheet, chart.x, chart.y)}</xdr:from><xdr:to>${anchorOf(sheet, chart.x + chart.w, chart.y + chart.h)}</xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${index + 2}" name="Diagramm ${index + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${rel}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`,
    )
    .join("");
  return `${XML_HEAD}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors}</xdr:wsDr>`;
}

const checkOf = (files: Map<string, Buffer> | ZipEntry[]) => {
  const list = Array.isArray(files) ? files.map((entry) => [entry.path, entry.content] as const) : [...files.entries()];
  return sha256(
    Buffer.concat(
      list
        .filter(
          ([path]) =>
            path === "xl/workbook.xml" ||
            path.startsWith("xl/worksheets/sheet") ||
            /^xl\/(comments\d+|threadedComments\/[^/]+)\.xml$/.test(path),
        )
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([, content]) => content),
    ),
  );
};

// Kennzeichnung dynamischer Matrixformeln (damit Excel sie überlaufen lässt statt als {Matrixformel}).
const DYNAMIC_METADATA = `${XML_HEAD}<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray"><metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1" cellMeta="1"/></metadataTypes><futureMetadata name="XLDAPR" count="1"><bk><extLst><ext uri="{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}"><xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata><cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>`;

export function buildXlsx(model: SheetModel, meta: { title: string; author: string }) {
  const styles = new StyleTable();
  const evaluator = evaluateWorkbook(model);
  const computed = evaluator.all();
  const defined = new Set((model.names ?? []).map((entry) => entry.name.toUpperCase()));
  // Werte je Blatt samt übergelaufener Zellen.
  const results = computed.map((values, index) => {
    const merged = new Map(values);
    for (const spill of evaluator.spills(index).values())
      spill.values.forEach((line, r) =>
        line.forEach((value, c) => {
          const key = cellKey(spill.area.c1 + c, spill.area.r1 + r);
          if (r || c) merged.set(key, value);
        }),
      );
    return merged;
  });
  const dynamic = model.sheets.some((_, index) => evaluator.spills(index).size > 0);
  const main = "application/vnd.openxmlformats-officedocument.spreadsheetml";
  const extra: ZipEntry[] = [];
  const types: [string, string][] = [];
  let chartCount = 0;
  let drawingCount = 0;
  let noteCount = 0;
  const sheets = model.sheets.map((sheet, index) => {
    const charts = sheet.charts.flatMap((chart) => {
      const xml = chartXml(sheet, chart, results[index]);
      if (!xml) return [];
      chartCount += 1;
      extra.push({ path: `xl/charts/chart${chartCount}.xml`, content: Buffer.from(xml) });
      types.push([
        `/xl/charts/chart${chartCount}.xml`,
        "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
      ]);
      return [{ chart, file: `chart${chartCount}.xml` }];
    });
    const sheetRels: Rel[] = [];
    let drawingRel: string | null = null;
    if (charts.length) {
      drawingCount += 1;
      const drawing = `drawing${drawingCount}.xml`;
      const linked = charts.map((item, position) => ({ rel: `rId${position + 1}`, chart: item.chart }));
      extra.push({ path: `xl/drawings/${drawing}`, content: Buffer.from(drawingXml(sheet, linked)) });
      extra.push({
        path: `xl/drawings/_rels/${drawing}.rels`,
        content: Buffer.from(
          relationships(
            charts.map((item, position) => ({
              id: `rId${position + 1}`,
              type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
              target: `../charts/${item.file}`,
            })),
          ),
        ),
      });
      types.push([`/xl/drawings/${drawing}`, "application/vnd.openxmlformats-officedocument.drawing+xml"]);
      drawingRel = "rId1";
      sheetRels.push({
        id: drawingRel,
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
        target: `../drawings/${drawing}`,
      });
    }
    // Kommentare als Notizen (comments + VML-Zeichnung, damit Excel das Notizfeld anzeigt).
    let legacyRel: string | null = null;
    const notes = Object.entries(sheet.comments ?? {});
    if (notes.length) {
      noteCount += 1;
      extra.push({ path: `xl/comments${noteCount}.xml`, content: Buffer.from(notesXml(notes)) });
      extra.push({ path: `xl/drawings/vmlDrawing${noteCount}.vml`, content: Buffer.from(notesVml(notes, noteCount)) });
      types.push(
        [`/xl/comments${noteCount}.xml`, "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"],
        [`/xl/drawings/vmlDrawing${noteCount}.vml`, "application/vnd.openxmlformats-officedocument.vmlDrawing"],
      );
      legacyRel = "rId3";
      sheetRels.push(
        { id: "rId2", type: REL.comments, target: `../comments${noteCount}.xml` },
        {
          id: legacyRel,
          type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing",
          target: `../drawings/vmlDrawing${noteCount}.vml`,
        },
      );
    }
    if (sheetRels.length)
      extra.push({
        path: `xl/worksheets/_rels/sheet${index + 1}.xml.rels`,
        content: Buffer.from(relationships(sheetRels)),
      });
    return sheetXml(sheet, index, styles, results[index], drawingRel, evaluator.spills(index), defined, legacyRel);
  });
  // Filterbereiche kennt Excel zusätzlich als versteckten Namen, den Druckbereich als „Print_Area“.
  const names = [
    ...(model.names ?? []).flatMap((entry) => {
      const area = parseArea(entry.range);
      return area
        ? [
            `<definedName name="${esc(entry.name)}">${esc(absolute(entry.sheet, area.c1, area.r1, area.c2, area.r2))}</definedName>`,
          ]
        : [];
    }),
    ...model.sheets.map((sheet, index) => {
      const area = sheet.filter ? parseArea(sheet.filter.range) : null;
      return area
        ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${index}" hidden="1">${esc(absolute(sheet.name, area.c1, area.r1, area.c2, area.r2))}</definedName>`
        : "";
    }),
    ...model.sheets.map((sheet, index) => {
      const area = sheet.print.area ? parseArea(sheet.print.area) : null;
      return area
        ? `<definedName name="_xlnm.Print_Area" localSheetId="${index}">${esc(absolute(sheet.name, area.c1, area.r1, area.c2, area.r2))}</definedName>`
        : "";
    }),
  ].join("");
  const workbook = `${XML_HEAD}<workbook ${MAIN}><bookViews><workbookView/></bookViews><sheets>${model.sheets
    .map((sheet, index) => `<sheet name="${esc(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join(
      "",
    )}</sheets>${names ? `<definedNames>${names}</definedNames>` : ""}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
  const rels = relationships([
    ...model.sheets.map((_, index) => ({
      id: `rId${index + 1}`,
      type: REL.worksheet,
      target: `worksheets/sheet${index + 1}.xml`,
    })),
    { id: `rId${model.sheets.length + 1}`, type: REL.styles, target: "styles.xml" },
    ...(dynamic
      ? [
          {
            id: `rId${model.sheets.length + 2}`,
            type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata",
            target: "metadata.xml",
          },
        ]
      : []),
  ]);
  const sheetEntries = sheets.map((xml, index) => ({
    path: `xl/worksheets/sheet${index + 1}.xml`,
    content: Buffer.from(xml),
  }));
  const entries: ZipEntry[] = [
    {
      path: "[Content_Types].xml",
      content: Buffer.from(
        contentTypes(
          [
            ["/xl/workbook.xml", `${main}.sheet.main+xml`],
            ["/xl/styles.xml", `${main}.styles+xml`],
            ...model.sheets.map(
              (_, index) => [`/xl/worksheets/sheet${index + 1}.xml`, `${main}.worksheet+xml`] as [string, string],
            ),
            ...types,
            ...(dynamic ? [["/xl/metadata.xml", `${main}.sheetMetadata+xml`] as [string, string]] : []),
          ],
          false,
        ),
      ),
    },
    { path: "_rels/.rels", content: Buffer.from(rootRels("xl/workbook.xml")) },
    { path: "docProps/core.xml", content: Buffer.from(coreProps(meta.title, meta.author)) },
    { path: "docProps/app.xml", content: Buffer.from(appProps()) },
    { path: "xl/workbook.xml", content: Buffer.from(workbook) },
    { path: "xl/_rels/workbook.xml.rels", content: Buffer.from(rels) },
    // Stile erst nach den Blättern: Regeln der bedingten Formatierung ergänzen sie.
    { path: "xl/styles.xml", content: Buffer.from(styles.xml()) },
    ...sheetEntries,
    ...extra,
    ...(dynamic ? [{ path: "xl/metadata.xml", content: Buffer.from(DYNAMIC_METADATA) }] : []),
  ];
  entries.push({ path: MODEL_PART, content: packModel(model, checkOf(entries), new Map()) });
  return createZip(entries);
}

// ---------- Lesen ----------

const BUILTIN_FORMATS: Record<number, NumberFormat> = {
  1: "integer",
  2: "number",
  3: "integer",
  4: "number",
  9: "percent",
  10: "percent",
  14: "date",
  15: "date",
  16: "date",
  17: "date",
  20: "time",
  21: "time",
  22: "datetime",
  49: "text",
};

function formatOfCode(code: string): { fmt: NumberFormat; dec?: number } {
  const lower = code
    .replace(/"[^"]*"/g, (match) => (/chf/i.test(match) ? "chf" : match.includes("€") ? "eur" : ""))
    .replace(/\[[^\]]*\]/g, (match) => (/chf/i.test(match) ? "chf" : match.includes("€") ? "eur" : ""))
    .toLowerCase();
  const decimals = /0\.(0+)/.exec(code)?.[1].length ?? 0;
  if (lower.includes("chf")) return { fmt: "chf", dec: decimals };
  if (lower.includes("€") || lower.includes("eur")) return { fmt: "eur", dec: decimals };
  if (code.includes("%")) return { fmt: "percent", dec: decimals };
  if (/[dy]/.test(lower) && /h/.test(lower)) return { fmt: "datetime" };
  if (/[dy]/.test(lower)) return { fmt: "date" };
  if (/h/.test(lower)) return { fmt: "time" };
  if (code === "@") return { fmt: "text" };
  if (code.includes("#,##0") || code.includes("0"))
    return decimals ? { fmt: "number", dec: decimals } : { fmt: "integer" };
  return { fmt: "general" };
}

function colorOf(node: XmlNode | undefined) {
  const rgb = node?.attrs.rgb;
  return rgb && /^[0-9a-f]{8}$/i.test(rgb) ? `#${rgb.slice(2).toLowerCase()}` : undefined;
}

const BORDER_STYLES: Record<string, CellStyle["bw"]> = {
  thin: "thin",
  hair: "thin",
  dotted: "thin",
  dashed: "thin",
  dashDot: "thin",
  dashDotDot: "thin",
  medium: "medium",
  mediumDashed: "medium",
  mediumDashDot: "medium",
  mediumDashDotDot: "medium",
  slantDashDot: "medium",
  thick: "thick",
  double: "thick",
};
const FONT_NAMES_KNOWN = ["Calibri", "Arial", "Cambria", "Georgia", "Times New Roman", "Verdana", "Courier New"];

// Formatierungen der bedingten Formatierung (dxf) aus styles.xml.
function readDxfs(xml: Buffer | undefined): RuleStyle[] {
  if (!xml) return [];
  const root = parseXml(xml.toString("utf8"));
  return childrenOf(find(root, "dxfs"), "dxf").map((dxf) => {
    const style: RuleStyle = {};
    const font = child(dxf, "font");
    if (font && child(font, "b") && child(font, "b")?.attrs.val !== "0") style.b = true;
    const color = colorOf(child(font, "color"));
    if (color) style.color = color;
    const pattern = child(child(dxf, "fill"), "patternFill");
    const fill = colorOf(child(pattern, "bgColor")) ?? colorOf(child(pattern, "fgColor"));
    if (fill) style.fill = fill;
    return style;
  });
}

function readStyles(xml: Buffer | undefined): CellStyle[] {
  if (!xml) return [];
  const root = parseXml(xml.toString("utf8"));
  const codes = new Map<number, string>();
  for (const numFmt of findAll(root, "numFmt")) codes.set(Number(numFmt.attrs.numFmtId), numFmt.attrs.formatCode);
  const fonts = childrenOf(find(root, "fonts"), "font");
  const fills = childrenOf(find(root, "fills"), "fill");
  const borders = childrenOf(find(root, "borders"), "border");
  return childrenOf(find(root, "cellXfs"), "xf").map((xf) => {
    const style: CellStyle = {};
    const font = fonts[Number(xf.attrs.fontId ?? 0)];
    if (font) {
      if (child(font, "b") && child(font, "b")?.attrs.val !== "0") style.b = true;
      if (child(font, "i") && child(font, "i")?.attrs.val !== "0") style.i = true;
      if (child(font, "u")) style.u = true;
      if (child(font, "strike")) style.s = true;
      const color = colorOf(child(font, "color"));
      if (color && color !== "#000000") style.color = color;
      const size = Number(child(font, "sz")?.attrs.val);
      if (size && size !== 11) style.size = Math.round(size);
      const name = child(font, "name")?.attrs.val;
      const known = FONT_NAMES_KNOWN.find((item) => item.toLowerCase() === name?.toLowerCase());
      if (known && known !== "Calibri") style.font = known;
    }
    const pattern = child(fills[Number(xf.attrs.fillId ?? 0)], "patternFill");
    if (pattern?.attrs.patternType === "solid") {
      const fill = colorOf(child(pattern, "fgColor"));
      if (fill && fill !== "#ffffff") style.fill = fill;
    }
    const border = borders[Number(xf.attrs.borderId ?? 0)];
    if (border) {
      const sides = (["top", "bottom", "left", "right"] as const).map((side) => child(border, side));
      const lines = sides.filter((side) => side?.attrs.style && side.attrs.style !== "none");
      if (lines.length) {
        const [top, bottom, left, right] = sides.map((side) =>
          Boolean(side?.attrs.style && side.attrs.style !== "none"),
        );
        if (top && bottom && left && right) style.border = true;
        else {
          if (top) style.bt = true;
          if (bottom) style.bb = true;
          if (left) style.bl = true;
          if (right) style.br = true;
        }
        const weight = BORDER_STYLES[lines[0]!.attrs.style] ?? "thin";
        if (weight !== "thin") style.bw = weight;
        const color = colorOf(child(lines[0], "color"));
        if (color && color !== DEFAULT_BORDER_COLOR) style.bc = color;
      }
    }
    const id = Number(xf.attrs.numFmtId ?? 0);
    const code = codes.get(id);
    const format = code ? formatOfCode(code) : BUILTIN_FORMATS[id] ? { fmt: BUILTIN_FORMATS[id] } : null;
    if (format && format.fmt !== "general") {
      style.fmt = format.fmt;
      if ("dec" in format && format.dec !== undefined && format.dec !== decimalsOf({ fmt: format.fmt }))
        style.dec = format.dec;
    }
    const alignment = child(xf, "alignment");
    const horizontal = alignment?.attrs.horizontal;
    if (horizontal === "left" || horizontal === "center" || horizontal === "right") style.align = horizontal;
    const vertical = alignment?.attrs.vertical;
    if (vertical === "top" || vertical === "bottom") style.valign = vertical;
    if (vertical === "center") style.valign = "middle";
    if (alignment?.attrs.wrapText === "1") style.wrap = true;
    if (child(xf, "protection")?.attrs.locked === "0") style.unlocked = true;
    const indent = Number(alignment?.attrs.indent ?? 0);
    if (indent >= 1) style.indent = Math.min(10, Math.trunc(indent));
    return style;
  });
}

// Text aus der Datei so ablegen, dass er Text bleibt („007“, „=“ am Anfang, Datum als Text).
const asText = (text: string) => (parseInput(text).type === "text" && !text.startsWith("'") ? text : `'${text}`);

type FilterVisible = Map<number, { values: Set<string>; blank: boolean }>;
const RULE_TYPES: Record<string, RuleOp> = {
  greaterThan: "gt",
  lessThan: "lt",
  greaterThanOrEqual: "ge",
  lessThanOrEqual: "le",
  equal: "eq",
  notEqual: "ne",
  between: "between",
};
// Vergleichswert aus einer Regel-Formel: Zahl oder Text in Anführungszeichen.
const formulaOperand = (formula: string) => {
  const text = /^"([\s\S]*)"$/.exec(formula.trim());
  return text ? text[1].replace(/""/g, '"') : formula.trim();
};

function readSheet(
  xml: Buffer,
  name: string,
  shared: string[],
  styles: CellStyle[],
  dxfs: RuleStyle[],
): { sheet: Sheet; filterVisible: FilterVisible | null } {
  const root = parseXml(xml.toString("utf8"));
  const sheet = newSheet(name);
  const sharedFormulas = new Map<string, { formula: string; col: number; row: number }>();
  let maxRow = 0;
  let maxCol = 0;
  const hiddenRows: number[] = [];
  // Bereiche von Matrixformeln: die übrigen Zellen darin sind nur berechnete Werte.
  const arrays: { anchor: string; area: Area }[] = [];
  for (const row of findAll(find(root, "sheetData"), "row")) {
    const rowIndex = Number(row.attrs.r) - 1;
    if (row.attrs.hidden === "1" && rowIndex < 10_000) hiddenRows.push(rowIndex);
    if (row.attrs.customHeight === "1" && row.attrs.ht)
      sheet.rows[String(rowIndex)] = Math.round(Number(row.attrs.ht) / 0.75);
    for (const c of childrenOf(row, "c")) {
      const ref = parseCellKey(c.attrs.r ?? "");
      if (!ref || ref.row >= 10_000 || ref.col >= 200) continue;
      const style = styles[Number(c.attrs.s ?? 0)];
      const f = child(c, "f");
      const v = child(c, "v");
      if (f?.attrs.t === "array" && f.attrs.ref) {
        const area = parseArea(f.attrs.ref);
        if (area) arrays.push({ anchor: cellKey(ref.col, ref.row), area });
      }
      // Zellen im Überlaufbereich: nur das Format übernehmen, der Wert entsteht wieder aus der Formel.
      const spilled =
        !f &&
        arrays.some(
          (item) =>
            item.anchor !== cellKey(ref.col, ref.row) &&
            ref.col >= item.area.c1 &&
            ref.col <= item.area.c2 &&
            ref.row >= item.area.r1 &&
            ref.row <= item.area.r2,
        );
      let raw = "";
      if (f) {
        let formula = textOf(f);
        if (f.attrs.t === "shared" && f.attrs.si !== undefined) {
          const master = sharedFormulas.get(f.attrs.si);
          if (formula) sharedFormulas.set(f.attrs.si, { formula, col: ref.col, row: ref.row });
          else if (master) formula = shiftFormula(master.formula, ref.col - master.col, ref.row - master.row);
        }
        if (formula) raw = `=${fromExcelFormula(formula)}`;
      }
      if (!raw) {
        const type = c.attrs.t;
        if (type === "s") raw = asText(shared[Number(textOf(v))] ?? "");
        else if (type === "inlineStr") raw = asText(textOf(child(c, "is")));
        else if (type === "str") raw = asText(textOf(v));
        else if (type === "b") raw = textOf(v) === "1" ? "WAHR" : "FALSCH";
        else if (type === "e") raw = asText(textOf(v));
        else raw = textOf(v);
      }
      if (spilled) raw = "";
      const cleanStyle = style && Object.keys(style).length ? style : undefined;
      if (!raw && !cleanStyle) continue;
      sheet.cells[cellKey(ref.col, ref.row)] = cleanStyle ? { v: raw, s: cleanStyle } : { v: raw };
      maxRow = Math.max(maxRow, ref.row + 1);
      maxCol = Math.max(maxCol, ref.col + 1);
    }
  }
  const hiddenCols: number[] = [];
  for (const col of findAll(find(root, "cols"), "col")) {
    if (col.attrs.hidden === "1")
      for (let index = Number(col.attrs.min) - 1; index < Math.min(Number(col.attrs.max), 200); index += 1)
        hiddenCols.push(index);
    const width = Number(col.attrs.width);
    if (!width || col.attrs.customWidth === "0") continue;
    for (let index = Number(col.attrs.min) - 1; index < Math.min(Number(col.attrs.max), 200); index += 1)
      if (Math.abs(pxWidth(width) - DEFAULT_COL_WIDTH) > 2) sheet.cols[String(index)] = pxWidth(width);
  }
  sheet.merges = findAll(find(root, "mergeCells"), "mergeCell")
    .map((merge) => merge.attrs.ref)
    .filter((ref): ref is string => typeof ref === "string" && ref.includes(":"));
  const pane = find(find(root, "sheetViews"), "pane");
  if (pane?.attrs.state === "frozen" || pane?.attrs.state === "frozenSplit")
    sheet.freeze = {
      rows: Math.trunc(Number(pane.attrs.ySplit ?? 0)),
      cols: Math.trunc(Number(pane.attrs.xSplit ?? 0)),
    };
  sheet.rowCount = Math.min(10_000, Math.max(100, maxRow + 20));
  sheet.colCount = Math.min(200, Math.max(26, maxCol + 2));
  const view = find(find(root, "sheetViews"), "sheetView");
  if (view?.attrs.showGridLines === "0") sheet.showGrid = false;
  const protection = find(root, "sheetProtection");
  if (protection && (protection.attrs.sheet === "1" || protection.attrs.sheet === "true")) sheet.protected = true;
  // Zeilen, die ein Filter ausblendet, ergeben sich wieder aus dem Filter.
  let filterVisible: FilterVisible | null = null;
  const autoFilter = find(root, "autoFilter");
  const filterArea = autoFilter?.attrs.ref ? parseArea(autoFilter.attrs.ref) : null;
  if (filterArea && filterArea.r2 > filterArea.r1) {
    sheet.filter = { range: areaName(filterArea), hidden: {} };
    filterVisible = new Map();
    for (const column of childrenOf(autoFilter, "filterColumn")) {
      const filters = child(column, "filters");
      if (!filters) continue;
      filterVisible.set(filterArea.c1 + Number(column.attrs.colId ?? 0), {
        values: new Set(childrenOf(filters, "filter").map((item) => item.attrs.val ?? "")),
        blank: filters.attrs.blank === "1",
      });
    }
  }
  const filterRows = new Set<number>();
  if (filterArea && filterVisible?.size)
    for (let row = filterArea.r1 + 1; row <= filterArea.r2; row += 1) filterRows.add(row);
  sheet.hiddenRows = hiddenRows.filter((row) => !filterRows.has(row));
  sheet.hiddenCols = hiddenCols;
  for (const block of findAll(root, "conditionalFormatting")) {
    const range = (block.attrs.sqref ?? "").split(/\s+/)[0];
    const area = parseArea(range);
    if (!area) continue;
    for (const rule of childrenOf(block, "cfRule")) {
      // Farbskala und Datenbalken: Farben aus der Regel (Designfarben ohne RGB → Standardfarben).
      if (rule.attrs.type === "colorScale" || rule.attrs.type === "dataBar") {
        const scale = rule.attrs.type === "colorScale";
        const colors = childrenOf(child(rule, scale ? "colorScale" : "dataBar"), "color")
          .map((color) => color.attrs.rgb ?? "")
          .filter((rgb) => /^([0-9a-f]{2})?[0-9a-f]{6}$/i.test(rgb))
          .map((rgb) => `#${rgb.slice(-6).toLowerCase()}`);
        sheet.rules.push({
          id: `r${sheet.rules.length + 1}`,
          range: areaName(area),
          op: scale ? "scale" : "bar",
          value: "",
          value2: "",
          style: {},
          ...(colors.length ? { colors: colors.slice(0, scale ? 3 : 1) } : {}),
        });
        continue;
      }
      const style = dxfs[Number(rule.attrs.dxfId ?? -1)];
      if (!style || !Object.keys(style).length) continue;
      const formulas = childrenOf(rule, "formula").map(textOf);
      let op: RuleOp | null = null;
      let value = "";
      let value2 = "";
      if (rule.attrs.type === "cellIs" && RULE_TYPES[rule.attrs.operator ?? ""]) {
        op = RULE_TYPES[rule.attrs.operator];
        value = formulaOperand(formulas[0] ?? "");
        value2 = formulaOperand(formulas[1] ?? "");
      } else if (rule.attrs.type === "containsText") {
        op = "contains";
        value = rule.attrs.text ?? "";
      } else if (rule.attrs.type === "containsBlanks") op = "empty";
      else if (rule.attrs.type === "notContainsBlanks") op = "notEmpty";
      else if (rule.attrs.type === "duplicateValues") op = "duplicate";
      if (op)
        sheet.rules.push({
          id: `r${sheet.rules.length + 1}`,
          range: areaName(area),
          op,
          value,
          value2,
          style,
        });
    }
  }
  for (const item of findAll(root, "dataValidation")) {
    if (item.attrs.type !== "list") continue;
    const formula = textOf(child(item, "formula1")).trim();
    const inline = /^"([\s\S]*)"$/.exec(formula);
    const values = inline
      ? inline[1]
          .replace(/""/g, '"')
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [];
    const area = parseArea((item.attrs.sqref ?? "").split(/\s+/)[0]);
    if (area && values.length) sheet.validations.push({ range: areaName(area), values });
  }
  const setup = find(root, "pageSetup");
  sheet.print = {
    orientation: setup?.attrs.orientation === "landscape" ? "landscape" : "portrait",
    fit: find(find(root, "sheetPr"), "pageSetUpPr")?.attrs.fitToPage === "1",
    gridlines: find(root, "printOptions")?.attrs.gridLines === "1",
  };
  const headerFooter = find(root, "headerFooter");
  if (headerFooter) {
    const header = readHeaderFooter(textOf(child(headerFooter, "oddHeader")));
    const footer = readHeaderFooter(textOf(child(headerFooter, "oddFooter")));
    if (header.text) sheet.print.header = header.text;
    if (footer.text) sheet.print.footer = footer.text;
    if (header.pageNumbers || footer.pageNumbers) sheet.print.pageNumbers = true;
  }
  return { sheet, filterVisible };
}

// ---------- Diagramme aus Excel-Dateien ----------

const partRels = (files: Map<string, Buffer>, part: string) => {
  const map = new Map<string, string>();
  const xml = files.get(relsPathOf(part));
  if (xml)
    for (const rel of findAll(parseXml(xml.toString("utf8")), "Relationship"))
      if (rel.attrs.TargetMode !== "External") map.set(rel.attrs.Id, resolvePart(part, rel.attrs.Target));
  return map;
};
// Bezug in einer Diagrammreihe („'Tabelle 1'!$B$2:$B$5“) → Bereich auf dem eigenen Blatt.
function chartRef(formula: string, sheetName: string): Area | null {
  const match = /^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(formula.trim());
  if (!match) return null;
  const sheet = (match[1] ?? match[2]).replace(/''/g, "'");
  if (sheet.toLocaleLowerCase("de-CH") !== sheetName.toLocaleLowerCase("de-CH")) return null;
  return parseArea(match[3].replace(/\$/g, ""));
}
function readCharts(files: Map<string, Buffer>, sheetPath: string, sheet: Sheet): SheetChart[] {
  const sheetRels = partRels(files, sheetPath);
  const drawingId = find(parseXml(files.get(sheetPath)!.toString("utf8")), "drawing")?.attrs.id;
  const drawingPath = drawingId ? sheetRels.get(drawingId) : undefined;
  const drawingXml = drawingPath ? files.get(drawingPath) : undefined;
  if (!drawingPath || !drawingXml) return [];
  const drawingRels = partRels(files, drawingPath);
  // Pixel aus Zelle + Versatz (EMU).
  const left = (col: number) => {
    let x = 0;
    for (let index = 0; index < col; index += 1)
      x += sheet.hiddenCols.includes(index) ? 0 : (sheet.cols[String(index)] ?? DEFAULT_COL_WIDTH);
    return x;
  };
  const top = (row: number) => {
    let y = 0;
    for (let index = 0; index < row; index += 1)
      y += sheet.hiddenRows.includes(index) ? 0 : (sheet.rows[String(index)] ?? DEFAULT_ROW_HEIGHT);
    return y;
  };
  const point = (node: XmlNode | undefined) => {
    const number = (name: string) => Number(textOf(child(node, name)) || 0);
    return {
      x: left(number("col")) + number("colOff") / 9525,
      y: top(number("row")) + number("rowOff") / 9525,
    };
  };
  const charts: SheetChart[] = [];
  const anchors = parseXml(drawingXml.toString("utf8")).children.flatMap((root) =>
    root.children.filter((node) => node.name === "twoCellAnchor" || node.name === "oneCellAnchor"),
  );
  for (const anchor of anchors) {
    const chartId = find(anchor, "chart")?.attrs.id;
    const chartPath = chartId ? drawingRels.get(chartId) : undefined;
    const chartXml = chartPath ? files.get(chartPath) : undefined;
    if (!chartXml) continue;
    const root = parseXml(chartXml.toString("utf8"));
    const plot = find(root, "plotArea");
    const kind = plot?.children.find((node) => node.name.endsWith("Chart"));
    if (!kind) continue;
    const type: SheetChart["type"] =
      CHART_KINDS[kind.name] ?? (child(kind, "barDir")?.attrs.val === "bar" ? "bar" : "column");
    // Bereich aus allen Bezügen der Reihen (Namen, Beschriftungen, Werte).
    let area: Area | null = null;
    for (const series of findAll(kind, "ser"))
      for (const ref of [...findAll(series, "f")]) {
        const part = chartRef(textOf(ref), sheet.name);
        if (!part) continue;
        area = area
          ? {
              c1: Math.min(area.c1, part.c1),
              r1: Math.min(area.r1, part.r1),
              c2: Math.max(area.c2, part.c2),
              r2: Math.max(area.r2, part.r2),
            }
          : part;
      }
    if (!area) continue;
    const texts = chartTexts(root);
    const from = point(child(anchor, "from"));
    let size = { w: 480, h: 300 };
    const to = child(anchor, "to");
    if (to) {
      const end = point(to);
      size = { w: end.x - from.x, h: end.y - from.y };
    } else {
      const extent = child(anchor, "ext");
      if (extent) size = { w: Number(extent.attrs.cx) / 9525, h: Number(extent.attrs.cy) / 9525 };
    }
    charts.push({
      id: `c${charts.length + 1}`,
      type,
      range: areaName(area),
      title: texts.title.slice(0, 200),
      ...(texts.xTitle ? { xTitle: texts.xTitle.slice(0, 200) } : {}),
      ...(texts.yTitle ? { yTitle: texts.yTitle.slice(0, 200) } : {}),
      ...(texts.labels ? { labels: true } : {}),
      x: Math.max(0, Math.round(from.x)),
      y: Math.max(0, Math.round(from.y)),
      w: Math.min(2000, Math.max(160, Math.round(size.w))),
      h: Math.min(1500, Math.max(120, Math.round(size.h))),
    });
    if (charts.length >= 20) break;
  }
  return charts;
}

// ---------- Kommentare aus Excel-Dateien ----------

const THREADED = "http://schemas.microsoft.com/office/2017/10/relationships/threadedComment";
const PERSON = "http://schemas.microsoft.com/office/2017/10/relationships/person";

// Personen der Kommentar-Unterhaltungen (Excel 365) aus der Arbeitsmappe.
function readPersons(files: Map<string, Buffer>) {
  const persons = new Map<string, string>();
  const relsXml = files.get("xl/_rels/workbook.xml.rels");
  if (!relsXml) return persons;
  const rel = findAll(parseXml(relsXml.toString("utf8")), "Relationship").find((item) => item.attrs.Type === PERSON);
  const xml = rel ? files.get(resolvePart("xl/workbook.xml", rel.attrs.Target)) : undefined;
  if (xml)
    for (const person of findAll(parseXml(xml.toString("utf8")), "person"))
      persons.set(person.attrs.id ?? "", (person.attrs.displayName ?? "").slice(0, 120));
  return persons;
}

const excelDate = (value: string | undefined) => {
  const match = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/.exec(value ?? "");
  return match ? `${match[0]}Z` : "";
};

function readNotes(files: Map<string, Buffer>, sheetPath: string, persons: Map<string, string>) {
  const comments: Record<string, CommentThread> = {};
  const rels = new Map<string, string>();
  const relsXml = files.get(relsPathOf(sheetPath));
  if (relsXml)
    for (const rel of findAll(parseXml(relsXml.toString("utf8")), "Relationship"))
      if (rel.attrs.TargetMode !== "External") rels.set(rel.attrs.Type, resolvePart(sheetPath, rel.attrs.Target));
  // Neuere Unterhaltungen (mit Antworten) zuerst.
  const threadedPath = rels.get(THREADED);
  const threadedXml = threadedPath ? files.get(threadedPath) : undefined;
  if (threadedXml) {
    const byId = new Map<string, CommentThread>();
    for (const entry of findAll(parseXml(threadedXml.toString("utf8")), "threadedComment")) {
      const text = textOf(child(entry, "text")).trim().slice(0, 2000);
      const ref = (entry.attrs.ref ?? "").toUpperCase();
      if (!text || !parseCellKey(ref)) continue;
      const id = `x${(entry.attrs.id ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 36) || byId.size}`;
      const item = {
        id,
        author: persons.get(entry.attrs.personId ?? "") ?? "",
        date: excelDate(entry.attrs.dT),
        text,
      };
      const parent = entry.attrs.parentId ? byId.get(entry.attrs.parentId) : undefined;
      if (parent) parent.replies.push(item);
      else {
        const thread: CommentThread = { ...item, ...(entry.attrs.done === "1" ? { resolved: true } : {}), replies: [] };
        byId.set(entry.attrs.id ?? id, thread);
        comments[ref] = thread;
      }
    }
  }
  const notesPath = rels.get(REL.comments);
  const notesXml = notesPath ? files.get(notesPath) : undefined;
  if (!notesXml) return comments;
  const root = parseXml(notesXml.toString("utf8"));
  const authors = findAll(find(root, "authors"), "author").map((author) => textOf(author).slice(0, 120));
  for (const [index, note] of findAll(root, "comment").entries()) {
    const ref = (note.attrs.ref ?? "").toUpperCase();
    if (!parseCellKey(ref) || comments[ref]) continue;
    // Abschnitte: fett gedruckter „Name:“ beginnt einen Eintrag (so schreibt Excel den Namen in die Notiz).
    const entries: { author: string; text: string }[] = [];
    const text = child(note, "text");
    const runs = text ? (findAll(text, "r").length ? findAll(text, "r") : [text]) : [];
    for (const run of runs) {
      const value = textOf(child(run, "t") ?? run);
      const bold = Boolean(find(child(run, "rPr"), "b"));
      if (bold && /:\s*$/.test(value)) entries.push({ author: value.trim().replace(/:$/, ""), text: "" });
      else if (entries.length) entries[entries.length - 1].text += value;
      else entries.push({ author: authors[Number(note.attrs.authorId)] ?? "", text: value });
    }
    let resolved = false;
    const clean = entries
      .map((entry) => {
        let body = entry.text.trim();
        if (/\(erledigt\)$/.test(body)) {
          resolved = true;
          body = body.replace(/\s*\(erledigt\)$/, "");
        }
        return { author: entry.author, text: body.slice(0, 2000) };
      })
      .filter((entry) => entry.text);
    if (!clean.length) continue;
    const [head, ...replies] = clean;
    comments[ref] = {
      id: `n${index + 1}`,
      author: head.author,
      date: "",
      text: head.text,
      ...(resolved ? { resolved: true } : {}),
      replies: replies.map((reply, position) => ({
        id: `n${index + 1}r${position + 1}`,
        author: reply.author,
        date: "",
        text: reply.text,
      })),
    };
  }
  return comments;
}

export function readXlsx(bytes: Buffer): { model: SheetModel; imported: boolean } {
  const files = readZip(bytes);
  const workbookXml = files.get("xl/workbook.xml");
  if (!workbookXml) throw new Error("Keine Excel-Arbeitsmappe.");
  const stored = files.get(MODEL_PART);
  if (stored) {
    try {
      const parsed = unpackModel(stored, files);
      if (parsed.check === checkOf(files))
        return { model: cleanModel("sheet", parsed.model) as SheetModel, imported: false };
    } catch {
      // Beschädigtes Modell: aus der Datei lesen.
    }
  }
  const rels = new Map<string, string>();
  const relsXml = files.get("xl/_rels/workbook.xml.rels");
  if (relsXml)
    for (const rel of findAll(parseXml(relsXml.toString("utf8")), "Relationship"))
      rels.set(rel.attrs.Id, resolvePart("xl/workbook.xml", rel.attrs.Target));
  const shared: string[] = [];
  const sharedXml = files.get("xl/sharedStrings.xml");
  if (sharedXml)
    for (const si of findAll(parseXml(sharedXml.toString("utf8")), "si"))
      // Lautschrift (rPh) gehört nicht zum Text.
      shared.push(
        si.children
          .filter((part) => part.name !== "rPh")
          .map(textOf)
          .join(""),
      );
  const styles = readStyles(files.get("xl/styles.xml"));
  const dxfs = readDxfs(files.get("xl/styles.xml"));
  const persons = readPersons(files);
  const read = findAll(parseXml(workbookXml.toString("utf8")), "sheet").flatMap((entry) => {
    const path = rels.get(entry.attrs.id ?? "");
    const xml = path ? files.get(path) : undefined;
    if (!path || !xml) return [];
    const result = readSheet(xml, entry.attrs.name ?? "Tabelle", shared, styles, dxfs);
    result.sheet.charts = readCharts(files, path, result.sheet);
    const notes = readNotes(files, path, persons);
    if (Object.keys(notes).length) result.sheet.comments = notes;
    return [result];
  });
  // Benannte Bereiche und Druckbereiche (Namen mit Formeln oder mehreren Bereichen bleiben weg).
  const names: { name: string; sheet: string; range: string }[] = [];
  for (const entry of findAll(parseXml(workbookXml.toString("utf8")), "definedName")) {
    const name = entry.attrs.name ?? "";
    const target = /^(?:'((?:[^']|'')+)'|([^!'",()]+))!(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)$/i.exec(
      textOf(entry).trim(),
    );
    if (!target) continue;
    const sheet = (target[1] ?? target[2]).replace(/''/g, "'");
    const area = parseArea(target[3].replace(/\$/g, "").toUpperCase());
    if (!area) continue;
    if (name === "_xlnm.Print_Area") {
      const index = Number(entry.attrs.localSheetId);
      const owner = read[index]?.sheet;
      if (owner && owner.name.toLocaleLowerCase("de-CH") === sheet.toLocaleLowerCase("de-CH"))
        owner.print.area = areaName(area);
      continue;
    }
    if (entry.attrs.hidden === "1" || name.startsWith("_xlnm.")) continue;
    names.push({ name, sheet, range: areaName(area) });
  }
  const model = cleanModel("sheet", {
    kind: "sheet",
    sheets: read.map((item) => item.sheet),
    names,
  }) as SheetModel;
  // Filter: in der Datei stehen die sichtbaren Werte, im Modell die ausgeblendeten.
  if (read.some((item) => item.filterVisible?.size)) {
    const results = evaluateWorkbook(model).all();
    model.sheets.forEach((sheet, index) => {
      const visible = read[index]?.filterVisible;
      const area = sheet.filter ? parseArea(sheet.filter.range) : null;
      if (!visible?.size || !area || !sheet.filter) return;
      for (const [col, allowed] of visible) {
        const hidden = new Set<string>();
        for (let row = area.r1 + 1; row <= area.r2; row += 1) {
          const key = cellKey(col, row);
          const text = formatValue(results[index].get(key) ?? null, sheet.cells[key]?.s);
          if (text === "" ? !allowed.blank : !allowed.values.has(text)) hidden.add(text);
        }
        if (hidden.size) sheet.filter.hidden[String(col)] = [...hidden];
      }
    });
  }
  return { model, imported: true };
}
