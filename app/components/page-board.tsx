"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CareOptionSelect } from "./care-form-controls";

// Einrichtbare Seite: Bausteine in Zeilen, je Person verschiebbar, in der Breite wählbar, untereinander stapelbar und
// ausblendbar. Ohne eigene Anordnung entsteht genau das Standardbild der Seite (gleiche Spaltenverhältnisse wie zuvor).

export type BoardSize = "third" | "half" | "twoThirds" | "full";
export const BOARD_SIZES: Array<{ id: BoardSize; label: string; fraction: number }> = [
  { id: "third", label: "⅓", fraction: 1 / 3 },
  { id: "half", label: "½", fraction: 1 / 2 },
  { id: "twoThirds", label: "⅔", fraction: 2 / 3 },
  { id: "full", label: "Voll", fraction: 1 },
];

const sizeOptions = [
  { value: "", label: "Standard" },
  ...BOARD_SIZES.map((size) => ({ value: size.id, label: size.label })),
];

export type BoardWidget = {
  id: string;
  label: string;
  // Anteil an der Zeilenbreite im Standardbild (z. B. 1.15 / 2 für eine Spalte im Verhältnis 1,15 : 0,85).
  fraction: number;
  // Standardmässig unter dem vorherigen Baustein (in derselben Spalte).
  stacked?: boolean;
  content: ReactNode;
};

type Layout = { order: string[]; hidden: string[]; sizes: Record<string, BoardSize>; stacked?: string[] };

const storageKey = (page: string) => `carecore.page-layout.${page}`;
const empty = (): Layout => ({ order: [], hidden: [], sizes: {} });

function readStored(page: string): Layout {
  if (typeof window === "undefined") return empty();
  try {
    const saved = window.localStorage.getItem(storageKey(page));
    return saved ? sanitize(JSON.parse(saved)) : empty();
  } catch {
    return empty();
  }
}

function sanitize(input: unknown): Layout {
  if (!input || typeof input !== "object") return empty();
  const value = input as Partial<Layout>;
  const ids = (list: unknown) => (Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : []);
  const sizes: Record<string, BoardSize> = {};
  for (const [id, size] of Object.entries(value.sizes ?? {}))
    if (BOARD_SIZES.some((entry) => entry.id === size)) sizes[id] = size as BoardSize;
  return {
    order: ids(value.order),
    hidden: ids(value.hidden),
    sizes,
    ...(Array.isArray(value.stacked) ? { stacked: ids(value.stacked) } : {}),
  };
}

export function usePageBoard(page: string) {
  const [layout, setLayout] = useState<Layout>(() => readStored(page));
  const [editing, setEditing] = useState(false);
  const [dragged, setDragged] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/me/page-layout?page=${page}`, { credentials: "same-origin" })
      .then((response) => (response.ok ? (response.json() as Promise<{ layout: unknown }>) : null))
      .then((payload) => {
        if (active && payload?.layout) setLayout(sanitize(payload.layout));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [page]);

  function persist(next: Layout) {
    setLayout(next);
    try {
      window.localStorage.setItem(storageKey(page), JSON.stringify(next));
    } catch {
      // Ohne Browser-Speicher bleibt die Anordnung in der Datenbank.
    }
    void fetch(`/api/me/page-layout?page=${page}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    }).catch(() => undefined);
  }

  function reset() {
    setLayout(empty());
    try {
      window.localStorage.removeItem(storageKey(page));
    } catch {
      // Ohne Browser-Speicher genügt das Löschen in der Datenbank.
    }
    void fetch(`/api/me/page-layout?page=${page}`, { method: "DELETE", credentials: "same-origin" }).catch(
      () => undefined,
    );
  }

  return { page, layout, editing, setEditing, dragged, setDragged, persist, reset };
}

export type PageBoardState = ReturnType<typeof usePageBoard>;

// Vollständige Reihenfolge: gespeicherte Bausteine zuerst, neue an ihrem Standardplatz.
function orderOf(widgets: BoardWidget[], layout: Layout) {
  const known = new Set(widgets.map((widget) => widget.id));
  const result = layout.order.filter((id) => known.has(id));
  widgets.forEach((widget, index) => {
    if (!result.includes(widget.id)) result.splice(Math.min(index, result.length), 0, widget.id);
  });
  return result;
}

const stackedSet = (widgets: BoardWidget[], layout: Layout) =>
  new Set(layout.stacked ?? widgets.filter((widget) => widget.stacked).map((widget) => widget.id));

