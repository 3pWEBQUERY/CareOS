"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableCell, TableHeader, TableKit } from "@tiptap/extension-table";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import {
  ArrowsDownUp,
  ArrowUUpLeft,
  ArrowUUpRight,
  ArrowsMerge,
  ArrowsSplit,
  Asterisk,
  CaretLeft,
  CaretRight,
  ChatCircleText,
  ChatsCircle,
  CheckCircle,
  ColumnsPlusLeft,
  ColumnsPlusRight,
  Eraser,
  FileDashed,
  GearSix,
  HighlighterCircle,
  Image as ImageIcon,
  LinkSimple,
  ListBullets,
  ListChecks,
  ListDashes,
  ListNumbers,
  MagnifyingGlass,
  Minus,
  PaintBucket,
  PencilLine,
  RowsPlusBottom,
  RowsPlusTop,
  Table,
  TextAUnderline,
  TextAlignCenter,
  TextAlignJustify,
  TextAlignLeft,
  TextAlignRight,
  TextB,
  TextIndent,
  TextItalic,
  TextOutdent,
  TextStrikethrough,
  TextSubscript,
  TextSuperscript,
  TextUnderline,
  Trash,
  XCircle,
} from "@phosphor-icons/react";
import { DEFAULT_PAGE, MARGINS_MM, newId, type DocNode, type DocumentModel, type PageSetup } from "@/lib/office/model";
import type { CommentThread } from "@/lib/office/comments";
import { CommentsPanel, newComment } from "./office-comments";
import type { EditorProps } from "./editor-props";
import { REMOTE_META, alignText, applyContent, toggleList } from "./text-commands";
import {
  Deletion,
  Insertion,
  TrackChanges,
  changeCounts,
  setTracking,
  changesAt,
  changesOf,
  goToChange,
  resolveChanges,
  type TrackedChange,
} from "./track-changes";
import { collaboratorColor } from "@/lib/office/presence";
import {
  CommentMark,
  DEFAULT_LINE_SPACING,
  Footnote,
  LINE_SPACINGS,
  LineSpacing,
  Subscript,
  Superscript,
  TableOfContents,
  addCommentMark,
  commentRanges,
  commentsAt,
  footnotesOf,
  insertTableOfContents,
  removeCommentMark,
  removeFootnote,
  setFootnoteText,
  setLineSpacing,
} from "./doc-extensions";
import {
  ColorPicker,
  MenuList,
  TablePicker,
  ToolButton,
  ToolGroup,
  ToolPopover,
  ToolSeparator,
  imageToDataUrl,
} from "./office-ui";

// Seitenumbruch wie in Word (Ctrl+Enter); erscheint im Editor als gestrichelte Linie.
const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: "div[data-page-break]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-page-break": "", class: "office-page-break" }),
    "Seitenumbruch",
  ],
  addKeyboardShortcuts() {
    return { "Mod-Enter": () => this.editor.commands.insertContent({ type: this.name }) };
  },
});

// Zellen mit Hintergrundfarbe (Schattierung wie in Word).
const shading = {
  backgroundColor: {
    default: null,
    parseHTML: (element: HTMLElement) => element.style.backgroundColor || null,
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.backgroundColor ? { style: `background-color: ${String(attributes.backgroundColor)}` } : {},
  },
};
const ShadedCell = TableCell.extend({
  addAttributes: function () {
    return { ...this.parent?.(), ...shading };
  },
});
const ShadedHeader = TableHeader.extend({
  addAttributes: function () {
    return { ...this.parent?.(), ...shading };
  },
});

const STYLES = [
  { id: "paragraph", label: "Standard", hint: "Fliesstext" },
  { id: "h1", label: "Überschrift 1", hint: "Titel" },
  { id: "h2", label: "Überschrift 2", hint: "Abschnitt" },
  { id: "h3", label: "Überschrift 3", hint: "Unterabschnitt" },
  { id: "quote", label: "Zitat", hint: "Hervorgehoben" },
] as const;
const FONTS = ["Calibri", "Arial", "Georgia", "Times New Roman", "Verdana", "Courier New"];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48];
const ZOOMS = [75, 90, 100, 110, 125, 150];

type Match = { from: number; to: number };

// Treffer der Suche über ganze Absätze hinweg (auch über Formatwechsel innerhalb eines Absatzes).
function findMatches(editor: Editor, query: string, caseSensitive: boolean): Match[] {
  if (!query) return [];
  const matches: Match[] = [];
  const needle = caseSensitive ? query : query.toLocaleLowerCase("de-CH");
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    const positions: number[] = [];
    node.forEach((child, offset) => {
      const content = child.isText ? (child.text ?? "") : "￼";
      for (let index = 0; index < content.length; index += 1) {
        text += content[index];
        positions.push(pos + 1 + offset + index);
      }
    });
    const haystack = caseSensitive ? text : text.toLocaleLowerCase("de-CH");
    for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length))
      matches.push({ from: positions[at], to: positions[at + needle.length - 1] + 1 });
    return false;
  });
  return matches;
}

