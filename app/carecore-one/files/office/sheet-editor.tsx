"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal, flushSync } from "react-dom";
import { CaretDown, Columns, Funnel, Function as FunctionIcon, Lock, Plus } from "@phosphor-icons/react";
import {
  ERROR_HINTS,
  functionHelp,
  areaName,
  cellKey,
  columnName,
  formulaProblem,
  isError,
  parseArea,
  parseCellKey,
  parseInput,
  type Area,
  type Value,
} from "@/lib/office/formula";
import type { CommentThread } from "@/lib/office/comments";
import { mergeModels } from "@/lib/office/merge";
import { pivotFields, refreshPivotSheet } from "@/lib/office/pivot";
import { PIVOT_MESSAGE, PROTECTED_MESSAGE, cellLocked, protectionBlock } from "@/lib/office/sheet-protection";
import { collaboratorColor, type Collaborator } from "@/lib/office/presence";
import {
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  NUMBER_FORMATS,
  decimalsOf,
  evaluateWorkbook,
  formatValue,
  newSheet,
  usedRange,
  newId,
  type BorderWeight,
  type CellStyle,
  type NumberFormat,
  type Sheet,
  type SheetCell,
  type SheetChart,
  type SheetModel,
  type SheetPivot,
} from "@/lib/office/model";
import {
  DEFAULT_BORDER_COLOR,
  allowedByValidation,
  applyBorder,
  chartData,
  currentRegion,
  cycleReference,
  distinctValues,
  edgesAt,
  filteredRows,
  findAll,
  replaceIn,
  ruleStyler,
  seriesValue,
  validationAt,
  type BorderPreset,
  type Edges,
  type FindOptions,
  type RuleLook,
} from "@/lib/office/sheet-features";
import {
  areaOf,
  clearArea,
  duplicateSheet,
  inArea,
  insertDelete,
  mergesOf,
  overlaps,
  parseClipboard,
  renameSheet,
  replaceSheet,
  setValue,
  setValues,
  shiftedCell,
  sortArea,
  styleArea,
  toDelimited,
  type Pos,
  type Range,
} from "@/lib/office/sheet-ops";
import type { EditorProps } from "./editor-props";
import { CommentsPanel, newComment } from "./office-comments";
import { MenuList, type MenuItem } from "./office-ui";
import {
  ChartDialog,
  ChartSvg,
  FilterMenu,
  FindBar,
  NamesDialog,
  PageDialog,
  PivotDialog,
  RulesDialog,
  ValidationDialog,
  type ChartValues,
} from "./sheet-panels";
import { SheetPrint } from "./sheet-print";
import { SheetRibbon } from "./sheet-ribbon";
import {
  OPERATOR_END,
  barStyle,
  edgeShadow,
  formulaContext,
  formulaSuggestions,
  lowerBound,
  sameArea,
  type Dialog,
} from "./sheet-shared";

const HEADER_H = 26;
const ROWHEAD_W = 48;
const OVERSCAN = 12;
const HISTORY = 100;
const ZOOMS = [50, 75, 100, 125, 150, 200];
const pad2 = (value: number) => String(value).padStart(2, "0");

type Editing = { pos: Pos; value: string; mode: "enter" | "edit"; source: "cell" | "bar" };
type Clip = {
  text: string;
  area: Area;
  sheet: number;
  cells: (SheetCell | undefined)[][];
  values: Value[][];
  cut: boolean;
};
type Menu = { x: number; y: number; kind: "cell" | "tab"; sheet?: number } | null;
type Drag = { kind: "select" | "rows" | "cols" | "fill" | "point"; start: Pos } | null;
type Find = { replace: boolean; hits: Pos[]; index: number; query: string; options: FindOptions } | null;