export function PageBoard({ board, widgets }: { board: PageBoardState; widgets: BoardWidget[] }) {
  const { layout, editing, persist, dragged, setDragged } = board;
  const byId = new Map(widgets.map((widget) => [widget.id, widget]));
  const order = orderOf(widgets, layout);
  const stacked = stackedSet(widgets, layout);
  const visible = order.filter((id) => !layout.hidden.includes(id) && byId.get(id)!.content !== null);
  const fraction = (id: string) =>
    BOARD_SIZES.find((size) => size.id === layout.sizes[id])?.fraction ?? byId.get(id)!.fraction;

  // Spalten (gestapelte Bausteine teilen die Spalte des vorherigen), dann Zeilen bis zur vollen Breite.
  const columns: Array<{ fraction: number; ids: string[] }> = [];
  for (const id of visible) {
    const last = columns.at(-1);
    if (last && stacked.has(id)) last.ids.push(id);
    else columns.push({ fraction: fraction(id), ids: [id] });
  }
  const rows: Array<typeof columns> = [];
  let width = Infinity;
  for (const column of columns) {
    if (width + column.fraction > 1.0001) {
      rows.push([]);
      width = 0;
    }
    rows.at(-1)!.push(column);
    width += column.fraction;
  }

  const move = (id: string, step: -1 | 1) => {
    const position = visible.indexOf(id);
    const neighbour = visible[position + step];
    if (!neighbour) return;
    const next = [...order];
    const a = next.indexOf(id);
    const b = next.indexOf(neighbour);
    [next[a], next[b]] = [next[b], next[a]];
    persist({ ...layout, order: next });
  };
  const drop = (target: string) => {
    if (!dragged || dragged === target) return;
    const next = order.filter((id) => id !== dragged);
    next.splice(next.indexOf(target), 0, dragged);
    persist({ ...layout, order: next });
  };
  const setSize = (id: string, size: BoardSize | "") => {
    const sizes = { ...layout.sizes };
    if (size) sizes[id] = size;
    else delete sizes[id];
    persist({ ...layout, sizes });
  };
  const toggleStack = (id: string) => {
    const next = new Set(stacked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    persist({ ...layout, stacked: [...next] });
  };

  return (
    <div className={`page-board ${editing ? "is-editing" : ""}`}>
      {rows.map((row) => {
        const used = row.reduce((sum, column) => sum + column.fraction, 0);
        return (
          <div className="page-board-row" key={row[0].ids[0]}>
            {row.map((column) => (
              <div className="page-board-column" key={column.ids[0]} style={{ flexGrow: column.fraction }}>
                {column.ids.map((id) => {
                  const widget = byId.get(id)!;
                  const position = visible.indexOf(id);
                  return (
                    <div
                      className={`page-board-widget ${dragged === id ? "is-dragging" : ""}`}
                      data-widget={id}
                      key={id}
                      draggable={editing}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        setDragged(id);
                      }}
                      onDragEnd={() => setDragged(null)}
                      onDragOver={(event) => editing && event.preventDefault()}
                      onDrop={() => drop(id)}
                    >
                      {editing && (
                        <div className="page-board-handle">
                          <span className="page-board-title" aria-hidden="true" title={widget.label}>
                            ⠿ <span>{widget.label}</span>
                          </span>
                          <span className="page-board-tools" role="group" aria-label={`${widget.label} anpassen`}>
                            <button
                              type="button"
                              disabled={position === 0}
                              onClick={() => move(id, -1)}
                              aria-label={`${widget.label} nach vorne`}
                              title="Nach vorne"
                            >
                              ←
                            </button>
                            <button
                              type="button"
                              disabled={position === visible.length - 1}
                              onClick={() => move(id, 1)}
                              aria-label={`${widget.label} nach hinten`}
                              title="Nach hinten"
                            >
                              →
                            </button>
                            <CareOptionSelect
                              className="widget-size-select"
                              label={`Breite von ${widget.label}`}
                              value={layout.sizes[id] ?? ""}
                              options={sizeOptions}
                              onChange={(value) => setSize(id, value as BoardSize | "")}
                            />
                            <button
                              type="button"
                              disabled={position === 0}
                              aria-pressed={stacked.has(id)}
                              onClick={() => toggleStack(id)}
                              aria-label={`${widget.label} unter den vorherigen stellen`}
                              title={stacked.has(id) ? "Wieder eigene Spalte" : "Unter den vorherigen stellen"}
                            >
                              ⤓
                            </button>
                            <button
                              type="button"
                              onClick={() => persist({ ...layout, hidden: [...layout.hidden, id] })}
                              aria-label={`${widget.label} ausblenden`}
                              title="Ausblenden"
                            >
                              ×
                            </button>
                          </span>
                        </div>
                      )}
                      {widget.content}
                    </div>
                  );
                })}
              </div>
            ))}
            {/* Nicht volle Zeilen behalten ihre Breiten; der Rest bleibt frei. */}
            {used < 0.9999 && <div className="page-board-spacer" style={{ flexGrow: 1 - used }} aria-hidden="true" />}
          </div>
        );
      })}
    </div>
  );
}

// Liste aller Bausteine zum Ein- und Ausblenden, nur im Bearbeiten-Modus.
export function PageBoardCustomizer({ board, widgets }: { board: PageBoardState; widgets: BoardWidget[] }) {
  const { layout, persist, reset } = board;
  const toggle = (id: string) =>
    persist({
      ...layout,
      hidden: layout.hidden.includes(id) ? layout.hidden.filter((entry) => entry !== id) : [...layout.hidden, id],
    });
  return (
    <section className="dashboard-customizer page-board-customizer" aria-label="Ansicht anpassen">
      <div>
        <p className="eyebrow">Bausteine</p>
        <h2>Ansicht anpassen</h2>
        <p>
          Bausteine ziehen oder mit ← → verschieben, die Breite wählen, mit ⤓ unter den vorherigen stellen und hier ein-
          oder ausblenden.
        </p>
      </div>
      <div className="dashboard-customizer-list">
        {widgets.map((widget) => (
          <button
            className={!layout.hidden.includes(widget.id) ? "active" : ""}
            type="button"
            key={widget.id}
            onClick={() => toggle(widget.id)}
          >
            <span>{!layout.hidden.includes(widget.id) ? "✓" : "+"}</span>
            <div>
              <strong>{widget.label}</strong>
            </div>
          </button>
        ))}
      </div>
      <button className="quiet-button" type="button" onClick={reset}>
        Standard wiederherstellen
      </button>
    </section>
  );
}
