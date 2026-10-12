"use client";

import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ArrowsLeftRight, Heart, Sparkle, Star, Timer, Warning } from "@phosphor-icons/react";
import { formatHours, formatSignedMinutes, localTime } from "@/lib/roster/time";
import { WEEKDAY_SHORT } from "@/lib/roster/types";
import type { GridDay, GridEmployee, GridShift, SchedulePayload } from "@/lib/roster/view-types";

const cellId = (employeeId: string, date: string) => `${employeeId}|${date}`;

// Deutsch für Screenreader beim Ziehen mit Tastatur oder Maus.
const announcements = (shiftLabel: (id: string) => string, cellLabel: (id: string) => string): Announcements => ({
  onDragStart: ({ active }) => `${shiftLabel(String(active.id))} aufgenommen.`,
  onDragOver: ({ active, over }) =>
    over
      ? `${shiftLabel(String(active.id))} über ${cellLabel(String(over.id))}.`
      : `${shiftLabel(String(active.id))} ausserhalb des Rasters.`,
  onDragEnd: ({ active, over }) =>
    over ? `${shiftLabel(String(active.id))} abgelegt bei ${cellLabel(String(over.id))}.` : "Verschieben abgebrochen.",
  onDragCancel: () => "Verschieben abgebrochen.",
});

export function shiftTooltip(shift: GridShift, data: SchedulePayload) {
  if (shift.masked) return "Abwesend";
  const tz = data.timezone;
  const parts = [
    `${shift.name} (${shift.code})`,
    `${localTime(shift.plannedStart, tz)}–${localTime(shift.plannedEnd, tz)}`,
    shift.category === "ABSENCE" ? "" : `${formatHours(shift.netMinutes)} netto, Pause ${shift.breakMinutes} Min`,
    shift.entry?.clockOut
      ? `Ist ${localTime(shift.entry.clockIn, tz)}–${localTime(shift.entry.clockOut, tz)}, Differenz ${formatSignedMinutes(shift.entry.differenceMinutes ?? 0)}`
      : shift.entry
        ? `Eingestempelt ${localTime(shift.entry.clockIn, tz)}`
        : "",
    shift.swapped ? `↔ Getauscht (${shift.swapped.with})` : "",
    shift.source === "AI" ? "Von der KI vorgeschlagen" : "",
    ...shift.violations.map((v) => `⚠ ${v.message}`),
  ];
  return parts.filter(Boolean).join("\n");
}

function ShiftChip({
  shift,
  data,
  draggable,
  onOpen,
  onSelect,
  overlay,
}: {
  shift: GridShift;
  data: SchedulePayload;
  draggable: boolean;
  onOpen?: () => void;
  onSelect?: () => void;
  overlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: shift.id,
    disabled: !draggable || overlay,
  });
  const warn = shift.violations.some((v) => v.severity !== "INFO");
  const deviation = shift.entry?.differenceMinutes ?? null;
  const bigDeviation = deviation !== null && Math.abs(deviation) >= data.ruleSet.deviationThresholdMinutes;
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`roster-chip ${shift.category.toLowerCase()} ${isDragging && !overlay ? "dragging" : ""} ${warn ? "has-warning" : ""}`}
      style={{ "--chip-color": shift.color } as React.CSSProperties}
      title={shiftTooltip(shift, data)}
      aria-label={`${shift.masked ? "Abwesend" : `${shift.name} ${localTime(shift.plannedStart, data.timezone)} bis ${localTime(shift.plannedEnd, data.timezone)}`}${warn ? ", mit Warnung" : ""}`}
      // PEP-Arbeitsweise: Klick markiert die Zelle, Doppelklick (oder Enter) öffnet den Dienst.
      onClick={onSelect ?? onOpen}
      onDoubleClick={onSelect ? onOpen : undefined}
      {...(draggable ? listeners : {})}
      {...(draggable ? attributes : {})}
    >
      <strong>{shift.code}</strong>
      {!shift.masked && shift.category !== "ABSENCE" && (
        <small>
          {localTime(shift.plannedStart, data.timezone).replace(/:00$/, "")}–
          {localTime(shift.plannedEnd, data.timezone).replace(/:00$/, "")}
        </small>
      )}
      <span className="roster-chip-badges" aria-hidden="true">
        {shift.swapped && <ArrowsLeftRight />}
        {shift.source === "AI" && <Sparkle />}
        {warn && <Warning />}
        {bigDeviation && <Timer />}
      </span>
    </button>
  );
}

