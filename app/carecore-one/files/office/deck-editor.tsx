"use client";

import NextImage from "next/image";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal, flushSync } from "react-dom";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { Placeholder } from "@tiptap/extensions";
import {
  ArrowDown,
  ArrowUp,
  ArrowUUpLeft,
  ArrowUUpRight,
  ChartBar,
  ChatCircleText,
  ChatsCircle,
  CopySimple,
  FilmStrip,
  HighlighterCircle,
  Image as ImageIcon,
  Layout,
  ListBullets,
  ListNumbers,
  Palette,
  Play,
  Plus,
  Shapes,
  Table,
  TextAUnderline,
  TextAlignCenter,
  TextAlignLeft,
  TextAlignRight,
  TextB,
  TextIndent,
  TextItalic,
  TextOutdent,
  TextStrikethrough,
  TextT,
  TextUnderline,
  Trash,
  X,
} from "@phosphor-icons/react";
import {
  DECK_THEMES,
  ITEM_LIMITS,
  SLIDE_BODY_SIZE,
  SLIDE_BOXES,
  SLIDE_LAYOUTS,
  SLIDE_SHAPES,
  SLIDE_SIZE,
  SLIDE_TRANSITIONS,
  TRANSITION_SPEEDS,
  emptyDoc,
  newId,
  newSlide,
  type ChartType,
  type DeckModel,
  type DeckTheme,
  type DocMark,
  type DocNode,
  type Slide,
  type SlideBox,
  type SlideItem,
  type SlideLayout,
  type SlideShape,
  type SlideTransitionType,
  type TransitionSpeed,
} from "@/lib/office/model";
import { playTransition, reducedMotion } from "./deck-transitions";
import { CHART_LABELS } from "@/lib/office/sheet-features";
import { CHART_ICONS, ChartDataDialog, ItemBar, ItemLayer, SHAPE_ICONS, StaticItems } from "./deck-items";
import type { EditorProps } from "./editor-props";
import { CommentsPanel, newComment } from "./office-comments";
import { initials, type CommentThread } from "@/lib/office/comments";
import { REMOTE_META, alignText, applyContent, toggleList } from "./text-commands";
import { collaboratorColor } from "@/lib/office/presence";
import { stableKey } from "@/lib/office/merge";
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

// Masse in Prozent der Folie, Schriftgrössen relativ zur Folienbreite (Folie 960 pt breit wie in PowerPoint).
const box = (value: SlideBox): CSSProperties => ({
  left: `${(value.x / SLIDE_SIZE.width) * 100}%`,
  top: `${(value.y / SLIDE_SIZE.height) * 100}%`,
  width: `${(value.w / SLIDE_SIZE.width) * 100}%`,
  height: `${(value.h / SLIDE_SIZE.height) * 100}%`,
});
const pt = (size: number) => `${size / 9.6}cqw`;

function slideColors(slide: Slide, theme: DeckTheme) {
  const colors = DECK_THEMES[theme];
  return slide.layout === "section"
    ? { background: colors.accent, text: "#ffffff", accent: "#ffffff", muted: "rgba(255,255,255,0.86)" }
    : { background: colors.background, text: colors.text, accent: colors.accent, muted: colors.muted };
}

// Neues Objekt ohne Lage (die vergibt der Editor) – je Art getrennt, damit die Felder geprüft bleiben.
type NewItem = SlideItem extends infer Item ? (Item extends SlideItem ? Omit<Item, "id" | "x" | "y"> : never) : never;

// ---------- Anzeige ohne Bearbeitung (Übersicht, Vorführen, Drucken) ----------

function markStyle(marks: DocMark[] | undefined): CSSProperties {
  const style: CSSProperties = {};
  for (const mark of marks ?? []) {
    if (mark.type === "bold") style.fontWeight = 700;
    if (mark.type === "italic") style.fontStyle = "italic";
    if (mark.type === "underline") style.textDecoration = `${style.textDecoration ?? ""} underline`.trim();
    if (mark.type === "strike") style.textDecoration = `${style.textDecoration ?? ""} line-through`.trim();
    if (mark.type === "textStyle" && typeof mark.attrs?.color === "string") style.color = mark.attrs.color;
    if (mark.type === "highlight")
      style.background = typeof mark.attrs?.color === "string" ? mark.attrs.color : "#fef08a";
  }
  return style;
}

function DocView({ node }: { node: DocNode }): ReactNode {
  const children = (node.content ?? []).map((child, index) => <DocView key={index} node={child} />);
  const align = node.attrs?.textAlign ? { textAlign: node.attrs.textAlign as CSSProperties["textAlign"] } : undefined;
  switch (node.type) {
    case "doc":
      return <>{children}</>;
    case "paragraph":
      return <p style={align}>{children.length ? children : <br />}</p>;
    case "heading":
      return <h3 style={align}>{children}</h3>;
    case "bulletList":
      return <ul>{children}</ul>;
    case "orderedList":
      return <ol start={Number(node.attrs?.start ?? 1)}>{children}</ol>;
    case "listItem":
      return <li>{children}</li>;
    case "blockquote":
      return <blockquote>{children}</blockquote>;
    case "hardBreak":
      return <br />;
    case "text":
      return node.marks?.length ? <span style={markStyle(node.marks)}>{node.text}</span> : <>{node.text}</>;
    default:
      return <>{children}</>;
  }
}

