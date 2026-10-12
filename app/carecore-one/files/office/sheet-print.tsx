import { cellKey, parseArea, type Value } from "@/lib/office/formula";
import { DEFAULT_COL_WIDTH, formatValue, usedRange, type Sheet } from "@/lib/office/model";
import { chartData, edgesAt, type RuleLook } from "@/lib/office/sheet-features";
import { mergesOf } from "@/lib/office/sheet-ops";
import { ChartSvg } from "./sheet-panels";
import { barStyle } from "./sheet-shared";

// Druckansicht eines Blatts (Zellen, Diagramme, Kopf- und Fusszeile).
export function SheetPrint({
  sheet,
  hiddenRows,
  valueOf,
  textOf,
  ruleStyle,
}: {
  sheet: Sheet;
  hiddenRows: Set<number>;
  valueOf: (col: number, row: number) => Value;
  textOf: (col: number, row: number) => string;
  ruleStyle: (col: number, row: number) => RuleLook | undefined;
}) {
  const used = usedRange(sheet);
  // Druckbereich: nur diese Zellen (ohne Druckbereich das ganze benutzte Blatt).
  const printArea = sheet.print.area ? parseArea(sheet.print.area) : null;
  const bounds = printArea ?? { c1: 0, r1: 0, c2: used.cols - 1, r2: used.rows - 1 };
  const merges = mergesOf(sheet);
  const hiddenCols = new Set(sheet.hiddenCols);
  const covered = new Set<string>();
  for (const merge of merges)
    for (let row = merge.r1; row <= merge.r2; row += 1)
      for (let col = merge.c1; col <= merge.c2; col += 1)
        if (row !== merge.r1 || col !== merge.c1) covered.add(cellKey(col, row));
  const visibleCols = Array.from({ length: Math.max(0, bounds.c2 - bounds.c1 + 1) }, (_, at) => bounds.c1 + at).filter(
    (col) => !hiddenCols.has(col),
  );
  const line = (edge: { width: number; color: string } | null) =>
    edge ? `${Math.max(1, edge.width)}px solid ${edge.color}` : undefined;
  const rows = [];
  for (let row = bounds.r1; row <= bounds.r2; row += 1) {
    if (hiddenRows.has(row)) continue;
    const cells = [];
    for (const col of visibleCols) {
      const key = cellKey(col, row);
      if (covered.has(key)) continue;
      const merge = merges.find((item) => item.c1 === col && item.r1 === row);
      const cell = sheet.cells[key];
      const value = valueOf(col, row);
      const style = cell?.s;
      const rule = ruleStyle(col, row);
      const edges = edgesAt(sheet, col, row);
      cells.push(
        <td
          key={key}
          colSpan={merge ? merge.c2 - merge.c1 + 1 : undefined}
          rowSpan={merge ? merge.r2 - merge.r1 + 1 : undefined}
          style={{
            fontWeight: style?.b || rule?.b ? 700 : undefined,
            fontStyle: style?.i ? "italic" : undefined,
            textDecoration:
              [style?.u ? "underline" : "", style?.s ? "line-through" : ""].filter(Boolean).join(" ") || undefined,
            color: rule?.color ?? style?.color,
            backgroundColor: rule?.fill ?? style?.fill,
            ...barStyle(rule),
            textAlign: style?.align ?? (typeof value === "number" ? "right" : "left"),
            verticalAlign: style?.valign === "top" ? "top" : style?.valign === "middle" ? "middle" : "bottom",
            whiteSpace: style?.wrap ? "pre-wrap" : "pre",
            fontSize: style?.size ? `${style.size}pt` : undefined,
            fontFamily: style?.font ? `"${style.font}", Calibri, Carlito, Arial, sans-serif` : undefined,
            paddingLeft: style?.indent ? 5 + style.indent * 8 : undefined,
            borderTop: line(edges?.top ?? null),
            borderBottom: line(edges?.bottom ?? null),
            borderLeft: line(edges?.left ?? null),
            borderRight: line(edges?.right ?? null),
          }}
        >
          {formatValue(value, style)}
        </td>,
      );
    }
    rows.push(
      <tr key={row} style={{ height: sheet.rows[String(row)] ?? undefined }}>
        {cells}
      </tr>,
    );
  }
  const { orientation, fit, gridlines, header, footer, pageNumbers } = sheet.print;
  // Kopf- und Fusszeile in den Seitenrändern jeder gedruckten Seite (mit „Seite 1 von 3“).
  const cssText = (text: string) => JSON.stringify(text.replace(/[\r\n\u2028\u2029]+/g, " "));
  const marginBoxes = [
    header ? `@top-center { content: ${cssText(header)}; }` : "",
    footer ? `@bottom-left { content: ${cssText(footer)}; }` : "",
    pageNumbers ? '@bottom-right { content: "Seite " counter(page) " von " counter(pages); }' : "",
  ].join(" ");
  return (
    <div className={`office-print-only sheet-print ${gridlines ? "gridlines" : ""} ${fit ? "fit" : ""}`}>
      <h1>{sheet.name}</h1>
      <table>
        <colgroup>
          {visibleCols.map((col) => (
            <col key={col} style={{ width: sheet.cols[String(col)] ?? DEFAULT_COL_WIDTH }} />
          ))}
        </colgroup>
        <tbody>{rows}</tbody>
      </table>
      {/* Mit Druckbereich nur die Zellen, sonst auch die Diagramme des Blatts. */}
      {(printArea ? [] : sheet.charts).map((chart) => {
        const area = parseArea(chart.range);
        return area ? (
          <div key={chart.id} className="sheet-print-chart">
            <ChartSvg
              data={chartData(area, valueOf, textOf)}
              type={chart.type}
              title={chart.title}
              width={chart.w}
              height={chart.h}
              xTitle={chart.xTitle}
              yTitle={chart.yTitle}
              labels={chart.labels}
            />
          </div>
        ) : null;
      })}
      <style>
        {`@media print { @page { size: A4 ${orientation}; margin: ${header ? 16 : 12}mm 12mm ${footer || pageNumbers ? 16 : 12}mm; font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #5b6b6d; ${marginBoxes} } }`}
      </style>
    </div>
  );
}
