"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowRight,
  ChartBar,
  ChartBarHorizontal,
  ChartLine,
  ChartPie,
  Circle,
  ColumnsPlusLeft,
  ColumnsPlusRight,
  CopySimple,
  LineSegment,
  PaintBucket,
  PencilSimple,
  Rectangle,
  RowsPlusBottom,
  RowsPlusTop,
  Square,
  StackMinus,
  StackPlus,
  Trash,
  Triangle,
} from "@phosphor-icons/react";
import {
  ITEM_LIMITS,
  ITEM_TEXT_SIZE,
  SLIDE_SHAPES,
  SLIDE_SIZE,
  TABLE_TEXT_SIZE,
  contrastText,
  type ChartType,
  type SlideItem,
  type SlideShape,
} from "@/lib/office/model";
import { CHART_LABELS } from "@/lib/office/sheet-features";
import { ChartSvg, SheetDialog } from "./sheet-panels";
import { ColorPicker, MenuList, ToolButton, ToolPopover, ToolSeparator } from "./office-ui";

// Freie Objekte auf der Folie: Textfeld, Form, Tabelle und Diagramm – anzeigen, auswählen, verschieben, Grösse ändern.

export type ItemColors = { background: string; text: string; accent: string; muted: string };
type Frame = { x: number; y: number; w: number; h: number };
type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const EMU_PER_PT = 12_700;
const MIN_SIZE = 91_440;
const STEP = 45_720;

export const frameStyle = (frame: Frame): CSSProperties => ({
  left: `${(frame.x / SLIDE_SIZE.width) * 100}%`,
  top: `${(frame.y / SLIDE_SIZE.height) * 100}%`,
  width: `${(frame.w / SLIDE_SIZE.width) * 100}%`,
  height: `${(frame.h / SLIDE_SIZE.height) * 100}%`,
});
const pt = (size: number) => `${size / 9.6}cqw`;

export const ITEM_LABELS: Record<SlideItem["type"], string> = {
  text: "Textfeld",
  shape: "Form",
  table: "Tabelle",
  chart: "Diagramm",
};
export const SHAPE_ICONS: Record<SlideShape, ReactNode> = {
  rect: <Square />,
  roundRect: <Rectangle />,
  ellipse: <Circle />,
  triangle: <Triangle />,
  rightArrow: <ArrowRight />,
  line: <LineSegment />,
};
export const CHART_ICONS: Record<ChartType, ReactNode> = {
  column: <ChartBar />,
  bar: <ChartBarHorizontal />,
  line: <ChartLine />,
  pie: <ChartPie />,
};

function ShapeSvg({ item, colors }: { item: Extract<SlideItem, { type: "shape" }>; colors: ItemColors }) {
  // Zeichenfläche in Punkten der Folie, damit Rundungen und Linien wie in PowerPoint wirken.
  const w = Math.max(1, item.w / EMU_PER_PT);
  const h = Math.max(1, item.h / EMU_PER_PT);
  const fill = item.fill || "none";
  const stroke = item.shape === "line" ? item.line || colors.accent : item.line || "none";
  const width = item.shape === "line" ? 2.25 : 1;
  const inset = width / 2;
  let shape: ReactNode;
  switch (item.shape) {
    case "roundRect": {
      const radius = Math.min(w, h) * 0.1667;
      shape = <rect x={inset} y={inset} width={w - width} height={h - width} rx={radius} ry={radius} />;
      break;
    }
    case "ellipse":
      shape = <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - inset} ry={h / 2 - inset} />;
      break;
    case "triangle":
      shape = <polygon points={`${w / 2},${inset} ${w - inset},${h - inset} ${inset},${h - inset}`} />;
      break;
    case "rightArrow": {
      const head = Math.min(w, h * 0.5 * 2) * 0.5;
      const top = h * 0.25;
      const bottom = h * 0.75;
      shape = (
        <polygon
          points={`${inset},${top} ${w - head},${top} ${w - head},${inset} ${w - inset},${h / 2} ${w - head},${h - inset} ${w - head},${bottom} ${inset},${bottom}`}
        />
      );
      break;
    }
    case "line":
      shape = <line x1={0} y1={0} x2={w} y2={h} strokeLinecap="round" />;
      break;
    default:
      shape = <rect x={inset} y={inset} width={w - width} height={h - width} />;
  }
  return (
    <svg
      className="deck-shape-svg"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      fill={fill}
      stroke={stroke}
      strokeWidth={width}
      overflow="visible"
    >
      {shape}
    </svg>
  );
}