function SlideView({
  slide,
  theme,
  className,
  children,
}: {
  slide: Slide;
  theme: DeckTheme;
  className?: string;
  children?: ReactNode;
}) {
  const colors = slideColors(slide, theme);
  const boxes = SLIDE_BOXES[slide.layout];
  return (
    <div
      className={`deck-slide layout-${slide.layout} ${className ?? ""}`}
      style={{
        background: colors.background,
        color: colors.text,
        ["--deck-accent" as string]: colors.accent,
        ["--deck-muted" as string]: colors.muted,
      }}
    >
      {children ?? (
        <>
          <div
            className={`deck-box deck-title anchor-${boxes.anchor}`}
            style={{ ...box(boxes.title), fontSize: pt(boxes.titleSize) }}
          >
            <span>{slide.title}</span>
          </div>
          {boxes.bar && <div className="deck-bar" style={{ ...box(boxes.bar), background: colors.accent }} />}
          {boxes.subtitle && (
            <div className="deck-box deck-subtitle" style={{ ...box(boxes.subtitle), fontSize: pt(20) }}>
              {slide.subtitle}
            </div>
          )}
          {boxes.body && (
            <div className="deck-box deck-body" style={{ ...box(boxes.body), fontSize: pt(SLIDE_BODY_SIZE) }}>
              <DocView node={slide.body} />
            </div>
          )}
          {boxes.body2 && (
            <div className="deck-box deck-body" style={{ ...box(boxes.body2), fontSize: pt(SLIDE_BODY_SIZE) }}>
              <DocView node={slide.body2} />
            </div>
          )}
          {boxes.image && slide.image && (
            <div className="deck-box deck-image" style={box(boxes.image)}>
              <NextImage src={slide.image} alt="" fill unoptimized sizes="50vw" style={{ objectFit: "contain" }} />
            </div>
          )}
          <StaticItems items={slide.items} colors={colors} textView={(item) => <DocView node={item.body} />} />
        </>
      )}
    </div>
  );
}

// ---------- Bearbeiten ----------

function BodyEditor({
  value,
  placeholder,
  readOnly,
  autofocus,
  onChange,
  onFocus,
}: {
  value: DocNode;
  placeholder: string;
  readOnly: boolean;
  autofocus?: boolean;
  onChange: (node: DocNode) => void;
  onFocus: (editor: Editor) => void;
}) {
  const emit = useRef(onChange);
  const focus = useRef(onFocus);
  // Zuletzt selbst gemeldeter Inhalt: ein anderer Wert stammt von anderen Personen und wird übernommen.
  // Verglichen wird der Inhalt (ein leeres Textfeld bekommt bei jedem Zeichnen ein neues leeres Dokument); der
  // Anfangsinhalt gilt als bekannt, sonst überschriebe er beim Erstellen schon Getipptes.
  const emitted = useRef(stableKey(value));
  useEffect(() => {
    emit.current = onChange;
    focus.current = onFocus;
  }, [onChange, onFocus]);
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        code: false,
        codeBlock: false,
        heading: { levels: [3] },
        horizontalRule: false,
        link: false,
        blockquote: false,
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyleKit.configure({ fontFamily: false, fontSize: false, lineHeight: false, backgroundColor: false }),
      Highlight.configure({ multicolor: true }),
      Placeholder.configure({ placeholder }),
    ],
    [placeholder],
  );
  const editorProps = useMemo(
    () => ({ attributes: { class: "deck-prose", "aria-label": placeholder } }),
    [placeholder],
  );
  const editor = useEditor({
    extensions,
    content: value,
    editable: !readOnly,
    autofocus: autofocus ? "end" : false,
    immediatelyRender: false,
    editorProps,
    onUpdate: ({ editor: current, transaction }) => {
      // Änderungen anderer (beim Zusammenführen übernommen) nicht als eigene melden.
      if (transaction.getMeta(REMOTE_META)) return;
      const json = current.getJSON() as DocNode;
      emitted.current = stableKey(json);
      emit.current(json);
    },
    onFocus: ({ editor: current }) => focus.current(current),
  });
  useEffect(() => {
    if (!editor) return;
    const key = stableKey(value);
    if (key === emitted.current) return;
    emitted.current = key;
    applyContent(editor, value);
  }, [editor, value]);
  return <EditorContent editor={editor} />;
}

function AutoText({
  value,
  placeholder,
  readOnly,
  className,
  style,
  onChange,
}: {
  value: string;
  placeholder: string;
  readOnly: boolean;
  className: string;
  style: CSSProperties;
  onChange: (value: string) => void;
}) {
  return (
    <textarea
      className={className}
      style={style}
      value={value}
      placeholder={placeholder}
      readOnly={readOnly}
      aria-label={placeholder}
      rows={1}
      spellCheck
      onChange={(event) => onChange(event.target.value.replace(/\n/g, " "))}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.preventDefault();
      }}
    />
  );
}

function Presenter({
  slides,
  theme,
  start,
  onExit,
}: {
  slides: Slide[];
  theme: DeckTheme;
  start: number;
  onExit: () => void;
}) {
  const [index, setIndex] = useState(start);
  // Bisherige Folie, solange der Übergang zur neuen läuft.
  const [leaving, setLeaving] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const enterRef = useRef<HTMLDivElement>(null);
  const leaveRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    element?.focus();
    void element?.requestFullscreen?.().catch(() => undefined);
    const onFullscreen = () => {
      if (!document.fullscreenElement) onExit();
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [onExit]);
  // Übergang der Folie, die eingeblendet wird (wie in PowerPoint nur vorwärts).
  useLayoutEffect(() => {
    const transition = slides[index]?.transition;
    if (leaving === null || !transition) return;
    const animations = playTransition(transition, enterRef.current, leaveRef.current);
    if (!animations.length) {
      setLeaving(null);
      return;
    }
    void Promise.all(animations.map((animation) => animation.finished))
      .then(() => setLeaving(null))
      .catch(() => undefined);
    return () => animations.forEach((animation) => animation.cancel());
  }, [index, leaving, slides]);
  const show = (target: number) => {
    const next = Math.max(0, Math.min(slides.length - 1, target));
    if (next === index) return;
    setLeaving(next > index && slides[next].transition && !reducedMotion() ? index : null);
    setIndex(next);
  };
  const go = (delta: number) => show(index + delta);
  return createPortal(
    <div
      ref={root}
      className="deck-presenter"
      tabIndex={-1}
      role="dialog"
      aria-label="Vorführen"
      onClick={() => go(1)}
      onKeyDown={(event) => {
        if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(event.key)) {
          event.preventDefault();
          go(1);
        } else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(event.key)) {
          event.preventDefault();
          go(-1);
        } else if (event.key === "Home") show(0);
        else if (event.key === "End") show(slides.length - 1);
        else if (event.key === "Escape") onExit();
      }}
    >
      <div className="deck-presenter-stage">
        {leaving !== null && (
          <div ref={leaveRef} className="deck-presenter-layer" aria-hidden="true">
            <SlideView slide={slides[leaving]} theme={theme} />
          </div>
        )}
        <div ref={enterRef} key={index} className="deck-presenter-layer">
          <SlideView slide={slides[index]} theme={theme} />
        </div>
      </div>
      <div className="deck-presenter-bar" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => go(-1)} disabled={index === 0} aria-label="Vorherige Folie">
          <ArrowUp aria-hidden="true" style={{ transform: "rotate(-90deg)" }} />
        </button>
        <span>
          {index + 1} / {slides.length}
        </span>
        <button type="button" onClick={() => go(1)} disabled={index === slides.length - 1} aria-label="Nächste Folie">
          <ArrowDown aria-hidden="true" style={{ transform: "rotate(-90deg)" }} />
        </button>
        <button type="button" onClick={onExit} aria-label="Vorführen beenden">
          <X aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body,
  );
}