export default function SheetEditor({
  model: initial,
  onChange,
  readOnly,
  title,
  flushRef,
  user,
  remoteRef,
  people = [],
  onPlace,
}: EditorProps<SheetModel>) {
  const [model, setModel] = useState(initial);
  const modelRef = useRef(initial);
  const [active, setActive] = useState(0);
  const [range, setRange] = useState<Range>({ anchor: { col: 0, row: 0 }, focus: { col: 0, row: 0 } });
  const [editing, setEditingState] = useState<Editing | null>(null);
  // Laufende Eingabe auch als Ref: Tasten, die vor dem nächsten Zeichnen eintreffen, gehen nicht verloren.
  const editingRef = useRef<Editing | null>(null);
  const setEditing = useCallback((next: Editing | null) => {
    editingRef.current = next;
    setEditingState(next);
  }, []);
  const [formulaError, setFormulaError] = useState("");
  const [history, setHistory] = useState<{ undo: SheetModel[]; redo: SheetModel[] }>({ undo: [], redo: [] });
  const [scroll, setScroll] = useState({ top: 0, left: 0, height: 600 });
  const [menu, setMenu] = useState<Menu>(null);
  const [renaming, setRenaming] = useState<{ index: number; value: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [resize, setResize] = useState<{ kind: "col" | "row"; index: number; size: number } | null>(null);
  const [fillTarget, setFillTarget] = useState<Area | null>(null);
  const [notice, setNotice] = useState("");
  const [printing, setPrinting] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [hasClip, setHasClip] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [find, setFind] = useState<Find>(null);
  const [painter, setPainter] = useState<(CellStyle | undefined)[][] | null>(null);
  const [filterMenu, setFilterMenu] = useState<{ col: number; x: number; y: number } | null>(null);
  const [listMenu, setListMenu] = useState<{ x: number; y: number; values: string[] } | null>(null);
  const [selectedChart, setSelectedChart] = useState<string | null>(null);
  const [chartDrag, setChartDrag] = useState<{ id: string; x: number; y: number; w: number; h: number } | null>(null);
  const [borderWeight, setBorderWeight] = useState<BorderWeight>("thin");
  const [borderColor, setBorderColor] = useState<string>(DEFAULT_BORDER_COLOR);
  // Kommentare an Zellen: Seitenleiste offen, wenn die Datei offene Kommentare hat; Entwurf gehört zu Blatt und Zelle.
  const [showComments, setShowComments] = useState(() =>
    initial.sheets.some((item) => Object.values(item.comments ?? {}).some((thread) => !thread.resolved)),
  );
  const [commentDraft, setCommentDraft] = useState<{ sheet: string; key: string } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLTextAreaElement>(null);
  const drag = useRef<Drag>(null);
  const clip = useRef<Clip | null>(null);
  const pasteHandled = useRef(true);
  const [point, setPoint] = useState<{ start: number; result: string } | null>(null);
  const emit = useRef(onChange);
  useEffect(() => {
    emit.current = onChange;
  }, [onChange]);

  const sheet = model.sheets[active] ?? model.sheets[0];
  const area = areaOf(range);
  const merges = useMemo(() => mergesOf(sheet), [sheet]);
  const evaluator = useMemo(() => evaluateWorkbook(model), [model]);
  const valueAt = useCallback(
    (col: number, row: number) => evaluator.value(active, cellKey(col, row)),
    [evaluator, active],
  );
  // Angezeigter Text einer Zelle (für Filter, Suchen und Diagrammbeschriftungen).
  const textAt = useCallback(
    (col: number, row: number) => formatValue(valueAt(col, row), sheet.cells[cellKey(col, row)]?.s),
    [valueAt, sheet],
  );
  const filterArea = useMemo(() => (sheet.filter ? parseArea(sheet.filter.range) : null), [sheet.filter]);
  const hiddenRowSet = useMemo(() => new Set([...sheet.hiddenRows, ...filteredRows(sheet, textAt)]), [sheet, textAt]);
  const hiddenColSet = useMemo(() => new Set(sheet.hiddenCols), [sheet.hiddenCols]);
  const ruleStyle = useMemo(() => ruleStyler(sheet, valueAt), [sheet, valueAt]);

  // Verlauf als Ref (sicher bei schnellen Wiederholungen) und als Zustand (für die Knöpfe).
  const historyRef = useRef<{ undo: SheetModel[]; redo: SheetModel[] }>({ undo: [], redo: [] });
  const apply = useCallback((next: SheetModel) => {
    modelRef.current = next;
    setModel(next);
    setHistory({ undo: historyRef.current.undo, redo: historyRef.current.redo });
    setActive((current) => Math.min(current, next.sheets.length - 1));
    emit.current(next);
  }, []);
  const commit = useCallback(
    (next: SheetModel, force = false) => {
      // Blattschutz und Pivot-Tabellen: verbotene Änderungen gar nicht erst übernehmen.
      const block = force ? null : protectionBlock(modelRef.current, next);
      if (block) {
        setNotice(block);
        return;
      }
      historyRef.current = { undo: [...historyRef.current.undo.slice(-HISTORY + 1), modelRef.current], redo: [] };
      apply(next);
    },
    [apply],
  );
  const commitSheet = useCallback(
    (change: (sheet: Sheet) => Sheet) => {
      const current = modelRef.current;
      commit(replaceSheet(current, active, change(current.sheets[active])));
    },
    [active, commit],
  );
  // Gleichzeitiges Bearbeiten: zusammengeführten Stand übernehmen. Die laufende Eingabe bleibt offen, und
  // Rückgängig/Wiederholen betreffen weiterhin nur die eigenen Schritte (Verlauf auf den neuen Stand umgestellt).
  useEffect(() => {
    if (!remoteRef) return;
    remoteRef.current = (next) => {
      const before = modelRef.current;
      if (next === before) return;
      const rebase = (list: SheetModel[]) => list.map((entry) => mergeModels(before, entry, next) as SheetModel);
      historyRef.current = { undo: rebase(historyRef.current.undo), redo: rebase(historyRef.current.redo) };
      modelRef.current = next;
      setModel(next);
      setHistory({ undo: historyRef.current.undo, redo: historyRef.current.redo });
      setActive((current) => Math.min(current, next.sheets.length - 1));
    };
    return () => {
      remoteRef.current = null;
    };
  }, [remoteRef]);
  // Eigene Stelle für die anderen (Blatt und aktive Zelle).
  useEffect(() => {
    onPlace?.({ sheet: sheet.id, cell: cellKey(range.focus.col, range.focus.row) });
  }, [onPlace, sheet.id, range.focus.col, range.focus.row]);
  // Andere Personen auf diesem Blatt, je Zelle.
  const othersAt = useMemo(() => {
    const map = new Map<string, Collaborator>();
    for (const person of people)
      if (person.place?.sheet === sheet.id && person.place.cell) map.set(person.place.cell, person);
    return map;
  }, [people, sheet.id]);

  function undo() {
    const previous = historyRef.current.undo[historyRef.current.undo.length - 1];
    if (!previous) return;
    historyRef.current = {
      undo: historyRef.current.undo.slice(0, -1),
      redo: [...historyRef.current.redo, modelRef.current],
    };
    apply(previous);
  }
  function redo() {
    const next = historyRef.current.redo[historyRef.current.redo.length - 1];
    if (!next) return;
    historyRef.current = {
      undo: [...historyRef.current.undo, modelRef.current],
      redo: historyRef.current.redo.slice(0, -1),
    };
    apply(next);
  }

  // ---------- Masse ----------
  const colWidths = useMemo(
    () =>
      Array.from({ length: sheet.colCount }, (_, col) =>
        hiddenColSet.has(col)
          ? 0
          : resize?.kind === "col" && resize.index === col
            ? resize.size
            : (sheet.cols[String(col)] ?? DEFAULT_COL_WIDTH),
      ),
    [sheet, resize, hiddenColSet],
  );
  const rowHeights = useMemo(
    () =>
      Array.from({ length: sheet.rowCount }, (_, row) =>
        hiddenRowSet.has(row)
          ? 0
          : resize?.kind === "row" && resize.index === row
            ? resize.size
            : (sheet.rows[String(row)] ?? DEFAULT_ROW_HEIGHT),
      ),
    [sheet, resize, hiddenRowSet],
  );
  const colLefts = useMemo(() => {
    const out = [0];
    colWidths.forEach((width) => out.push(out[out.length - 1] + width));
    return out;
  }, [colWidths]);
  const rowTops = useMemo(() => {
    const out = [0];
    rowHeights.forEach((height) => out.push(out[out.length - 1] + height));
    return out;
  }, [rowHeights]);
  const freezeRows = Math.min(sheet.freeze.rows, sheet.rowCount);
  const freezeCols = Math.min(sheet.freeze.cols, sheet.colCount);
  const frozenHeight = rowTops[freezeRows];
  const frozenWidth = colLefts[freezeCols];

  // Sichtbare Zeilen (nur diese werden gezeichnet – auch grosse Tabellen bleiben flüssig).
  const scale = zoom / 100;
  let first = Math.max(freezeRows, lowerBound(rowTops, scroll.top / scale + frozenHeight) - OVERSCAN);
  const last = Math.min(sheet.rowCount - 1, lowerBound(rowTops, (scroll.top + scroll.height) / scale) + OVERSCAN);
  for (const merge of merges) if (merge.r1 < first && merge.r2 >= first && merge.r1 >= freezeRows) first = merge.r1;

  const mergeAt = useMemo(() => {
    const origin = new Map<string, Area>();
    const covered = new Set<string>();
    for (const merge of merges) {
      // Verbund mit ausgeblendeter erster Zelle: Zellen einzeln zeigen.
      if (hiddenRowSet.has(merge.r1) || hiddenColSet.has(merge.c1)) continue;
      origin.set(cellKey(merge.c1, merge.r1), merge);
      for (let row = merge.r1; row <= merge.r2; row += 1)
        for (let col = merge.c1; col <= merge.c2; col += 1)
          if (row !== merge.r1 || col !== merge.c1) covered.add(cellKey(col, row));
    }
    return { origin, covered };
  }, [merges, hiddenRowSet, hiddenColSet]);

  // ---------- Auswahl ----------
  const select = useCallback(
    (anchor: Pos, focus: Pos = anchor) => {
      const clamp = (pos: Pos) => ({
        col: Math.max(0, Math.min(sheet.colCount - 1, pos.col)),
        row: Math.max(0, Math.min(sheet.rowCount - 1, pos.row)),
      });
      setRange({ anchor: clamp(anchor), focus: clamp(focus) });
    },
    [sheet.colCount, sheet.rowCount],
  );

  // Aktive Zelle sichtbar halten.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const { col, row } = range.focus;
    const z = zoom / 100;
    if (row >= freezeRows) {
      const top = (rowTops[row] - frozenHeight) * z;
      const bottom = (rowTops[row + 1] - frozenHeight) * z;
      const view = grid.clientHeight - (HEADER_H + frozenHeight) * z;
      if (top < grid.scrollTop) grid.scrollTop = top;
      else if (bottom > grid.scrollTop + view) grid.scrollTop = bottom - view;
    }
    if (col >= freezeCols) {
      const left = (colLefts[col] - frozenWidth) * z;
      const right = (colLefts[col + 1] - frozenWidth) * z;
      const view = grid.clientWidth - (ROWHEAD_W + frozenWidth) * z;
      if (left < grid.scrollLeft) grid.scrollLeft = left;
      else if (right > grid.scrollLeft + view) grid.scrollLeft = right - view;
    }
  }, [range.focus, rowTops, colLefts, freezeRows, freezeCols, frozenHeight, frozenWidth, zoom]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const update = () => setScroll({ top: grid.scrollTop, left: grid.scrollLeft, height: grid.clientHeight });
    update();
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    grid.addEventListener("scroll", onScroll);
    const observer = new ResizeObserver(update);
    observer.observe(grid);
    return () => {
      grid.removeEventListener("scroll", onScroll);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [active]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(id);
  }, [notice]);

  // Drucken: ganze Tabelle (nicht nur der sichtbare Ausschnitt).
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  const focusGrid = () => gridRef.current?.focus({ preventScroll: true });
  const rawAt = (pos: Pos) => sheet.cells[cellKey(pos.col, pos.row)]?.v ?? "";
  const styleAt = (pos: Pos) => sheet.cells[cellKey(pos.col, pos.row)]?.s;

  // ---------- Bearbeiten ----------
  function startEdit(mode: Editing["mode"], value?: string, source: Editing["source"] = "cell") {
    if (readOnly) return;
    const pos = range.focus;
    const origin = [...mergeAt.origin.values()].find((merge) => inArea(merge, pos.col, pos.row));
    const target = origin ? { col: origin.c1, row: origin.r1 } : pos;
    if (cellLocked(sheet, cellKey(target.col, target.row)))
      return setNotice(sheet.pivot ? PIVOT_MESSAGE : PROTECTED_MESSAGE);
    // Sofort zeichnen und das Eingabefeld fokussieren: so landen auch schnell getippte Zeichen in der Zelle.
    flushSync(() => {
      setEditing({ pos: target, value: value ?? rawAt(target), mode, source });
      setFormulaError("");
      setSuggestIndex(0);
      setPoint(null);
    });
    if (source === "cell") {
      const input = gridRef.current?.querySelector<HTMLTextAreaElement>(".sheet-cell-editor");
      input?.focus({ preventScroll: true });
      input?.setSelectionRange(input.value.length, input.value.length);
    }
  }

  // Tab, Tab, …, Enter wie in Excel: Enter führt in die Spalte zurück, in der die Folge mit Tab begann, eine Zeile
  // tiefer. Gilt nur, solange die Zelle aktiv ist, auf die der letzte Tab geführt hat.
  const tabChain = useRef<{ start: number; at: string } | null>(null);
  function keyStep(from: { col: number; row: number }, dc: number, dr: number) {
    const chain = tabChain.current?.at === cellKey(from.col, from.row) ? tabChain.current : null;
    if (dr === 0) return { dc, start: chain ? chain.start : from.col };
    return { dc: chain ? chain.start - from.col : dc, start: null };
  }

  function commitEdit(move?: { dc: number; dr: number; key?: boolean }, options: { keepFocus?: boolean } = {}) {
    const editing = editingRef.current;
    if (!editing) return true;
    let raw = editing.value;
    if (raw.startsWith("=") && raw.length > 1) {
      const problem = formulaProblem(raw.slice(1));
      if (problem) {
        setFormulaError(`Formel unvollständig: ${problem}.`);
        return false;
      }
    }
    // Auswahlliste: nur erlaubte Werte (Schreibweise wie in der Liste).
    const rule = validationAt(modelRef.current.sheets[active], editing.pos.col, editing.pos.row);
    if (rule && !raw.startsWith("=")) {
      const allowed = allowedByValidation(rule.values, raw);
      if (allowed === false) {
        setFormulaError(
          `„${raw}“ ist hier nicht erlaubt. Erlaubt: ${rule.values.slice(0, 12).join(", ")}${rule.values.length > 12 ? " …" : ""}.`,
        );
        return false;
      }
      if (allowed !== true) raw = allowed;
    }
    if (raw !== (modelRef.current.sheets[active].cells[cellKey(editing.pos.col, editing.pos.row)]?.v ?? ""))
      commitSheet((current) => {
        const next = setValue(current, editing.pos, raw);
        // Zeilenumbruch in der Eingabe (Alt+Enter): Zeilenumbruch der Zelle einschalten.
        if (!raw.includes("\n")) return next;
        return styleArea(
          next,
          { c1: editing.pos.col, r1: editing.pos.row, c2: editing.pos.col, r2: editing.pos.row },
          (style) => ({ ...style, wrap: true }),
        );
      });
    setEditing(null);
    setFormulaError("");
    setPoint(null);
    if (move) {
      const step = move.key ? keyStep(editing.pos, move.dc, move.dr) : { dc: move.dc, start: null };
      const next = { col: editing.pos.col + step.dc, row: editing.pos.row + move.dr };
      select(next);
      tabChain.current = step.start === null ? null : { start: step.start, at: cellKey(next.col, next.row) };
    } else select(editing.pos);
    if (!options.keepFocus) focusGrid();
    return true;
  }

  // Offene Eingabe übernehmen, bevor gespeichert, heruntergeladen oder geschlossen wird.
  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = () => commitEdit(undefined, { keepFocus: true });
    return () => {
      flushRef.current = null;
    };
  });

  // Das Eingabefeld der Zelle erhält immer den Fokus (Schreibmarke am Ende).
  useEffect(() => {
    if (editing?.source !== "cell") return;
    const input = gridRef.current?.querySelector<HTMLTextAreaElement>(".sheet-cell-editor");
    if (input && document.activeElement !== input) {
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }, [editing?.source, editing?.pos.col, editing?.pos.row]);

  // Text an der Schreibmarke des aktiven Eingabefelds einfügen (Datum, Uhrzeit, Zeilenumbruch).
  function insertAtCaret(target: HTMLTextAreaElement, text: string) {
    const current = editingRef.current;
    if (!current) return;
    const start = target.selectionStart ?? current.value.length;
    const end = target.selectionEnd ?? start;
    const value = current.value.slice(0, start) + text + current.value.slice(end);
    // Sofort übernehmen und den Cursor setzen: sonst landet ein schnell nachgetipptes Zeichen an der alten Stelle.
    flushSync(() => setEditing({ ...current, value, mode: "edit" }));
    target.setSelectionRange(start + text.length, start + text.length);
  }
  const todayText = () => {
    const now = new Date();
    return `${pad2(now.getDate())}.${pad2(now.getMonth() + 1)}.${now.getFullYear()}`;
  };
  const timeText = () => {
    const now = new Date();
    return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  };

  function cancelEdit() {
    setEditing(null);
    setFormulaError("");
    setPoint(null);
    focusGrid();
  }

  const context = editing ? formulaContext(editing.value) : { typing: null, inside: null };
  // Vorschläge: benannte Bereiche zuerst, dann Funktionen.
  const suggestions = editing && context.typing ? formulaSuggestions(model.names, context.typing) : [];
  const signature = context.inside ? functionHelp(context.inside) : null;

  function acceptSuggestion(name: string) {
    if (!editing || !context.typing) return;
    // Benannte Bereiche ohne Klammer, Funktionen mit.
    const isName = (model.names ?? []).some((entry) => entry.name === name);
    const value = `${editing.value.slice(0, editing.value.length - context.typing.length)}${name}${isName ? "" : "("}`;
    setEditing({ ...editing, value, mode: "edit" });
    setSuggestIndex(0);
    requestAnimationFrame(() =>
      (editing.source === "bar"
        ? barRef.current
        : gridRef.current?.querySelector<HTMLTextAreaElement>(".sheet-cell-editor")
      )?.focus(),
    );
  }

  // Beim Schreiben einer Formel: Klick auf eine Zelle fügt ihren Bezug ein, Ziehen einen Bereich.
  function pointAt(pos: Pos, anchor?: Pos) {
    if (!editing) return;
    const text = anchor ? areaName(areaOf({ anchor, focus: pos })) : cellKey(pos.col, pos.row);
    const sheetPrefix = "";
    let start = editing.value.length;
    if (point && editing.value === point.result) start = point.start;
    const value = `${editing.value.slice(0, start)}${sheetPrefix}${text}`;
    setPoint({ start, result: value });
    setEditing({ ...editing, value });
  }
  const pointMode = Boolean(
    editing &&
    editing.value.startsWith("=") &&
    (OPERATOR_END.test(editing.value) || (point && editing.value === point.result)),
  );

  // ---------- Werkzeuge ----------
  const activeStyle = styleAt(range.focus) ?? {};
  function applyStyle(change: (style: CellStyle) => CellStyle) {
    if (readOnly) return;
    commitSheet((current) => styleArea(current, area, change));
  }
  const toggle = (flag: "b" | "i" | "u" | "s" | "wrap") => {
    const on = !activeStyle[flag];
    applyStyle((style) => ({ ...style, [flag]: on }));
  };
  function setFormat(fmt: NumberFormat) {
    applyStyle((style) => ({ ...style, fmt: fmt === "general" ? undefined : fmt, dec: undefined }));
  }
  function changeDecimals(delta: number) {
    applyStyle((style) => {
      const fmt = style.fmt && style.fmt !== "general" ? style.fmt : "number";
      return { ...style, fmt, dec: Math.max(0, Math.min(10, decimalsOf({ ...style, fmt }) + delta)) };
    });
  }
  function toggleMerge() {
    if (readOnly) return;
    const touching = merges.filter((merge) => overlaps(merge, area));
    if (touching.length) {
      commitSheet((current) => ({
        ...current,
        merges: mergesOf(current)
          .filter((merge) => !overlaps(merge, area))
          .map(areaName),
      }));
      return;
    }
    if (area.c1 === area.c2 && area.r1 === area.r2) return;
    const lost = Object.keys(sheet.cells).filter((key) => {
      const col = key.match(/^[A-Z]+/)?.[0];
      const row = Number(key.match(/\d+$/)?.[0]) - 1;
      if (!col) return false;
      const index = col.split("").reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;
      return inArea(area, index, row) && !(index === area.c1 && row === area.r1) && sheet.cells[key].v !== "";
    });
    commitSheet((current) => {
      let next = current;
      if (lost.length) {
        const cells = { ...next.cells };
        for (const key of lost) cells[key] = { ...cells[key], v: "" };
        next = { ...next, cells };
      }
      return { ...next, merges: [...next.merges, areaName(area)] };
    });
    if (lost.length) setNotice("Verbunden – nur der Wert oben links bleibt erhalten");
  }
  function autoSum() {
    if (readOnly) return;
    const pos = range.focus;
    let top = pos.row - 1;
    while (top >= 0 && typeof valueAt(pos.col, top) === "number") top -= 1;
    const formula =
      top < pos.row - 1 ? `=SUMME(${columnName(pos.col)}${top + 2}:${columnName(pos.col)}${pos.row})` : "=SUMME()";
    startEdit("edit", formula);
  }
  function setFreeze(rows: number, cols: number) {
    commitSheet((current) => ({ ...current, freeze: { rows, cols } }));
  }
  function insert(axis: "row" | "col", before: boolean) {
    if (readOnly) return;
    const index = axis === "row" ? (before ? area.r1 : area.r2 + 1) : before ? area.c1 : area.c2 + 1;
    const count = axis === "row" ? area.r2 - area.r1 + 1 : area.c2 - area.c1 + 1;
    commit(insertDelete(modelRef.current, active, axis, index, count));
  }
  function remove(axis: "row" | "col") {
    if (readOnly) return;
    const index = axis === "row" ? area.r1 : area.c1;
    const count = axis === "row" ? area.r2 - area.r1 + 1 : area.c2 - area.c1 + 1;
    if ((axis === "row" ? sheet.rowCount : sheet.colCount) - count < 1) return;
    commit(insertDelete(modelRef.current, active, axis, index, -count));
    select({ col: Math.min(area.c1, sheet.colCount - 1), row: Math.min(area.r1, sheet.rowCount - 1) });
  }
  function sort(direction: 1 | -1) {
    if (readOnly) return;
    let region = area;
    if (area.r1 === area.r2) {
      const used = usedRange(sheet);
      const startRow = Math.max(freezeRows, 0);
      region = { c1: 0, r1: startRow, c2: Math.max(0, used.cols - 1), r2: Math.max(startRow, used.rows - 1) };
      if (region.r2 <= region.r1) return;
    }
    commitSheet((current) => sortArea(current, region, range.anchor.col, direction, (col, row) => valueAt(col, row)));
    setNotice(direction === 1 ? "Aufsteigend sortiert" : "Absteigend sortiert");
  }
  function clear(what: "content" | "formats" | "all") {
    if (readOnly) return;
    commitSheet((current) => clearArea(current, area, what));
  }
  function setBorder(preset: BorderPreset, weight = borderWeight, color = borderColor) {
    if (readOnly) return;
    commitSheet((current) => {
      const cells = { ...current.cells };
      for (let row = area.r1; row <= area.r2; row += 1)
        for (let col = area.c1; col <= area.c2; col += 1) {
          const key = cellKey(col, row);
          const style = applyBorder({ ...(cells[key]?.s ?? {}) }, preset, area, col, row, weight, color);
          for (const name of Object.keys(style) as (keyof CellStyle)[])
            if (style[name] === undefined || style[name] === false) delete style[name];
          const value = cells[key]?.v ?? "";
          if (!value && !Object.keys(style).length) delete cells[key];
          else cells[key] = Object.keys(style).length ? { v: value, s: style } : { v: value };
        }
      return { ...current, cells };
    });
  }
  function changeIndent(delta: number) {
    applyStyle((style) => {
      const indent = Math.max(0, Math.min(10, (style.indent ?? 0) + delta));
      return { ...style, indent: indent || undefined, align: indent ? (style.align ?? "left") : style.align };
    });
  }
  function startPainter() {
    if (painter) return setPainter(null);
    const pattern: (CellStyle | undefined)[][] = [];
    for (let row = area.r1; row <= Math.min(area.r2, area.r1 + 199); row += 1) {
      const line: (CellStyle | undefined)[] = [];
      for (let col = area.c1; col <= Math.min(area.c2, area.c1 + 49); col += 1) line.push(styleAt({ col, row }));
      pattern.push(line);
    }
    setPainter(pattern);
    setNotice("Format übertragen: Zielzellen markieren");
  }
  function paintFormats(target: Area) {
    const pattern = painter;
    setPainter(null);
    if (!pattern || readOnly) return;
    const height = pattern.length;
    const width = pattern[0]?.length ?? 1;
    // Einzelne Zielzelle: so gross wie die Vorlage.
    const region =
      target.c1 === target.c2 && target.r1 === target.r2
        ? { ...target, c2: target.c1 + width - 1, r2: target.r1 + height - 1 }
        : target;
    commitSheet((current) => {
      const cells = { ...current.cells };
      for (let row = region.r1; row <= region.r2; row += 1)
        for (let col = region.c1; col <= region.c2; col += 1) {
          const key = cellKey(col, row);
          const style = pattern[(row - region.r1) % height][(col - region.c1) % width];
          const value = cells[key]?.v ?? "";
          if (!value && !style) delete cells[key];
          else cells[key] = style ? { v: value, s: style } : { v: value };
        }
      return { ...current, cells };
    });
  }
  function hide(axis: "row" | "col", hidden: boolean) {
    if (readOnly) return;
    commitSheet((current) => {
      const list = new Set(axis === "row" ? current.hiddenRows : current.hiddenCols);
      const [from, to] = axis === "row" ? [area.r1, area.r2] : [area.c1, area.c2];
      for (let index = from; index <= to; index += 1) {
        if (hidden) list.add(index);
        else list.delete(index);
      }
      const total = axis === "row" ? current.rowCount : current.colCount;
      if (list.size >= total) return current;
      const sorted = [...list].sort((a, b) => a - b);
      return axis === "row" ? { ...current, hiddenRows: sorted } : { ...current, hiddenCols: sorted };
    });
  }
  function toggleFilter() {
    if (readOnly) return;
    if (sheet.filter) {
      commitSheet((current) => ({ ...current, filter: null }));
      return setNotice("Filter entfernt");
    }
    const region =
      area.r1 === area.r2 && area.c1 === area.c2 ? currentRegion(sheet, range.focus.col, range.focus.row) : area;
    if (region.r2 <= region.r1) return setNotice("Für einen Filter bitte eine Tabelle mit Überschriften markieren");
    commitSheet((current) => ({ ...current, filter: { range: areaName(region), hidden: {} } }));
    setNotice("Filter eingeschaltet – Pfeile in der Überschrift");
  }
  function sortFilterColumn(col: number, direction: 1 | -1) {
    if (!filterArea) return;
    const region = { ...filterArea, r1: filterArea.r1 + 1 };
    commitSheet((current) => sortArea(current, region, col, direction, (c, r) => valueAt(c, r)));
  }
  function addChart() {
    const region =
      area.r1 === area.r2 && area.c1 === area.c2 ? currentRegion(sheet, range.focus.col, range.focus.row) : area;
    setDialog({ kind: "chart", chart: null });
    setRange({ anchor: { col: region.c1, row: region.r1 }, focus: { col: region.c2, row: region.r2 } });
  }
  function saveChart(chart: SheetChart | null, values: ChartValues) {
    if (chart) {
      commitSheet((current) => ({
        ...current,
        charts: current.charts.map((item) => (item.id === chart.id ? { ...item, ...values } : item)),
      }));
      return;
    }
    const grid = gridRef.current;
    const scaleNow = zoom / 100;
    const target = parseArea(values.range);
    // Neben den Daten platzieren (wie Excel), sonst im sichtbaren Bereich.
    const x = target ? colLefts[Math.min(sheet.colCount, target.c2 + 1)] + 16 : (grid?.scrollLeft ?? 0) / scaleNow + 40;
    const y = target ? rowTops[target.r1] : (grid?.scrollTop ?? 0) / scaleNow + 40;
    const created: SheetChart = { id: newId(), ...values, x: Math.round(x), y: Math.round(y), w: 480, h: 300 };
    commitSheet((current) => ({ ...current, charts: [...current.charts, created] }));
    setSelectedChart(created.id);
  }
  function deleteChart(id: string) {
    commitSheet((current) => ({ ...current, charts: current.charts.filter((item) => item.id !== id) }));
    setSelectedChart(null);
    focusGrid();
  }
  function startChartDrag(event: React.MouseEvent, chart: SheetChart, mode: "move" | "resize") {
    if (event.button !== 0 || readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedChart(chart.id);
    const startX = event.clientX;
    const startY = event.clientY;
    const z = zoom / 100;
    let next = { id: chart.id, x: chart.x, y: chart.y, w: chart.w, h: chart.h };
    const onMove = (moveEvent: MouseEvent) => {
      const dx = (moveEvent.clientX - startX) / z;
      const dy = (moveEvent.clientY - startY) / z;
      next =
        mode === "move"
          ? { ...next, x: Math.max(0, Math.round(chart.x + dx)), y: Math.max(0, Math.round(chart.y + dy)) }
          : { ...next, w: Math.max(160, Math.round(chart.w + dx)), h: Math.max(120, Math.round(chart.h + dy)) };
      setChartDrag(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setChartDrag(null);
      if (next.x !== chart.x || next.y !== chart.y || next.w !== chart.w || next.h !== chart.h)
        commitSheet((current) => ({
          ...current,
          charts: current.charts.map((item) => (item.id === chart.id ? { ...item, ...next } : item)),
        }));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // ---------- Suchen und Ersetzen ----------
  function openFind(replace: boolean) {
    if (editing && !commitEdit()) return;
    setFind((current) => ({
      replace,
      hits: current?.hits ?? [],
      index: current?.index ?? 0,
      query: current?.query ?? "",
      options: current?.options ?? { matchCase: false, wholeCell: false },
    }));
  }
  function runSearch(query: string, options: FindOptions) {
    const hits = findAll(sheet, query, options, textAt);
    const from = hits.findIndex(
      (hit) => hit.row > range.focus.row || (hit.row === range.focus.row && hit.col >= range.focus.col),
    );
    const index = from < 0 ? 0 : from;
    setFind((current) => (current ? { ...current, hits, index, query, options } : current));
    if (hits[index]) select(hits[index]);
  }
  function nextHit(direction: 1 | -1) {
    if (!find?.hits.length) return;
    const index = (find.index + direction + find.hits.length) % find.hits.length;
    setFind({ ...find, index });
    select(find.hits[index]);
  }
  function replaceHits(replacement: string, all: boolean) {
    if (!find?.hits.length || readOnly) return;
    const targets = all ? find.hits : [find.hits[find.index]];
    const entries: { pos: Pos; cell: SheetCell | null }[] = [];
    for (const pos of targets) {
      const cell = sheet.cells[cellKey(pos.col, pos.row)];
      if (!cell) continue;
      const next = replaceIn(cell.v, find.query, replacement, find.options);
      if (next !== cell.v) entries.push({ pos, cell: { ...cell, v: next } });
    }
    if (!entries.length) return setNotice("Nur in Formeln gefunden – dort bitte direkt ändern");
    commitSheet((current) => setValues(current, entries));
    setNotice(entries.length === 1 ? "1 Zelle ersetzt" : `${entries.length} Zellen ersetzt`);
    const hits = findAll(
      {
        ...sheet,
        cells: {
          ...sheet.cells,
          ...Object.fromEntries(entries.map((entry) => [cellKey(entry.pos.col, entry.pos.row), entry.cell!])),
        },
      },
      find.query,
      find.options,
      textAt,
    );
    setFind({ ...find, hits, index: Math.min(find.index, Math.max(0, hits.length - 1)) });
    if (hits.length && !all) select(hits[Math.min(find.index, hits.length - 1)]);
  }
  function autoFit(col: number) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let width = 40;
    for (let row = 0; row < sheet.rowCount; row += 1) {
      const cell = sheet.cells[cellKey(col, row)];
      if (!cell) continue;
      ctx.font = `${cell.s?.b ? "700" : "400"} ${cell.s?.size ? (cell.s.size * 4) / 3 : 14}px Calibri, Carlito, Arial, sans-serif`;
      width = Math.max(width, ctx.measureText(formatValue(valueAt(col, row), cell.s)).width + 16);
    }
    commitSheet((current) => ({
      ...current,
      cols: { ...current.cols, [String(col)]: Math.min(600, Math.ceil(width)) },
    }));
  }

  // ---------- Zwischenablage ----------
  function selectionText(source: Area) {
    const rows: string[][] = [];
    for (let row = source.r1; row <= source.r2; row += 1) {
      const line: string[] = [];
      for (let col = source.c1; col <= source.c2; col += 1)
        line.push(formatValue(valueAt(col, row), styleAt({ col, row })));
      rows.push(line);
    }
    return toDelimited(rows, "\t");
  }
  function copy(cut: boolean, data?: DataTransfer | null) {
    const text = selectionText(area);
    const cells: (SheetCell | undefined)[][] = [];
    const values: Value[][] = [];
    for (let row = area.r1; row <= area.r2; row += 1) {
      const line: (SheetCell | undefined)[] = [];
      const valueLine: Value[] = [];
      for (let col = area.c1; col <= area.c2; col += 1) {
        line.push(sheet.cells[cellKey(col, row)]);
        valueLine.push(valueAt(col, row));
      }
      cells.push(line);
      values.push(valueLine);
    }
    clip.current = { text, area, sheet: active, cells, values, cut };
    setHasClip(true);
    if (data) data.setData("text/plain", text);
    else void navigator.clipboard?.writeText(text).catch(() => undefined);
    setNotice(cut ? "Ausgeschnitten – an der Zielzelle einfügen" : "Kopiert");
  }
  function paste(text: string) {
    if (readOnly || !text) return;
    const target = { col: area.c1, row: area.r1 };
    const internal = clip.current && clip.current.text === text ? clip.current : null;
    if (internal) {
      const height = internal.cells.length;
      const width = internal.cells[0]?.length ?? 0;
      const dRow = target.row - internal.area.r1;
      const dCol = target.col - internal.area.c1;
      // Ist die Auswahl ein Vielfaches des Kopierten, wird sie damit gefüllt (wie in Excel).
      const tilesY = !internal.cut && (area.r2 - area.r1 + 1) % height === 0 ? (area.r2 - area.r1 + 1) / height : 1;
      const tilesX = !internal.cut && (area.c2 - area.c1 + 1) % width === 0 ? (area.c2 - area.c1 + 1) / width : 1;
      let next = modelRef.current;
      if (internal.cut) {
        const source = next.sheets[internal.sheet];
        next = replaceSheet(next, internal.sheet, clearArea(source, internal.area, "all"));
      }
      const entries: { pos: Pos; cell: SheetCell | null }[] = [];
      for (let ty = 0; ty < tilesY; ty += 1)
        for (let tx = 0; tx < tilesX; tx += 1)
          internal.cells.forEach((line, r) =>
            line.forEach((cell, c) => {
              const pos = { col: target.col + tx * width + c, row: target.row + ty * height + r };
              entries.push({
                pos,
                cell: internal.cut ? (cell ?? null) : shiftedCell(cell, dCol + tx * width, dRow + ty * height),
              });
            }),
          );
      next = replaceSheet(next, active, setValues(next.sheets[active], entries));
      commit(next);
      if (internal.cut) {
        clip.current = null;
        setHasClip(false);
      }
      select(target, { col: target.col + width * tilesX - 1, row: target.row + height * tilesY - 1 });
      return;
    }
    const rows = parseClipboard(text);
    const entries: { pos: Pos; cell: SheetCell | null }[] = [];
    rows.forEach((line, r) =>
      line.forEach((value, c) => {
        const pos = { col: target.col + c, row: target.row + r };
        const current = sheet.cells[cellKey(pos.col, pos.row)];
        entries.push({ pos, cell: { v: value, ...(current?.s ? { s: current.s } : {}) } });
      }),
    );
    commitSheet((current) => setValues(current, entries));
    select(target, {
      col: target.col + Math.max(...rows.map((line) => line.length)) - 1,
      row: target.row + rows.length - 1,
    });
  }

  // Inhalte einfügen: nur Werte (Formeln als Ergebnis) oder nur Formate.
  function pasteSpecial(mode: "values" | "formats") {
    const internal = clip.current;
    if (readOnly || !internal) return;
    const target = { col: area.c1, row: area.r1 };
    const entries: { pos: Pos; cell: SheetCell | null }[] = [];
    internal.cells.forEach((line, r) =>
      line.forEach((cell, c) => {
        const pos = { col: target.col + c, row: target.row + r };
        const current = sheet.cells[cellKey(pos.col, pos.row)];
        if (mode === "formats") {
          entries.push({ pos, cell: { v: current?.v ?? "", ...(cell?.s ? { s: cell.s } : {}) } });
          return;
        }
        const value = internal.values[r][c];
        const v =
          value === null || isError(value)
            ? ""
            : typeof value === "number"
              ? String(value)
              : typeof value === "boolean"
                ? value
                  ? "WAHR"
                  : "FALSCH"
                : /^[=']/.test(value) || parseInput(value).type !== "text"
                  ? `'${value}`
                  : value;
        // Zahlenformat der Quelle mitnehmen, damit ein Datum ein Datum bleibt.
        const fmt =
          cell?.s?.fmt && !current?.s?.fmt
            ? { fmt: cell.s.fmt, ...(cell.s.dec !== undefined ? { dec: cell.s.dec } : {}) }
            : {};
        const style = { ...(current?.s ?? {}), ...fmt };
        entries.push({ pos, cell: { v, ...(Object.keys(style).length ? { s: style } : {}) } });
      }),
    );
    commitSheet((current) => setValues(current, entries));
    select(target, {
      col: target.col + (internal.cells[0]?.length ?? 1) - 1,
      row: target.row + internal.cells.length - 1,
    });
    setNotice(mode === "values" ? "Werte eingefügt" : "Formate eingefügt");
  }

  // ---------- Ausfüllen ----------
  function fill(source: Area, target: Area) {
    if (sameArea(source, target)) return;
    const entries: { pos: Pos; cell: SheetCell | null }[] = [];
    const vertical = target.r1 < source.r1 || target.r2 > source.r2;
    const lines = vertical ? [source.c1, source.c2] : [source.r1, source.r2];
    for (let line = lines[0]; line <= lines[1]; line += 1) {
      const seeds: Pos[] = [];
      if (vertical) for (let row = source.r1; row <= source.r2; row += 1) seeds.push({ col: line, row });
      else for (let col = source.c1; col <= source.c2; col += 1) seeds.push({ col, row: line });
      const numbers = seeds.map((pos) => {
        const raw = rawAt(pos);
        const value = valueAt(pos.col, pos.row);
        return !raw.startsWith("=") && typeof value === "number" ? value : null;
      });
      const numeric = numbers.every((value) => value !== null);
      const step =
        numeric && seeds.length >= 2
          ? (numbers[numbers.length - 1]! - numbers[0]!) / (seeds.length - 1)
          : numeric && seeds.length === 1 && ["date", "datetime"].includes(styleAt(seeds[0])?.fmt ?? "")
            ? 1
            : null;
      const span = seeds.length;
      const from = vertical ? target.r1 : target.c1;
      const to = vertical ? target.r2 : target.c2;
      const sourceStart = vertical ? source.r1 : source.c1;
      const sourceEnd = vertical ? source.r2 : source.c2;
      for (let index = from; index <= to; index += 1) {
        if (index >= sourceStart && index <= sourceEnd) continue;
        const offset = index - sourceStart;
        const seed = seeds[((offset % span) + span) % span];
        const pos = vertical ? { col: line, row: index } : { col: index, row: line };
        const cell = sheet.cells[cellKey(seed.col, seed.row)];
        // Reihen wie Wochentage, Monate oder „Woche 1“ fortsetzen.
        const series = step === null ? seriesValue(seeds.map(rawAt), offset) : null;
        if (step !== null) {
          const value = numbers[0]! + step * offset;
          entries.push({ pos, cell: { v: String(Number(value.toPrecision(15))), ...(cell?.s ? { s: cell.s } : {}) } });
        } else if (series !== null) entries.push({ pos, cell: { v: series, ...(cell?.s ? { s: cell.s } : {}) } });
        else entries.push({ pos, cell: shiftedCell(cell, pos.col - seed.col, pos.row - seed.row) });
      }
    }
    commitSheet((current) => setValues(current, entries));
    select({ col: target.c1, row: target.r1 }, { col: target.c2, row: target.r2 });
  }
  // Doppelklick auf das Ausfüllkästchen: bis zum Ende der Daten in der Nachbarspalte ausfüllen.
  function fillDown() {
    if (readOnly) return;
    const filled = (col: number, row: number) => col >= 0 && col < sheet.colCount && rawAt({ col, row }) !== "";
    let last = area.r2;
    for (const col of [area.c1 - 1, area.c2 + 1]) {
      let row = area.r2;
      while (row + 1 < sheet.rowCount && filled(col, row + 1)) row += 1;
      last = Math.max(last, row);
    }
    if (last > area.r2) fill(area, { ...area, r2: last });
  }
  function fillAreaFor(pos: Pos): Area {
    const down = pos.row - area.r2;
    const up = area.r1 - pos.row;
    const right = pos.col - area.c2;
    const left = area.c1 - pos.col;
    const vertical = Math.max(down, up) >= Math.max(right, left);
    if (vertical && down > 0) return { ...area, r2: pos.row };
    if (vertical && up > 0) return { ...area, r1: pos.row };
    if (!vertical && right > 0) return { ...area, c2: pos.col };
    if (!vertical && left > 0) return { ...area, c1: pos.col };
    return area;
  }

  // ---------- Maus ----------
  function beginDrag(value: Drag) {
    drag.current = value;
  }
  useEffect(() => {
    const up = () => {
      const current = drag.current;
      drag.current = null;
      if (current?.kind === "fill") {
        setFillTarget((target) => {
          if (target) queueMicrotask(() => fill(area, target));
          return null;
        });
      }
      if (current?.kind === "select" && painter) paintFormats(area);
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  });

  function onCellMouseDown(event: React.MouseEvent, pos: Pos) {
    if (event.button !== 0) return;
    if (editing && pointMode) {
      event.preventDefault();
      drag.current = { kind: "point", start: pos };
      pointAt(pos);
      return;
    }
    if (editing && !commitEdit()) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    focusGrid();
    setSelectedChart(null);
    if (event.shiftKey) select(range.anchor, pos);
    else select(pos);
    drag.current = { kind: "select", start: pos };
  }
  function onCellMouseEnter(pos: Pos) {
    const current = drag.current;
    if (!current) return;
    if (current.kind === "select") select(range.anchor, pos);
    else if (current.kind === "point") pointAt(pos, current.start);
    else if (current.kind === "fill") setFillTarget(fillAreaFor(pos));
    else if (current.kind === "rows")
      select({ col: 0, row: current.start.row }, { col: sheet.colCount - 1, row: pos.row });
    else if (current.kind === "cols")
      select({ col: current.start.col, row: 0 }, { col: pos.col, row: sheet.rowCount - 1 });
  }
  function startResize(event: React.MouseEvent, kind: "col" | "row", index: number) {
    event.preventDefault();
    event.stopPropagation();
    const start = kind === "col" ? event.clientX : event.clientY;
    const initialSize = kind === "col" ? colWidths[index] : rowHeights[index];
    let size = initialSize;
    const move = (moveEvent: MouseEvent) => {
      size = Math.max(
        kind === "col" ? 24 : 16,
        Math.min(800, initialSize + (kind === "col" ? moveEvent.clientX : moveEvent.clientY) - start),
      );
      setResize({ kind, index, size });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setResize(null);
      if (size !== initialSize && !readOnly)
        commitSheet((current) =>
          kind === "col"
            ? { ...current, cols: { ...current.cols, [String(index)]: Math.round(size) } }
            : { ...current, rows: { ...current.rows, [String(index)]: Math.round(size) } },
        );
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  // ---------- Tastatur ----------
  function move(dc: number, dr: number, extend: boolean, jump: boolean, tabStart: number | null = null) {
    const from = range.focus;
    let col = from.col + dc;
    let row = from.row + dr;
    if (jump) {
      // Ctrl+Pfeil: bis zum Rand des ausgefüllten Bereichs (wie Excel).
      const filled = (c: number, r: number) => rawAt({ col: c, row: r }) !== "";
      col = from.col;
      row = from.row;
      const startFilled = filled(col, row) && filled(col + dc, row + dr);
      while (col + dc >= 0 && col + dc < sheet.colCount && row + dr >= 0 && row + dr < sheet.rowCount) {
        col += dc;
        row += dr;
        if (startFilled ? !filled(col + dc, row + dr) : filled(col, row)) break;
      }
    }
    // Ausgeblendete Zeilen und Spalten überspringen.
    const rowStep = dr < 0 ? -1 : 1;
    const colStep = dc < 0 ? -1 : 1;
    while (hiddenRowSet.has(row) && row + rowStep >= 0 && row + rowStep < sheet.rowCount) row += rowStep;
    while (hiddenColSet.has(col) && col + colStep >= 0 && col + colStep < sheet.colCount) col += colStep;
    // Über verbundene Zellen hinwegspringen.
    const merge = merges.find((item) => inArea(item, col, row) && !inArea(item, from.col, from.row));
    if (merge && !extend) {
      if (dc > 0) col = merge.c1;
      if (dr > 0) row = merge.r1;
      if (dc < 0) col = merge.c1;
      if (dr < 0) row = merge.r1;
    }
    if (extend) select(range.anchor, { col, row });
    else select({ col, row });
    tabChain.current = tabStart === null ? null : { start: tabStart, at: cellKey(col, row) };
  }

  function onGridKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.target !== gridRef.current) return;
    // Ctrl+Alt+M wie in Word: Kommentar zur aktiven Zelle.
    if ((event.ctrlKey || event.metaKey) && event.altKey && event.code === "KeyM") {
      event.preventDefault();
      startComment();
      return;
    }
    // Eingabe läuft schon, das Eingabefeld hat aber (noch) keinen Fokus: Tasten trotzdem in die Zelle schreiben.
    const pending = editingRef.current;
    if (pending) {
      const mod = event.metaKey || event.ctrlKey;
      if (event.key === "Enter") {
        event.preventDefault();
        commitEdit({ dc: 0, dr: event.shiftKey ? -1 : 1, key: true });
      } else if (event.key === "Tab") {
        event.preventDefault();
        commitEdit({ dc: event.shiftKey ? -1 : 1, dr: 0, key: true });
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelEdit();
      } else if (event.key === "Backspace") {
        event.preventDefault();
        setEditing({ ...pending, value: pending.value.slice(0, -1) });
      } else if (!mod && !event.altKey && event.key.length === 1) {
        event.preventDefault();
        setEditing({ ...pending, value: pending.value + event.key });
      }
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key;
    if (key === "Escape" && painter) {
      event.preventDefault();
      return setPainter(null);
    }
    if (selectedChart && (key === "Delete" || key === "Backspace")) {
      event.preventDefault();
      if (!readOnly) deleteChart(selectedChart);
      return;
    }
    if (mod && (key.toLowerCase() === "f" || key.toLowerCase() === "h")) {
      event.preventDefault();
      return openFind(key.toLowerCase() === "h" && !readOnly);
    }
    if (mod && event.shiftKey && key.toLowerCase() === "l") {
      event.preventDefault();
      return toggleFilter();
    }
    if (mod && (key === ";" || key === ".")) {
      event.preventDefault();
      return startEdit("enter", todayText());
    }
    if (mod && key === ":") {
      event.preventDefault();
      return startEdit("enter", timeText());
    }
    if (event.altKey && key === "ArrowDown") {
      event.preventDefault();
      return openListMenu();
    }
    if (mod && key.toLowerCase() === "z") {
      event.preventDefault();
      return event.shiftKey ? redo() : undo();
    }
    if (mod && key.toLowerCase() === "y") {
      event.preventDefault();
      return redo();
    }
    if (mod && key.toLowerCase() === "a") {
      event.preventDefault();
      return select({ col: 0, row: 0 }, { col: sheet.colCount - 1, row: sheet.rowCount - 1 });
    }
    // Kopieren/Ausschneiden merken sich die Auswahl auch dann, wenn der Browser kein Zwischenablage-Ereignis
    // liefert; Einfügen nimmt dann das zuletzt Kopierte.
    if (mod && (key.toLowerCase() === "c" || key.toLowerCase() === "x")) {
      if (key.toLowerCase() === "x" && readOnly) return;
      copy(key.toLowerCase() === "x");
      return;
    }
    if (mod && key.toLowerCase() === "v") {
      pasteHandled.current = false;
      window.setTimeout(() => {
        if (!pasteHandled.current && clip.current) paste(clip.current.text);
      }, 80);
      return;
    }
    if (mod && ["b", "i", "u"].includes(key.toLowerCase())) {
      event.preventDefault();
      return toggle(key.toLowerCase() as "b" | "i" | "u");
    }
    const arrows: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    if (arrows[key]) {
      event.preventDefault();
      return move(arrows[key][0], arrows[key][1], event.shiftKey, mod);
    }
    if (key === "Enter") {
      event.preventDefault();
      const dr = event.shiftKey ? -1 : 1;
      return move(keyStep(range.focus, 0, dr).dc, dr, false, false);
    }
    if (key === "Tab") {
      event.preventDefault();
      const dc = event.shiftKey ? -1 : 1;
      return move(dc, 0, false, false, keyStep(range.focus, dc, 0).start);
    }
    if (key === "Home") {
      event.preventDefault();
      return mod ? select({ col: 0, row: 0 }) : select({ col: 0, row: range.focus.row });
    }
    if (key === "End" && mod) {
      event.preventDefault();
      const used = usedRange(sheet);
      return select({ col: Math.max(0, used.cols - 1), row: Math.max(0, used.rows - 1) });
    }
    if (key === "PageDown" || key === "PageUp") {
      event.preventDefault();
      return move(0, key === "PageDown" ? 20 : -20, event.shiftKey, false);
    }
    if (key === "Delete" || key === "Backspace") {
      event.preventDefault();
      return clear("content");
    }
    if (key === "F2") {
      event.preventDefault();
      return startEdit("edit");
    }
    if (!mod && !event.altKey && key.length === 1) {
      event.preventDefault();
      startEdit("enter", key);
    }
  }

  function onEditorKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!editing) return;
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === "Enter" && event.altKey) {
      event.preventDefault();
      return insertAtCaret(event.currentTarget, "\n");
    }
    if (event.key === "F4" && editing.value.startsWith("=")) {
      event.preventDefault();
      const target = event.currentTarget;
      const cycled = cycleReference(editing.value, target.selectionStart ?? editing.value.length);
      if (!cycled) return;
      setEditing({ ...editing, value: cycled.text, mode: "edit" });
      setPoint(null);
      requestAnimationFrame(() => target.setSelectionRange(cycled.caret, cycled.caret));
      return;
    }
    if (mod && (event.key === ";" || event.key === ".")) {
      event.preventDefault();
      return insertAtCaret(event.currentTarget, todayText());
    }
    if (mod && event.key === ":") {
      event.preventDefault();
      return insertAtCaret(event.currentTarget, timeText());
    }
    if (suggestions.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setSuggestIndex(
        (index) => (index + (event.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length,
      );
      return;
    }
    if (suggestions.length && event.key === "Tab") {
      event.preventDefault();
      acceptSuggestion(suggestions[Math.min(suggestIndex, suggestions.length - 1)].name);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      commitEdit({ dc: 0, dr: event.shiftKey ? -1 : 1, key: true });
    } else if (event.key === "Tab") {
      event.preventDefault();
      commitEdit({ dc: event.shiftKey ? -1 : 1, dr: 0, key: true });
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit();
    } else if (
      editing.mode === "enter" &&
      event.key.startsWith("Arrow") &&
      !(editing.value.startsWith("=") && OPERATOR_END.test(editing.value))
    ) {
      event.preventDefault();
      const delta: Record<string, [number, number]> = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
      };
      commitEdit({ dc: delta[event.key][0], dr: delta[event.key][1] });
    }
  }

  // Auswahlliste der aktiven Zelle öffnen (Pfeil neben der Zelle oder Alt+Pfeil nach unten).
  function openListMenu(anchor?: DOMRect) {
    const rule = validationAt(sheet, range.focus.col, range.focus.row);
    if (!rule || readOnly) return;
    const rect =
      anchor ??
      gridRef.current?.querySelector<HTMLElement>("td.focus")?.getBoundingClientRect() ??
      new DOMRect(200, 200, 0, 0);
    setListMenu({ x: rect.left, y: rect.bottom + 2, values: rule.values });
  }
  function chooseFromList(value: string) {
    setListMenu(null);
    const pos = range.focus;
    commitSheet((current) => setValue(current, pos, value));
    focusGrid();
  }

  // ---------- Blätter ----------
  // ---------- Blattschutz ----------
  function toggleProtection() {
    if (readOnly || sheet.pivot) return;
    const on = !sheet.protected;
    commitSheet((current) => {
      const next = { ...current };
      if (on) next.protected = true;
      else delete next.protected;
      return next;
    });
    setNotice(on ? "Blatt geschützt – nur freigegebene Zellen bleiben bearbeitbar" : "Blattschutz aufgehoben");
  }
  function toggleUnlocked() {
    const on = !activeStyle.unlocked;
    applyStyle((style) => {
      const next = { ...style };
      if (on) next.unlocked = true;
      else delete next.unlocked;
      return next;
    });
  }

  // ---------- Pivot-Tabelle ----------
  function pivotStart(): SheetPivot {
    if (sheet.pivot) return sheet.pivot;
    const region =
      area.r1 === area.r2 && area.c1 === area.c2 ? currentRegion(sheet, range.focus.col, range.focus.row) : area;
    return {
      source: sheet.id,
      range: areaName(region),
      rows: 0,
      cols: null,
      value: Math.min(1, region.c2 - region.c1),
      fn: "sum",
    };
  }
  function pivotFieldsFor(source: string, rangeText: string) {
    const current = modelRef.current;
    const index = current.sheets.findIndex((item) => item.id === source);
    const region = parseArea(rangeText);
    if (index < 0 || !region || region.r2 <= region.r1) return null;
    const values = evaluateWorkbook(current);
    return pivotFields(current.sheets[index], region, (col, row) => values.value(index, cellKey(col, row)));
  }
  function savePivot(pivot: SheetPivot, editing: boolean) {
    const current = modelRef.current;
    const values = evaluateWorkbook(current).value;
    if (editing) {
      const built = refreshPivotSheet(current, { ...current.sheets[active], pivot }, values);
      if ("error" in built) return setNotice(built.error);
      commit(replaceSheet(current, active, built), true);
      return setNotice("Pivot-Tabelle geändert");
    }
    const names = new Set(current.sheets.map((item) => item.name.toLocaleLowerCase("de-CH")));
    let number = 1;
    while (names.has(`pivot-tabelle ${number}`)) number += 1;
    const built = refreshPivotSheet(current, { ...newSheet(`Pivot-Tabelle ${number}`), pivot }, values);
    if ("error" in built) return setNotice(built.error);
    const at =
      Math.max(
        0,
        current.sheets.findIndex((item) => item.id === pivot.source),
      ) + 1;
    commit({ ...current, sheets: [...current.sheets.slice(0, at), built, ...current.sheets.slice(at)] }, true);
    setActive(at);
    setRange({ anchor: { col: 0, row: 0 }, focus: { col: 0, row: 0 } });
    setNotice("Pivot-Tabelle eingefügt");
  }
  function refreshPivot() {
    const current = modelRef.current;
    const built = refreshPivotSheet(current, current.sheets[active], evaluateWorkbook(current).value);
    if ("error" in built) return setNotice(built.error);
    commit(replaceSheet(current, active, built), true);
    setNotice("Pivot-Tabelle aktualisiert");
  }

  function addSheet() {
    if (readOnly) return;
    const names = new Set(model.sheets.map((item) => item.name.toLocaleLowerCase("de-CH")));
    let index = model.sheets.length + 1;
    while (names.has(`tabelle${index}`)) index += 1;
    commit({ ...modelRef.current, sheets: [...modelRef.current.sheets, newSheet(`Tabelle${index}`)] });
    setActive(model.sheets.length);
    setRange({ anchor: { col: 0, row: 0 }, focus: { col: 0, row: 0 } });
  }
  function finishRename() {
    if (!renaming) return;
    const name = renaming.value
      .replace(/[\\/?*[\]:]/g, "")
      .trim()
      .slice(0, 31);
    const taken = model.sheets.some(
      (item, index) =>
        index !== renaming.index && item.name.toLocaleLowerCase("de-CH") === name.toLocaleLowerCase("de-CH"),
    );
    if (name && !taken && name !== model.sheets[renaming.index].name)
      commit(renameSheet(modelRef.current, renaming.index, name));
    if (taken) setNotice("Diesen Blattnamen gibt es bereits");
    setRenaming(null);
  }
  // ---------- Kommentare ----------
  // Eine Zelle hat höchstens einen Kommentar (mit Antworten), wie in Excel: hat sie schon einen, wird er gezeigt.
  function startComment() {
    if (editing && !commitEdit()) return;
    setShowComments(true);
    const key = cellKey(range.focus.col, range.focus.row);
    if (!readOnly && !sheet.comments?.[key]) setCommentDraft({ sheet: sheet.id, key });
  }
  function updateComment(id: string, thread: CommentThread | null) {
    commitSheet((current) => {
      const comments = { ...current.comments };
      const key = Object.keys(comments).find((item) => comments[item].id === id);
      if (!key) return current;
      if (thread) comments[key] = thread;
      else delete comments[key];
      return { ...current, comments };
    });
  }
  function selectComment(id: string) {
    const key = Object.keys(sheet.comments ?? {}).find((item) => sheet.comments?.[item].id === id);
    const at = key ? parseCellKey(key) : null;
    if (!at) return;
    if (editing && !commitEdit()) return;
    select(at);
    focusGrid();
  }

  function switchSheet(index: number) {
    if (editing && !commitEdit()) return;
    setActive(index);
    setRange({ anchor: { col: 0, row: 0 }, focus: { col: 0, row: 0 } });
    setConfirmDelete(null);
  }
  function moveSheet(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= model.sheets.length) return;
    const sheets = [...modelRef.current.sheets];
    const [moved] = sheets.splice(index, 1);
    sheets.splice(target, 0, moved);
    commit({ ...modelRef.current, sheets });
    setActive(target);
  }
  function deleteSheet(index: number) {
    if (model.sheets.length < 2) return;
    const removed = modelRef.current.sheets[index]?.name;
    const names = modelRef.current.names?.filter((entry) => entry.sheet !== removed);
    commit({
      ...modelRef.current,
      sheets: modelRef.current.sheets.filter((_, position) => position !== index),
      ...(names ? { names } : {}),
    });
    setActive(Math.max(0, Math.min(index, model.sheets.length - 2)));
    setConfirmDelete(null);
  }

  function downloadCsv() {
    const used = usedRange(sheet);
    const rows: string[][] = [];
    for (let row = 0; row < used.rows; row += 1) {
      const line: string[] = [];
      for (let col = 0; col < used.cols; col += 1) line.push(formatValue(valueAt(col, row), styleAt({ col, row })));
      rows.push(line);
    }
    const blob = new Blob([`﻿${toDelimited(rows, ";")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    // Browser verwerfen bei solchen Downloads Namen mit Umlauten: „Bäder“ → „Baeder“.
    const ascii = `${title} - ${sheet.name}`
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/Ä/g, "Ae")
      .replace(/Ö/g, "Oe")
      .replace(/Ü/g, "Ue")
      .replace(/ß/g, "ss")
      .normalize("NFKD")
      .replace(/[^\x20-\x7e]/g, "")
      .replace(/[\\/:*?"<>|]/g, "-");
    link.download = `${ascii.trim() || "Tabelle"}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ---------- Statuszeile ----------
  const stats = (() => {
    if (area.c1 === area.c2 && area.r1 === area.r2) return null;
    let sum = 0;
    let numbers = 0;
    let filled = 0;
    const r2 = Math.min(area.r2, usedRange(sheet).rows);
    const c2 = Math.min(area.c2, usedRange(sheet).cols);
    for (let row = area.r1; row <= r2; row += 1)
      for (let col = area.c1; col <= c2; col += 1) {
        const value = valueAt(col, row);
        if (value === null || value === "") continue;
        filled += 1;
        if (typeof value === "number") {
          sum += value;
          numbers += 1;
        }
      }
    return { sum, numbers, filled };
  })();

  // ---------- Zellen ----------
  const cellStyle = (style: CellStyle | undefined, value: Value, rule?: RuleLook): CSSProperties => ({
    fontWeight: style?.b || rule?.b ? 700 : undefined,
    fontStyle: style?.i ? "italic" : undefined,
    textDecoration:
      [style?.u ? "underline" : "", style?.s ? "line-through" : ""].filter(Boolean).join(" ") || undefined,
    color: isError(value) ? "var(--critical)" : (rule?.color ?? style?.color),
    backgroundColor: rule?.fill ?? style?.fill,
    ...barStyle(rule),
    textAlign:
      style?.align ??
      (typeof value === "number" ? "right" : typeof value === "boolean" || isError(value) ? "center" : "left"),
    verticalAlign: style?.valign === "top" ? "top" : style?.valign === "middle" ? "middle" : "bottom",
    whiteSpace: style?.wrap ? "pre-wrap" : "pre",
    fontSize: style?.size ? `${(style.size * 4) / 3}px` : undefined,
    fontFamily: style?.font ? `"${style.font}", Calibri, Carlito, Arial, sans-serif` : undefined,
    paddingLeft: style?.indent && style.align !== "right" ? 6 + style.indent * 9 : undefined,
    paddingRight: style?.indent && style.align === "right" ? 6 + style.indent * 9 : undefined,
  });

  const fillArea = fillTarget;
  const columns = Array.from({ length: sheet.colCount }, (_, col) => col).filter((col) => !hiddenColSet.has(col));
  const showFillHandle = !readOnly && !editing;
  const visibleBetween = (from: number, to: number, hidden: Set<number>) => {
    let count = 0;
    for (let index = from; index <= to; index += 1) if (!hidden.has(index)) count += 1;
    return Math.max(1, count);
  };
  // Rahmen einer (verbundenen) Zelle: oben/links von der ersten, unten/rechts von der letzten Zeile/Spalte.
  const edgesFor = (col: number, row: number, merge?: Area): Edges | null => {
    const own = edgesAt(sheet, col, row);
    if (!merge) return own;
    const edges = {
      top: own?.top ?? null,
      left: own?.left ?? null,
      bottom: edgesAt(sheet, col, merge.r2)?.bottom ?? null,
      right: edgesAt(sheet, merge.c2, row)?.right ?? null,
    };
    return edges.top || edges.left || edges.bottom || edges.right ? edges : null;
  };
  const focusValidation = !readOnly && !editing ? validationAt(sheet, range.focus.col, range.focus.row) : null;
  const renderRow = (row: number, frozenTop?: number) => {
    const frozen = frozenTop !== undefined;
    const stickyTop: CSSProperties = frozen ? { position: "sticky", top: frozenTop } : {};
    const cells = columns.map((col) => {
      const key = cellKey(col, row);
      if (mergeAt.covered.has(key)) return null;
      const merge = mergeAt.origin.get(key);
      const cell = sheet.cells[key];
      const value = valueAt(col, row);
      const selected = inArea(area, col, row) || (merge ? overlaps(merge, area) : false);
      const focus = range.focus.col === col && range.focus.row === row;
      const isEditing = editing && editing.pos.col === col && editing.pos.row === row && editing.source === "cell";
      const frozenCol = col < freezeCols;
      const bottomRight = (merge ? merge.r2 : row) === area.r2 && (merge ? merge.c2 : col) === area.c2;
      const edges = edgeShadow(edgesFor(col, row, merge));
      const filterHead = filterArea && row === filterArea.r1 && col >= filterArea.c1 && col <= filterArea.c2;
      const filtered = filterHead && (sheet.filter?.hidden[String(col)]?.length ?? 0) > 0;
      const comment = sheet.comments?.[key];
      const classes = [
        selected ? "selected" : "",
        focus ? "focus" : "",
        frozenCol ? "frozen-col" : "",
        col === freezeCols - 1 ? "freeze-edge-col" : "",
        row === freezeRows - 1 ? "freeze-edge-row" : "",
        fillArea && inArea(fillArea, col, row) && !inArea(area, col, row) ? "fill-preview" : "",
        isError(value) ? "error" : "",
        filterHead ? "filter-head" : "",
      ];
      return (
        <td
          key={key}
          colSpan={merge ? visibleBetween(merge.c1, merge.c2, hiddenColSet) : undefined}
          rowSpan={merge ? visibleBetween(merge.r1, merge.r2, hiddenRowSet) : undefined}
          className={classes.filter(Boolean).join(" ")}
          style={{
            ...cellStyle(cell?.s, value, ruleStyle(col, row)),
            ...(edges ? ({ "--cell-border": edges } as CSSProperties) : {}),
            ...(frozen ? { ...stickyTop, zIndex: 3 } : {}),
            ...(frozenCol ? { position: "sticky", left: ROWHEAD_W + colLefts[col], zIndex: frozen ? 4 : 2 } : {}),
          }}
          data-tip={
            isError(value)
              ? ERROR_HINTS[value.error]
              : comment
                ? `${comment.author || "Kommentar"}: ${comment.text}`
                : undefined
          }
          onMouseDown={(event) => onCellMouseDown(event, { col, row })}
          onMouseEnter={() => onCellMouseEnter({ col, row })}
          onDoubleClick={() => startEdit("edit")}
          onContextMenu={(event) => {
            event.preventDefault();
            if (!inArea(area, col, row)) select({ col, row });
            setMenu({ x: event.clientX, y: event.clientY, kind: "cell" });
          }}
        >
          {isEditing ? (
            <textarea
              className="sheet-cell-editor"
              aria-label={`Zelle ${key} bearbeiten`}
              autoFocus
              rows={Math.max(1, editing.value.split("\n").length)}
              value={editing.value}
              spellCheck={false}
              onChange={(event) => {
                setEditing({ ...(editingRef.current ?? editing), value: event.target.value });
                setSuggestIndex(0);
                setPoint(null);
              }}
              onKeyDown={onEditorKeyDown}
              onBlur={(event) => {
                // Wer woanders hinklickt, übernimmt die Eingabe (wie in Excel) – ausser beim Wechsel in die Formelleiste.
                if (event.relatedTarget === barRef.current) return;
                if (editingRef.current?.source === "cell") commitEdit(undefined, { keepFocus: true });
              }}
              onMouseDown={(event) => event.stopPropagation()}
            />
          ) : (
            <span className="sheet-cell-text">{formatValue(value, cell?.s)}</span>
          )}
          {comment && (
            <span
              className={`sheet-comment-flag ${comment.resolved ? "resolved" : ""}`}
              role="img"
              aria-label={`Kommentar: ${comment.text}`}
              onMouseDown={() => setShowComments(true)}
            />
          )}
          {filterHead && (
            <button
              type="button"
              className={`sheet-filter-button ${filtered ? "active" : ""}`}
              aria-label={`Filter ${columnName(col)}`}
              data-tip={filtered ? "Gefiltert – Filter ändern" : "Filtern und sortieren"}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (editing && !commitEdit()) return;
                const rect = event.currentTarget.getBoundingClientRect();
                setFilterMenu({ col, x: rect.left, y: rect.bottom + 4 });
              }}
            >
              {filtered ? <Funnel weight="fill" aria-hidden="true" /> : <CaretDown aria-hidden="true" />}
            </button>
          )}
          {focus && focusValidation && (
            <button
              type="button"
              className="sheet-list-button"
              aria-label="Auswahlliste öffnen"
              data-tip="Wert auswählen"
              data-shortcut="Alt+↓"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openListMenu(event.currentTarget.getBoundingClientRect());
              }}
            >
              <CaretDown aria-hidden="true" />
            </button>
          )}
          {showFillHandle && bottomRight && (
            <span
              className="sheet-fill-handle"
              aria-hidden="true"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                // Doppelklick: bis zum Ende der Daten in der Nachbarspalte ausfüllen.
                if (event.detail >= 2) {
                  drag.current = null;
                  setFillTarget(null);
                  return fillDown();
                }
                beginDrag({ kind: "fill", start: range.focus });
                setFillTarget(area);
              }}
            />
          )}
        </td>
      );
    });
    return (
      <tr key={row} className={frozen ? "sheet-frozen-row" : undefined} style={{ height: rowHeights[row] }}>
        <th
          scope="row"
          className={`sheet-rowhead ${row >= area.r1 && row <= area.r2 ? "selected" : ""} ${row > 0 && hiddenRowSet.has(row - 1) ? "after-hidden" : ""}`}
          style={frozen ? { ...stickyTop, zIndex: 6 } : undefined}
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            if (editing && !commitEdit()) return;
            focusGrid();
            if (event.shiftKey) select({ col: 0, row: range.anchor.row }, { col: sheet.colCount - 1, row });
            else select({ col: 0, row }, { col: sheet.colCount - 1, row });
            beginDrag({ kind: "rows", start: { col: 0, row } });
          }}
          onMouseEnter={() => onCellMouseEnter({ col: 0, row })}
          onContextMenu={(event) => {
            event.preventDefault();
            if (!(row >= area.r1 && row <= area.r2)) select({ col: 0, row }, { col: sheet.colCount - 1, row });
            setMenu({ x: event.clientX, y: event.clientY, kind: "cell" });
          }}
        >
          {row + 1}
          {!readOnly && (
            <span
              className="sheet-row-resize"
              onMouseDown={(event) => startResize(event, "row", row)}
              aria-hidden="true"
            />
          )}
        </th>
        {cells}
      </tr>
    );
  };

  const frozenRowsRendered = Array.from({ length: freezeRows }, (_, row) => row).filter(
    (row) => !hiddenRowSet.has(row),
  );
  const bodyRows: number[] = [];
  for (let row = first; row <= last; row += 1) if (!hiddenRowSet.has(row)) bodyRows.push(row);
  const totalWidth = ROWHEAD_W + colLefts[sheet.colCount];
  // Überlauf: zur aktiven Zelle gehörender Bereich (Rahmen) und – in leeren Zellen darin – die Formel des Ursprungs
  // (grau, wie in Excel).
  const focusKey = cellKey(range.focus.col, range.focus.row);
  const spillAnchor = evaluator.spillAnchor(active, focusKey);
  const spillArea = spillAnchor ? (evaluator.spills(active).get(spillAnchor)?.area ?? null) : null;
  const ghostFormula =
    !editing && spillAnchor && spillAnchor !== focusKey && !rawAt(range.focus)
      ? (sheet.cells[spillAnchor]?.v ?? "")
      : "";
  const focusRaw = editing ? editing.value : ghostFormula || rawAt(range.focus);
  // Wie Excel: deckt die Auswahl genau einen benannten Bereich ab, steht dessen Name im Feld.
  const namedSelection = (model.names ?? []).find(
    (entry) => entry.sheet === sheet.name && entry.range === areaName(area),
  );
  const refLabel =
    namedSelection?.name ??
    (sameArea(area, {
      c1: range.focus.col,
      r1: range.focus.row,
      c2: range.focus.col,
      r2: range.focus.row,
    })
      ? cellKey(range.focus.col, range.focus.row)
      : areaName(area));
  const fmtLabel = NUMBER_FORMATS.find((item) => item.value === (activeStyle.fmt ?? "general"))?.label ?? "Standard";

  const focusComment = sheet.comments?.[cellKey(range.focus.col, range.focus.row)];
  const sheetComments = Object.entries(sheet.comments ?? {});
  const openComments = sheetComments.filter(([, thread]) => !thread.resolved).length;
  const cellMenu: (MenuItem | "separator")[] = [
    { label: "Ausschneiden", hint: "Ctrl+X", disabled: readOnly, onSelect: () => copy(true) },
    { label: "Kopieren", hint: "Ctrl+C", onSelect: () => copy(false) },
    {
      label: "Einfügen",
      hint: "Ctrl+V",
      disabled: readOnly,
      onSelect: () => {
        if (clip.current) return paste(clip.current.text);
        navigator.clipboard
          ?.readText()
          .then(paste)
          .catch(() => setNotice("Einfügen bitte mit Ctrl+V"));
      },
    },
    { label: "Nur Werte einfügen", disabled: readOnly || !hasClip, onSelect: () => pasteSpecial("values") },
    { label: "Nur Formate einfügen", disabled: readOnly || !hasClip, onSelect: () => pasteSpecial("formats") },
    "separator",
    focusComment
      ? { label: "Kommentar anzeigen", onSelect: startComment }
      : { label: "Neuer Kommentar", hint: "Ctrl+Alt+M", disabled: readOnly, onSelect: startComment },
    "separator",
    { label: "Zeilen oberhalb einfügen", disabled: readOnly, onSelect: () => insert("row", true) },
    { label: "Zeilen unterhalb einfügen", disabled: readOnly, onSelect: () => insert("row", false) },
    { label: "Spalten links einfügen", disabled: readOnly, onSelect: () => insert("col", true) },
    { label: "Spalten rechts einfügen", disabled: readOnly, onSelect: () => insert("col", false) },
    "separator",
    {
      label: area.r1 === area.r2 ? "Zeile löschen" : "Zeilen löschen",
      danger: true,
      disabled: readOnly,
      onSelect: () => remove("row"),
    },
    {
      label: area.c1 === area.c2 ? "Spalte löschen" : "Spalten löschen",
      danger: true,
      disabled: readOnly,
      onSelect: () => remove("col"),
    },
    { label: "Inhalte löschen", hint: "Entf", disabled: readOnly, onSelect: () => clear("content") },
    { label: "Formate löschen", disabled: readOnly, onSelect: () => clear("formats") },
    "separator",
    { label: "Zeilen ausblenden", disabled: readOnly, onSelect: () => hide("row", true) },
    { label: "Zeilen einblenden", disabled: readOnly || !sheet.hiddenRows.length, onSelect: () => hide("row", false) },
    { label: "Spalten ausblenden", disabled: readOnly, onSelect: () => hide("col", true) },
    { label: "Spalten einblenden", disabled: readOnly || !sheet.hiddenCols.length, onSelect: () => hide("col", false) },
    "separator",
    { label: "Aufsteigend sortieren (A–Z)", disabled: readOnly, onSelect: () => sort(1) },
    { label: "Absteigend sortieren (Z–A)", disabled: readOnly, onSelect: () => sort(-1) },
    { label: "Auswahlliste …", disabled: readOnly, onSelect: () => setDialog({ kind: "validation" }) },
  ];

  return (
    <div className="office-sheet">
      {!readOnly && (
        <SheetRibbon
          canUndo={history.undo.length > 0}
          canRedo={history.redo.length > 0}
          undo={undo}
          redo={redo}
          painter={painter !== null}
          startPainter={startPainter}
          activeStyle={activeStyle}
          applyStyle={applyStyle}
          toggle={toggle}
          setBorder={setBorder}
          borderWeight={borderWeight}
          setBorderWeight={setBorderWeight}
          borderColor={borderColor}
          setBorderColor={setBorderColor}
          changeIndent={changeIndent}
          merged={merges.some((merge) => overlaps(merge, area))}
          toggleMerge={toggleMerge}
          fmtLabel={fmtLabel}
          setFormat={setFormat}
          changeDecimals={changeDecimals}
          sheet={sheet}
          sort={sort}
          toggleFilter={toggleFilter}
          setDialog={setDialog}
          addChart={addChart}
          autoSum={autoSum}
          insert={insert}
          remove={remove}
          hide={hide}
          commitSheet={commitSheet}
          autoFit={autoFit}
          range={range}
          area={area}
          freezeRows={freezeRows}
          freezeCols={freezeCols}
          setFreeze={setFreeze}
          clear={clear}
          openFind={openFind}
          focusComment={focusComment}
          startComment={startComment}
          showComments={showComments}
          setShowComments={setShowComments}
          downloadCsv={downloadCsv}
          protectedSheet={Boolean(sheet.protected)}
          pivotSheet={Boolean(sheet.pivot)}
          toggleProtection={toggleProtection}
          toggleUnlocked={toggleUnlocked}
          openPivot={() => setDialog({ kind: "pivot", editing: false })}
          editPivot={() => setDialog({ kind: "pivot", editing: true })}
          refreshPivot={refreshPivot}
        />
      )}
      <div className="sheet-formula-bar">
        <span className="sheet-ref" aria-label="Ausgewählte Zelle">
          {refLabel}
        </span>
        <FunctionIcon className="sheet-fx" aria-hidden="true" />
        <div className="sheet-formula-field">
          <textarea
            ref={barRef}
            rows={1}
            aria-label="Inhalt der Zelle"
            className={ghostFormula ? "ghost" : undefined}
            data-tip={ghostFormula ? `Ergebnis der Formel in ${spillAnchor}` : undefined}
            value={focusRaw}
            readOnly={readOnly}
            spellCheck={false}
            onFocus={() => {
              if (!editing && !readOnly) startEdit("edit", undefined, "bar");
            }}
            onChange={(event) => {
              if (!editing) startEdit("edit", event.target.value, "bar");
              else setEditing({ ...(editingRef.current ?? editing), value: event.target.value });
              setSuggestIndex(0);
              setPoint(null);
            }}
            onKeyDown={onEditorKeyDown}
            onBlur={(event) => {
              if ((event.relatedTarget as HTMLElement | null)?.classList.contains("sheet-cell-editor")) return;
              if (editingRef.current?.source === "bar") commitEdit(undefined, { keepFocus: true });
            }}
          />
          {editing && (suggestions.length > 0 || signature) && (
            <div className="sheet-suggest" role="listbox" aria-label="Funktionen">
              {suggestions.length
                ? suggestions.map((item, index) => (
                    <button
                      key={item.name}
                      type="button"
                      role="option"
                      aria-selected={index === suggestIndex}
                      className={index === suggestIndex ? "active" : ""}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        acceptSuggestion(item.name);
                      }}
                    >
                      <strong>
                        {item.name}
                        {item.english && <small className="sheet-suggest-alias">auch {item.english}</small>}
                      </strong>
                      <span>{item.text}</span>
                    </button>
                  ))
                : signature && (
                    <p>
                      <strong>{signature.syntax}</strong>
                      <span>{signature.text}</span>
                      {signature.example && <em className="sheet-suggest-example">Beispiel: {signature.example}</em>}
                    </p>
                  )}
            </div>
          )}
        </div>
      </div>
      {find && (
        <FindBar
          replace={find.replace && !readOnly}
          count={find.hits.length}
          current={find.index}
          onSearch={runSearch}
          onNext={nextHit}
          onReplace={(replacement) => replaceHits(replacement, false)}
          onReplaceAll={(replacement) => replaceHits(replacement, true)}
          onToggleReplace={() => setFind({ ...find, replace: !find.replace })}
          onClose={() => {
            setFind(null);
            focusGrid();
          }}
        />
      )}
      {formulaError && (
        <p className="office-inline-error" role="alert">
          {formulaError}
        </p>
      )}
      <div className="office-main">
        <div
          ref={gridRef}
          className={`sheet-grid ${pointMode ? "point-mode" : ""}`}
          tabIndex={0}
          role="grid"
          aria-label={`Blatt ${sheet.name}`}
          aria-rowcount={sheet.rowCount}
          aria-colcount={sheet.colCount}
          onKeyDown={onGridKeyDown}
          onCopy={(event) => {
            if (editing) return;
            event.preventDefault();
            copy(false, event.clipboardData);
          }}
          onCut={(event) => {
            if (editing || readOnly) return;
            event.preventDefault();
            copy(true, event.clipboardData);
          }}
          onPaste={(event) => {
            if (editing || readOnly) return;
            event.preventDefault();
            pasteHandled.current = true;
            // Leere Zwischenablage (z. B. ohne Zugriffsrecht): zuletzt in der Tabelle Kopiertes verwenden.
            paste(event.clipboardData.getData("text/plain") || clip.current?.text || "");
          }}
        >
          <div className="sheet-zoom" style={{ zoom: scale, width: totalWidth }}>
            <table
              className={`sheet-table ${sheet.showGrid ? "" : "no-grid"} ${painter ? "painting" : ""}`}
              style={{ width: totalWidth }}
            >
              <colgroup>
                <col style={{ width: ROWHEAD_W }} />
                {columns.map((col) => (
                  <col key={col} style={{ width: colWidths[col] }} />
                ))}
              </colgroup>
              <thead>
                <tr style={{ height: HEADER_H }}>
                  <th
                    className="sheet-corner"
                    aria-label="Alles auswählen"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      select({ col: 0, row: 0 }, { col: sheet.colCount - 1, row: sheet.rowCount - 1 });
                      focusGrid();
                    }}
                  />
                  {columns.map((col) => (
                    <th
                      key={col}
                      scope="col"
                      className={`sheet-colhead ${col >= area.c1 && col <= area.c2 ? "selected" : ""} ${col > 0 && hiddenColSet.has(col - 1) ? "after-hidden" : ""}`}
                      style={col < freezeCols ? { left: ROWHEAD_W + colLefts[col], zIndex: 8 } : undefined}
                      onMouseDown={(event) => {
                        if (event.button !== 0) return;
                        event.preventDefault();
                        if (editing && !commitEdit()) return;
                        focusGrid();
                        if (event.shiftKey) select({ col: range.anchor.col, row: 0 }, { col, row: sheet.rowCount - 1 });
                        else select({ col, row: 0 }, { col, row: sheet.rowCount - 1 });
                        drag.current = { kind: "cols", start: { col, row: 0 } };
                      }}
                      onMouseEnter={() => onCellMouseEnter({ col, row: 0 })}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        if (!(col >= area.c1 && col <= area.c2))
                          select({ col, row: 0 }, { col, row: sheet.rowCount - 1 });
                        setMenu({ x: event.clientX, y: event.clientY, kind: "cell" });
                      }}
                    >
                      {columnName(col)}
                      {!readOnly && (
                        <span
                          className="sheet-col-resize"
                          aria-hidden="true"
                          onMouseDown={(event) => startResize(event, "col", col)}
                          onDoubleClick={() => autoFit(col)}
                        />
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {frozenRowsRendered.map((row) => (
                  <RowSlot key={row} render={renderRow} row={row} frozenTop={HEADER_H + rowTops[row]} />
                ))}
                {first > freezeRows && (
                  <tr aria-hidden="true" style={{ height: rowTops[first] - rowTops[freezeRows] }}>
                    <td colSpan={columns.length + 1} className="sheet-spacer" />
                  </tr>
                )}
                {bodyRows.map((row) => (
                  <RowSlot key={row} render={renderRow} row={row} />
                ))}
                {last < sheet.rowCount - 1 && (
                  <tr aria-hidden="true" style={{ height: rowTops[sheet.rowCount] - rowTops[last + 1] }}>
                    <td colSpan={columns.length + 1} className="sheet-spacer" />
                  </tr>
                )}
              </tbody>
            </table>
            {spillArea && (
              <div
                className="sheet-spill"
                aria-hidden="true"
                style={{
                  left: ROWHEAD_W + colLefts[spillArea.c1],
                  top: HEADER_H + rowTops[spillArea.r1],
                  width: colLefts[spillArea.c2 + 1] - colLefts[spillArea.c1],
                  height: rowTops[spillArea.r2 + 1] - rowTops[spillArea.r1],
                }}
              />
            )}
            {[...othersAt].map(([key, person]) => {
              const at = parseCellKey(key);
              if (!at || at.col >= sheet.colCount || at.row >= sheet.rowCount) return null;
              const color = collaboratorColor(person.session);
              return (
                <div
                  key={person.session}
                  className={`sheet-remote ${at.row === 0 ? "first-row" : ""}`}
                  style={{
                    left: ROWHEAD_W + colLefts[at.col],
                    top: HEADER_H + rowTops[at.row],
                    width: colLefts[at.col + 1] - colLefts[at.col],
                    height: rowTops[at.row + 1] - rowTops[at.row],
                    borderColor: color,
                  }}
                  role="img"
                  aria-label={`${person.name} ist in Zelle ${key}`}
                >
                  <span style={{ background: color }}>{person.name}</span>
                </div>
              );
            })}
            {sheet.charts.map((chart) => {
              const box = chartDrag?.id === chart.id ? { ...chart, ...chartDrag } : chart;
              const chartArea = parseArea(chart.range);
              const selectedNow = selectedChart === chart.id;
              return (
                <div
                  key={chart.id}
                  className={`sheet-chart ${selectedNow ? "selected" : ""}`}
                  style={{ left: ROWHEAD_W + box.x, top: HEADER_H + box.y, width: box.w, height: box.h }}
                  role="figure"
                  aria-label={chart.title ? `Diagramm ${chart.title}` : "Diagramm"}
                  onMouseDown={(event) => startChartDrag(event, chart, "move")}
                  onClick={() => setSelectedChart(chart.id)}
                  onDoubleClick={() => !readOnly && setDialog({ kind: "chart", chart })}
                >
                  {chartArea && (
                    <ChartSvg
                      data={chartData(chartArea, valueAt, textAt)}
                      type={chart.type}
                      title={chart.title}
                      width={box.w}
                      height={box.h}
                      xTitle={chart.xTitle}
                      yTitle={chart.yTitle}
                      labels={chart.labels}
                    />
                  )}
                  {selectedNow && !readOnly && (
                    <>
                      <div
                        // Ganz oben im Blatt läge die Leiste unter den Spaltenköpfen: dann unter dem Diagramm.
                        className={`sheet-chart-tools ${box.y < 40 ? "below" : ""}`}
                        onMouseDown={(event) => event.stopPropagation()}
                      >
                        <button type="button" onClick={() => setDialog({ kind: "chart", chart })}>
                          Bearbeiten
                        </button>
                        <button type="button" className="danger" onClick={() => deleteChart(chart.id)}>
                          Löschen
                        </button>
                      </div>
                      <span
                        className="sheet-chart-resize"
                        aria-hidden="true"
                        onMouseDown={(event) => startChartDrag(event, chart, "resize")}
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {!readOnly && (
            <div className="sheet-more" style={{ width: totalWidth }}>
              <button
                type="button"
                disabled={sheet.rowCount >= 10_000}
                onClick={() =>
                  commitSheet((current) => ({ ...current, rowCount: Math.min(10_000, current.rowCount + 100) }))
                }
              >
                <Plus aria-hidden="true" /> 100 weitere Zeilen
              </button>
              <button
                type="button"
                disabled={sheet.colCount >= 200}
                onClick={() =>
                  commitSheet((current) => ({ ...current, colCount: Math.min(200, current.colCount + 10) }))
                }
              >
                <Columns aria-hidden="true" /> 10 weitere Spalten
              </button>
            </div>
          )}
        </div>
        {showComments && (
          <CommentsPanel
            threads={sheetComments
              .map(([key, thread]) => ({ key, thread, at: parseCellKey(key) }))
              .sort((a, b) => (a.at?.row ?? 0) - (b.at?.row ?? 0) || (a.at?.col ?? 0) - (b.at?.col ?? 0))
              .map(({ key, thread }) => ({ thread, label: `Zelle ${key}` }))}
            user={user}
            readOnly={readOnly}
            draft={commentDraft?.sheet === sheet.id ? `Zelle ${commentDraft.key}` : null}
            active={focusComment?.id ?? null}
            onCreate={(text) => {
              const target = commentDraft;
              if (!target) return;
              commitSheet((current) => ({
                ...current,
                comments: { ...current.comments, [target.key]: newComment(user, text) },
              }));
              setCommentDraft(null);
            }}
            onCancelDraft={() => {
              setCommentDraft(null);
              focusGrid();
            }}
            onChange={(thread) => updateComment(thread.id, thread)}
            onDelete={(id) => updateComment(id, null)}
            onSelect={selectComment}
            onClose={() => {
              setShowComments(false);
              setCommentDraft(null);
            }}
          />
        )}
      </div>
      <footer className="sheet-footer">
        <div className="sheet-tabs" role="tablist" aria-label="Blätter">
          {model.sheets.map((item, index) =>
            renaming?.index === index ? (
              <input
                key={item.id}
                className="sheet-tab-rename"
                aria-label="Blattname"
                autoFocus
                maxLength={31}
                value={renaming.value}
                onChange={(event) => setRenaming({ index, value: event.target.value })}
                onBlur={finishRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") finishRename();
                  if (event.key === "Escape") setRenaming(null);
                }}
              />
            ) : (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={index === active}
                className={index === active ? "active" : ""}
                onClick={() => switchSheet(index)}
                onDoubleClick={() => !readOnly && setRenaming({ index, value: item.name })}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (readOnly) return;
                  switchSheet(index);
                  setMenu({ x: event.clientX, y: event.clientY, kind: "tab", sheet: index });
                }}
              >
                {item.protected && <Lock className="sheet-tab-lock" aria-hidden="true" />}
                {item.name}
              </button>
            ),
          )}
          {!readOnly && (
            <button
              type="button"
              className="sheet-tab-add"
              aria-label="Blatt hinzufügen"
              data-tip="Blatt hinzufügen"
              onClick={addSheet}
            >
              <Plus aria-hidden="true" />
            </button>
          )}
        </div>
        {confirmDelete !== null && (
          <span className="sheet-confirm" role="alert">
            Blatt „{model.sheets[confirmDelete]?.name}“ löschen?
            <button type="button" className="danger" onClick={() => deleteSheet(confirmDelete)}>
              Löschen
            </button>
            <button type="button" onClick={() => setConfirmDelete(null)}>
              Abbrechen
            </button>
          </span>
        )}
        <span className="sheet-stats" aria-live="polite">
          {sheet.filter && filterArea && (
            <span>
              {[...hiddenRowSet].filter((row) => row > filterArea.r1 && row <= filterArea.r2).length > 0
                ? `Gefiltert: ${filterArea.r2 - filterArea.r1 - [...hiddenRowSet].filter((row) => row > filterArea.r1 && row <= filterArea.r2).length} von ${filterArea.r2 - filterArea.r1} Zeilen`
                : "Filter aktiv"}
            </span>
          )}
          {stats && stats.filled > 0 && (
            <>
              {stats.numbers > 0 && (
                <>
                  <span>Summe: {formatValue(stats.sum, activeStyle)}</span>
                  <span>
                    Mittelwert:{" "}
                    {formatValue(stats.sum / stats.numbers, { ...activeStyle, dec: activeStyle.fmt ? undefined : 2 })}
                  </span>
                </>
              )}
              <span>Anzahl: {stats.filled}</span>
            </>
          )}
          {openComments > 0 && (
            <button type="button" className="office-status-link" onClick={() => setShowComments((value) => !value)}>
              {openComments} {openComments === 1 ? "offener Kommentar" : "offene Kommentare"}
            </button>
          )}
        </span>
        <span className="office-zoom" role="group" aria-label="Zoom">
          {ZOOMS.map((value) => (
            <button
              key={value}
              type="button"
              className={zoom === value ? "active" : ""}
              aria-pressed={zoom === value}
              onClick={() => setZoom(value)}
            >
              {value}%
            </button>
          ))}
        </span>
      </footer>
      {menu &&
        createPortal(
          <div
            className="office-context"
            style={{
              top: Math.max(8, Math.min(menu.y, window.innerHeight - 420)),
              left: Math.min(menu.x, window.innerWidth - 260),
              // Lange Menüs passen nicht immer ins Fenster: dann im Menü blättern.
              maxHeight: window.innerHeight - Math.max(8, Math.min(menu.y, window.innerHeight - 420)) - 8,
              overflowY: "auto",
            }}
            onMouseLeave={() => setMenu(null)}
          >
            <MenuList
              close={() => setMenu(null)}
              items={
                menu.kind === "cell"
                  ? cellMenu
                  : [
                      {
                        label: "Umbenennen",
                        onSelect: () => setRenaming({ index: menu.sheet!, value: model.sheets[menu.sheet!].name }),
                      },
                      {
                        label: "Duplizieren",
                        onSelect: () => {
                          const base = model.sheets[menu.sheet!].name.slice(0, 24);
                          let name = `${base} (2)`;
                          for (
                            let index = 3;
                            model.sheets.some(
                              (item) => item.name.toLocaleLowerCase("de-CH") === name.toLocaleLowerCase("de-CH"),
                            );
                            index += 1
                          )
                            name = `${base} (${index})`;
                          commit(duplicateSheet(modelRef.current, menu.sheet!, name));
                          setActive(menu.sheet! + 1);
                        },
                      },
                      {
                        label: "Nach links verschieben",
                        disabled: menu.sheet === 0,
                        onSelect: () => moveSheet(menu.sheet!, -1),
                      },
                      {
                        label: "Nach rechts verschieben",
                        disabled: menu.sheet === model.sheets.length - 1,
                        onSelect: () => moveSheet(menu.sheet!, 1),
                      },
                      "separator",
                      {
                        label: "Löschen",
                        danger: true,
                        disabled: model.sheets.length < 2,
                        onSelect: () => setConfirmDelete(menu.sheet!),
                      },
                    ]
              }
            />
          </div>,
          document.body,
        )}
      {menu && <div className="office-context-backdrop" onMouseDown={() => setMenu(null)} />}
      {listMenu &&
        createPortal(
          <div
            className="office-context sheet-list-menu"
            style={{
              top: Math.min(listMenu.y, window.innerHeight - 320),
              left: Math.min(listMenu.x, window.innerWidth - 260),
            }}
          >
            <MenuList
              close={() => setListMenu(null)}
              items={listMenu.values.map((value) => ({
                label: value,
                active: rawAt(range.focus) === value,
                onSelect: () => chooseFromList(value),
              }))}
            />
          </div>,
          document.body,
        )}
      {listMenu && <div className="office-context-backdrop" onMouseDown={() => setListMenu(null)} />}
      {filterMenu && filterArea && (
        <FilterMenu
          key={filterMenu.col}
          anchor={filterMenu}
          values={distinctValues(sheet, filterMenu.col, textAt)}
          hidden={sheet.filter?.hidden[String(filterMenu.col)] ?? []}
          onClose={() => setFilterMenu(null)}
          onSort={(direction) => {
            setFilterMenu(null);
            sortFilterColumn(filterMenu.col, direction);
          }}
          onApply={(hidden) => {
            setFilterMenu(null);
            commitSheet((current) => {
              if (!current.filter) return current;
              const next = { ...current.filter.hidden };
              if (hidden.length) next[String(filterMenu.col)] = hidden;
              else delete next[String(filterMenu.col)];
              return { ...current, filter: { ...current.filter, hidden: next } };
            });
          }}
        />
      )}
      {dialog?.kind === "rules" && (
        <RulesDialog
          rules={sheet.rules}
          selection={area}
          onClose={() => setDialog(null)}
          onSave={(rules) => commitSheet((current) => ({ ...current, rules }))}
        />
      )}
      {dialog?.kind === "validation" && (
        <ValidationDialog
          selection={area}
          current={validationAt(sheet, range.focus.col, range.focus.row)}
          onClose={() => setDialog(null)}
          onSave={(rangeText, values) =>
            commitSheet((current) => {
              const target = parseArea(rangeText)!;
              // Überschneidende Listen ersetzen.
              const rest = current.validations.filter((item) => {
                const other = parseArea(item.range);
                return !other || !overlaps(other, target);
              });
              return { ...current, validations: [...rest, { range: rangeText, values }] };
            })
          }
          onRemove={(rangeText) =>
            commitSheet((current) => ({
              ...current,
              validations: current.validations.filter((item) => item.range !== rangeText),
            }))
          }
        />
      )}
      {dialog?.kind === "pivot" && (
        <PivotDialog
          sheets={model.sheets.filter((item) => !item.pivot).map((item) => ({ id: item.id, name: item.name }))}
          initial={pivotStart()}
          editing={dialog.editing}
          fieldsFor={pivotFieldsFor}
          onClose={() => setDialog(null)}
          onSave={(pivot) => savePivot(pivot, dialog.editing)}
        />
      )}
      {dialog?.kind === "names" && (
        <NamesDialog
          names={model.names ?? []}
          sheets={model.sheets.map((item) => item.name)}
          sheet={sheet.name}
          selection={area}
          onClose={() => setDialog(null)}
          onSave={(names) => commit({ ...modelRef.current, names })}
        />
      )}
      {dialog?.kind === "page" && (
        <PageDialog
          print={sheet.print}
          selection={area}
          onClose={() => setDialog(null)}
          onSave={(print) => commitSheet((current) => ({ ...current, print }))}
        />
      )}
      {dialog?.kind === "chart" && (
        <ChartDialog
          chart={dialog.chart}
          selection={area}
          onClose={() => setDialog(null)}
          onSave={(values) => saveChart(dialog.chart, values)}
        />
      )}
      {notice && (
        <div className="office-toast" role="status">
          {notice}
        </div>
      )}
      {printing && (
        <SheetPrint
          sheet={sheet}
          hiddenRows={hiddenRowSet}
          valueOf={(col, row) => valueAt(col, row)}
          textOf={textAt}
          ruleStyle={ruleStyle}
        />
      )}
    </div>
  );
}

// Zeile als eigener Baustein: die Maus- und Tastaturhandler darin greifen erst bei Ereignissen auf den Zustand zu.
function RowSlot({
  render,
  row,
  frozenTop,
}: {
  render: (row: number, frozenTop?: number) => React.ReactNode;
  row: number;
  frozenTop?: number;
}) {
  return render(row, frozenTop);
}
