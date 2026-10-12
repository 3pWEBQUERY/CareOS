import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";

// Liste ein- oder ausschalten wie in Word: Liegt jeder beschriebene Absatz der Markierung schon in dieser Liste,
// wird sie aufgehoben (auch nach „Alles markieren“, das den leeren Schlussabsatz mit erfasst); sonst wird sie gesetzt.
export function toggleList(
  editor: Editor,
  list: "bulletList" | "orderedList" | "taskList",
  item: "listItem" | "taskItem",
) {
  const { from, to } = editor.state.selection;
  let total = 0;
  let inside = 0;
  let depth = 0;
  let first = -1;
  let last = -1;
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    const resolved = editor.state.doc.resolve(pos + 1);
    let levels = 0;
    let inAnyList = false;
    for (let level = resolved.depth; level > 0; level -= 1) {
      const name = resolved.node(level).type.name;
      if (name === list) levels += 1;
      if (name === "bulletList" || name === "orderedList" || name === "taskList") inAnyList = true;
    }
    // Leere Absätze ausserhalb von Listen (z. B. der Schlussabsatz nach „Alles markieren“) zählen nicht mit.
    if (node.content.size === 0 && !inAnyList) return false;
    total += 1;
    if (first < 0) first = pos + 1;
    last = pos + 1 + node.content.size;
    if (levels) inside += 1;
    depth = Math.max(depth, levels);
    return false;
  });
  if (!total) return;
  // Ein Schritt (ein „Rückgängig“): Markierung auf die betroffenen Absätze begrenzen.
  let chain = editor.chain().focus().setTextSelection({ from: first, to: last });
  if (inside === total) for (let level = 0; level < depth; level += 1) chain = chain.liftListItem(item);
  else if (list === "bulletList") chain = chain.toggleBulletList();
  else if (list === "orderedList") chain = chain.toggleOrderedList();
  else chain = chain.toggleTaskList();
  chain.run();
}

// Linksbündig ist die Grundausrichtung: Ausrichtung entfernen statt „links“ zu speichern.
export function alignText(editor: Editor, align: "left" | "center" | "right" | "justify") {
  if (align === "left") editor.chain().focus().unsetTextAlign().run();
  else editor.chain().focus().setTextAlign(align).run();
}

// Gleichzeitiges Bearbeiten: neuen Inhalt übernehmen, indem nur der geänderte Abschnitt ersetzt wird. So bleiben
// Cursor und Markierung an ihrer Stelle (sie wandern mit, wenn davor Text dazukommt), und Rückgängig betrifft
// weiterhin nur die eigenen Änderungen.
export const REMOTE_META = "carecoreRemote";

export function applyContent(editor: Editor, json: unknown) {
  if (editor.isDestroyed) return;
  let next;
  try {
    next = editor.schema.nodeFromJSON(json);
  } catch {
    return;
  }
  const current = editor.state.doc;
  const start = current.content.findDiffStart(next.content);
  if (start === null) return;
  const end = current.content.findDiffEnd(next.content);
  let endA = end?.a ?? current.content.size;
  let endB = end?.b ?? next.content.size;
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  const tr = editor.state.tr.replace(start, endA, next.slice(start, endB));
  tr.setMeta("addToHistory", false);
  tr.setMeta(REMOTE_META, true);
  editor.view.dispatch(tr);
}

// Markierung bzw. Cursor aus dem Browser übernehmen: direkt nach Shift+Pfeil, Pos1 oder Ende kennt der Editor sie
// noch nicht (der Browser meldet die neue Stelle erst etwas später).
export function syncSelection(editor: Editor) {
  const dom = window.getSelection();
  const { view } = editor;
  if (!dom?.anchorNode || !dom.focusNode || !view.dom.contains(dom.anchorNode) || !view.dom.contains(dom.focusNode))
    return;
  const anchor = view.posAtDOM(dom.anchorNode, dom.anchorOffset);
  const head = view.posAtDOM(dom.focusNode, dom.focusOffset);
  const { selection } = view.state;
  if (anchor === selection.anchor && head === selection.head) return;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)));
}