// Stabile Aktionen für alle Zellen (ändern sich nie), damit memoisierte Zellen nur bei eigenen
// Änderungen neu rendern – wichtig für grosse Raster (40 Personen × 31 Tage).
type CellActions = {
  focus: (row: number, col: number) => void;
  create: (employeeId: string, date: string) => void;
  open: (shift: GridShift) => void;
  select: (row: number, col: number) => void;
  pointerDown: (row: number, col: number, event: PointerEvent<HTMLDivElement>) => void;
  keyDown: (row: number, col: number, event: KeyboardEvent<HTMLDivElement>) => void;
};
const NO_SHIFTS: GridShift[] = [];

const Cell = memo(function Cell({
  row,
  col,
  employee,
  day,
  shifts,
  data,
  canEdit,
  draggable,
  selectable,
  focused,
  selected,
  previewed,
  highlight,
  actions,
  children,
}: {
  row: number;
  col: number;
  employee: GridEmployee;
  day: GridDay;
  shifts: GridShift[];
  data: SchedulePayload;
  canEdit: boolean;
  draggable: boolean;
  selectable: boolean;
  focused: boolean;
  selected: boolean;
  previewed: boolean;
  highlight: boolean;
  actions: CellActions;
  children?: ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: cellId(employee.id, day.date), disabled: !canEdit });
  const timeOff = employee.timeOff.find(
    (t) => t.startDate <= day.date && t.endDate >= day.date && (t.status === "OPEN" || t.status === "APPROVED"),
  );
  return (
    <td
      className={`roster-cell ${day.weekend ? "weekend" : ""} ${day.holiday ? "holiday" : ""} ${day.today ? "today" : ""} ${highlight ? "highlight" : ""} ${selected ? "selected" : ""} ${previewed ? "previewed" : ""}`}
    >
      <div
        ref={setNodeRef}
        className={`roster-cell-inner ${isOver ? "drop-over" : ""}`}
        role="gridcell"
        aria-selected={selected}
        tabIndex={focused ? 0 : -1}
        data-cell={cellId(employee.id, day.date)}
        aria-label={`${employee.name}, ${WEEKDAY_SHORT[day.weekday - 1]} ${day.date.slice(8)}.${day.date.slice(5, 7)}.${shifts.length ? "" : ", frei"}${timeOff ? `, Wunschfrei ${timeOff.status === "APPROVED" ? "genehmigt" : "beantragt"}` : ""}`}
        onFocus={() => actions.focus(row, col)}
        onKeyDown={(event) => actions.keyDown(row, col, event)}
        onPointerDown={(event) => actions.pointerDown(row, col, event)}
        onDoubleClick={(event) =>
          canEdit &&
          !shifts.length &&
          !(event.target as HTMLElement).closest("input") &&
          actions.create(employee.id, day.date)
        }
      >
        {shifts.map((shift) => (
          <ShiftChip
            key={shift.id}
            shift={shift}
            data={data}
            draggable={draggable && !shift.masked && !shift.entry}
            onOpen={() => actions.open(shift)}
            onSelect={selectable ? () => actions.select(row, col) : undefined}
          />
        ))}
        {timeOff && (
          <span
            className={`roster-timeoff ${timeOff.status === "APPROVED" ? "approved" : "open"}`}
            title={timeOff.status === "APPROVED" ? "Wunschfrei genehmigt" : "Wunschfrei beantragt"}
          >
            WF{timeOff.status === "OPEN" ? "?" : ""}
          </span>
        )}
        {canEdit && !shifts.length && (
          <button
            className="roster-cell-add"
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => actions.create(employee.id, day.date)}
          >
            +
          </button>
        )}
        {children}
      </div>
    </td>
  );
});

export type CellValue = { employeeId: string; date: string; shiftTypeId: string | null };
// Stempel der Dienst-Palette: Diensttyp-ID, "clear" (leeren) oder null (aus).
export type PaintTool = string | "clear" | null;

