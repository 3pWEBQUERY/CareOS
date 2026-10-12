"use client";

import type { Dispatch, SetStateAction } from "react";
import {
  AlignBottom,
  AlignCenterVertical,
  AlignTop,
  ArrowUUpLeft,
  ArrowUUpRight,
  ArrowsClockwise,
  ArrowsMerge,
  ChartBar,
  ChatCircleText,
  ChatsCircle,
  DownloadSimple,
  Eraser,
  Funnel,
  GridFour,
  Highlighter,
  ListChecks,
  Lock,
  LockOpen,
  MagnifyingGlass,
  PaintBrush,
  PaintBucket,
  PencilSimple,
  Printer,
  Rows,
  Sigma,
  Snowflake,
  SortAscending,
  SortDescending,
  SquareHalf,
  Swatches,
  Table,
  Tag,
  TextAUnderline,
  TextAlignCenter,
  TextAlignLeft,
  TextAlignRight,
  TextB,
  TextIndent,
  TextItalic,
  TextOutdent,
  TextStrikethrough,
  TextUnderline,
  ArrowUDownLeft as WrapText,
} from "@phosphor-icons/react";
import type { CommentThread } from "@/lib/office/comments";
import { areaName, cellKey, type Area } from "@/lib/office/formula";
import {
  FONT_NAMES,
  NUMBER_FORMATS,
  formatValue,
  type BorderWeight,
  type CellStyle,
  type NumberFormat,
  type Sheet,
} from "@/lib/office/model";
import {
  BORDER_WIDTH,
  CELL_STYLES,
  DEFAULT_BORDER_COLOR,
  withCellStyle,
  type BorderPreset,
} from "@/lib/office/sheet-features";
import type { Range } from "@/lib/office/sheet-ops";
import { ColorPicker, MenuList, PALETTE, ToolButton, ToolGroup, ToolPopover, ToolSeparator } from "./office-ui";
import { edgeShadow, type Dialog } from "./sheet-shared";