function FindPanel({ editor, close }: { editor: Editor; close: () => void }) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [result, setResult] = useState("");
  const matches = () => findMatches(editor, query, caseSensitive);
  function next() {
    const list = matches();
    if (!list.length) return setResult("Keine Treffer");
    const after = list.find((match) => match.from >= editor.state.selection.to) ?? list[0];
    editor.chain().focus().setTextSelection(after).scrollIntoView().run();
    setResult(`Treffer ${list.indexOf(after) + 1} von ${list.length}`);
  }
  function replaceOne() {
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to);
    const same = caseSensitive
      ? selected === query
      : selected.toLocaleLowerCase("de-CH") === query.toLocaleLowerCase("de-CH");
    if (query && same) editor.chain().focus().insertContentAt({ from, to }, replacement).run();
    next();
  }
  function replaceAll() {
    const list = matches();
    if (!list.length) return setResult("Keine Treffer");
    editor.commands.focus();
    const transaction = editor.state.tr;
    for (const match of [...list].reverse()) transaction.insertText(replacement, match.from, match.to);
    editor.view.dispatch(transaction);
    setResult(`${list.length} ersetzt`);
  }
  return (
    <div className="office-form">
      <label>
        <span>Suchen</span>
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setResult("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              next();
            }
          }}
        />
      </label>
      <label>
        <span>Ersetzen durch</span>
        <input value={replacement} onChange={(event) => setReplacement(event.target.value)} />
      </label>
      <button
        type="button"
        className={`office-toggle ${caseSensitive ? "active" : ""}`}
        aria-pressed={caseSensitive}
        onClick={() => setCaseSensitive((value) => !value)}
      >
        Gross-/Kleinschreibung beachten
      </button>
      <div className="office-form-actions">
        <button type="button" onClick={next} disabled={!query}>
          Weitersuchen
        </button>
        <button type="button" onClick={replaceOne} disabled={!query}>
          Ersetzen
        </button>
        <button type="button" onClick={replaceAll} disabled={!query}>
          Alle ersetzen
        </button>
        <button type="button" onClick={close}>
          Schliessen
        </button>
      </div>
      {result && (
        <p className="office-form-result" role="status">
          {result}
        </p>
      )}
    </div>
  );
}

function LinkPanel({ editor, close }: { editor: Editor; close: () => void }) {
  const [href, setHref] = useState(String(editor.getAttributes("link").href ?? ""));
  const [error, setError] = useState("");
  function apply() {
    const value = href.trim();
    if (!value) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return close();
    }
    const full = /^(https?:|mailto:|tel:)/i.test(value)
      ? value
      : value.includes("@")
        ? `mailto:${value}`
        : `https://${value}`;
    if (!/^(https?:\/\/[^\s]+|mailto:[^\s]+|tel:[+\d\s]+)$/i.test(full))
      return setError("Bitte eine gültige Adresse eingeben.");
    if (editor.state.selection.empty && !editor.isActive("link"))
      editor
        .chain()
        .focus()
        .insertContent({ type: "text", text: value, marks: [{ type: "link", attrs: { href: full } }] })
        .run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: full }).run();
    close();
  }
  return (
    <div className="office-form">
      <label>
        <span>Adresse (Webseite oder E-Mail)</span>
        <input
          autoFocus
          value={href}
          placeholder="z. B. www.beispiel.ch"
          onChange={(event) => {
            setHref(event.target.value);
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              apply();
            }
          }}
        />
      </label>
      {error && <p className="office-form-error">{error}</p>}
      <div className="office-form-actions">
        <button type="button" onClick={apply}>
          Übernehmen
        </button>
        {editor.isActive("link") && (
          <button
            type="button"
            onClick={() => {
              editor.chain().focus().extendMarkRange("link").unsetLink().run();
              close();
            }}
          >
            Link entfernen
          </button>
        )}
      </div>
    </div>
  );
}

function FootnotePanel({ onInsert }: { onInsert: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="office-form">
      <label>
        <span>Text der Fussnote</span>
        <textarea
          autoFocus
          rows={3}
          value={text}
          maxLength={2000}
          placeholder="z. B. Quelle oder Erklärung"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && text.trim()) {
              event.preventDefault();
              onInsert(text.replace(/\s+/g, " ").trim());
            }
          }}
        />
      </label>
      <div className="office-form-actions">
        <button type="button" disabled={!text.trim()} onClick={() => onInsert(text.replace(/\s+/g, " ").trim())}>
          Einfügen
        </button>
      </div>
    </div>
  );
}

const spacingLabel = (value: string) => (value.includes(".") ? value : `${value}.0`).replace(".", ",");