export type GridProps = {
  data: SchedulePayload;
  days: GridDay[];
  employees: GridEmployee[];
  shifts: GridShift[];
  highlightShiftIds: Set<string> | null;
  onCreate: (employeeId: string, date: string) => void;
  onOpen: (shift: GridShift) => void;
  onDrop: (shift: GridShift, employeeId: string, date: string) => void;
  // PEP-Arbeitsweise (nur Leitung): Zellen setzen/leeren, Stempel und Hinweise.
  onApplyCells?: (cells: CellValue[], label: string) => void;
  paintTool?: PaintTool;
  onNotice?: (message: string) => void;
};

type Pos = { row: number; col: number };

// Der DnD-Kontext liegt aussen und rendert bei Fokus- und Auswahländerungen nicht neu; sonst würden
// alle Zellen (Droppables) über den Kontext mitrendern.
export function RosterGrid(props: GridProps) {
  const { data, employees, shifts, onDrop } = props;
  const [active, setActive] = useState<GridShift | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Long press on touch devices so horizontal scrolling keeps working.
    useSensor(TouchSensor, { activationConstraint: { delay: 280, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const latest = useRef({ shifts, onDrop });
  useLayoutEffect(() => {
    latest.current = { shifts, onDrop };
  });
  const handlers = useMemo(() => {
    const find = (id: unknown) => latest.current.shifts.find((s) => s.id === id);
    return {
      dragStart: (event: DragStartEvent) => setActive(find(event.active.id) ?? null),
      dragEnd: (event: DragEndEvent) => {
        setActive(null);
        const shift = find(event.active.id);
        if (!shift || !event.over) return;
        const [employeeId, date] = String(event.over.id).split("|");
        if (employeeId === shift.employeeId && date === shift.date) return;
        latest.current.onDrop(shift, employeeId, date);
      },
      dragCancel: () => setActive(null),
    };
  }, []);
  // Ansagen für Screenreader; ändern sich nur mit Diensten und Personen, nicht mit Fokus/Auswahl.
  const accessibility = useMemo(() => {
    const names = new Map(employees.map((e) => [e.id, e.name]));
    const shiftLabel = (id: string) => {
      const shift = shifts.find((s) => s.id === id);
      return shift
        ? `${shift.name} von ${names.get(shift.employeeId) ?? ""} am ${shift.date.slice(8)}.${shift.date.slice(5, 7)}.`
        : "Dienst";
    };
    const cellLabel = (id: string) => {
      const [employeeId, date] = id.split("|");
      return `${names.get(employeeId) ?? ""}, ${date?.slice(8)}.${date?.slice(5, 7)}.`;
    };
    return {
      announcements: announcements(shiftLabel, cellLabel),
      screenReaderInstructions: {
        draggable:
          "Leertaste drücken, um den Dienst aufzunehmen. Mit den Pfeiltasten verschieben, Leertaste zum Ablegen, Escape zum Abbrechen.",
      },
    };
  }, [shifts, employees]);
  return (
    <DndContext
      sensors={sensors}
      onDragStart={handlers.dragStart}
      onDragEnd={handlers.dragEnd}
      onDragCancel={handlers.dragCancel}
      accessibility={accessibility}
    >
      <GridTable {...props} />
      <DragOverlay dropAnimation={null}>
        {active ? <ShiftChip shift={active} data={data} draggable={false} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

const GridTable = memo(function GridTable({
  data,
  days,
  employees,
  shifts,
  highlightShiftIds,
  onCreate,
  onOpen,
  onApplyCells,
  paintTool = null,
  onNotice,
}: GridProps) {
  const [focus, setFocus] = useState<Pos>({ row: 0, col: 0 });
  const [anchor, setAnchor] = useState<Pos>({ row: 0, col: 0 });
  const [editing, setEditing] = useState<string | null>(null);
  const [preview, setPreview] = useState<Set<string>>(new Set());
  const clipboard = useRef<Array<Array<string | null>> | null>(null);
  const gesture = useRef<{ kind: "select" | "paint"; cells: Map<string, CellValue> } | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const pep = !!onApplyCells && data.canEdit;
  const painting = pep && paintTool !== null;
  const byCell = useMemo(() => {
    const map = new Map<string, GridShift[]>();
    for (const shift of shifts) {
      const key = cellId(shift.employeeId, shift.date);
      map.set(key, [...(map.get(key) ?? []), shift]);
    }
    return map;
  }, [shifts]);
  const typeByCode = useMemo(
    () => new Map(data.shiftTypes.filter((t) => t.active).map((t) => [t.code.toUpperCase(), t])),
    [data.shiftTypes],
  );
  const rowOf = useMemo(() => new Map(employees.map((e, i) => [e.id, i])), [employees]);
  const colOf = useMemo(() => new Map(days.map((d, i) => [d.date, i])), [days]);
  // Markierter Bereich (Rechteck zwischen Anker und Fokus).
  const range = {
    r0: Math.min(anchor.row, focus.row),
    r1: Math.max(anchor.row, focus.row),
    c0: Math.min(anchor.col, focus.col),
    c1: Math.max(anchor.col, focus.col),
  };
  const inRange = (row: number, col: number) =>
    row >= range.r0 && row <= range.r1 && col >= range.c0 && col <= range.c1;
  const rangeCells = (shiftTypeId: string | null): CellValue[] => {
    const cells: CellValue[] = [];
    for (let row = range.r0; row <= range.r1; row += 1)
      for (let col = range.c0; col <= range.c1; col += 1)
        if (employees[row] && days[col])
          cells.push({ employeeId: employees[row].id, date: days[col].date, shiftTypeId });
    return cells;
  };
  const typeAt = (row: number, col: number) => {
    const cell = employees[row] && days[col] ? byCell.get(cellId(employees[row].id, days[col].date)) : undefined;
    const shift = cell?.find((s) => !s.masked);
    return shift?.shiftTypeId ?? null;
  };

  const focusCell = (next: Pos) =>
    requestAnimationFrame(() => {
      const employee = employees[next.row];
      const day = days[next.col];
      if (employee && day)
        tableRef.current?.querySelector<HTMLElement>(`[data-cell="${cellId(employee.id, day.date)}"]`)?.focus();
    });
  const moveFocus = (row: number, col: number, extend = false) => {
    const next = {
      row: Math.max(0, Math.min(employees.length - 1, row)),
      col: Math.max(0, Math.min(days.length - 1, col)),
    };
    setFocus(next);
    if (!extend) setAnchor(next);
    focusCell(next);
  };
  const apply = (cells: CellValue[], label: string) => {
    if (!onApplyCells || !cells.length) return;
    onApplyCells(cells, label);
  };

  // Kürzel übernehmen: gilt für den markierten Bereich (oder die Zelle), danach eine Zeile tiefer.
  const commitCode = (text: string, move: [number, number]) => {
    const code = text.trim().toUpperCase();
    const type = code ? typeByCode.get(code) : null;
    if (code && !type) {
      onNotice?.(`Unbekanntes Kürzel „${code}“. Verfügbar: ${[...typeByCode.keys()].join(", ")}`);
      return;
    }
    setEditing(null);
    const cells = rangeCells(type?.id ?? null);
    apply(cells, type ? `${type.code} gesetzt` : "Zellen geleert");
    moveFocus(
      range.r1 === range.r0 ? focus.row + move[0] : range.r0,
      range.c1 === range.c0 ? focus.col + move[1] : range.c0,
    );
  };

  const copy = () => {
    const rows: Array<Array<string | null>> = [];
    for (let row = range.r0; row <= range.r1; row += 1) {
      const line: Array<string | null> = [];
      for (let col = range.c0; col <= range.c1; col += 1) line.push(typeAt(row, col));
      rows.push(line);
    }
    clipboard.current = rows;
    const code = (id: string | null) => (id ? (data.shiftTypes.find((t) => t.id === id)?.code ?? "") : "");
    void navigator.clipboard
      ?.writeText(rows.map((line) => line.map(code).join("\t")).join("\n"))
      .catch(() => undefined);
    onNotice?.(`${rows.length * (rows[0]?.length ?? 0)} Zellen kopiert`);
  };
  const pasteRows = (rows: Array<Array<string | null>>) => {
    const cells: CellValue[] = [];
    rows.forEach((line, dr) =>
      line.forEach((shiftTypeId, dc) => {
        const employee = employees[range.r0 + dr];
        const day = days[range.c0 + dc];
        if (employee && day) cells.push({ employeeId: employee.id, date: day.date, shiftTypeId });
      }),
    );
    apply(cells, "Eingefügt");
  };
  const pasteText = (text: string) => {
    const rows = text
      .replace(/\r/g, "")
      .split("\n")
      .filter((line, index, all) => line.length || index < all.length - 1)
      .map((line) => line.split("\t").map((code) => code.trim().toUpperCase()));
    const unknown = [...new Set(rows.flat().filter((code) => code && !typeByCode.has(code)))];
    if (unknown.length) {
      onNotice?.(`Unbekannte Kürzel: ${unknown.join(", ")}`);
      return;
    }
    pasteRows(rows.map((line) => line.map((code) => (code ? typeByCode.get(code)!.id : null))));
  };

  const keyHandler =
    (row: number, col: number, employee: GridEmployee, day: GridDay) => (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      const moves: Record<string, [number, number]> = {
        ArrowRight: [0, 1],
        ArrowLeft: [0, -1],
        ArrowDown: [1, 0],
        ArrowUp: [-1, 0],
      };
      const mod = event.ctrlKey || event.metaKey;
      if (moves[event.key]) {
        event.preventDefault();
        moveFocus(row + moves[event.key][0], col + moves[event.key][1], pep && event.shiftKey);
      } else if (event.key === "Home") moveFocus(row, 0, pep && event.shiftKey);
      else if (event.key === "End") moveFocus(row, days.length - 1, pep && event.shiftKey);
      else if (pep && mod && event.key.toLowerCase() === "c") {
        event.preventDefault();
        copy();
      } else if (pep && mod && event.key.toLowerCase() === "v" && clipboard.current) {
        event.preventDefault();
        pasteRows(clipboard.current);
      } else if (pep && mod && event.key.toLowerCase() === "x") {
        event.preventDefault();
        copy();
        apply(rangeCells(null), "Ausgeschnitten");
      } else if (pep && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        apply(rangeCells(null), "Zellen geleert");
      } else if (pep && event.key === "F2") {
        event.preventDefault();
        const current = typeAt(row, col);
        setEditing(current ? (data.shiftTypes.find((t) => t.id === current)?.code ?? "") : "");
      } else if (pep && !mod && !event.altKey && event.key.length === 1 && /[\p{L}\p{N}]/u.test(event.key)) {
        event.preventDefault();
        setEditing(event.key.toUpperCase());
      } else if (event.key === "Escape") {
        moveFocus(row, col);
      } else if (
        event.key === "Enter" ||
        event.key === " " ||
        event.key === "ContextMenu" ||
        (event.shiftKey && event.key === "F10")
      ) {
        event.preventDefault();
        const cell = byCell.get(cellId(employee.id, day.date));
        if (cell?.[0]) onOpen(cell[0]);
        else if (data.canEdit) onCreate(employee.id, day.date);
      }
    };

  // Maus/Touch: Klick markiert, Shift+Klick erweitert, Ziehen markiert einen Bereich; mit Stempel
  // werden alle überstrichenen Zellen gesetzt.
  const cellFromPoint = (x: number, y: number) => {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-cell]");
    const [employeeId, date] = element?.dataset.cell?.split("|") ?? [];
    const row = rowOf.get(employeeId);
    const col = colOf.get(date);
    return row === undefined || col === undefined ? null : { row, col, employeeId, date };
  };
  const pointerDown = (row: number, col: number) => (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("input, .roster-cell-add")) return;
    if (painting) {
      event.preventDefault();
      const employee = employees[row];
      const day = days[col];
      const cells = new Map([
        [cellId(employee.id, day.date), { employeeId: employee.id, date: day.date, shiftTypeId: null }],
      ]);
      gesture.current = { kind: "paint", cells };
      setPreview(new Set(cells.keys()));
      return;
    }
    const onChip = !!(event.target as HTMLElement).closest(".roster-chip");
    if (pep && event.shiftKey) {
      event.preventDefault();
      setFocus({ row, col });
      focusCell({ row, col });
      return;
    }
    setFocus({ row, col });
    setAnchor({ row, col });
    if (pep && !onChip && event.pointerType === "mouse") gesture.current = { kind: "select", cells: new Map() };
  };
  const gestureMove = (event: globalThis.PointerEvent) => {
    const current = gesture.current;
    if (!current) return;
    const hit = cellFromPoint(event.clientX, event.clientY);
    if (!hit) return;
    if (current.kind === "select")
      setFocus((prev) => (prev.row === hit.row && prev.col === hit.col ? prev : { row: hit.row, col: hit.col }));
    else if (!current.cells.has(cellId(hit.employeeId, hit.date))) {
      current.cells.set(cellId(hit.employeeId, hit.date), {
        employeeId: hit.employeeId,
        date: hit.date,
        shiftTypeId: null,
      });
      setPreview(new Set(current.cells.keys()));
    }
  };
  const gestureEnd = () => {
    const current = gesture.current;
    gesture.current = null;
    if (current?.kind !== "paint") return;
    setPreview(new Set());
    const shiftTypeId = paintTool === "clear" ? null : paintTool;
    const type = data.shiftTypes.find((t) => t.id === shiftTypeId);
    apply(
      [...current.cells.values()].map((cell) => ({ ...cell, shiftTypeId })),
      type ? `${type.code} gestempelt` : "Zellen geleert",
    );
  };

  // Die aktuellen Handler liegen in einem Ref; Zellen und Fenster-Listener bekommen stabile Funktionen.
  const latest = useRef({ keyHandler, pointerDown, moveFocus, onCreate, onOpen, gestureMove, gestureEnd });
  useLayoutEffect(() => {
    latest.current = { keyHandler, pointerDown, moveFocus, onCreate, onOpen, gestureMove, gestureEnd };
  });
  const actions = useMemo<CellActions>(
    () => ({
      focus: (row, col) => setFocus((prev) => (prev.row === row && prev.col === col ? prev : { row, col })),
      create: (employeeId, date) => latest.current.onCreate(employeeId, date),
      open: (shift) => latest.current.onOpen(shift),
      select: (row, col) => latest.current.moveFocus(row, col),
      pointerDown: (row, col, event) => latest.current.pointerDown(row, col)(event),
      keyDown: (row, col, event) => {
        const employee = employees[row];
        const day = days[col];
        if (employee && day) latest.current.keyHandler(row, col, employee, day)(event);
      },
    }),
    [employees, days],
  );
  useEffect(() => {
    const move = (event: globalThis.PointerEvent) => latest.current.gestureMove(event);
    const up = () => latest.current.gestureEnd();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  const staffingTypes = data.shiftTypes.filter((type) => data.staffing.some((cell) => cell.shiftTypeId === type.id));

  return (
    <>
      <div className="roster-grid-scroll">
        <table
          className={`roster-grid${painting ? " painting" : ""}${pep ? " pep" : ""}`}
          ref={tableRef}
          role="grid"
          aria-multiselectable={pep}
          aria-label={`Dienstplan ${data.unit.name}`}
          onPaste={(event) => {
            if (!pep || editing !== null) return;
            const text = event.clipboardData.getData("text/plain");
            if (!text) return;
            event.preventDefault();
            pasteText(text);
          }}
        >
          <thead>
            <tr>
              <th className="roster-name-head" scope="col">
                Mitarbeitende
              </th>
              {days.map((day) => (
                <th
                  key={day.date}
                  scope="col"
                  className={`${day.weekend ? "weekend" : ""} ${day.holiday ? "holiday" : ""} ${day.today ? "today" : ""}`}
                  title={day.holiday ?? undefined}
                >
                  <span>{WEEKDAY_SHORT[day.weekday - 1]}</span>
                  <strong>{Number(day.date.slice(8))}</strong>
                  {day.holiday && <Star aria-label={day.holiday} weight="fill" />}
                </th>
              ))}
              {data.lead && (
                <th scope="col" className="roster-total-head" title="Geplante Stunden im Monat gegenüber dem Soll">
                  <span>Plan</span>
                  <strong>Soll</strong>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {employees.map((employee, row) => (
              <tr key={employee.id} className={employee.isSelf ? "self" : ""}>
                <th scope="row" className="roster-name">
                  <strong>{employee.name}</strong>
                  <small>
                    {employee.pensumPercent} %
                    {employee.targetMinutes !== null && employee.plannedMinutes !== null && (
                      <>
                        {" "}
                        · Soll {formatHours(employee.targetMinutes).replace(" h", "")} · geplant{" "}
                        <span
                          className={
                            Math.abs(employee.plannedMinutes - employee.targetMinutes) >= 60 ? "roster-off-target" : ""
                          }
                        >
                          {formatHours(employee.plannedMinutes)}
                        </span>
                      </>
                    )}
                  </small>
                  <span className="roster-name-tags">
                    {employee.otherUnits.length > 0 && (
                      <em title={`Auch in: ${employee.otherUnits.join(", ")}`}>Springer</em>
                    )}
                    {employee.preferences.length > 0 && (
                      <em title={`Dienstwünsche: ${employee.preferences.join(" · ")}`}>
                        <Heart aria-hidden="true" /> {employee.preferences.length}
                      </em>
                    )}
                    {employee.qualifications.slice(0, 1).map((q) => (
                      <em key={q} title={employee.qualifications.join(", ")}>
                        {q.replace("Pflegefachperson", "PF").replace("Fachperson Gesundheit", "FaGe")}
                      </em>
                    ))}
                  </span>
                </th>
                {days.map((day, col) => (
                  <Cell
                    key={day.date}
                    row={row}
                    col={col}
                    employee={employee}
                    day={day}
                    data={data}
                    shifts={byCell.get(cellId(employee.id, day.date)) ?? NO_SHIFTS}
                    canEdit={data.canEdit}
                    draggable={data.canEdit && !painting}
                    selectable={pep}
                    focused={focus.row === row && focus.col === col}
                    selected={pep && inRange(row, col) && (range.r0 !== range.r1 || range.c0 !== range.c1)}
                    previewed={preview.has(cellId(employee.id, day.date))}
                    highlight={
                      !!highlightShiftIds &&
                      (byCell.get(cellId(employee.id, day.date)) ?? NO_SHIFTS).some((s) => highlightShiftIds.has(s.id))
                    }
                    actions={actions}
                  >
                    {editing !== null && focus.row === row && focus.col === col && (
                      <input
                        className="roster-code-input"
                        autoFocus
                        value={editing}
                        maxLength={8}
                        aria-label={`Kürzel für ${employee.name}, ${day.date.slice(8)}.${day.date.slice(5, 7)}. (Enter übernimmt, Escape bricht ab)`}
                        list="roster-codes"
                        onChange={(event) => setEditing(event.target.value.toUpperCase())}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === "Tab") {
                            event.preventDefault();
                            commitCode(editing, event.key === "Tab" ? [0, event.shiftKey ? -1 : 1] : [1, 0]);
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            setEditing(null);
                            focusCell(focus);
                          }
                        }}
                        onBlur={() => setEditing(null)}
                      />
                    )}
                  </Cell>
                ))}
                {data.lead && (
                  <td className="roster-total">
                    {employee.plannedMinutes !== null && employee.targetMinutes !== null && (
                      <>
                        <span
                          className={
                            Math.abs(employee.plannedMinutes - employee.targetMinutes) >= 60 ? "roster-off-target" : ""
                          }
                        >
                          {formatHours(employee.plannedMinutes).replace(" h", "")}
                        </span>
                        <small>{formatHours(employee.targetMinutes).replace(" h", "")}</small>
                        <em>{formatHours(employee.plannedMinutes - employee.targetMinutes, true).replace(" h", "")}</em>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {staffingTypes.length > 0 && (
            <tfoot>
              {staffingTypes.map((type) => (
                <tr key={type.id}>
                  <th scope="row" className="roster-name roster-staffing-name">
                    <strong>
                      <span className="roster-type-dot" style={{ background: type.color }} /> {type.code} · Besetzung
                    </strong>
                  </th>
                  {days.map((day) => {
                    const cell = data.staffing.find((s) => s.date === day.date && s.shiftTypeId === type.id);
                    const low = cell && cell.min !== null && cell.count < cell.min;
                    const lowQualified =
                      cell &&
                      cell.minQualified !== null &&
                      cell.qualified !== null &&
                      cell.qualified < cell.minQualified;
                    const high = cell && cell.max !== null && cell.count > cell.max;
                    return (
                      <td
                        key={day.date}
                        className={`roster-staffing ${low || lowQualified ? "low" : high ? "high" : cell?.min !== null && cell ? "ok" : ""}`}
                        title={
                          cell
                            ? `${type.name}: ${cell.count}${cell.min !== null ? ` von mind. ${cell.min}` : ""}${cell.max !== null ? `, max. ${cell.max}` : ""}${lowQualified ? " – Fachperson fehlt" : ""}`
                            : undefined
                        }
                      >
                        {cell ? `${cell.count}${cell.min !== null ? `/${cell.min}` : ""}` : ""}
                      </td>
                    );
                  })}
                  {data.lead && <td className="roster-total" />}
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>
      {pep && (
        <datalist id="roster-codes">
          {data.shiftTypes
            .filter((t) => t.active)
            .map((t) => (
              <option key={t.id} value={t.code}>
                {t.name}
              </option>
            ))}
        </datalist>
      )}
    </>
  );
});
