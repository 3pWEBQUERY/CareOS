import { Extension, Mark, mergeAttributes, type Editor } from "@tiptap/core";
import { isHistoryTransaction } from "@tiptap/pm/history";
import type { Mark as PmMark, Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import { collaboratorColor } from "@/lib/office/presence";
import { REMOTE_META, syncSelection } from "./text-commands";

// Änderungen nachverfolgen wie in Word: Eingefügtes wird unterstrichen, Gelöschtes bleibt durchgestrichen stehen,
// bis jemand die Änderung annimmt oder ablehnt. Jede Änderung trägt Name und Zeitpunkt.

export type ChangeKind = "insertion" | "deletion";
export type TrackedChange = { kind: ChangeKind; from: number; to: number; author: string; date: string };
// Vom Editor gesetzt: ob nachverfolgt wird und unter welchem Namen.
export type TrackState = { on: boolean; author: string; toggle?: () => void };

// Annehmen und Ablehnen sind selbst keine nachverfolgten Änderungen.
export const TRACK_META = "carecoreTrackChange";

const changeDate = (value: unknown) => {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("de-CH", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
};

function changeMark(name: ChangeKind, tag: "ins" | "del", label: string) {
  return Mark.create({
    name,
    inclusive: false,
    addAttributes() {
      return {
        author: {
          default: "",
          parseHTML: (element: HTMLElement) => element.getAttribute("data-author") ?? "",
          renderHTML: () => ({}),
        },
        date: {
          default: "",
          parseHTML: (element: HTMLElement) => element.getAttribute("data-date") ?? "",
          renderHTML: () => ({}),
        },
      };
    },
    parseHTML: () => [{ tag }],
    renderHTML: ({ HTMLAttributes, mark }) => {
      const author = String(mark.attrs.author ?? "");
      const when = changeDate(mark.attrs.date);
      return [
        tag,
        mergeAttributes(HTMLAttributes, {
          class: `office-${tag}`,
          "data-author": author,
          "data-date": String(mark.attrs.date ?? ""),
          "data-tip": [`${label}: ${author || "Unbekannt"}`, when].filter(Boolean).join(", "),
          style: `--change-color: ${collaboratorColor(author)}`,
        }),
        0,
      ];
    },
  });
}

export const Insertion = changeMark("insertion", "ins", "Eingefügt");
export const Deletion = changeMark("deletion", "del", "Gelöscht");

const hasInline = (doc: PmNode, from: number, to: number) => {
  let found = false;
  if (to > from)
    doc.nodesBetween(from, to, (node) => {
      if (node.isInline) found = true;
      return !found;
    });
  return found;
};

// Bestehende Änderung derselben Person direkt daneben weiterführen (sonst wird jeder Buchstabe eine eigene Änderung).
function neighbourAttrs(doc: PmNode, from: number, to: number, kind: ChangeKind, author: string) {
  const type = doc.type.schema.marks[kind];
  const near = [doc.resolve(from).nodeBefore, doc.resolve(to).nodeAfter];
  for (const node of near) {
    const mark = node?.marks.find((item) => item.type === type && item.attrs.author === author);
    if (mark) return mark.attrs;
  }
  return { author, date: new Date().toISOString() };
}

function track(tr: Transaction, oldState: EditorState, newState: EditorState, author: string) {
  // Nur einfache Eingaben (Tippen, Löschen, Einfügen, Ausschneiden); Umbauten wie Listen bleiben unverändert.
  if (tr.steps.length !== 1 || !(tr.steps[0] instanceof ReplaceStep)) return null;
  const step = tr.steps[0];
  const before = tr.docs[0];
  const { from, to, slice } = step;
  const removed = before.slice(from, to);
  const deleted = hasInline(before, from, to);
  const inserted = hasInline(newState.doc, from, from + slice.size);
  if (!deleted && !inserted) return null;
  const { insertion, deletion } = newState.schema.marks;
  const out = newState.tr.setMeta(TRACK_META, true);
  let delStart = from;
  let delEnd = from;
  if (deleted) {
    // Gelöschtes wieder einsetzen (vor dem neu Eingefügten) und als gelöscht markieren.
    out.replace(from, from, removed);
    delStart = out.mapping.map(from, -1);
    delEnd = out.mapping.map(from, 1);
  }
  const insStart = out.mapping.map(from, 1);
  const insEnd = out.mapping.map(from + slice.size, 1);
  if (inserted) {
    out.removeMark(insStart, insEnd, deletion);
    out.addMark(insStart, insEnd, insertion.create(neighbourAttrs(out.doc, insStart, insEnd, "insertion", author)));
  }
  if (deleted) {
    const attrs = neighbourAttrs(out.doc, delStart, delEnd, "deletion", author);
    // Eigene, noch nicht angenommene Eingaben verschwinden beim Löschen ganz (wie in Word).
    const own: { from: number; to: number }[] = [];
    out.doc.nodesBetween(delStart, delEnd, (node, pos) => {
      if (!node.isInline) return true;
      const start = Math.max(pos, delStart);
      const end = Math.min(pos + node.nodeSize, delEnd);
      if (node.marks.some((mark) => mark.type === insertion && mark.attrs.author === author))
        own.push({ from: start, to: end });
      else if (!node.marks.some((mark) => mark.type === deletion)) out.addMark(start, end, deletion.create(attrs));
      return false;
    });
    for (const range of own.reverse()) out.delete(range.from, range.to);
  }
  // Cursor wie in Word: Rücktaste springt vor das Gelöschte, Entf und Überschreiben dahinter.
  const old = oldState.selection;
  const backspace = !inserted && old.empty && old.from === to && to > from;
  const caret = inserted
    ? out.mapping.map(from + slice.size, 1)
    : backspace
      ? out.mapping.map(from, -1)
      : out.mapping.map(from, 1);
  out.setSelection(TextSelection.create(out.doc, Math.min(caret, out.doc.content.size)));
  return out;
}

declare module "@tiptap/core" {
  interface Storage {
    trackChanges: TrackState;
  }
}

export const TrackChanges = Extension.create<Record<string, never>, TrackState>({
  name: "trackChanges",
  // Vor den üblichen Tastenbelegungen (Rücktaste, Entf).
  priority: 1000,
  addStorage() {
    return { on: false, author: "" };
  },
  // Ein- und ausschalten wie in Word (Ctrl+Shift+E). Rücktaste und Entf löschen beim Nachverfolgen selbst ein
  // Zeichen (sonst löscht der Browser und der Cursor landet je nach Zeitpunkt vor oder hinter dem Gelöschten).
  addKeyboardShortcuts() {
    const removeChar = (direction: -1 | 1) => {
      if (!this.storage.on) return false;
      // Direkt nach Ende oder Pfeiltaste steht der Cursor im Editor sonst noch an der alten Stelle.
      if (this.editor.state.selection instanceof TextSelection) syncSelection(this.editor);
      const { state, view } = this.editor;
      const { selection } = state;
      if (!selection.empty) return false;
      const { $from } = selection;
      const near = direction === -1 ? $from.nodeBefore : $from.nodeAfter;
      if (!near?.isText || !near.text) return false;
      const char = direction === -1 ? Array.from(near.text).pop() : Array.from(near.text)[0];
      if (!char) return false;
      const from = direction === -1 ? $from.pos - char.length : $from.pos;
      view.dispatch(state.tr.delete(from, from + char.length).scrollIntoView());
      return true;
    };
    return {
      "Mod-Shift-e": () => {
        this.storage.toggle?.();
        return true;
      },
      Backspace: () => removeChar(-1),
      Delete: () => removeChar(1),
    };
  },
  addProseMirrorPlugins() {
    const state = this.storage;
    return [
      new Plugin({
        key: new PluginKey("trackChanges"),
        appendTransaction: (transactions, oldState, newState) => {
          if (!state.on) return null;
          // Nur die Eingabe selbst; was andere Erweiterungen danach anhängen, bleibt unverändert.
          const [tr] = transactions;
          if (!tr?.docChanged || transactions.slice(1).some((item) => item.docChanged)) return null;
          if (tr.getMeta(TRACK_META) || tr.getMeta(REMOTE_META) || isHistoryTransaction(tr)) return null;
          if (tr.getMeta("addToHistory") === false) return null;
          return track(tr, oldState, newState, state.author);
        },
      }),
    ];
  },
});

// Vom Editor gesetzt: ein/aus, Name für neue Änderungen, Umschalten per Tastenkürzel.
export function setTracking(editor: Editor, next: Partial<TrackState>) {
  Object.assign(editor.storage.trackChanges, next);
}

// Alle Änderungen im Dokument, zusammenhängende Stellen derselben Person als eine Änderung.
export function changesOf(doc: PmNode): TrackedChange[] {
  const list: TrackedChange[] = [];
  const open = new Map<ChangeKind, TrackedChange>();
  doc.descendants((node, pos) => {
    if (!node.isInline) {
      if (node.isTextblock) open.clear();
      return true;
    }
    for (const kind of ["insertion", "deletion"] as ChangeKind[]) {
      const mark: PmMark | undefined = node.marks.find((item) => item.type.name === kind);
      const last = open.get(kind);
      if (!mark) {
        open.delete(kind);
        continue;
      }
      if (last && last.to === pos && last.author === mark.attrs.author) last.to = pos + node.nodeSize;
      else {
        const entry = {
          kind,
          from: pos,
          to: pos + node.nodeSize,
          author: String(mark.attrs.author ?? ""),
          date: String(mark.attrs.date ?? ""),
        };
        list.push(entry);
        open.set(kind, entry);
      }
    }
    return false;
  });
  return list.sort((a, b) => a.from - b.from || a.to - b.to);
}

// Änderungen an der Markierung (oder direkt am Cursor).
export function changesAt(editor: Editor) {
  const { from, to } = editor.state.selection;
  return changesOf(editor.state.doc).filter((change) => touches(change, from, to));
}

const touches = (change: TrackedChange, from: number, to: number) =>
  from === to ? change.from <= from && change.to >= from : change.from < to && change.to > from;

// Annehmen: Eingefügtes bleibt, Gelöschtes verschwindet. Ablehnen: umgekehrt.
export function resolveChanges(editor: Editor, changes: TrackedChange[], accept: boolean) {
  if (!changes.length) return false;
  const { insertion, deletion } = editor.schema.marks;
  const tr = editor.state.tr.setMeta(TRACK_META, true);
  for (const change of [...changes].sort((a, b) => b.from - a.from)) {
    const from = tr.mapping.map(change.from);
    const to = tr.mapping.map(change.to);
    const keep = (change.kind === "insertion") === accept;
    if (keep) tr.removeMark(from, to, change.kind === "insertion" ? insertion : deletion);
    else tr.delete(from, to);
  }
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

// Zur nächsten oder vorherigen Änderung springen (und sie markieren).
export function goToChange(editor: Editor, direction: 1 | -1) {
  const changes = changesOf(editor.state.doc);
  if (!changes.length) return false;
  const { from, to } = editor.state.selection;
  const next =
    direction === 1
      ? (changes.find((change) => change.from >= to && !(change.from === from && change.to === to)) ?? changes[0])
      : ([...changes].reverse().find((change) => change.to <= from) ?? changes[changes.length - 1]);
  editor.chain().focus().setTextSelection({ from: next.from, to: next.to }).scrollIntoView().run();
  return true;
}

// Für die Werkzeugleiste: Anzahl Änderungen im Dokument und an der Markierung.
export function changeCounts(editor: Editor) {
  const all = changesOf(editor.state.doc);
  const { from, to } = editor.state.selection;
  const here = all.filter((change) => touches(change, from, to));
  return { changesTotal: all.length, changesHere: here.length };
}
