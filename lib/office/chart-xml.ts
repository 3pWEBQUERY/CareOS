import type { ChartType } from "./model";
import { XML_HEAD } from "./package";
import { CHART_COLORS } from "./sheet-features";
import { child, esc, find, findAll, parseXml, textOf, type XmlNode } from "./xml";

// Diagramm als DrawingML-Teil (chartN.xml) – gleich für Excel (Bezug aufs Blatt) und PowerPoint (eingebettete Tabelle).

export type ChartSpec = {
  type: ChartType;
  title: string;
  categories: string[];
  catRef?: string;
  series: { name: string; values: number[]; nameRef?: string; valRef?: string }[];
  // Beziehung zur eingebetteten Arbeitsmappe (PowerPoint: „Daten bearbeiten“).
  externalRel?: string;
  // Titel der Kategorien- und der Werteachse, Werte an den Datenpunkten.
  xTitle?: string;
  yTitle?: string;
  labels?: boolean;
};

const CHART_NS =
  'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const solid = (color: string) =>
  `<c:spPr><a:solidFill><a:srgbClr val="${color.slice(1).toUpperCase()}"/></a:solidFill></c:spPr>`;
const lineFill = (color: string) =>
  `<c:spPr><a:ln w="28575" cap="rnd"><a:solidFill><a:srgbClr val="${color.slice(1).toUpperCase()}"/></a:solidFill><a:round/></a:ln></c:spPr>`;
const strCache = (items: string[]) =>
  `<c:strCache><c:ptCount val="${items.length}"/>${items.map((item, index) => `<c:pt idx="${index}"><c:v>${esc(item)}</c:v></c:pt>`).join("")}</c:strCache>`;
const numCache = (items: number[]) =>
  `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${items.length}"/>${items.map((item, index) => `<c:pt idx="${index}"><c:v>${item}</c:v></c:pt>`).join("")}</c:numCache>`;
const strLit = (items: string[]) =>
  `<c:strLit><c:ptCount val="${items.length}"/>${items.map((item, index) => `<c:pt idx="${index}"><c:v>${esc(item)}</c:v></c:pt>`).join("")}</c:strLit>`;
const numLit = (items: number[]) =>
  `<c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="${items.length}"/>${items.map((item, index) => `<c:pt idx="${index}"><c:v>${item}</c:v></c:pt>`).join("")}</c:numLit>`;

const richTitle = (text: string, size: number, rotate = false) =>
  `<c:title><c:tx><c:rich><a:bodyPr${rotate ? ' rot="-5400000" vert="horz"' : ""}/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}" b="1"/></a:pPr><a:r><a:rPr lang="de-CH" sz="${size}" b="1"/><a:t>${esc(text)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
const DATA_LABELS =
  '<c:dLbls><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>';

export function chartSpaceXml(spec: ChartSpec) {
  const colors = CHART_COLORS;
  const labels = spec.labels ? DATA_LABELS : "";
  const series = (spec.type === "pie" ? spec.series.slice(0, 1) : spec.series).map((item, index) => {
    const tx = item.nameRef
      ? `<c:tx><c:strRef><c:f>${esc(item.nameRef)}</c:f>${strCache([item.name])}</c:strRef></c:tx>`
      : `<c:tx><c:v>${esc(item.name)}</c:v></c:tx>`;
    const cat = !spec.categories.length
      ? ""
      : spec.catRef
        ? `<c:cat><c:strRef><c:f>${esc(spec.catRef)}</c:f>${strCache(spec.categories)}</c:strRef></c:cat>`
        : `<c:cat>${strLit(spec.categories)}</c:cat>`;
    const val = item.valRef
      ? `<c:val><c:numRef><c:f>${esc(item.valRef)}</c:f>${numCache(item.values)}</c:numRef></c:val>`
      : `<c:val>${numLit(item.values)}</c:val>`;
    const color = colors[index % colors.length];
    const head = `<c:idx val="${index}"/><c:order val="${index}"/>${tx}`;
    if (spec.type === "pie") {
      const points = item.values
        .map(
          (_, point) =>
            `<c:dPt><c:idx val="${point}"/><c:bubble3D val="0"/>${solid(colors[point % colors.length])}</c:dPt>`,
        )
        .join("");
      return `<c:ser>${head}${points}${labels}${cat}${val}</c:ser>`;
    }
    if (spec.type === "line")
      return `<c:ser>${head}${lineFill(color)}<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>${labels}${cat}${val}<c:smooth val="0"/></c:ser>`;
    return `<c:ser>${head}${solid(color)}<c:invertIfNegative val="0"/>${labels}${cat}${val}</c:ser>`;
  });
  const axes = (horizontal: boolean) =>
    `<c:catAx><c:axId val="500000001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? "l" : "b"}"/>${spec.xTitle ? richTitle(spec.xTitle, 1000, horizontal) : ""}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="500000002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx><c:valAx><c:axId val="500000002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? "b" : "l"}"/><c:majorGridlines/>${spec.yTitle ? richTitle(spec.yTitle, 1000, !horizontal) : ""}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="500000001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;
  const ids = '<c:axId val="500000001"/><c:axId val="500000002"/>';
  let plot: string;
  if (spec.type === "pie")
    plot = `<c:pieChart><c:varyColors val="1"/>${series.join("")}<c:firstSliceAng val="0"/></c:pieChart>`;
  else if (spec.type === "line")
    plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series.join("")}<c:marker val="1"/>${ids}</c:lineChart>${axes(false)}`;
  else
    plot = `<c:barChart><c:barDir val="${spec.type === "bar" ? "bar" : "col"}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series.join("")}<c:gapWidth val="150"/>${ids}</c:barChart>${axes(spec.type === "bar")}`;
  const title = spec.title
    ? `${richTitle(spec.title, 1400)}<c:autoTitleDeleted val="0"/>`
    : '<c:autoTitleDeleted val="1"/>';
  const external = spec.externalRel
    ? `<c:externalData r:id="${spec.externalRel}"><c:autoUpdate val="0"/></c:externalData>`
    : "";
  return `${XML_HEAD}<c:chartSpace ${CHART_NS}><c:roundedCorners val="0"/><c:chart>${title}<c:plotArea><c:layout/>${plot}</c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>${external}</c:chartSpace>`;
}