function ChartView({ item }: { item: Extract<SlideItem, { type: "chart" }> }) {
  const empty = !item.categories.length || !item.series.length;
  if (empty)
    return (
      <div className="deck-chart-empty">
        <ChartBar aria-hidden="true" />
        <span>Diagramm ohne Daten</span>
      </div>
    );
  return (
    <ChartSvg
      data={{
        categories: item.categories,
        series: item.series.map((series, index) => ({ ...series, col: index })),
        layout: { headerRow: true, labelCol: true, firstRow: 1, firstCol: 1 },
      }}
      type={item.chart}
      title={item.title}
      width={Math.max(60, item.w / EMU_PER_PT)}
      height={Math.max(40, item.h / EMU_PER_PT)}
    />
  );
}

// Inhalt eines Objekts ohne Bearbeitung (Übersicht, Vorführen, Drucken und Formen/Diagramme im Editor).
export function ItemContent({
  item,
  colors,
  textView,
}: {
  item: SlideItem;
  colors: ItemColors;
  textView: (item: Extract<SlideItem, { type: "text" }>) => ReactNode;
}) {
  switch (item.type) {
    case "text":
      return (
        <div className="deck-body deck-item-text" style={{ fontSize: pt(ITEM_TEXT_SIZE) }}>
          {textView(item)}
        </div>
      );
    case "shape":
      return (
        <>
          <ShapeSvg item={item} colors={colors} />
          {item.shape !== "line" && item.text && (
            <div
              className="deck-shape-text"
              style={{ fontSize: pt(ITEM_TEXT_SIZE), color: item.fill ? contrastText(item.fill) : colors.text }}
            >
              {item.text}
            </div>
          )}
        </>
      );
    case "table":
      return (
        <table className="deck-table" style={{ fontSize: pt(TABLE_TEXT_SIZE), borderColor: colors.muted }}>
          <tbody>
            {item.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, colIndex) => {
                  const head = item.header && rowIndex === 0;
                  return (
                    <td
                      key={colIndex}
                      className={head ? "head" : ""}
                      style={{
                        borderColor: colors.muted,
                        ...(head ? { background: colors.accent, color: contrastText(colors.accent) } : {}),
                      }}
                    >
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "chart":
      return <ChartView item={item} />;
  }
}

export function StaticItems({
  items,
  colors,
  textView,
}: {
  items: SlideItem[];
  colors: ItemColors;
  textView: (item: Extract<SlideItem, { type: "text" }>) => ReactNode;
}) {
  return (
    <>
      {items.map((item) => (
        <div key={item.id} className={`deck-item type-${item.type}`} style={frameStyle(item)}>
          <ItemContent item={item} colors={colors} textView={textView} />
        </div>
      ))}
    </>
  );
}

// ---------- Bearbeiten ----------

const clampFrame = (frame: Frame, line: boolean): Frame => {
  const w = Math.max(line ? 0 : MIN_SIZE, Math.min(SLIDE_SIZE.width, Math.round(frame.w)));
  const h = Math.max(line ? 0 : MIN_SIZE, Math.min(SLIDE_SIZE.height, Math.round(frame.h)));
  return {
    x: Math.max(0, Math.min(SLIDE_SIZE.width - w, Math.round(frame.x))),
    y: Math.max(0, Math.min(SLIDE_SIZE.height - h, Math.round(frame.y))),
    w,
    h,
  };
};

export function ItemLayer({
  items,
  colors,
  selected,
  readOnly,
  onSelect,
  onChange,
  onRemove,
  onEditData,
  onTableCell,
  textEditor,
}: {
  items: SlideItem[];
  colors: ItemColors;
  selected: string | null;
  readOnly: boolean;
  onSelect: (id: string | null) => void;
  onChange: (item: SlideItem) => void;
  onRemove: (id: string) => void;
  onEditData: (id: string) => void;
  onTableCell: (cell: { row: number; col: number }) => void;
  textEditor: (item: Extract<SlideItem, { type: "text" }>) => ReactNode;
}) {
  const [draft, setDraft] = useState<{ id: string; frame: Frame } | null>(null);
  const [editingShape, setEditingShape] = useState<string | null>(null);

  function startDrag(event: React.PointerEvent, item: SlideItem, handle: Handle | "move") {
    if (readOnly || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(item.id);
    const rect = (event.currentTarget as HTMLElement).closest(".deck-item-layer")?.getBoundingClientRect();
    if (!rect) return;
    const scaleX = SLIDE_SIZE.width / rect.width;
    const scaleY = SLIDE_SIZE.height / rect.height;
    const start = { x: event.clientX, y: event.clientY };
    const origin: Frame = { x: item.x, y: item.y, w: item.w, h: item.h };
    const line = item.type === "shape" && item.shape === "line";
    let latest = origin;
    const move = (pointer: PointerEvent) => {
      const dx = (pointer.clientX - start.x) * scaleX;
      const dy = (pointer.clientY - start.y) * scaleY;
      let next: Frame;
      if (handle === "move") next = clampFrame({ ...origin, x: origin.x + dx, y: origin.y + dy }, line);
      else {
        let { x, y, w, h } = origin;
        if (handle.includes("e")) w = origin.w + dx;
        if (handle.includes("s")) h = origin.h + dy;
        if (handle.includes("w")) {
          w = origin.w - dx;
          x = origin.x + dx;
        }
        if (handle.includes("n")) {
          h = origin.h - dy;
          y = origin.y + dy;
        }
        const minimum = line ? 0 : MIN_SIZE;
        if (w < minimum) {
          if (handle.includes("w")) x -= minimum - w;
          w = minimum;
        }
        if (h < minimum) {
          if (handle.includes("n")) y -= minimum - h;
          h = minimum;
        }
        next = clampFrame({ x, y, w, h }, line);
      }
      latest = next;
      setDraft({ id: item.id, frame: next });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDraft(null);
      if (latest !== origin) onChange({ ...item, ...latest });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onKey(event: React.KeyboardEvent, item: SlideItem) {
    if (event.target !== event.currentTarget || readOnly) return;
    const step = event.shiftKey ? STEP * 10 : STEP;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (moves[event.key]) {
      event.preventDefault();
      const [dx, dy] = moves[event.key];
      onChange({
        ...item,
        ...clampFrame({ ...item, x: item.x + dx, y: item.y + dy }, item.type === "shape" && item.shape === "line"),
      });
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onRemove(item.id);
    } else if (event.key === "Escape") onSelect(null);
    else if (event.key === "Enter" && item.type === "shape" && item.shape !== "line") {
      event.preventDefault();
      setEditingShape(item.id);
    } else if (event.key === "Enter" && item.type === "chart") {
      event.preventDefault();
      onEditData(item.id);
    }
  }

  return (
    <div className="deck-item-layer">
      {items.map((item, position) => {
        const frame = draft?.id === item.id ? draft.frame : item;
        const active = selected === item.id;
        // Ganze Fläche zum Verschieben: Formen und Diagramme; sonst nur am Rand (Text und Zellen bleiben bearbeitbar).
        const surfaceDrag = item.type === "shape" || item.type === "chart";
        const line = item.type === "shape" && item.shape === "line";
        return (
          <div
            key={item.id}
            className={`deck-item type-${item.type} ${active ? "selected" : ""} ${line ? "is-line" : ""}`}
            data-item={item.id}
            style={frameStyle(frame)}
            tabIndex={readOnly ? -1 : 0}
            role="group"
            aria-label={`${ITEM_LABELS[item.type]} ${position + 1}`}
            onFocus={(event) => {
              if (!readOnly && event.target === event.currentTarget) onSelect(item.id);
            }}
            onKeyDown={(event) => onKey(event, item)}
            onPointerDown={(event) => {
              if (readOnly) return;
              if (surfaceDrag && editingShape !== item.id) startDrag(event, item, "move");
              else onSelect(item.id);
            }}
            onDoubleClick={() => {
              if (readOnly) return;
              if (item.type === "shape" && !line) setEditingShape(item.id);
              if (item.type === "chart") onEditData(item.id);
            }}
          >
            {item.type === "text" ? (
              <div className="deck-body deck-item-text editable" style={{ fontSize: pt(ITEM_TEXT_SIZE) }}>
                {textEditor(item)}
              </div>
            ) : item.type === "table" && !readOnly ? (
              <table className="deck-table" style={{ fontSize: pt(TABLE_TEXT_SIZE), borderColor: colors.muted }}>
                <tbody>
                  {item.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, colIndex) => {
                        const head = item.header && rowIndex === 0;
                        return (
                          <td
                            key={colIndex}
                            className={head ? "head" : ""}
                            style={{
                              borderColor: colors.muted,
                              ...(head
                                ? { background: colors.accent, color: contrastText(colors.accent) }
                                : { color: colors.text }),
                            }}
                          >
                            <textarea
                              value={cell}
                              rows={1}
                              maxLength={ITEM_LIMITS.cell}
                              aria-label={`Zelle ${rowIndex + 1}/${colIndex + 1}`}
                              onFocus={() => {
                                onSelect(item.id);
                                onTableCell({ row: rowIndex, col: colIndex });
                              }}
                              onChange={(event) =>
                                onChange({
                                  ...item,
                                  rows: item.rows.map((cells, r) =>
                                    r === rowIndex
                                      ? cells.map((value, c) => (c === colIndex ? event.target.value : value))
                                      : cells,
                                  ),
                                })
                              }
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : item.type === "shape" && editingShape === item.id ? (
              <>
                <ShapeSvg item={item} colors={colors} />
                <textarea
                  className="deck-shape-text editing"
                  style={{ fontSize: pt(ITEM_TEXT_SIZE), color: item.fill ? contrastText(item.fill) : colors.text }}
                  autoFocus
                  value={item.text}
                  maxLength={2000}
                  aria-label="Text der Form"
                  onPointerDown={(event) => event.stopPropagation()}
                  onBlur={() => setEditingShape(null)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setEditingShape(null);
                    }
                  }}
                  onChange={(event) => onChange({ ...item, text: event.target.value })}
                />
              </>
            ) : (
              <ItemContent item={item} colors={colors} textView={() => null} />
            )}
            {active && !readOnly && !surfaceDrag && (
              <>
                {(["top", "bottom", "left", "right"] as const).map((edge) => (
                  <span
                    key={edge}
                    className={`deck-item-edge ${edge}`}
                    aria-hidden="true"
                    onPointerDown={(event) => startDrag(event, item, "move")}
                  />
                ))}
              </>
            )}
            {active &&
              !readOnly &&
              (line ? (["nw", "se"] as Handle[]) : (["nw", "n", "ne", "e", "se", "s", "sw", "w"] as Handle[])).map(
                (handle) => (
                  <span
                    key={handle}
                    className={`deck-item-handle ${handle}`}
                    aria-hidden="true"
                    onPointerDown={(event) => startDrag(event, item, handle)}
                  />
                ),
              )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Leiste für das ausgewählte Objekt ----------

export function ItemBar({
  item,
  cell,
  onChange,
  onRemove,
  onDuplicate,
  onLayer,
  onEditData,
}: {
  item: SlideItem;
  cell: { row: number; col: number } | null;
  onChange: (item: SlideItem) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onLayer: (direction: 1 | -1) => void;
  onEditData: () => void;
}) {
  const table = item.type === "table" ? item : null;
  const rowCount = table?.rows.length ?? 0;
  const colCount = table?.rows[0]?.length ?? 0;
  const at = {
    row: Math.min(cell?.row ?? rowCount - 1, rowCount - 1),
    col: Math.min(cell?.col ?? colCount - 1, colCount - 1),
  };
  const setRows = (rows: string[][]) => table && onChange({ ...table, rows });
  return (
    <div className="office-contextbar" role="toolbar" aria-label={ITEM_LABELS[item.type]}>
      <span className="office-contextbar-label">{ITEM_LABELS[item.type]}</span>
      {item.type === "shape" && (
        <>
          <ToolPopover label="Form ändern" trigger={SHAPE_ICONS[item.shape]}>
            {(close) => (
              <MenuList
                close={close}
                items={SLIDE_SHAPES.filter((shape) => (item.shape === "line") === (shape.value === "line")).map(
                  (shape) => ({
                    label: shape.label,
                    icon: SHAPE_ICONS[shape.value],
                    active: item.shape === shape.value,
                    onSelect: () => onChange({ ...item, shape: shape.value }),
                  }),
                )}
              />
            )}
          </ToolPopover>
          {item.shape !== "line" && (
            <ColorPicker
              label="Füllfarbe"
              icon={<PaintBucket />}
              current={item.fill || null}
              noneLabel="Keine Füllung"
              onPick={(color) => onChange({ ...item, fill: color ?? "" })}
            />
          )}
          <ColorPicker
            label={item.shape === "line" ? "Linienfarbe" : "Rahmenfarbe"}
            icon={<LineSegment />}
            current={item.line || null}
            noneLabel={item.shape === "line" ? "Automatisch" : "Kein Rahmen"}
            onPick={(color) => onChange({ ...item, line: color ?? "" })}
          />
        </>
      )}
      {table && (
        <>
          <ToolButton
            label="Zeile oberhalb einfügen"
            icon={<RowsPlusTop />}
            text="Zeile oben"
            disabled={rowCount >= ITEM_LIMITS.rows}
            onClick={() =>
              setRows([...table.rows.slice(0, at.row), Array(colCount).fill(""), ...table.rows.slice(at.row)])
            }
          />
          <ToolButton
            label="Zeile unterhalb einfügen"
            icon={<RowsPlusBottom />}
            text="Zeile unten"
            disabled={rowCount >= ITEM_LIMITS.rows}
            onClick={() =>
              setRows([...table.rows.slice(0, at.row + 1), Array(colCount).fill(""), ...table.rows.slice(at.row + 1)])
            }
          />
          <ToolButton
            label="Spalte links einfügen"
            icon={<ColumnsPlusLeft />}
            text="Spalte links"
            disabled={colCount >= ITEM_LIMITS.cols}
            onClick={() => setRows(table.rows.map((row) => [...row.slice(0, at.col), "", ...row.slice(at.col)]))}
          />
          <ToolButton
            label="Spalte rechts einfügen"
            icon={<ColumnsPlusRight />}
            text="Spalte rechts"
            disabled={colCount >= ITEM_LIMITS.cols}
            onClick={() =>
              setRows(table.rows.map((row) => [...row.slice(0, at.col + 1), "", ...row.slice(at.col + 1)]))
            }
          />
          <ToolButton
            label="Kopfzeile ein oder aus"
            text="Kopfzeile"
            active={table.header}
            onClick={() => onChange({ ...table, header: !table.header })}
          />
          <ToolButton
            label="Zeile löschen"
            text="Zeile löschen"
            disabled={rowCount < 2}
            onClick={() => setRows(table.rows.filter((_, index) => index !== at.row))}
          />
          <ToolButton
            label="Spalte löschen"
            text="Spalte löschen"
            disabled={colCount < 2}
            onClick={() => setRows(table.rows.map((row) => row.filter((_, index) => index !== at.col)))}
          />
        </>
      )}
      {item.type === "chart" && (
        <>
          <ToolPopover label="Diagrammart" trigger={CHART_ICONS[item.chart]}>
            {(close) => (
              <MenuList
                close={close}
                items={(Object.keys(CHART_LABELS) as ChartType[]).map((type) => ({
                  label: CHART_LABELS[type],
                  icon: CHART_ICONS[type],
                  active: item.chart === type,
                  onSelect: () => onChange({ ...item, chart: type }),
                }))}
              />
            )}
          </ToolPopover>
          <ToolButton label="Daten bearbeiten" icon={<PencilSimple />} text="Daten bearbeiten" onClick={onEditData} />
        </>
      )}
      {item.type !== "text" && <ToolSeparator />}
      <ToolButton label="Eine Ebene nach vorne" icon={<StackPlus />} onClick={() => onLayer(1)} />
      <ToolButton label="Eine Ebene nach hinten" icon={<StackMinus />} onClick={() => onLayer(-1)} />
      <ToolButton label="Objekt duplizieren" icon={<CopySimple />} onClick={onDuplicate} />
      <ToolButton label="Objekt löschen" icon={<Trash />} className="danger" onClick={onRemove} />
    </div>
  );
}

// ---------- Daten des Diagramms ----------

const parseNumber = (text: string) => {
  const clean = text
    .trim()
    .replace(/['’\s]/g, "")
    .replace(",", ".");
  if (!clean) return 0;
  const value = Number(clean);
  return Number.isFinite(value) ? value : null;
};
const showNumber = (value: number) => String(value).replace(".", ",");

export function ChartDataDialog({
  item,
  onSave,
  onClose,
}: {
  item: Extract<SlideItem, { type: "chart" }>;
  onSave: (item: Extract<SlideItem, { type: "chart" }>) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [names, setNames] = useState(item.series.length ? item.series.map((series) => series.name) : [""]);
  const [categories, setCategories] = useState(item.categories.length ? item.categories : ["", "", ""]);
  const [values, setValues] = useState<string[][]>(
    (item.categories.length ? item.categories : ["", "", ""]).map((_, row) =>
      (item.series.length ? item.series : [{ name: "", values: [] }]).map((series) =>
        series.values[row] === undefined ? "" : showNumber(series.values[row]),
      ),
    ),
  );
  const [error, setError] = useState("");
  const firstInput = useRef<HTMLInputElement>(null);
  useEffect(() => firstInput.current?.focus(), []);

  function save() {
    const rows = categories
      .map((category, row) => ({ category: category.trim(), cells: values[row] }))
      .filter((row) => row.category || row.cells.some((cell) => cell.trim()));
    const parsed = rows.map((row) => row.cells.map(parseNumber));
    if (parsed.some((row) => row.some((value) => value === null)))
      return setError("Bitte in den Wertefeldern nur Zahlen eingeben (z. B. 12,5).");
    onSave({
      ...item,
      title: title.trim(),
      categories: rows.map((row, index) => row.category || String(index + 1)),
      series: rows.length
        ? names.map((name, col) => ({
            name: name.trim() || `Reihe ${col + 1}`,
            values: parsed.map((row) => row[col] ?? 0),
          }))
        : [],
    });
  }

  return (
    <SheetDialog
      title="Daten des Diagramms"
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="primary" onClick={save}>
            Übernehmen
          </button>
        </>
      }
    >
      <label className="sheet-dialog-field">
        <span>Titel</span>
        <input
          ref={firstInput}
          value={title}
          maxLength={200}
          placeholder="z. B. Belegung pro Monat"
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <div className="deck-chart-grid" role="group" aria-label="Werte">
        <table>
          <thead>
            <tr>
              <th scope="col">Beschriftung</th>
              {names.map((name, col) => (
                <th key={col} scope="col">
                  <span className="deck-chart-head">
                    <input
                      value={name}
                      maxLength={200}
                      aria-label={`Name der Reihe ${col + 1}`}
                      placeholder={`Reihe ${col + 1}`}
                      onChange={(event) => setNames(names.map((item, at) => (at === col ? event.target.value : item)))}
                    />
                    {names.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Reihe ${col + 1} entfernen`}
                        data-tip="Reihe entfernen"
                        onClick={() => {
                          setNames(names.filter((_, at) => at !== col));
                          setValues(values.map((row) => row.filter((_, at) => at !== col)));
                        }}
                      >
                        <Trash aria-hidden="true" />
                      </button>
                    )}
                  </span>
                </th>
              ))}
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {categories.map((category, row) => (
              <tr key={row}>
                <td>
                  <input
                    value={category}
                    maxLength={200}
                    aria-label={`Beschriftung ${row + 1}`}
                    onChange={(event) =>
                      setCategories(categories.map((item, at) => (at === row ? event.target.value : item)))
                    }
                  />
                </td>
                {names.map((_, col) => (
                  <td key={col}>
                    <input
                      value={values[row][col] ?? ""}
                      inputMode="decimal"
                      aria-label={`Wert ${row + 1} in Reihe ${col + 1}`}
                      onChange={(event) => {
                        setError("");
                        setValues(
                          values.map((cells, r) =>
                            r === row ? cells.map((cell, c) => (c === col ? event.target.value : cell)) : cells,
                          ),
                        );
                      }}
                    />
                  </td>
                ))}
                <td>
                  {categories.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Zeile ${row + 1} entfernen`}
                      data-tip="Zeile entfernen"
                      onClick={() => {
                        setCategories(categories.filter((_, at) => at !== row));
                        setValues(values.filter((_, at) => at !== row));
                      }}
                    >
                      <Trash aria-hidden="true" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="deck-chart-actions">
        <button
          type="button"
          disabled={categories.length >= ITEM_LIMITS.categories}
          onClick={() => {
            setCategories([...categories, ""]);
            setValues([...values, names.map(() => "")]);
          }}
        >
          Zeile hinzufügen
        </button>
        <button
          type="button"
          disabled={names.length >= ITEM_LIMITS.series}
          onClick={() => {
            setNames([...names, ""]);
            setValues(values.map((row) => [...row, ""]));
          }}
        >
          Reihe hinzufügen
        </button>
      </div>
      {error && (
        <p className="office-form-error" role="alert">
          {error}
        </p>
      )}
    </SheetDialog>
  );
}
