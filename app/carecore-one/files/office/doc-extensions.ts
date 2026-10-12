import { Extension, Mark, Node, mergeAttributes, type Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { syncSelection } from "./text-commands";

// Hoch- und tiefgestellt (H₂O, m²) – schliessen sich gegenseitig aus wie in Word.
export const Superscript = Mark.create({
  name: "superscript",
  excludes: "subscript",
  parseHTML: () => [{ tag: "sup" }, { style: "vertical-align=super" }],
  renderHTML: ({ HTMLAttributes }) => ["sup", mergeAttributes(HTMLAttributes), 0],
  addKeyboardShortcuts() {
    return { "Mod-.": () => this.editor.commands.toggleMark(this.name) };
  },
});

export const Subscript = Mark.create({
  name: "subscript",
  excludes: "superscript",
  parseHTML: () => [{ tag: "sub" }, { style: "vertical-align=sub" }],
  renderHTML: ({ HTMLAttributes }) => ["sub", mergeAttributes(HTMLAttributes), 0],
  addKeyboardShortcuts() {
    return { "Mod-,": () => this.editor.commands.toggleMark(this.name) };
  },
});

// Zeilenabstand je Absatz als Vielfaches wie in Word („1,5-zeilig“). Ohne Angabe gilt 1,15.
export const LINE_SPACINGS = ["1", "1.15", "1.5", "2", "2.5", "3"] as const;
export const DEFAULT_LINE_SPACING = "1.15";
const SPACING = /^\d(\.\d{1,2})?$/;
// Calibri braucht bei „einfach“ rund das 1,2-Fache der Schriftgrösse.
export const lineHeightCss = (factor: string) => String(Math.round(Number(factor) * 1.2 * 1000) / 1000);

export const LineSpacing = Extension.create({
  name: "lineSpacing",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const value = element.getAttribute("data-line-spacing");
              return value && SPACING.test(value) ? value : null;
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = typeof attributes.lineHeight === "string" ? attributes.lineHeight : "";
              return SPACING.test(value)
                ? { "data-line-spacing": value, style: `line-height: ${lineHeightCss(value)}` }
                : {};
            },
          },
        },
      },
    ];
  },
});

export function setLineSpacing(editor: Editor, value: string | null) {
  editor
    .chain()
    .focus()
    .updateAttributes("paragraph", { lineHeight: value })
    .updateAttributes("heading", { lineHeight: value })
    .run();
}

export type Heading = { level: number; text: string; pos: number };

export function headingsOf(editor: Editor): Heading[] {
  const list: Heading[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading")
      list.push({ level: Number(node.attrs.level ?? 1), text: node.textContent.trim(), pos });
    return !node.isTextblock;
  });
  return list;
}

// Inhaltsverzeichnis: zeigt die Überschriften des Dokuments und folgt jeder Änderung von selbst.
export const TableOfContents = Node.create({
  name: "tableOfContents",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: "nav[data-toc]" }],
  renderHTML: ({ HTMLAttributes }) => ["nav", mergeAttributes(HTMLAttributes, { "data-toc": "", class: "office-toc" })],
  addNodeView() {
    return ({ editor, getPos }) => {
      const dom = document.createElement("nav");
      dom.className = "office-toc";
      dom.setAttribute("data-toc", "");
      dom.setAttribute("aria-label", "Inhaltsverzeichnis");
      dom.contentEditable = "false";
      let last = "";
      const render = () => {
        const headings = headingsOf(editor);
        const key = JSON.stringify(headings.map((item) => [item.level, item.text]));
        if (key === last) return;
        last = key;
        dom.replaceChildren();
        const title = document.createElement("div");
        title.className = "office-toc-title";
        title.textContent = "Inhaltsverzeichnis";
        dom.append(title);
        if (!headings.length) {
          const empty = document.createElement("div");
          empty.className = "office-toc-empty";
          empty.textContent = "Noch keine Überschriften. Überschriften erscheinen hier von selbst.";
          dom.append(empty);
          return;
        }
        const list = document.createElement("ol");
        headings.forEach((heading, index) => {
          const item = document.createElement("li");
          item.className = `office-toc-level${Math.min(3, heading.level)}`;
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = heading.text || "(Überschrift ohne Text)";
          button.addEventListener("mousedown", (event) => event.preventDefault());
          button.addEventListener("click", () => {
            // Position beim Klick neu bestimmen: das Dokument kann sich seit dem Zeichnen verändert haben.
            const target = headingsOf(editor)[index];
            if (!target) return;
            editor
              .chain()
              .focus()
              .setTextSelection(target.pos + 1)
              .run();
            const element = editor.view.nodeDOM(target.pos);
            if (element instanceof HTMLElement) element.scrollIntoView({ block: "start", behavior: "smooth" });
          });
          item.append(button);
          list.append(item);
        });
        dom.append(list);
      };
      // Klick auf das Verzeichnis (nicht auf einen Eintrag) markiert es als Ganzes – zum Löschen oder Verschieben.
      dom.addEventListener("mousedown", (event) => {
        if (event.target instanceof HTMLButtonElement || !editor.isEditable) return;
        const pos = getPos();
        if (typeof pos !== "number") return;
        event.preventDefault();
        editor.chain().focus().setNodeSelection(pos).run();
      });
      render();
      editor.on("update", render);
      return {
        dom,
        stopEvent: (event) => event.target instanceof HTMLButtonElement || event.type === "mousedown",
        ignoreMutation: () => true,
        destroy: () => {
          editor.off("update", render);
        },
      };
    };
  },
});