// Diagrammart aus dem Element im Zeichnungsbereich (fremde Arten auf die nächste eigene abgebildet).
export const CHART_KINDS: Record<string, ChartType> = {
  lineChart: "line",
  line3DChart: "line",
  areaChart: "line",
  area3DChart: "line",
  scatterChart: "line",
  radarChart: "line",
  pieChart: "pie",
  pie3DChart: "pie",
  doughnutChart: "pie",
  ofPieChart: "pie",
};

// Titel, Achsentitel und Datenbeschriftungen eines Diagramms (Titel steht direkt unter c:chart, Achsentitel in den Achsen).
export function chartTexts(root: XmlNode) {
  const chart = find(root, "chart");
  const textIn = (node: XmlNode | undefined) => (node ? findAll(node, "t").map(textOf).join("") : "");
  const plot = find(chart, "plotArea");
  const labels = findAll(plot, "dLbls").some((node) => child(node, "showVal")?.attrs.val === "1");
  return {
    title: textIn(child(chart, "title")),
    xTitle: textIn(child(child(plot, "catAx") ?? child(plot, "dateAx"), "title")),
    yTitle: textIn(child(child(plot, "valAx"), "title")),
    labels,
  };
}

// Werte aus den zwischengespeicherten Daten eines Diagramms (für Diagramme ohne eigenes Blatt, z. B. in PowerPoint).
export function readChartSpace(xml: string): Omit<ChartSpec, "externalRel" | "catRef"> | null {
  const root = parseXml(xml);
  const plot = find(root, "plotArea");
  const kind = plot?.children.find((node) => node.name.endsWith("Chart"));
  if (!kind) return null;
  const type = CHART_KINDS[kind.name] ?? (child(kind, "barDir")?.attrs.val === "bar" ? "bar" : "column");
  const points = (node: XmlNode | undefined) => {
    const list: string[] = [];
    for (const pt of findAll(node, "pt")) list[Number(pt.attrs.idx ?? list.length)] = textOf(child(pt, "v"));
    return Array.from(list, (item) => item ?? "");
  };
  const all = findAll(kind, "ser");
  const categories = points(child(all[0], "cat"));
  const series = all.map((ser, index) => {
    const tx = child(ser, "tx");
    const name = (child(tx, "v") ? textOf(child(tx, "v")) : points(tx)[0]) || `Reihe ${index + 1}`;
    const values = points(child(ser, "val")).map((value) => (Number.isFinite(Number(value)) ? Number(value) : 0));
    return { name, values };
  });
  const count = Math.max(categories.length, ...series.map((item) => item.values.length));
  return {
    type,
    ...chartTexts(root),
    categories: Array.from({ length: count }, (_, index) => categories[index] ?? String(index + 1)),
    series: series.map((item) => ({
      name: item.name,
      values: Array.from({ length: count }, (_, index) => item.values[index] ?? 0),
    })),
  };
}