// Werkzeugleiste der Tabelle (Start-Register wie in Excel); Zustand und Befehle kommen vom Editor.
export function SheetRibbon({
  canUndo,
  canRedo,
  undo,
  redo,
  painter,
  startPainter,
  activeStyle,
  applyStyle,
  toggle,
  setBorder,
  borderWeight,
  setBorderWeight,
  borderColor,
  setBorderColor,
  changeIndent,
  merged,
  toggleMerge,
  fmtLabel,
  setFormat,
  changeDecimals,
  sheet,
  sort,
  toggleFilter,
  setDialog,
  addChart,
  autoSum,
  insert,
  remove,
  hide,
  commitSheet,
  autoFit,
  range,
  area,
  freezeRows,
  freezeCols,
  setFreeze,
  clear,
  openFind,
  focusComment,
  startComment,
  showComments,
  setShowComments,
  downloadCsv,
  protectedSheet,
  pivotSheet,
  toggleProtection,
  toggleUnlocked,
  openPivot,
  editPivot,
  refreshPivot,
}: {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  painter: boolean;
  startPainter: () => void;
  activeStyle: CellStyle;
  applyStyle: (change: (style: CellStyle) => CellStyle) => void;
  toggle: (flag: "b" | "i" | "u" | "s" | "wrap") => void;
  setBorder: (preset: BorderPreset) => void;
  borderWeight: BorderWeight;
  setBorderWeight: (weight: BorderWeight) => void;
  borderColor: string;
  setBorderColor: (color: string) => void;
  changeIndent: (delta: number) => void;
  merged: boolean;
  toggleMerge: () => void;
  fmtLabel: string;
  setFormat: (fmt: NumberFormat) => void;
  changeDecimals: (delta: number) => void;
  sheet: Sheet;
  sort: (direction: 1 | -1) => void;
  toggleFilter: () => void;
  setDialog: (dialog: Dialog) => void;
  addChart: () => void;
  autoSum: () => void;
  insert: (axis: "row" | "col", before: boolean) => void;
  remove: (axis: "row" | "col") => void;
  hide: (axis: "row" | "col", hidden: boolean) => void;
  commitSheet: (change: (sheet: Sheet) => Sheet) => void;
  autoFit: (col: number) => void;
  range: Range;
  area: Area;
  freezeRows: number;
  freezeCols: number;
  setFreeze: (rows: number, cols: number) => void;
  clear: (what: "content" | "formats" | "all") => void;
  openFind: (replace: boolean) => void;
  focusComment: CommentThread | undefined;
  startComment: () => void;
  showComments: boolean;
  setShowComments: Dispatch<SetStateAction<boolean>>;
  downloadCsv: () => void;
  protectedSheet: boolean;
  pivotSheet: boolean;
  toggleProtection: () => void;
  toggleUnlocked: () => void;
  openPivot: () => void;
  editPivot: () => void;
  refreshPivot: () => void;
}) {
  return (
    <div className="office-ribbon" role="toolbar" aria-label="Tabelle bearbeiten">
      <ToolGroup label="Rückgängig">
        <ToolButton label="Rückgängig" shortcut="Ctrl+Z" icon={<ArrowUUpLeft />} disabled={!canUndo} onClick={undo} />
        <ToolButton label="Wiederholen" shortcut="Ctrl+Y" icon={<ArrowUUpRight />} disabled={!canRedo} onClick={redo} />
        <ToolButton
          label={painter ? "Format übertragen beenden" : "Format übertragen"}
          icon={<PaintBrush />}
          active={Boolean(painter)}
          onClick={startPainter}
        />
      </ToolGroup>
      <ToolSeparator />
      <ToolGroup label="Schrift">
        <ToolPopover
          label="Schriftart"
          className="office-font-picker"
          trigger={<span className="office-select-text">{activeStyle.font ?? "Calibri"}</span>}
        >
          {(close) => (
            <MenuList
              close={close}
              items={FONT_NAMES.map((font) => ({
                label: font,
                active: (activeStyle.font ?? "Calibri") === font,
                style: { fontFamily: `"${font}", sans-serif` },
                onSelect: () => applyStyle((style) => ({ ...style, font: font === "Calibri" ? undefined : font })),
              }))}
            />
          )}
        </ToolPopover>
        <ToolPopover
          label="Schriftgrösse"
          className="office-size-picker"
          trigger={<span className="office-select-text">{activeStyle.size ?? 11}</span>}
        >
          {(close) => (
            <MenuList
              close={close}
              items={[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36].map((size) => ({
                label: String(size),
                active: (activeStyle.size ?? 11) === size,
                onSelect: () => applyStyle((style) => ({ ...style, size: size === 11 ? undefined : size })),
              }))}
            />
          )}
        </ToolPopover>
        <ToolButton
          label="Fett"
          shortcut="Ctrl+B"
          icon={<TextB weight="bold" />}
          active={Boolean(activeStyle.b)}
          onClick={() => toggle("b")}
        />
        <ToolButton
          label="Kursiv"
          shortcut="Ctrl+I"
          icon={<TextItalic />}
          active={Boolean(activeStyle.i)}
          onClick={() => toggle("i")}
        />
        <ToolButton
          label="Unterstrichen"
          shortcut="Ctrl+U"
          icon={<TextUnderline />}
          active={Boolean(activeStyle.u)}
          onClick={() => toggle("u")}
        />
        <ToolButton
          label="Durchgestrichen"
          icon={<TextStrikethrough />}
          active={Boolean(activeStyle.s)}
          onClick={() => toggle("s")}
        />
        <ColorPicker
          label="Schriftfarbe"
          icon={<TextAUnderline />}
          current={activeStyle.color ?? null}
          noneLabel="Automatisch"
          onPick={(color) => applyStyle((style) => ({ ...style, color: color ?? undefined }))}
        />
        <ColorPicker
          label="Füllfarbe"
          icon={<PaintBucket />}
          current={activeStyle.fill ?? null}
          noneLabel="Keine Füllung"
          onPick={(color) => applyStyle((style) => ({ ...style, fill: color ?? undefined }))}
        />
        <ToolPopover label="Rahmen" trigger={<SquareHalf />}>
          {(close) => (
            <div className="sheet-border-menu">
              <MenuList
                close={close}
                items={[
                  { label: "Alle Rahmenlinien", onSelect: () => setBorder("all") },
                  { label: "Rahmenlinien aussen", onSelect: () => setBorder("outside") },
                  { label: "Innere Rahmenlinien", onSelect: () => setBorder("inside") },
                  { label: "Dicke Rahmenlinie aussen", onSelect: () => setBorder("thickOutside") },
                  "separator",
                  { label: "Rahmenlinie oben", onSelect: () => setBorder("top") },
                  { label: "Rahmenlinie unten", onSelect: () => setBorder("bottom") },
                  { label: "Rahmenlinie links", onSelect: () => setBorder("left") },
                  { label: "Rahmenlinie rechts", onSelect: () => setBorder("right") },
                  "separator",
                  { label: "Kein Rahmen", danger: true, onSelect: () => setBorder("none") },
                ]}
              />
              <span className="office-menu-separator" />
              <p className="sheet-menu-label">Linienstärke</p>
              <div className="sheet-border-weights" role="radiogroup" aria-label="Linienstärke">
                {(["thin", "medium", "thick"] as BorderWeight[]).map((weight) => (
                  <button
                    key={weight}
                    type="button"
                    role="radio"
                    aria-checked={borderWeight === weight}
                    aria-label={weight === "thin" ? "Dünn" : weight === "medium" ? "Mittel" : "Dick"}
                    data-tip={weight === "thin" ? "Dünn" : weight === "medium" ? "Mittel" : "Dick"}
                    className={borderWeight === weight ? "active" : ""}
                    onClick={() => setBorderWeight(weight)}
                  >
                    <i style={{ height: BORDER_WIDTH[weight], background: borderColor }} />
                  </button>
                ))}
              </div>
              <p className="sheet-menu-label">Linienfarbe</p>
              <div className="office-palette-row" role="radiogroup" aria-label="Linienfarbe">
                {[DEFAULT_BORDER_COLOR, ...PALETTE[0].filter((color) => color !== "#5b6b6d").slice(0, 9)].map(
                  (color) => (
                    <button
                      key={color}
                      type="button"
                      role="radio"
                      aria-checked={borderColor === color}
                      aria-label={color === DEFAULT_BORDER_COLOR ? "Standardfarbe" : `Farbe ${color}`}
                      className={borderColor === color ? "active" : ""}
                      style={{ background: color }}
                      onClick={() => setBorderColor(color)}
                    />
                  ),
                )}
              </div>
            </div>
          )}
        </ToolPopover>
      </ToolGroup>
      <ToolSeparator />
      <ToolGroup label="Ausrichtung">
        <ToolButton
          label="Linksbündig"
          icon={<TextAlignLeft />}
          active={activeStyle.align === "left"}
          onClick={() => applyStyle((style) => ({ ...style, align: style.align === "left" ? undefined : "left" }))}
        />
        <ToolButton
          label="Zentriert"
          icon={<TextAlignCenter />}
          active={activeStyle.align === "center"}
          onClick={() => applyStyle((style) => ({ ...style, align: style.align === "center" ? undefined : "center" }))}
        />
        <ToolButton
          label="Rechtsbündig"
          icon={<TextAlignRight />}
          active={activeStyle.align === "right"}
          onClick={() => applyStyle((style) => ({ ...style, align: style.align === "right" ? undefined : "right" }))}
        />
        <ToolButton
          label="Oben ausrichten"
          icon={<AlignTop />}
          active={activeStyle.valign === "top"}
          onClick={() => applyStyle((style) => ({ ...style, valign: style.valign === "top" ? undefined : "top" }))}
        />
        <ToolButton
          label="Vertikal zentrieren"
          icon={<AlignCenterVertical />}
          active={activeStyle.valign === "middle"}
          onClick={() =>
            applyStyle((style) => ({ ...style, valign: style.valign === "middle" ? undefined : "middle" }))
          }
        />
        <ToolButton
          label="Unten ausrichten"
          icon={<AlignBottom />}
          active={!activeStyle.valign || activeStyle.valign === "bottom"}
          onClick={() => applyStyle((style) => ({ ...style, valign: undefined }))}
        />
        <ToolButton
          label="Einzug verkleinern"
          icon={<TextOutdent />}
          disabled={!activeStyle.indent}
          onClick={() => changeIndent(-1)}
        />
        <ToolButton label="Einzug vergrössern" icon={<TextIndent />} onClick={() => changeIndent(1)} />
        <ToolButton
          label="Zeilenumbruch"
          icon={<WrapText />}
          active={Boolean(activeStyle.wrap)}
          onClick={() => toggle("wrap")}
        />
        <ToolButton
          label="Zellen verbinden oder trennen"
          icon={<ArrowsMerge />}
          active={merged}
          onClick={toggleMerge}
        />
      </ToolGroup>
      <ToolSeparator />
      <ToolGroup label="Zahl">
        <ToolPopover
          label="Zahlenformat"
          className="office-format-picker"
          trigger={<span className="office-select-text">{fmtLabel}</span>}
        >
          {(close) => (
            <MenuList
              close={close}
              items={NUMBER_FORMATS.map((item) => ({
                label: item.label,
                hint: formatValue(
                  item.value === "date" || item.value === "datetime"
                    ? 46300.5
                    : item.value === "time"
                      ? 0.3125
                      : item.value === "percent"
                        ? 0.125
                        : 1234.5,
                  { fmt: item.value },
                ),
                active: (activeStyle.fmt ?? "general") === item.value,
                onSelect: () => setFormat(item.value),
              }))}
            />
          )}
        </ToolPopover>
        <ToolButton label="Weniger Dezimalstellen" text=",0" onClick={() => changeDecimals(-1)} />
        <ToolButton label="Mehr Dezimalstellen" text=",00" onClick={() => changeDecimals(1)} />
        <ToolPopover label="Zellenformatvorlagen" trigger={<Swatches />}>
          {(close) => (
            <div className="sheet-cell-styles" role="menu">
              {CELL_STYLES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  style={{
                    background: item.style.fill,
                    color: item.style.color,
                    fontWeight: item.style.b ? 700 : 500,
                    boxShadow: edgeShadow(
                      item.style.border || item.style.bb || item.style.bt
                        ? {
                            top:
                              item.style.border || item.style.bt
                                ? { width: 1, color: item.style.bc ?? DEFAULT_BORDER_COLOR }
                                : null,
                            bottom:
                              item.style.border || item.style.bb
                                ? {
                                    width: BORDER_WIDTH[item.style.bw ?? "thin"],
                                    color: item.style.bc ?? DEFAULT_BORDER_COLOR,
                                  }
                                : null,
                            left: item.style.border ? { width: 1, color: item.style.bc ?? DEFAULT_BORDER_COLOR } : null,
                            right: item.style.border
                              ? { width: 1, color: item.style.bc ?? DEFAULT_BORDER_COLOR }
                              : null,
                          }
                        : null,
                    ),
                  }}
                  onClick={() => {
                    close();
                    applyStyle((style) => withCellStyle(style, item.style));
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </ToolPopover>
      </ToolGroup>
      <ToolSeparator />
      <ToolGroup label="Daten">
        <ToolButton label="Aufsteigend sortieren" icon={<SortAscending />} onClick={() => sort(1)} />
        <ToolButton label="Absteigend sortieren" icon={<SortDescending />} onClick={() => sort(-1)} />
        <ToolButton
          label={sheet.filter ? "Filter entfernen" : "Filter"}
          shortcut="Ctrl+Shift+L"
          icon={<Funnel />}
          active={Boolean(sheet.filter)}
          onClick={toggleFilter}
        />
        <ToolButton label="Auswahlliste" icon={<ListChecks />} onClick={() => setDialog({ kind: "validation" })} />
        <ToolButton label="Bedingte Formatierung" icon={<Highlighter />} onClick={() => setDialog({ kind: "rules" })} />
        <ToolButton label="Diagramm einfügen" icon={<ChartBar />} onClick={addChart} />
        <ToolButton label="Namen verwalten" icon={<Tag />} onClick={() => setDialog({ kind: "names" })} />
        {pivotSheet ? (
          <>
            <ToolButton label="Pivot-Tabelle aktualisieren" icon={<ArrowsClockwise />} onClick={refreshPivot} />
            <ToolButton label="Pivot-Tabelle bearbeiten" icon={<PencilSimple />} onClick={editPivot} />
          </>
        ) : (
          <ToolButton label="Pivot-Tabelle einfügen" icon={<Table />} onClick={openPivot} />
        )}
      </ToolGroup>
      <ToolSeparator />
      <ToolGroup label="Bearbeiten">
        <ToolButton label="Summe (AutoSumme)" icon={<Sigma />} onClick={autoSum} />
        <ToolPopover label="Zeilen und Spalten" trigger={<Rows />}>
          {(close) => (
            <MenuList
              close={close}
              items={[
                { label: "Zeilen oberhalb einfügen", onSelect: () => insert("row", true) },
                { label: "Zeilen unterhalb einfügen", onSelect: () => insert("row", false) },
                { label: "Spalten links einfügen", onSelect: () => insert("col", true) },
                { label: "Spalten rechts einfügen", onSelect: () => insert("col", false) },
                "separator",
                { label: "Zeilen löschen", danger: true, onSelect: () => remove("row") },
                { label: "Spalten löschen", danger: true, onSelect: () => remove("col") },
                "separator",
                { label: "Zeilen ausblenden", onSelect: () => hide("row", true) },
                {
                  label: "Zeilen einblenden",
                  disabled: !sheet.hiddenRows.length,
                  onSelect: () => hide("row", false),
                },
                { label: "Spalten ausblenden", onSelect: () => hide("col", true) },
                {
                  label: "Spalten einblenden",
                  disabled: !sheet.hiddenCols.length,
                  onSelect: () => hide("col", false),
                },
                {
                  label: "Alle einblenden",
                  disabled: !sheet.hiddenRows.length && !sheet.hiddenCols.length,
                  onSelect: () => commitSheet((current) => ({ ...current, hiddenRows: [], hiddenCols: [] })),
                },
                "separator",
                { label: "Spaltenbreite anpassen", onSelect: () => autoFit(range.focus.col) },
              ]}
            />
          )}
        </ToolPopover>
        <ToolPopover label="Fixieren" trigger={<Snowflake />}>
          {(close) => (
            <MenuList
              close={close}
              items={[
                {
                  label: "Oberste Zeile fixieren",
                  active: freezeRows === 1 && freezeCols === 0,
                  onSelect: () => setFreeze(1, 0),
                },
                {
                  label: "Erste Spalte fixieren",
                  active: freezeRows === 0 && freezeCols === 1,
                  onSelect: () => setFreeze(0, 1),
                },
                {
                  label: `Bis ${cellKey(range.focus.col, range.focus.row)} fixieren`,
                  hint: "Zeilen darüber, Spalten links",
                  onSelect: () => setFreeze(range.focus.row, range.focus.col),
                },
                {
                  label: "Fixierung aufheben",
                  disabled: !freezeRows && !freezeCols,
                  onSelect: () => setFreeze(0, 0),
                },
              ]}
            />
          )}
        </ToolPopover>
        <ToolPopover label="Löschen" trigger={<Eraser />}>
          {(close) => (
            <MenuList
              close={close}
              items={[
                { label: "Alles löschen", danger: true, onSelect: () => clear("all") },
                { label: "Formate löschen", onSelect: () => clear("formats") },
                { label: "Inhalte löschen", hint: "Entf", onSelect: () => clear("content") },
              ]}
            />
          )}
        </ToolPopover>
        <ToolButton
          label="Suchen und Ersetzen"
          shortcut="Ctrl+F"
          icon={<MagnifyingGlass />}
          onClick={() => openFind(false)}
        />
      </ToolGroup>
      <ToolSeparator />
      <ToolGroup label="Ansicht">
        <ToolButton
          label="Gitternetzlinien"
          icon={<GridFour />}
          active={sheet.showGrid}
          onClick={() => commitSheet((current) => ({ ...current, showGrid: !current.showGrid }))}
        />
        <ToolPopover label="Seite einrichten" trigger={<Printer />}>
          {(close) => (
            <MenuList
              close={close}
              items={[
                {
                  label: "Hochformat",
                  active: sheet.print.orientation === "portrait",
                  onSelect: () =>
                    commitSheet((current) => ({
                      ...current,
                      print: { ...current.print, orientation: "portrait" },
                    })),
                },
                {
                  label: "Querformat",
                  active: sheet.print.orientation === "landscape",
                  onSelect: () =>
                    commitSheet((current) => ({
                      ...current,
                      print: { ...current.print, orientation: "landscape" },
                    })),
                },
                "separator",
                {
                  label: "Auf Seitenbreite anpassen",
                  active: sheet.print.fit,
                  onSelect: () =>
                    commitSheet((current) => ({
                      ...current,
                      print: { ...current.print, fit: !current.print.fit },
                    })),
                },
                {
                  label: "Gitternetz drucken",
                  active: sheet.print.gridlines,
                  onSelect: () =>
                    commitSheet((current) => ({
                      ...current,
                      print: { ...current.print, gridlines: !current.print.gridlines },
                    })),
                },
                "separator",
                {
                  label: "Druckbereich festlegen",
                  hint: areaName(area),
                  onSelect: () =>
                    commitSheet((current) => ({ ...current, print: { ...current.print, area: areaName(area) } })),
                },
                {
                  label: "Druckbereich aufheben",
                  disabled: !sheet.print.area,
                  onSelect: () =>
                    commitSheet((current) => ({ ...current, print: { ...current.print, area: undefined } })),
                },
                { label: "Kopf- und Fusszeile …", onSelect: () => setDialog({ kind: "page" }) },
                "separator",
                { label: "Drucken …", hint: "Ctrl+P", onSelect: () => window.setTimeout(() => window.print(), 50) },
              ]}
            />
          )}
        </ToolPopover>
      </ToolGroup>
      <ToolSeparator />
      <ToolGroup label="Überprüfen">
        <ToolButton
          label={focusComment ? "Kommentar anzeigen" : "Neuer Kommentar"}
          shortcut="Ctrl+Alt+M"
          icon={<ChatCircleText />}
          onClick={startComment}
        />
        <ToolButton
          label="Kommentare anzeigen"
          icon={<ChatsCircle />}
          active={showComments}
          onClick={() => setShowComments((value) => !value)}
        />
        <ToolButton
          label={protectedSheet ? "Blattschutz aufheben" : "Blatt schützen"}
          icon={protectedSheet ? <Lock /> : <LockOpen />}
          active={protectedSheet}
          disabled={pivotSheet}
          onClick={toggleProtection}
        />
        <ToolButton
          label="Bearbeitbar trotz Blattschutz"
          icon={<LockOpen />}
          active={Boolean(activeStyle.unlocked)}
          disabled={protectedSheet || pivotSheet}
          onClick={toggleUnlocked}
        />
      </ToolGroup>
      <ToolSeparator />
      <ToolButton label="Blatt als CSV herunterladen" icon={<DownloadSimple />} text="CSV" onClick={downloadCsv} />
    </div>
  );
}