// Einfügen und mit dem Cursor im nächsten Absatz weiterschreiben (sonst würde das erste Zeichen das Verzeichnis ersetzen).
export function insertTableOfContents(editor: Editor) {
  editor
    .chain()
    .focus()
    .insertContent({ type: "tableOfContents" })
    .command(({ tr }) => {
      const after = tr.selection.to;
      if (!tr.doc.resolve(after).nodeAfter?.isTextblock) tr.insert(after, editor.schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, after + 1));
      return true;
    })
    .run();
}

// Fussnote: Zahl im Text, Text der Fussnote unter dem Dokument (Nummer zählt das Dokument selbst).
export const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      text: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-text") ?? "",
        renderHTML: (attributes: Record<string, unknown>) => {
          const text = typeof attributes.text === "string" ? attributes.text : "";
          return { "data-text": text, title: text || "Fussnote ohne Text" };
        },
      },
    };
  },
  parseHTML: () => [{ tag: "span[data-footnote]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, { "data-footnote": "", class: "office-footnote" }),
  ],
});

export type FootnoteEntry = { pos: number; text: string };

export function footnotesOf(editor: Editor): FootnoteEntry[] {
  const list: FootnoteEntry[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "footnote") list.push({ pos, text: String(node.attrs.text ?? "") });
  });
  return list;
}

export function setFootnoteText(editor: Editor, pos: number, text: string) {
  const node = editor.state.doc.nodeAt(pos);
  if (node?.type.name !== "footnote") return;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, text }));
}

export function removeFootnote(editor: Editor, pos: number) {
  const node = editor.state.doc.nodeAt(pos);
  if (node?.type.name !== "footnote") return;
  editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize));
}

// Kommentar an einer Textstelle (wie in Word): Markierung mit der Nummer des Kommentars; mehrere dürfen sich überlappen.
export const CommentMark = Mark.create({
  name: "comment",
  excludes: "",
  inclusive: false,
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-comment"),
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.id === "string" ? { "data-comment": attributes.id } : {},
      },
    };
  },
  parseHTML: () => [{ tag: "span[data-comment]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { class: "office-comment-mark" }), 0],
});

// Alle Textstücke eines Kommentars (Position und Text) in Lesereihenfolge.
export function commentRanges(editor: Editor, id: string) {
  const ranges: { from: number; to: number; text: string }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.marks.some((mark) => mark.type.name === "comment" && mark.attrs.id === id))
      ranges.push({ from: pos, to: pos + node.nodeSize, text: node.text ?? "" });
  });
  return ranges;
}

export function addCommentMark(editor: Editor, id: string) {
  syncSelection(editor);
  const { from, to } = editor.state.selection;
  if (from === to) return false;
  editor.view.dispatch(editor.state.tr.addMark(from, to, editor.schema.marks.comment.create({ id })));
  return true;
}

export function removeCommentMark(editor: Editor, id: string) {
  const tr = editor.state.tr;
  for (const range of commentRanges(editor, id))
    tr.removeMark(range.from, range.to, editor.schema.marks.comment.create({ id }));
  if (tr.docChanged) editor.view.dispatch(tr);
}

// Kommentare an der Cursorstelle (für die Hervorhebung in der Seitenleiste).
export function commentsAt(editor: Editor) {
  const { $from } = editor.state.selection;
  const marks = [...(editor.state.storedMarks ?? []), ...$from.marks(), ...($from.nodeAfter?.marks ?? [])];
  return [...new Set(marks.filter((mark) => mark.type.name === "comment").map((mark) => String(mark.attrs.id)))];
}