export default function DeckEditor({
  model: initial,
  onChange,
  readOnly,
  user,
  remoteRef,
  people = [],
  onPlace,
}: EditorProps<DeckModel>) {
  const [model, setModel] = useState(initial);
  const modelRef = useRef(initial);
  const [current, setCurrent] = useState(0);
  const [focused, setFocused] = useState<Editor | null>(null);
  const [presenting, setPresenting] = useState<number | null>(null);
  const [printing, setPrinting] = useState(false);
  const [undo, setUndo] = useState<{ text: string; model: DeckModel } | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [tableCell, setTableCell] = useState<{ row: number; col: number } | null>(null);
  const [dataDialog, setDataDialog] = useState<string | null>(null);
  const [freshText, setFreshText] = useState<string | null>(null);
  // Tippen direkt nach „Textfeld einfügen“: Zeichen bis zum Fokus im neuen Feld sammeln und dann einfügen.
  const typed = useRef<{ id: string; text: string; stop: () => void } | null>(null);
  function collectTyping(id: string) {
    typed.current?.stop();
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest(".ProseMirror, input, textarea, [contenteditable]")) return;
      event.preventDefault();
      if (typed.current?.id === id) typed.current.text += event.key;
    };
    const stop = () => {
      document.removeEventListener("keydown", onKey, true);
      window.clearTimeout(timer);
      if (typed.current?.id === id) typed.current = null;
    };
    const timer = window.setTimeout(stop, 3000);
    document.addEventListener("keydown", onKey, true);
    typed.current = { id, text: "", stop };
  }
  useEffect(() => () => typed.current?.stop(), []);
  // Kommentare je Folie (wie in PowerPoint): Seitenleiste offen, wenn es offene Kommentare gibt.
  const [showComments, setShowComments] = useState(() =>
    initial.slides.some((item) => item.comments?.some((thread) => !thread.resolved)),
  );
  const [commentDraft, setCommentDraft] = useState<string | null>(null);
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const emit = useRef(onChange);
  useEffect(() => {
    emit.current = onChange;
  }, [onChange]);

  const update = useCallback((next: DeckModel) => {
    modelRef.current = next;
    setModel(next);
    emit.current(next);
  }, []);
  const updateSlide = useCallback(
    (id: string, change: (slide: Slide) => Slide) => {
      const now = modelRef.current;
      update({ ...now, slides: now.slides.map((slide) => (slide.id === id ? change(slide) : slide)) });
    },
    [update],
  );

  // ---------- Übergänge ----------
  const stageRef = useRef<HTMLDivElement>(null);
  function setTransition(type: SlideTransitionType | null) {
    const slideId = modelRef.current.slides[index]?.id;
    if (!slideId) return;
    updateSlide(slideId, (item) => {
      const next = { ...item };
      if (type) next.transition = { type, speed: item.transition?.speed ?? "med" };
      else delete next.transition;
      return next;
    });
  }
  function setTransitionSpeed(speed: TransitionSpeed) {
    const slideId = modelRef.current.slides[index]?.id;
    if (!slideId) return;
    updateSlide(slideId, (item) => (item.transition ? { ...item, transition: { ...item.transition, speed } } : item));
  }
  function applyTransitionToAll() {
    const now = modelRef.current;
    const transition = now.slides[index]?.transition;
    if (!transition) return;
    update({ ...now, slides: now.slides.map((item) => ({ ...item, transition })) });
  }

  useEffect(() => {
    if (!undo) return;
    const id = window.setTimeout(() => setUndo(null), 8000);
    return () => window.clearTimeout(id);
  }, [undo]);
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

  // Gleichzeitiges Bearbeiten: zusammengeführten Stand übernehmen (die aktuelle Folie bleibt gewählt).
  useEffect(() => {
    if (!remoteRef) return;
    remoteRef.current = (next) => {
      const shown = modelRef.current.slides[Math.min(current, modelRef.current.slides.length - 1)]?.id;
      modelRef.current = next;
      setModel(next);
      const at = next.slides.findIndex((item) => item.id === shown);
      if (at >= 0) setCurrent(at);
    };
    return () => {
      remoteRef.current = null;
    };
  }, [remoteRef, current]);

  const index = Math.min(current, model.slides.length - 1);
  const slide = model.slides[index];
  const boxes = SLIDE_BOXES[slide.layout];
  const colors = slideColors(slide, model.theme);
  useEffect(() => {
    onPlace?.({ slide: slide.id });
  }, [onPlace, slide.id]);
  const item = slide.items.find((entry) => entry.id === selectedItem) ?? null;
  const chartToEdit = slide.items.find((entry) => entry.id === dataDialog && entry.type === "chart");

  const state = useEditorState({
    editor: focused,
    selector: ({ editor }) =>
      editor && !editor.isDestroyed
        ? {
            bold: editor.isActive("bold"),
            italic: editor.isActive("italic"),
            underline: editor.isActive("underline"),
            strike: editor.isActive("strike"),
            bullet: editor.isActive("bulletList"),
            ordered: editor.isActive("orderedList"),
            align: (["center", "right"] as const).find((value) => editor.isActive({ textAlign: value })) ?? "left",
            color:
              typeof editor.getAttributes("textStyle").color === "string"
                ? String(editor.getAttributes("textStyle").color)
                : null,
            highlight:
              typeof editor.getAttributes("highlight").color === "string"
                ? String(editor.getAttributes("highlight").color)
                : null,
            canUndo: editor.can().undo(),
            canRedo: editor.can().redo(),
            canSink: editor.can().sinkListItem("listItem"),
            canLift: editor.can().liftListItem("listItem"),
          }
        : null,
  });
  const text = focused && !focused.isDestroyed ? () => focused.chain().focus() : null;

  function addSlide(layout: SlideLayout) {
    const now = modelRef.current;
    const slides = [...now.slides];
    slides.splice(index + 1, 0, newSlide(layout));
    update({ ...now, slides });
    setCurrent(index + 1);
    setFocused(null);
  }
  function duplicate(at: number) {
    const now = modelRef.current;
    const slides = [...now.slides];
    const copy = { ...structuredClone(now.slides[at]), id: newId() };
    // Kopierte Kommentare bekommen eigene Nummern, sonst wären sie zweimal dieselben.
    if (copy.comments)
      copy.comments = copy.comments.map((thread) => ({
        ...thread,
        id: newId(),
        replies: thread.replies.map((reply) => ({ ...reply, id: newId() })),
      }));
    slides.splice(at + 1, 0, copy);
    update({ ...now, slides });
    setCurrent(at + 1);
  }
  function remove(at: number) {
    const now = modelRef.current;
    if (now.slides.length < 2) return;
    setUndo({ text: `Folie ${at + 1} gelöscht`, model: now });
    update({ ...now, slides: now.slides.filter((_, position) => position !== at) });
    setCurrent(Math.max(0, Math.min(at, now.slides.length - 2)));
    setFocused(null);
  }
  function moveSlide(from: number, to: number) {
    const now = modelRef.current;
    if (to < 0 || to >= now.slides.length || from === to) return;
    const slides = [...now.slides];
    const [moved] = slides.splice(from, 1);
    slides.splice(to, 0, moved);
    update({ ...now, slides });
    setCurrent(to);
  }
  // ---------- Kommentare ----------
  function startComment() {
    setShowComments(true);
    if (!readOnly) setCommentDraft(slide.id);
  }
  function changeComments(slideId: string, change: (threads: CommentThread[]) => CommentThread[]) {
    updateSlide(slideId, (item) => {
      const comments = change(item.comments ?? []);
      return { ...item, comments: comments.length ? comments : undefined };
    });
  }
  const openComments = model.slides.reduce(
    (sum, item) => sum + (item.comments ?? []).filter((thread) => !thread.resolved).length,
    0,
  );
  const commentSlide = (id: string) => model.slides.findIndex((item) => item.comments?.some((c) => c.id === id));

  async function pickImage(file: File) {
    try {
      setError("");
      const src = await imageToDataUrl(file, 1920);
      updateSlide(slide.id, (item) => ({
        ...item,
        image: src,
        layout: SLIDE_BOXES[item.layout].image ? item.layout : "image",
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Das Bild konnte nicht eingefügt werden.");
    }
  }

  // ---------- Freie Objekte ----------
  const changeItem = (next: SlideItem) =>
    updateSlide(slide.id, (current) => ({
      ...current,
      items: current.items.map((entry) => (entry.id === next.id ? next : entry)),
    }));
  function addItem(entry: NewItem) {
    const count = slide.items.length;
    if (count >= ITEM_LIMITS.items) return setError(`Höchstens ${ITEM_LIMITS.items} Objekte pro Folie.`);
    // Fokus aus der zuletzt bearbeiteten Tabellenzelle lösen (Menüs lassen ihn dort stehen).
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    // Neue Objekte mittig und leicht versetzt, damit sie nicht genau aufeinander liegen.
    const offset = (count % 6) * 182_880;
    const created = {
      ...entry,
      id: newId(),
      x: Math.min(SLIDE_SIZE.width - entry.w, Math.round((SLIDE_SIZE.width - entry.w) / 2) + offset),
      y: Math.min(SLIDE_SIZE.height - entry.h, Math.round((SLIDE_SIZE.height - entry.h) / 2) + offset),
    } as SlideItem;
    updateSlide(slide.id, (current) => ({ ...current, items: [...current.items, created] }));
    setSelectedItem(created.id);
    setTableCell(null);
    if (created.type !== "text" && created.type !== "chart") focusItem(created.id);
    return created;
  }
  // Nach dem Schliessen von Menü oder Dialog den Fokus aufs Objekt (sonst holt ihn das zuvor bearbeitete Feld zurück).
  function focusItem(id: string) {
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`.deck-item[data-item="${CSS.escape(id)}"]`)?.focus(),
    );
  }
  function addShape(shape: SlideShape) {
    addItem(
      shape === "line"
        ? { type: "shape", shape, w: 3_048_000, h: 0, fill: "", line: colors.accent, text: "" }
        : { type: "shape", shape, w: 2_286_000, h: 1_371_600, fill: colors.accent, line: "", text: "" },
    );
  }
  function addChart(chart: ChartType) {
    const created = addItem({
      type: "chart",
      chart,
      w: 5_486_400,
      h: 3_200_400,
      title: "",
      categories: [],
      series: [],
    });
    if (created) setDataDialog(created.id);
  }
  function removeItem(id: string) {
    const now = modelRef.current;
    const label = slide.items.find((entry) => entry.id === id);
    if (!label) return;
    setUndo({ text: "Objekt gelöscht", model: now });
    updateSlide(slide.id, (current) => ({ ...current, items: current.items.filter((entry) => entry.id !== id) }));
    setSelectedItem(null);
    setFocused(null);
  }
  function duplicateItem(id: string) {
    const source = slide.items.find((entry) => entry.id === id);
    if (!source || slide.items.length >= ITEM_LIMITS.items) return;
    const copy = {
      ...structuredClone(source),
      id: newId(),
      x: Math.min(SLIDE_SIZE.width - source.w, source.x + 182_880),
      y: Math.min(SLIDE_SIZE.height - source.h, source.y + 182_880),
    };
    updateSlide(slide.id, (current) => ({ ...current, items: [...current.items, copy] }));
    setSelectedItem(copy.id);
  }
  function moveLayer(id: string, direction: 1 | -1) {
    updateSlide(slide.id, (current) => {
      const items = [...current.items];
      const at = items.findIndex((entry) => entry.id === id);
      const to = at + direction;
      if (at < 0 || to < 0 || to >= items.length) return current;
      [items[at], items[to]] = [items[to], items[at]];
      return { ...current, items };
    });
  }

  const layoutLabel = SLIDE_LAYOUTS.find((item) => item.value === slide.layout)?.label ?? "";

  return (
    <div
      className="office-deck"
      onKeyDown={(event) => {
        // Ctrl+Alt+M wie in PowerPoint: Kommentar zur aktuellen Folie.
        if ((event.ctrlKey || event.metaKey) && event.altKey && event.code === "KeyM") {
          event.preventDefault();
          startComment();
        }
      }}
    >
      {!readOnly && (
        <div className="office-ribbon" role="toolbar" aria-label="Präsentation bearbeiten">
          <ToolGroup label="Rückgängig">
            <ToolButton
              label="Rückgängig"
              shortcut="Ctrl+Z"
              icon={<ArrowUUpLeft />}
              disabled={!state?.canUndo}
              onClick={() => text?.().undo().run()}
            />
            <ToolButton
              label="Wiederholen"
              shortcut="Ctrl+Y"
              icon={<ArrowUUpRight />}
              disabled={!state?.canRedo}
              onClick={() => text?.().redo().run()}
            />
          </ToolGroup>
          <ToolSeparator />
          <ToolGroup label="Folien">
            <ToolPopover
              label="Neue Folie"
              trigger={
                <span className="office-tool-label">
                  <Plus aria-hidden="true" /> Neue Folie
                </span>
              }
            >
              {(close) => (
                <MenuList
                  close={close}
                  items={SLIDE_LAYOUTS.map((item) => ({ label: item.label, onSelect: () => addSlide(item.value) }))}
                />
              )}
            </ToolPopover>
            <ToolPopover
              label="Layout"
              trigger={
                <span className="office-tool-label">
                  <Layout aria-hidden="true" /> {layoutLabel}
                </span>
              }
            >
              {(close) => (
                <MenuList
                  close={close}
                  items={SLIDE_LAYOUTS.map((item) => ({
                    label: item.label,
                    active: slide.layout === item.value,
                    onSelect: () => {
                      setFocused(null);
                      updateSlide(slide.id, (current) => ({ ...current, layout: item.value }));
                    },
                  }))}
                />
              )}
            </ToolPopover>
            <ToolPopover
              label="Design"
              trigger={
                <span className="office-tool-label">
                  <Palette aria-hidden="true" /> Design
                </span>
              }
            >
              {(close) => (
                <div className="deck-themes">
                  {(Object.keys(DECK_THEMES) as DeckTheme[]).map((theme) => (
                    <button
                      key={theme}
                      type="button"
                      className={model.theme === theme ? "active" : ""}
                      aria-pressed={model.theme === theme}
                      onClick={() => {
                        update({ ...modelRef.current, theme });
                        close();
                      }}
                    >
                      <span
                        className="deck-theme-swatch"
                        style={{ background: DECK_THEMES[theme].background, color: DECK_THEMES[theme].text }}
                      >
                        <i style={{ background: DECK_THEMES[theme].accent }} />
                        Aa
                      </span>
                      {DECK_THEMES[theme].label}
                    </button>
                  ))}
                </div>
              )}
            </ToolPopover>
            <ToolButton label="Folie duplizieren" icon={<CopySimple />} onClick={() => duplicate(index)} />
            <ToolButton
              label="Folie löschen"
              icon={<Trash />}
              className="danger"
              disabled={model.slides.length < 2}
              onClick={() => remove(index)}
            />
          </ToolGroup>
          <ToolSeparator />
          <ToolGroup label="Text">
            <ToolButton
              label="Fett"
              shortcut="Ctrl+B"
              icon={<TextB weight="bold" />}
              disabled={!text}
              active={state?.bold}
              onClick={() => text?.().toggleBold().run()}
            />
            <ToolButton
              label="Kursiv"
              shortcut="Ctrl+I"
              icon={<TextItalic />}
              disabled={!text}
              active={state?.italic}
              onClick={() => text?.().toggleItalic().run()}
            />
            <ToolButton
              label="Unterstrichen"
              shortcut="Ctrl+U"
              icon={<TextUnderline />}
              disabled={!text}
              active={state?.underline}
              onClick={() => text?.().toggleUnderline().run()}
            />
            <ToolButton
              label="Durchgestrichen"
              icon={<TextStrikethrough />}
              disabled={!text}
              active={state?.strike}
              onClick={() => text?.().toggleStrike().run()}
            />
            <ColorPicker
              label="Schriftfarbe"
              icon={<TextAUnderline />}
              current={state?.color ?? null}
              noneLabel="Automatisch"
              onPick={(color) => (color ? text?.().setColor(color).run() : text?.().unsetColor().run())}
            />
            <ColorPicker
              label="Hervorheben"
              icon={<HighlighterCircle />}
              current={state?.highlight ?? null}
              noneLabel="Keine Hervorhebung"
              onPick={(color) => (color ? text?.().setHighlight({ color }).run() : text?.().unsetHighlight().run())}
            />
          </ToolGroup>
          <ToolSeparator />
          <ToolGroup label="Absatz">
            <ToolButton
              label="Aufzählung"
              icon={<ListBullets />}
              disabled={!text}
              active={state?.bullet}
              onClick={() => focused && toggleList(focused, "bulletList", "listItem")}
            />
            <ToolButton
              label="Nummerierung"
              icon={<ListNumbers />}
              disabled={!text}
              active={state?.ordered}
              onClick={() => focused && toggleList(focused, "orderedList", "listItem")}
            />
            <ToolButton
              label="Einzug verkleinern"
              icon={<TextOutdent />}
              disabled={!state?.canLift}
              onClick={() => text?.().liftListItem("listItem").run()}
            />
            <ToolButton
              label="Einzug vergrössern"
              icon={<TextIndent />}
              disabled={!state?.canSink}
              onClick={() => text?.().sinkListItem("listItem").run()}
            />
            <ToolButton
              label="Linksbündig"
              icon={<TextAlignLeft />}
              disabled={!text}
              active={state?.align === "left"}
              onClick={() => focused && alignText(focused, "left")}
            />
            <ToolButton
              label="Zentriert"
              icon={<TextAlignCenter />}
              disabled={!text}
              active={state?.align === "center"}
              onClick={() => text?.().setTextAlign("center").run()}
            />
            <ToolButton
              label="Rechtsbündig"
              icon={<TextAlignRight />}
              disabled={!text}
              active={state?.align === "right"}
              onClick={() => text?.().setTextAlign("right").run()}
            />
          </ToolGroup>
          <ToolSeparator />
          <ToolGroup label="Einfügen">
            <ToolButton
              label="Textfeld einfügen"
              icon={<TextT />}
              onClick={() => {
                const created = addItem({ type: "text", w: 3_657_600, h: 914_400, body: emptyDoc() });
                if (!created) return;
                setFreshText(created.id);
                collectTyping(created.id);
              }}
            />
            <ToolPopover label="Form einfügen" trigger={<Shapes />}>
              {(close) => (
                <MenuList
                  close={close}
                  items={SLIDE_SHAPES.map((shape) => ({
                    label: shape.label,
                    icon: SHAPE_ICONS[shape.value],
                    onSelect: () => addShape(shape.value),
                  }))}
                />
              )}
            </ToolPopover>
            <ToolPopover label="Tabelle einfügen" trigger={<Table />}>
              {(close) => (
                <TablePicker
                  onPick={(rows, cols) => {
                    close();
                    addItem({
                      type: "table",
                      w: Math.min(10_972_800, cols * 1_828_800),
                      h: Math.min(5_029_200, rows * 411_480),
                      header: true,
                      rows: Array.from({ length: rows }, () => Array<string>(cols).fill("")),
                    });
                  }}
                />
              )}
            </ToolPopover>
            <ToolPopover label="Diagramm einfügen" trigger={<ChartBar />}>
              {(close) => (
                <MenuList
                  close={close}
                  items={(Object.keys(CHART_LABELS) as ChartType[]).map((type) => ({
                    label: CHART_LABELS[type],
                    icon: CHART_ICONS[type],
                    onSelect: () => addChart(type),
                  }))}
                />
              )}
            </ToolPopover>
            <ToolButton
              label={slide.image ? "Bild ersetzen" : "Bild einfügen"}
              icon={<ImageIcon />}
              text={slide.image ? "Bild ersetzen" : "Bild"}
              onClick={() => imageInput.current?.click()}
            />
            {slide.image && SLIDE_BOXES[slide.layout].image && (
              <ToolButton
                label="Bild entfernen"
                icon={<Trash />}
                onClick={() => updateSlide(slide.id, (item) => ({ ...item, image: "" }))}
              />
            )}
          </ToolGroup>
          <ToolSeparator />
          <ToolGroup label="Übergänge">
            <ToolPopover
              label="Übergang"
              className="office-format-picker"
              trigger={
                <span className="office-select-text">
                  {slide.transition ? SLIDE_TRANSITIONS[slide.transition.type] : "Kein Übergang"}
                </span>
              }
            >
              {(close) => (
                <MenuList
                  close={close}
                  items={[
                    {
                      label: "Kein Übergang",
                      active: !slide.transition,
                      onSelect: () => setTransition(null),
                    },
                    ...(Object.keys(SLIDE_TRANSITIONS) as SlideTransitionType[]).map((type) => ({
                      label: SLIDE_TRANSITIONS[type],
                      active: slide.transition?.type === type,
                      onSelect: () => setTransition(type),
                    })),
                  ]}
                />
              )}
            </ToolPopover>
            <ToolPopover
              label="Tempo des Übergangs"
              disabled={!slide.transition}
              trigger={
                <span className="office-select-text">{TRANSITION_SPEEDS[slide.transition?.speed ?? "med"].label}</span>
              }
            >
              {(close) => (
                <MenuList
                  close={close}
                  items={(Object.keys(TRANSITION_SPEEDS) as TransitionSpeed[]).map((speed) => ({
                    label: TRANSITION_SPEEDS[speed].label,
                    hint: `${TRANSITION_SPEEDS[speed].ms / 1000} s`.replace(".", ","),
                    active: slide.transition?.speed === speed,
                    onSelect: () => setTransitionSpeed(speed),
                  }))}
                />
              )}
            </ToolPopover>
            <ToolButton
              label="Vorschau des Übergangs"
              icon={<Play />}
              disabled={!slide.transition}
              onClick={() => slide.transition && playTransition(slide.transition, stageRef.current)}
            />
            <ToolButton
              label="Übergang für alle Folien übernehmen"
              icon={<CopySimple />}
              disabled={!slide.transition}
              onClick={applyTransitionToAll}
            />
          </ToolGroup>
          <ToolSeparator />
          <ToolGroup label="Überprüfen">
            <ToolButton
              label="Neuer Kommentar"
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
          </ToolGroup>
          <ToolSeparator />
          <ToolButton
            label="Ab aktueller Folie vorführen"
            icon={<Play weight="fill" />}
            text="Vorführen"
            className="primary"
            onClick={() => setPresenting(index)}
          />
          <input
            ref={imageInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void pickImage(file);
            }}
          />
        </div>
      )}
      {readOnly && (
        <div className="office-ribbon" role="toolbar" aria-label="Präsentation">
          <ToolButton
            label="Vorführen"
            icon={<Play weight="fill" />}
            text="Vorführen"
            className="primary"
            onClick={() => setPresenting(0)}
          />
        </div>
      )}
      {!readOnly && item && (
        <ItemBar
          item={item}
          cell={tableCell}
          onChange={changeItem}
          onRemove={() => removeItem(item.id)}
          onDuplicate={() => duplicateItem(item.id)}
          onLayer={(direction) => moveLayer(item.id, direction)}
          onEditData={() => setDataDialog(item.id)}
        />
      )}
      {error && (
        <p className="office-inline-error" role="alert">
          {error}
        </p>
      )}
      <div className={`deck-workspace ${showComments ? "with-comments" : ""}`}>
        <ol
          className="deck-rail"
          aria-label="Folien"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setCurrent(Math.min(model.slides.length - 1, index + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setCurrent(Math.max(0, index - 1));
            } else if ((event.key === "Delete" || event.key === "Backspace") && !readOnly) {
              event.preventDefault();
              remove(index);
            }
          }}
        >
          {model.slides.map((item, position) => (
            <Fragment key={item.id}>
              {dropIndex === position && dragIndex !== null && dragIndex !== position && (
                <li className="deck-drop-line" aria-hidden="true" />
              )}
              <li
                className={`deck-thumb ${position === index ? "active" : ""} ${dragIndex === position ? "dragging" : ""}`}
                draggable={!readOnly}
                onDragStart={(event) => {
                  setDragIndex(position);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", String(position));
                }}
                onDragOver={(event) => {
                  if (dragIndex === null) return;
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  setDropIndex(event.clientY > rect.top + rect.height / 2 ? position + 1 : position);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragIndex !== null && dropIndex !== null)
                    moveSlide(dragIndex, dropIndex > dragIndex ? dropIndex - 1 : dropIndex);
                  setDragIndex(null);
                  setDropIndex(null);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setDropIndex(null);
                }}
              >
                <span className="deck-thumb-number">
                  {position + 1}
                  {people
                    .filter((person) => person.place?.slide === item.id)
                    .map((person) => (
                      <span
                        key={person.session}
                        className="deck-thumb-person"
                        style={{ background: collaboratorColor(person.session) }}
                        role="img"
                        aria-label={`${person.name} ist auf dieser Folie`}
                        data-tip={`${person.name} ist auf dieser Folie`}
                      >
                        {initials(person.name)}
                      </span>
                    ))}
                  {item.comments?.some((thread) => !thread.resolved) && (
                    <span
                      className="deck-thumb-comments"
                      role="img"
                      aria-label={`${item.comments.filter((thread) => !thread.resolved).length} offene Kommentare`}
                      data-tip="Offene Kommentare"
                    >
                      <ChatCircleText weight="fill" aria-hidden="true" />
                    </span>
                  )}
                  {item.transition && (
                    <span
                      className="deck-thumb-transition"
                      role="img"
                      aria-label={`Übergang: ${SLIDE_TRANSITIONS[item.transition.type]}`}
                      data-tip={`Übergang: ${SLIDE_TRANSITIONS[item.transition.type]}`}
                    >
                      <FilmStrip aria-hidden="true" />
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="deck-thumb-button"
                  aria-label={`Folie ${position + 1}${item.title ? `: ${item.title}` : ""}`}
                  aria-current={position === index}
                  onClick={() => {
                    setCurrent(position);
                    setFocused(null);
                  }}
                >
                  <SlideView slide={item} theme={model.theme} className="thumb" />
                </button>
                {!readOnly && position === index && (
                  <span className="deck-thumb-actions">
                    <button
                      type="button"
                      aria-label="Folie nach oben"
                      data-tip="Folie nach oben"
                      disabled={position === 0}
                      onClick={() => moveSlide(position, position - 1)}
                    >
                      <ArrowUp aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label="Folie nach unten"
                      data-tip="Folie nach unten"
                      disabled={position === model.slides.length - 1}
                      onClick={() => moveSlide(position, position + 1)}
                    >
                      <ArrowDown aria-hidden="true" />
                    </button>
                  </span>
                )}
              </li>
            </Fragment>
          ))}
          {dropIndex === model.slides.length && dragIndex !== null && (
            <li className="deck-drop-line" aria-hidden="true" />
          )}
          {!readOnly && (
            <li className="deck-add">
              <button type="button" onClick={() => addSlide("content")}>
                <Plus aria-hidden="true" /> Folie
              </button>
            </li>
          )}
        </ol>
        <div className="deck-stage-wrap">
          <div
            ref={stageRef}
            className="deck-stage"
            onPointerDown={(event) => {
              if (!(event.target as HTMLElement).closest(".deck-item")) setSelectedItem(null);
            }}
          >
            <SlideView slide={slide} theme={model.theme} className="editing">
              <div
                className={`deck-box deck-title anchor-${boxes.anchor}`}
                style={{ ...box(boxes.title), fontSize: pt(boxes.titleSize) }}
              >
                <AutoText
                  key={`${slide.id}-title`}
                  className="deck-input title"
                  style={{ color: colors.text }}
                  value={slide.title}
                  placeholder={slide.layout === "title" ? "Titel der Präsentation" : "Titel eingeben"}
                  readOnly={readOnly}
                  onChange={(value) => updateSlide(slide.id, (item) => ({ ...item, title: value }))}
                />
              </div>
              {boxes.bar && <div className="deck-bar" style={{ ...box(boxes.bar), background: colors.accent }} />}
              {boxes.subtitle && (
                <div className="deck-box deck-subtitle" style={{ ...box(boxes.subtitle), fontSize: pt(20) }}>
                  <AutoText
                    key={`${slide.id}-subtitle`}
                    className="deck-input subtitle"
                    style={{ color: colors.muted }}
                    value={slide.subtitle}
                    placeholder="Untertitel eingeben"
                    readOnly={readOnly}
                    onChange={(value) => updateSlide(slide.id, (item) => ({ ...item, subtitle: value }))}
                  />
                </div>
              )}
              {boxes.body && (
                <div
                  className="deck-box deck-body editable"
                  style={{ ...box(boxes.body), fontSize: pt(SLIDE_BODY_SIZE) }}
                >
                  <BodyEditor
                    key={`${slide.id}-body`}
                    value={slide.body.content?.length ? slide.body : emptyDoc()}
                    placeholder="Text eingeben"
                    readOnly={readOnly}
                    onFocus={setFocused}
                    onChange={(node) => updateSlide(slide.id, (item) => ({ ...item, body: node }))}
                  />
                </div>
              )}
              {boxes.body2 && (
                <div
                  className="deck-box deck-body editable"
                  style={{ ...box(boxes.body2), fontSize: pt(SLIDE_BODY_SIZE) }}
                >
                  <BodyEditor
                    key={`${slide.id}-body2`}
                    value={slide.body2.content?.length ? slide.body2 : emptyDoc()}
                    placeholder="Text eingeben"
                    readOnly={readOnly}
                    onFocus={setFocused}
                    onChange={(node) => updateSlide(slide.id, (item) => ({ ...item, body2: node }))}
                  />
                </div>
              )}
              {boxes.image && (
                <div className="deck-box deck-image" style={box(boxes.image)}>
                  {slide.image ? (
                    <NextImage
                      src={slide.image}
                      alt=""
                      fill
                      unoptimized
                      sizes="50vw"
                      style={{ objectFit: "contain" }}
                    />
                  ) : (
                    !readOnly && (
                      <button type="button" className="deck-image-empty" onClick={() => imageInput.current?.click()}>
                        <ImageIcon aria-hidden="true" />
                        Bild einfügen
                      </button>
                    )
                  )}
                </div>
              )}
              <ItemLayer
                items={slide.items}
                colors={colors}
                selected={item?.id ?? null}
                readOnly={readOnly}
                onSelect={(id) => {
                  setSelectedItem(id);
                  if (id !== selectedItem) setTableCell(null);
                }}
                onChange={changeItem}
                onRemove={removeItem}
                onEditData={setDataDialog}
                onTableCell={setTableCell}
                textEditor={(entry) => (
                  <BodyEditor
                    key={`${slide.id}-${entry.id}`}
                    value={entry.body.content?.length ? entry.body : emptyDoc()}
                    placeholder="Text eingeben"
                    readOnly={readOnly}
                    autofocus={freshText === entry.id}
                    onFocus={(editor) => {
                      setFocused(editor);
                      setSelectedItem(entry.id);
                      setFreshText(null);
                      const pending = typed.current;
                      if (pending?.id !== entry.id) return;
                      pending.stop();
                      if (pending.text) editor.commands.insertContent(pending.text);
                    }}
                    onChange={(node) =>
                      updateSlide(slide.id, (current) => ({
                        ...current,
                        items: current.items.map((other) =>
                          other.id === entry.id && other.type === "text" ? { ...other, body: node } : other,
                        ),
                      }))
                    }
                  />
                )}
              />
            </SlideView>
          </div>
          <label className="deck-notes">
            <span>Notizen für die Vortragenden</span>
            <textarea
              key={`${slide.id}-notes`}
              value={slide.notes}
              readOnly={readOnly}
              placeholder="Was zu dieser Folie gesagt werden soll …"
              onChange={(event) => updateSlide(slide.id, (item) => ({ ...item, notes: event.target.value }))}
            />
          </label>
        </div>
        {showComments && (
          <CommentsPanel
            threads={model.slides.flatMap((item, position) =>
              (item.comments ?? []).map((thread) => ({ thread, label: `Folie ${position + 1}` })),
            )}
            user={user}
            readOnly={readOnly}
            draft={commentDraft === slide.id ? `Folie ${index + 1}` : null}
            active={activeComment}
            onCreate={(value) => {
              const created = newComment(user, value);
              changeComments(slide.id, (threads) => [...threads, created]);
              setActiveComment(created.id);
              setCommentDraft(null);
            }}
            onCancelDraft={() => setCommentDraft(null)}
            onChange={(thread) => {
              const at = commentSlide(thread.id);
              if (at >= 0)
                changeComments(model.slides[at].id, (threads) =>
                  threads.map((item) => (item.id === thread.id ? thread : item)),
                );
            }}
            onDelete={(id) => {
              const at = commentSlide(id);
              if (at >= 0) changeComments(model.slides[at].id, (threads) => threads.filter((item) => item.id !== id));
            }}
            onSelect={(id) => {
              const at = commentSlide(id);
              setActiveComment(id);
              if (at >= 0 && at !== index) {
                setCurrent(at);
                setFocused(null);
                setSelectedItem(null);
              }
            }}
            onClose={() => {
              setShowComments(false);
              setCommentDraft(null);
            }}
          />
        )}
      </div>
      <footer className="office-statusbar">
        <span>
          Folie {index + 1} von {model.slides.length} · {DECK_THEMES[model.theme].label}
          {openComments > 0 && (
            <>
              {" · "}
              <button type="button" className="office-status-link" onClick={() => setShowComments((value) => !value)}>
                {openComments} {openComments === 1 ? "offener Kommentar" : "offene Kommentare"}
              </button>
            </>
          )}
        </span>
        {undo && (
          <span className="office-undo" role="status">
            {undo.text}
            <button
              type="button"
              onClick={() => {
                update(undo.model);
                setUndo(null);
              }}
            >
              Rückgängig
            </button>
          </span>
        )}
      </footer>
      {chartToEdit?.type === "chart" && (
        <ChartDataDialog
          item={chartToEdit}
          onClose={() => {
            setDataDialog(null);
            focusItem(chartToEdit.id);
          }}
          onSave={(next) => {
            changeItem(next);
            setDataDialog(null);
            focusItem(next.id);
          }}
        />
      )}
      {presenting !== null && (
        <Presenter slides={model.slides} theme={model.theme} start={presenting} onExit={() => setPresenting(null)} />
      )}
      {printing && (
        <div className="office-print-only deck-print">
          {model.slides.map((item) => (
            <SlideView key={item.id} slide={item} theme={model.theme} />
          ))}
          <style>{"@media print { @page { size: A4 landscape; margin: 0; } }"}</style>
        </div>
      )}
    </div>
  );
}