function PagePanel({ page, onChange }: { page: PageSetup; onChange: (page: PageSetup) => void }) {
  return (
    <div className="office-form">
      <fieldset>
        <legend>Ausrichtung</legend>
        <div className="office-segmented">
          {(["portrait", "landscape"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={page.orientation === value ? "active" : ""}
              aria-pressed={page.orientation === value}
              onClick={() => onChange({ ...page, orientation: value })}
            >
              {value === "portrait" ? "Hochformat" : "Querformat"}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Seitenränder</legend>
        <div className="office-segmented">
          {(["narrow", "normal", "wide"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={page.margins === value ? "active" : ""}
              aria-pressed={page.margins === value}
              onClick={() => onChange({ ...page, margins: value })}
            >
              {value === "narrow" ? "Schmal" : value === "normal" ? "Normal" : "Breit"}
            </button>
          ))}
        </div>
      </fieldset>
      <label>
        <span>Kopfzeile</span>
        <input
          value={page.header}
          maxLength={200}
          placeholder="z. B. Name der Einrichtung"
          onChange={(event) => onChange({ ...page, header: event.target.value })}
        />
      </label>
      <label>
        <span>Fusszeile</span>
        <input
          value={page.footer}
          maxLength={200}
          placeholder="z. B. Stand und Verantwortliche"
          onChange={(event) => onChange({ ...page, footer: event.target.value })}
        />
      </label>
      <button
        type="button"
        className={`office-toggle ${page.pageNumbers ? "active" : ""}`}
        aria-pressed={page.pageNumbers}
        onClick={() => onChange({ ...page, pageNumbers: !page.pageNumbers })}
      >
        Seitenzahlen in der Fusszeile („Seite 1 von 3“)
      </button>
    </div>
  );
}

export default function DocEditor({
  model,
  onChange,
  readOnly,
  title,
  user,
  remoteRef,
  people = [],
  onPlace,
}: EditorProps<DocumentModel>) {
  const [page, setPage] = useState<PageSetup>({ ...DEFAULT_PAGE, ...model.page });
  const [zoom, setZoom] = useState(100);
  const pageRef = useRef(page);
  const imageInput = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState("");
  const emit = useRef(onChange);
  // Erst nach dem ersten Klick in den Text zählen Änderungen (beim Öffnen gleicht der Editor die Datei nur an).
  const touched = useRef(false);
  // Kommentare: Liste im Modell, Markierungen im Text; Seitenleiste offen, solange es offene Kommentare gibt.
  const [comments, setComments] = useState<CommentThread[]>(model.comments ?? []);
  const commentsRef = useRef(comments);
  const [showComments, setShowComments] = useState(Boolean(model.comments?.some((item) => !item.resolved)));
  const [draft, setDraft] = useState<string | null>(null);
  const [activeComment, setActiveComment] = useState<string | null>(null);
  // Änderungen nachverfolgen: Einstellung gehört zur Datei (wie in Word), Name für neue Änderungen.
  const [track, setTrack] = useState(Boolean(model.track));
  const trackOn = useRef(Boolean(model.track));
  // Gemeinsamer Stand für die Erweiterung (liest ihn erst beim Tippen, nicht beim Zeichnen).
  const withComments = (content: DocNode, nextPage: PageSetup, threads = commentsRef.current): DocumentModel => ({
    kind: "document",
    page: nextPage,
    content,
    ...(threads.length ? { comments: threads } : {}),
    ...(trackOn.current ? { track: true } : {}),
  });
  useEffect(() => {
    emit.current = onChange;
  }, [onChange]);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        code: false,
        codeBlock: false,
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https", protocols: ["mailto", "tel"] },
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyleKit.configure({ lineHeight: false }),
      LineSpacing,
      Superscript,
      Subscript,
      Highlight.configure({ multicolor: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: true }, tableCell: false, tableHeader: false }),
      ShadedCell,
      ShadedHeader,
      Image.configure({ allowBase64: true, resize: { enabled: true, alwaysPreserveAspectRatio: true, minWidth: 40 } }),
      PageBreak,
      TableOfContents,
      Footnote,
      CommentMark,
      Insertion,
      Deletion,
      TrackChanges,
      CharacterCount,
      Placeholder.configure({ placeholder: "Hier schreiben …" }),
    ],
    [],
  );

  // Stabile Einstellungen: sonst übernimmt der Editor sie bei jedem Zeichnen neu und hebt die Markierung auf.
  const editorProps = useMemo(
    () => ({
      attributes: { class: "office-prose", "aria-label": `Dokument ${title}`, spellcheck: "true", lang: "de-CH" },
    }),
    [title],
  );
  const editor = useEditor({
    extensions,
    content: model.content,
    editable: !readOnly,
    immediatelyRender: false,
    editorProps,
    onFocus: () => {
      touched.current = true;
    },
    onUpdate: ({ editor: current, transaction }) => {
      // Änderungen anderer (beim Zusammenführen übernommen) sind schon im Stand der Datei.
      if (!touched.current || transaction.getMeta(REMOTE_META)) return;
      emit.current(withComments(current.getJSON() as DocNode, pageRef.current));
    },
    onSelectionUpdate: ({ editor: current }) => {
      setActiveComment(commentsAt(current)[0] ?? null);
      // Eigene Stelle für die anderen: Absatz (oberste Ebene), in dem der Cursor steht.
      place.current?.({ block: current.state.selection.$from.index(0) });
    },
  });
  const place = useRef(onPlace);
  useEffect(() => {
    place.current = onPlace;
  }, [onPlace]);

  // Gleichzeitiges Bearbeiten: zusammengeführten Stand übernehmen (Text, Seite, Kommentare).
  useEffect(() => {
    if (!remoteRef) return;
    remoteRef.current = (next) => {
      const nextPage = { ...DEFAULT_PAGE, ...next.page };
      setPage(nextPage);
      pageRef.current = nextPage;
      commentsRef.current = next.comments ?? [];
      setComments(next.comments ?? []);
      trackOn.current = Boolean(next.track);
      setTrack(Boolean(next.track));
      if (editor) setTracking(editor, { on: trackOn.current });
      if (editor) applyContent(editor, next.content);
    };
    return () => {
      remoteRef.current = null;
    };
  }, [editor, remoteRef]);

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  function changePage(next: PageSetup) {
    setPage(next);
    pageRef.current = next;
    if (editor) emit.current(withComments(editor.getJSON() as DocNode, next));
  }

  // ---------- Änderungen nachverfolgen ----------
  function toggleTrack() {
    if (readOnly) return;
    const on = !trackOn.current;
    trackOn.current = on;
    setTrack(on);
    if (editor) setTracking(editor, { on });
    touched.current = true;
    if (editor) emit.current(withComments(editor.getJSON() as DocNode, pageRef.current));
  }
  useEffect(() => {
    if (editor) setTracking(editor, { on: trackOn.current, author: user, toggle: toggleTrack });
  });
  function resolve(changes: TrackedChange[], accept: boolean) {
    if (!editor || readOnly) return;
    touched.current = true;
    resolveChanges(editor, changes, accept);
    editor.commands.focus();
  }

  // ---------- Kommentare ----------
  function updateComments(next: CommentThread[]) {
    commentsRef.current = next;
    setComments(next);
    touched.current = true;
    if (editor) emit.current(withComments(editor.getJSON() as DocNode, pageRef.current, next));
  }
  function startComment() {
    if (!editor || readOnly) return;
    if (draft) removeCommentMark(editor, draft);
    const id = newId();
    touched.current = true;
    if (!addCommentMark(editor, id)) return;
    setDraft(id);
    setActiveComment(id);
    setShowComments(true);
  }
  function selectComment(id: string) {
    setActiveComment(id);
    const [first] = editor ? commentRanges(editor, id) : [];
    if (!editor || !first) return;
    editor.chain().focus().setTextSelection(first.from).scrollIntoView().run();
  }

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return null;
      const style = current.getAttributes("textStyle");
      return {
        canUndo: current.can().undo(),
        canRedo: current.can().redo(),
        bold: current.isActive("bold"),
        italic: current.isActive("italic"),
        underline: current.isActive("underline"),
        strike: current.isActive("strike"),
        superscript: current.isActive("superscript"),
        subscript: current.isActive("subscript"),
        lineSpacing: String(
          current.getAttributes("paragraph").lineHeight ??
            current.getAttributes("heading").lineHeight ??
            DEFAULT_LINE_SPACING,
        ),
        footnotes: footnotesOf(current),
        bullet: current.isActive("bulletList"),
        ordered: current.isActive("orderedList"),
        task: current.isActive("taskList"),
        link: current.isActive("link"),
        table: current.isActive("table"),
        style: current.isActive("heading", { level: 1 })
          ? "h1"
          : current.isActive("heading", { level: 2 })
            ? "h2"
            : current.isActive("heading", { level: 3 })
              ? "h3"
              : current.isActive("blockquote")
                ? "quote"
                : "paragraph",
        align:
          (["center", "right", "justify"] as const).find((value) => current.isActive({ textAlign: value })) ?? "left",
        color: typeof style.color === "string" ? style.color : null,
        font: typeof style.fontFamily === "string" ? style.fontFamily.split(",")[0].replace(/["']/g, "") : "Calibri",
        size: typeof style.fontSize === "string" ? style.fontSize.replace("pt", "") : "11",
        highlight:
          typeof current.getAttributes("highlight").color === "string"
            ? String(current.getAttributes("highlight").color)
            : null,
        canMerge: current.can().mergeCells(),
        canSplit: current.can().splitCell(),
        canSink: current.can().sinkListItem("listItem") || current.can().sinkListItem("taskItem"),
        canLift: current.can().liftListItem("listItem") || current.can().liftListItem("taskItem"),
        hasSelection: !current.state.selection.empty,
        ...changeCounts(current),
        words: current.storage.characterCount.words(),
        characters: current.storage.characterCount.characters(),
      };
    },
  });

  if (!editor || !state) return <p className="office-loading">Dokument wird vorbereitet …</p>;

  const chain = () => editor.chain().focus();
  function applyStyle(id: (typeof STYLES)[number]["id"]) {
    if (id === "quote") {
      if (!editor!.isActive("blockquote")) chain().setParagraph().setBlockquote().run();
      return;
    }
    const base = editor!.isActive("blockquote") ? chain().unsetBlockquote() : chain();
    if (id === "paragraph") base.setParagraph().run();
    else base.setHeading({ level: Number(id.slice(1)) as 1 | 2 | 3 }).run();
  }
  async function insertImage(file: File) {
    try {
      setImageError("");
      const src = await imageToDataUrl(file);
      chain()
        .setImage({ src, alt: file.name.replace(/\.[^.]+$/, "") })
        .run();
    } catch (cause) {
      setImageError(cause instanceof Error ? cause.message : "Das Bild konnte nicht eingefügt werden.");
    }
  }
  const sheetWidth = page.orientation === "portrait" ? 210 : 297;
  const sheetHeight = page.orientation === "portrait" ? 297 : 210;
  const margin = MARGINS_MM[page.margins];
  const currentStyle = STYLES.find((item) => item.id === state.style) ?? STYLES[0];
  const openCount = comments.filter((item) => !item.resolved).length;

  return (
    <div
      className="office-doc"
      onKeyDown={(event) => {
        // Ctrl+Alt+M wie in Word: Kommentar zur markierten Stelle.
        if ((event.ctrlKey || event.metaKey) && event.altKey && event.code === "KeyM") {
          event.preventDefault();
          startComment();
        }
      }}
    >
      {!readOnly && (
        <div className="office-ribbon" role="toolbar" aria-label="Formatierung">
          <ToolGroup label="Rückgängig">
            <ToolButton
              label="Rückgängig"
              shortcut="Ctrl+Z"
              icon={<ArrowUUpLeft />}
              disabled={!state.canUndo}
              onClick={() => chain().undo().run()}
            />
            <ToolButton
              label="Wiederholen"
              shortcut="Ctrl+Y"
              icon={<ArrowUUpRight />}
              disabled={!state.canRedo}
              onClick={() => chain().redo().run()}
            />
          </ToolGroup>
          <ToolSeparator />
          <ToolGroup label="Formatvorlage">
            <ToolPopover
              label="Formatvorlage"
              className="office-style-picker"
              trigger={<span className="office-select-text">{currentStyle.label}</span>}
            >
              {(close) => (
                <MenuList
                  close={close}
                  items={STYLES.map((item) => ({
                    label: item.label,
                    hint: item.hint,
                    active: state.style === item.id,
                    onSelect: () => applyStyle(item.id),
                  }))}
                />
              )}
            </ToolPopover>
            <ToolPopover
              label="Schriftart"
              className="office-font-picker"
              trigger={<span className="office-select-text">{state.font}</span>}
            >
              {(close) => (
                <MenuList
                  close={close}
                  items={FONTS.map((font) => ({
                    label: font,
                    style: { fontFamily: font },
                    active: state.font === font,
                    onSelect: () =>
                      font === "Calibri" ? chain().unsetFontFamily().run() : chain().setFontFamily(font).run(),
                  }))}
                />
              )}
            </ToolPopover>
            <ToolPopover
              label="Schriftgrösse"
              className="office-size-picker"
              trigger={<span className="office-select-text">{state.size}</span>}
            >
              {(close) => (
                <MenuList
                  close={close}
                  items={SIZES.map((size) => ({
                    label: String(size),
                    active: state.size === String(size),
                    onSelect: () =>
                      size === 11 ? chain().unsetFontSize().run() : chain().setFontSize(`${size}pt`).run(),
                  }))}
                />
              )}
            </ToolPopover>
          </ToolGroup>
          <ToolSeparator />
          <ToolGroup label="Zeichen">
            <ToolButton
              label="Fett"
              shortcut="Ctrl+B"
              icon={<TextB weight="bold" />}
              active={state.bold}
              onClick={() => chain().toggleBold().run()}
            />
            <ToolButton
              label="Kursiv"
              shortcut="Ctrl+I"
              icon={<TextItalic />}
              active={state.italic}
              onClick={() => chain().toggleItalic().run()}
            />
            <ToolButton
              label="Unterstrichen"
              shortcut="Ctrl+U"
              icon={<TextUnderline />}
              active={state.underline}
              onClick={() => chain().toggleUnderline().run()}
            />
            <ToolButton
              label="Durchgestrichen"
              icon={<TextStrikethrough />}
              active={state.strike}
              onClick={() => chain().toggleStrike().run()}
            />
            <ToolButton
              label="Hochgestellt"
              shortcut="Ctrl+."
              icon={<TextSuperscript />}
              active={state.superscript}
              onClick={() => chain().toggleMark("superscript").run()}
            />
            <ToolButton
              label="Tiefgestellt"
              shortcut="Ctrl+,"
              icon={<TextSubscript />}
              active={state.subscript}
              onClick={() => chain().toggleMark("subscript").run()}
            />
            <ColorPicker
              label="Schriftfarbe"
              icon={<TextAUnderline />}
              current={state.color}
              noneLabel="Automatisch"
              onPick={(color) => (color ? chain().setColor(color).run() : chain().unsetColor().run())}
            />
            <ColorPicker
              label="Hervorheben"
              icon={<HighlighterCircle />}
              current={state.highlight}
              noneLabel="Keine Hervorhebung"
              onPick={(color) => (color ? chain().setHighlight({ color }).run() : chain().unsetHighlight().run())}
            />
            <ToolButton label="Formatierung löschen" icon={<Eraser />} onClick={() => chain().unsetAllMarks().run()} />
          </ToolGroup>
          <ToolSeparator />
          <ToolGroup label="Absatz">
            <ToolButton
              label="Linksbündig"
              icon={<TextAlignLeft />}
              active={state.align === "left"}
              onClick={() => alignText(editor, "left")}
            />
            <ToolButton
              label="Zentriert"
              icon={<TextAlignCenter />}
              active={state.align === "center"}
              onClick={() => chain().setTextAlign("center").run()}
            />
            <ToolButton
              label="Rechtsbündig"
              icon={<TextAlignRight />}
              active={state.align === "right"}
              onClick={() => chain().setTextAlign("right").run()}
            />
            <ToolButton
              label="Blocksatz"
              icon={<TextAlignJustify />}
              active={state.align === "justify"}
              onClick={() => chain().setTextAlign("justify").run()}
            />
            <ToolPopover label="Zeilenabstand" trigger={<ArrowsDownUp />}>
              {(close) => (
                <MenuList
                  close={close}
                  items={LINE_SPACINGS.map((value) => ({
                    label: spacingLabel(value),
                    hint: value === DEFAULT_LINE_SPACING ? "Standard" : undefined,
                    active: state.lineSpacing === value,
                    onSelect: () => setLineSpacing(editor, value === DEFAULT_LINE_SPACING ? null : value),
                  }))}
                />
              )}
            </ToolPopover>
            <ToolButton
              label="Aufzählung"
              icon={<ListBullets />}
              active={state.bullet}
              onClick={() => toggleList(editor, "bulletList", "listItem")}
            />
            <ToolButton
              label="Nummerierung"
              icon={<ListNumbers />}
              active={state.ordered}
              onClick={() => toggleList(editor, "orderedList", "listItem")}
            />
            <ToolButton
              label="Aufgabenliste zum Abhaken"
              icon={<ListChecks />}
              active={state.task}
              onClick={() => toggleList(editor, "taskList", "taskItem")}
            />
            <ToolButton
              label="Einzug verkleinern"
              icon={<TextOutdent />}
              disabled={!state.canLift}
              onClick={() =>
                editor.can().liftListItem("taskItem")
                  ? chain().liftListItem("taskItem").run()
                  : chain().liftListItem("listItem").run()
              }
            />
            <ToolButton
              label="Einzug vergrössern"
              icon={<TextIndent />}
              disabled={!state.canSink}
              onClick={() =>
                editor.can().sinkListItem("taskItem")
                  ? chain().sinkListItem("taskItem").run()
                  : chain().sinkListItem("listItem").run()
              }
            />
          </ToolGroup>
          <ToolSeparator />
          <ToolGroup label="Einfügen">
            <ToolPopover label="Tabelle einfügen" trigger={<Table />}>
              {(close) => (
                <TablePicker
                  onPick={(rows, cols) => {
                    close();
                    chain().insertTable({ rows, cols, withHeaderRow: true }).run();
                  }}
                />
              )}
            </ToolPopover>
            <ToolButton label="Bild einfügen" icon={<ImageIcon />} onClick={() => imageInput.current?.click()} />
            <ToolPopover label="Link" trigger={<LinkSimple />} className={state.link ? "active" : ""}>
              {(close) => <LinkPanel editor={editor} close={close} />}
            </ToolPopover>
            <ToolButton label="Trennlinie" icon={<Minus />} onClick={() => chain().setHorizontalRule().run()} />
            <ToolButton
              label="Inhaltsverzeichnis"
              icon={<ListDashes />}
              onClick={() => insertTableOfContents(editor)}
            />
            <ToolPopover label="Fussnote" trigger={<Asterisk />}>
              {(close) => (
                <FootnotePanel
                  onInsert={(text) => {
                    close();
                    chain().insertContent({ type: "footnote", attrs: { text } }).run();
                  }}
                />
              )}
            </ToolPopover>
            <ToolButton
              label="Seitenumbruch"
              shortcut="Ctrl+Enter"
              icon={<FileDashed />}
              onClick={() => chain().insertContent({ type: "pageBreak" }).run()}
            />
          </ToolGroup>
          <ToolSeparator />
          <ToolGroup label="Dokument">
            <ToolPopover label="Suchen und ersetzen" trigger={<MagnifyingGlass />} wide>
              {(close) => <FindPanel editor={editor} close={close} />}
            </ToolPopover>
            <ToolPopover label="Seite einrichten" trigger={<GearSix />} wide>
              {() => <PagePanel page={page} onChange={changePage} />}
            </ToolPopover>
          </ToolGroup>
          <ToolSeparator />
          <ToolGroup label="Überprüfen">
            <ToolButton
              label="Neuer Kommentar"
              shortcut="Ctrl+Alt+M"
              icon={<ChatCircleText />}
              disabled={!state.hasSelection}
              onClick={startComment}
            />
            <ToolButton
              label="Kommentare anzeigen"
              icon={<ChatsCircle />}
              active={showComments}
              onClick={() => setShowComments((value) => !value)}
            />
            <ToolButton
              label="Änderungen nachverfolgen"
              shortcut="Ctrl+Shift+E"
              icon={<PencilLine />}
              active={track}
              onClick={toggleTrack}
            />
            <ToolPopover label="Annehmen" trigger={<CheckCircle />} disabled={!state.changesTotal}>
              {(close) => (
                <MenuList
                  close={close}
                  items={[
                    {
                      label: "Diese Änderung annehmen",
                      disabled: !state.changesHere,
                      onSelect: () => editor && resolve(changesAt(editor), true),
                    },
                    {
                      label: "Alle Änderungen annehmen",
                      onSelect: () => editor && resolve(changesOf(editor.state.doc), true),
                    },
                  ]}
                />
              )}
            </ToolPopover>
            <ToolPopover label="Ablehnen" trigger={<XCircle />} disabled={!state.changesTotal}>
              {(close) => (
                <MenuList
                  close={close}
                  items={[
                    {
                      label: "Diese Änderung ablehnen",
                      disabled: !state.changesHere,
                      onSelect: () => editor && resolve(changesAt(editor), false),
                    },
                    {
                      label: "Alle Änderungen ablehnen",
                      danger: true,
                      onSelect: () => editor && resolve(changesOf(editor.state.doc), false),
                    },
                  ]}
                />
              )}
            </ToolPopover>
            <ToolButton
              label="Vorherige Änderung"
              icon={<CaretLeft />}
              disabled={!state.changesTotal}
              onClick={() => editor && goToChange(editor, -1)}
            />
            <ToolButton
              label="Nächste Änderung"
              icon={<CaretRight />}
              disabled={!state.changesTotal}
              onClick={() => editor && goToChange(editor, 1)}
            />
          </ToolGroup>
          <input
            ref={imageInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void insertImage(file);
            }}
          />
        </div>
      )}
      {!readOnly && state.table && (
        <div className="office-contextbar" role="toolbar" aria-label="Tabelle">
          <span className="office-contextbar-label">Tabelle</span>
          <ToolButton
            label="Zeile oberhalb einfügen"
            icon={<RowsPlusTop />}
            text="Zeile oben"
            onClick={() => chain().addRowBefore().run()}
          />
          <ToolButton
            label="Zeile unterhalb einfügen"
            icon={<RowsPlusBottom />}
            text="Zeile unten"
            onClick={() => chain().addRowAfter().run()}
          />
          <ToolButton
            label="Spalte links einfügen"
            icon={<ColumnsPlusLeft />}
            text="Spalte links"
            onClick={() => chain().addColumnBefore().run()}
          />
          <ToolButton
            label="Spalte rechts einfügen"
            icon={<ColumnsPlusRight />}
            text="Spalte rechts"
            onClick={() => chain().addColumnAfter().run()}
          />
          <ToolSeparator />
          <ToolButton
            label="Zellen verbinden"
            icon={<ArrowsMerge />}
            text="Verbinden"
            disabled={!state.canMerge}
            onClick={() => chain().mergeCells().run()}
          />
          <ToolButton
            label="Zelle teilen"
            icon={<ArrowsSplit />}
            text="Teilen"
            disabled={!state.canSplit}
            onClick={() => chain().splitCell().run()}
          />
          <ToolButton label="Kopfzeile ein oder aus" text="Kopfzeile" onClick={() => chain().toggleHeaderRow().run()} />
          <ColorPicker
            label="Zellfarbe"
            icon={<PaintBucket />}
            current={null}
            noneLabel="Keine Füllung"
            onPick={(color) => chain().setCellAttribute("backgroundColor", color).run()}
          />
          <ToolSeparator />
          <ToolButton label="Zeile löschen" text="Zeile löschen" onClick={() => chain().deleteRow().run()} />
          <ToolButton label="Spalte löschen" text="Spalte löschen" onClick={() => chain().deleteColumn().run()} />
          <ToolButton
            label="Tabelle löschen"
            icon={<Trash />}
            className="danger"
            onClick={() => chain().deleteTable().run()}
          />
        </div>
      )}
      {imageError && (
        <p className="office-inline-error" role="alert">
          {imageError}
        </p>
      )}
      <div className="office-main">
        <div className="office-canvas">
          <div
            className="office-page"
            style={{
              width: `${sheetWidth}mm`,
              minHeight: `${sheetHeight}mm`,
              padding: `${margin}mm`,
              zoom: zoom / 100,
            }}
          >
            {page.header && (
              <div
                className="office-page-header"
                style={{ top: `${Math.min(12, margin / 2)}mm`, left: `${margin}mm`, right: `${margin}mm` }}
              >
                {page.header}
              </div>
            )}
            <EditorContent editor={editor} />
            {state.footnotes.length > 0 && (
              <section className="office-footnotes" aria-label="Fussnoten">
                <ol>
                  {state.footnotes.map((note, index) => (
                    <li key={index}>
                      {readOnly ? (
                        <span>{note.text}</span>
                      ) : (
                        <>
                          <input
                            value={note.text}
                            maxLength={2000}
                            aria-label={`Fussnote ${index + 1}`}
                            placeholder="Text der Fussnote"
                            onFocus={() => {
                              touched.current = true;
                            }}
                            onChange={(event) => setFootnoteText(editor, note.pos, event.target.value)}
                          />
                          <button
                            type="button"
                            aria-label={`Fussnote ${index + 1} löschen`}
                            title="Fussnote löschen"
                            onClick={() => {
                              touched.current = true;
                              removeFootnote(editor, note.pos);
                            }}
                          >
                            <Trash />
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            )}
            {(page.footer || page.pageNumbers) && (
              <div
                className="office-page-footer"
                style={{ bottom: `${Math.min(10, margin / 2)}mm`, left: `${margin}mm`, right: `${margin}mm` }}
              >
                {page.footer}
                {page.footer && page.pageNumbers ? "   ·   " : ""}
                {page.pageNumbers ? "Seite 1 von …" : ""}
              </div>
            )}
          </div>
        </div>
        {showComments && (
          <CommentsPanel
            threads={comments.map((thread) => {
              const ranges = commentRanges(editor, thread.id);
              const text = ranges
                .map((range) => range.text)
                .join("")
                .trim();
              return {
                thread,
                label: text ? `„${text.length > 60 ? `${text.slice(0, 57)}…` : text}“` : "Textstelle",
                missing: !ranges.length,
              };
            })}
            user={user}
            readOnly={readOnly}
            draft={draft ? "Kommentar zur markierten Textstelle" : null}
            active={activeComment}
            onCreate={(text) => {
              if (!draft) return;
              updateComments([...commentsRef.current, { ...newComment(user, text), id: draft }]);
              setDraft(null);
            }}
            onCancelDraft={() => {
              if (draft) removeCommentMark(editor, draft);
              setDraft(null);
            }}
            onChange={(thread) =>
              updateComments(commentsRef.current.map((item) => (item.id === thread.id ? thread : item)))
            }
            onDelete={(id) => {
              removeCommentMark(editor, id);
              updateComments(commentsRef.current.filter((item) => item.id !== id));
            }}
            onSelect={selectComment}
            onClose={() => setShowComments(false)}
          />
        )}
      </div>
      <footer className="office-statusbar">
        <span>
          {state.words.toLocaleString("de-CH")} {state.words === 1 ? "Wort" : "Wörter"} ·{" "}
          {state.characters.toLocaleString("de-CH")} Zeichen
          {comments.length > 0 && (
            <>
              {" · "}
              <button type="button" className="office-status-link" onClick={() => setShowComments((value) => !value)}>
                {openCount} {openCount === 1 ? "offener Kommentar" : "offene Kommentare"}
              </button>
            </>
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
      <style>{`@media print { @page { size: A4 ${page.orientation}; margin: ${margin}mm; } }`}</style>
      {/* Andere Personen: farbiger Rand und Name am Absatz, in dem sie gerade schreiben. */}
      {people.some((person) => person.place?.block !== undefined) && (
        <style>
          {people
            .filter((person) => person.place?.block !== undefined)
            .map((person) => {
              const color = collaboratorColor(person.session);
              const at = `.office-prose > :nth-child(${(person.place?.block ?? 0) + 1})`;
              return `${at} { position: relative; box-shadow: -8px 0 0 -4px ${color}; } ${at}::after { content: ${JSON.stringify(person.name)}; position: absolute; top: -1.35em; right: 0; padding: 0 6px; border-radius: 6px; background: ${color}; color: white; font: 600 11px/1.6 Arial, sans-serif; pointer-events: none; }`;
            })
            .join("\n")}
        </style>
      )}
      {/* Aktiver Kommentar im Text kräftiger hervorgehoben. */}
      {activeComment && (
        <style>{`.office-prose [data-comment="${CSS.escape(activeComment)}"] { background: rgba(245, 158, 11, 0.42); }`}</style>
      )}
    </div>
  );
}
