"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowCounterClockwise,
  CaretDown,
  CaretRight,
  ChatCircleDots,
  ClockCounterClockwise,
  CloudArrowUp,
  Copy,
  DotsThreeVertical,
  DownloadSimple,
  FilePlus,
  FolderOpen,
  FolderPlus,
  FolderSimple,
  HouseLine,
  Info,
  LinkSimple,
  ListBullets,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  SquaresFour,
  Trash,
  UploadSimple,
  UsersThree,
  X,
  ArrowRight,
} from "@phosphor-icons/react";
import ModulePageShell from "@/app/components/module-page-shell";
import {
  NEW_DOCUMENTS,
  TRASH_DAYS,
  fileKind,
  isTextEditable,
  prettyBytes,
  type ExplorerFile,
  type ExplorerFolder,
  type ExplorerListing,
  type ExplorerView,
  type FileScope,
  type FileVersion,
  type FolderNode,
  type NewDocumentKind,
} from "@/lib/files-shared";
import { OFFICE_TYPES, officeKindOf, type OfficeKind } from "@/lib/office/model";
import { call, download, fileUrl, loadTree, uploadOne, zipUrl, type UploadOutcome } from "./explorer-api";
import OfficeEditor from "./office/office-editor";
import { TooltipLayer } from "./office/tooltip-layer";
import {
  ConfirmDialog,
  ConflictDialog,
  FolderPickerDialog,
  NameDialog,
  NewDocumentDialog,
  NewOfficeDialog,
  PreviewDialog,
  ShareToChatDialog,
  TextEditorDialog,
  type ConflictChoice,
} from "./explorer-dialogs";
import { FileIcon, FolderIcon } from "./file-icon";

const COPY = {
  shared: {
    title: "Gemeinsame Ablage",
    lead: "Dateien und Ordner für das ganze Haus – wie der Dateibereich eines Teams.",
    route: "/c/carecore-one/ablage",
  },
  personal: {
    title: "Meine Dateien",
    lead: "Persönliche Dateien und Ordner – nur für dich sichtbar.",
    route: "/c/carecore-one/cloud",
  },
} as const;

type Item = { type: "folder"; folder: ExplorerFolder } | { type: "file"; file: ExplorerFile };
const keyOf = (item: Item) => (item.type === "folder" ? `d:${item.folder.id}` : `f:${item.file.id}`);
type SortKey = "name" | "updated" | "by" | "size";
type Dialog =
  | { kind: "folder" }
  | { kind: "document"; initial: NewDocumentKind }
  | { kind: "gallery"; office: OfficeKind }
  | { kind: "office"; file: ExplorerFile }
  | { kind: "rename"; item: Item }
  | { kind: "move" | "copy"; items: Item[] }
  | { kind: "editor"; file: ExplorerFile }
  | { kind: "preview"; file: ExplorerFile }
  | { kind: "share"; files: ExplorerFile[] }
  | { kind: "purge"; items: Item[] }
  | null;
type Menu = { item: Item; x: number; y: number } | null;
type Undo = { text: string; items: Item[] } | null;
type Conflict = {
  name: string;
  remaining: number;
  canReplace: boolean;
  resolve: (choice: ConflictChoice, all: boolean) => void;
};

const DRAG_TYPE = "application/x-carecore-files";
const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("de-CH", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "–";
const relative = (value: string) => {
  const minutes = Math.round((Date.now() - Date.parse(value)) / 60_000);
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} Min.`;
  if (minutes < 24 * 60 && new Date(value).toDateString() === new Date().toDateString())
    return `heute, ${new Intl.DateTimeFormat("de-CH", { timeStyle: "short" }).format(new Date(value))}`;
  return formatDate(value);
};

export default function FileExplorer({ scope }: { scope: FileScope }) {
  const copy = COPY[scope];
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const folderParam = params.get("folder");
  const fileParam = params.get("file");
  const [view, setView] = useState<ExplorerView>("folder");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<ExplorerListing | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [layout, setLayout] = useState<"list" | "tiles">("list");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const [details, setDetails] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [newMenu, setNewMenu] = useState(false);
  const [tree, setTree] = useState<FolderNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dragFiles, setDragFiles] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [undo, setUndo] = useState<Undo>(null);
  const [notice, setNotice] = useState("");
  const [versionList, setVersionList] = useState<{ key: string; list: FileVersion[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<number | null>(null);

  useEffect(() => {
    // Gewählte Darstellung (Liste/Kacheln) je Gerät merken.
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem("carecore-files-layout");
        if (stored === "tiles" || stored === "list") setLayout(stored);
      } catch {}
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    // Ordner für Ordner hochladen (der Browser liefert die Pfade mit).
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);

  const listUrl = useCallback(() => {
    const search = new URLSearchParams({ scope });
    if (view !== "folder") search.set("view", view);
    if (view === "search") search.set("q", query);
    if (view === "folder" && folderParam) search.set("folder", folderParam);
    return `/api/cloud/files?${search}`;
  }, [scope, view, query, folderParam]);

  const openedLink = useRef<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const [listing, folders] = await Promise.all([call<ExplorerListing>(listUrl()), loadTree(scope)]);
      setData(listing);
      setTree(folders);
      setError("");
      // Pfad zum geöffneten Ordner im Baum aufklappen.
      setExpanded((current) => {
        const next = new Set(current);
        listing.path.forEach((crumb) => crumb.id && next.add(crumb.id));
        return next;
      });
      // Link auf eine Datei (?file=) öffnet sie direkt – einmal je Link.
      const linked = fileParam ? listing.files.find((item) => item.id === fileParam) : null;
      if (linked && openedLink.current !== linked.id) {
        openedLink.current = linked.id;
        setDialog(
          officeKindOf(linked.name)
            ? { kind: "office", file: linked }
            : isTextEditable(linked)
              ? { kind: "editor", file: linked }
              : { kind: "preview", file: linked },
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die Ablage konnte nicht geladen werden.");
      // Ordner nicht (mehr) vorhanden: zurück zur obersten Ebene.
      if (folderParam && view === "folder") router.replace(pathname);
    } finally {
      setLoading(false);
    }
  }, [listUrl, scope, folderParam, fileParam, view, router, pathname]);

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload]);
  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), 9000);
    return () => window.clearTimeout(timer);
  }, [undo]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const items: Item[] = useMemo(() => {
    if (!data) return [];
    const folders = data.folders.map((folder) => ({ type: "folder", folder }) as Item);
    const files = data.files.map((file) => ({ type: "file", file }) as Item);
    const value = (item: Item) => {
      const entry = item.type === "folder" ? item.folder : item.file;
      if (sort.key === "updated") return entry.updatedAt;
      if (sort.key === "size") return item.type === "file" ? item.file.sizeBytes : -1;
      if (sort.key === "by") return (item.type === "file" ? item.file.updatedByName : item.folder.createdByName) ?? "";
      return entry.name;
    };
    const compare = (a: Item, b: Item) => {
      const left = value(a);
      const right = value(b);
      const result =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right), "de-CH", { numeric: true });
      return result * sort.dir;
    };
    // Wie gewohnt: Ordner zuerst; „Zuletzt verwendet“ bleibt nach Datum.
    if (view === "recent") return files;
    return [...folders.sort(compare), ...files.sort(compare)];
  }, [data, sort, view]);

  const chosen = items.filter((item) => selected.has(keyOf(item)));
  const single = chosen.length === 1 ? chosen[0] : null;
  const chosenFiles = chosen.flatMap((item) => (item.type === "file" ? [item.file] : []));
  const chosenFolders = chosen.flatMap((item) => (item.type === "folder" ? [item.folder] : []));
  const canEditChosen =
    chosen.length > 0 && chosen.every((item) => (item.type === "file" ? item.file.canEdit : item.folder.canEdit));
  const currentFolderId = view === "folder" ? (data?.folder?.id ?? null) : null;
  const inTrash = view === "trash";

  // Versionen im Detailbereich (eine Datei gewählt).
  const detailFile = single?.type === "file" ? single.file : null;
  const versionKey = detailFile ? `${detailFile.id}:${detailFile.versionNo}` : "";
  const versions = versionList?.key === versionKey ? versionList.list : null;
  useEffect(() => {
    if (!details || !versionKey || inTrash) return;
    const [id] = versionKey.split(":");
    call<{ versions: FileVersion[] }>(`/api/cloud/files/${id}?versions=1`)
      .then((result) => setVersionList({ key: versionKey, list: result.versions }))
      .catch(() => setVersionList({ key: versionKey, list: [] }));
  }, [details, versionKey, inTrash]);

  function changeView(next: ExplorerView) {
    setView(next);
    setSelected(new Set());
  }
  function openFolder(id: string | null) {
    setSelected(new Set());
    setView("folder");
    setQuery("");
    router.replace(id ? `${pathname}?folder=${id}` : pathname);
  }
  function openItem(item: Item) {
    if (inTrash) return;
    if (item.type === "folder") return openFolder(item.folder.id);
    const file = item.file;
    if (officeKindOf(file.name)) return setDialog({ kind: "office", file });
    if (isTextEditable(file)) return setDialog({ kind: "editor", file });
    const type = file.mimeType.toLowerCase();
    if (
      type.startsWith("image/") ||
      type.startsWith("video/") ||
      type.startsWith("audio/") ||
      type === "application/pdf"
    )
      return setDialog({ kind: "preview", file });
    download(fileUrl(file.id));
  }
  function select(item: Item, event?: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) {
    const key = keyOf(item);
    if (event?.shiftKey && anchor) {
      const keys = items.map(keyOf);
      const [from, to] = [keys.indexOf(anchor), keys.indexOf(key)].sort((a, b) => a - b);
      setSelected(new Set(keys.slice(from, to + 1)));
      return;
    }
    if (event?.metaKey || event?.ctrlKey) {
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    } else setSelected(new Set([key]));
    setAnchor(key);
  }
  function toggle(item: Item) {
    const key = keyOf(item);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setAnchor(key);
  }

  async function run(task: () => Promise<unknown>, success?: string) {
    try {
      await task();
      if (success) setNotice(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Das hat nicht geklappt.");
    }
    await reload();
  }

  async function patchItem(item: Item, body: Record<string, unknown>) {
    return item.type === "folder"
      ? call(`/api/cloud/folders/${item.folder.id}`, { method: "PATCH", json: body })
      : call(`/api/cloud/files/${item.file.id}`, { method: "PATCH", json: body });
  }

  async function trash(list: Item[]) {
    if (!list.length) return;
    await run(async () => {
      for (const item of list) await patchItem(item, { action: "trash" });
      setUndo({
        text: list.length === 1 ? `„${nameOf(list[0])}“ im Papierkorb` : `${list.length} Elemente im Papierkorb`,
        items: list,
      });
      setSelected(new Set());
    });
  }
  async function restore(list: Item[]) {
    await run(
      async () => {
        for (const item of list) await patchItem(item, { action: "restore" });
        setSelected(new Set());
      },
      list.length === 1 ? `„${nameOf(list[0])}“ wiederhergestellt` : `${list.length} Elemente wiederhergestellt`,
    );
  }
  async function moveTo(list: Item[], folderId: string | null) {
    const moving = list.filter((item) =>
      item.type === "folder" ? item.folder.id !== folderId : item.file.folderId !== folderId,
    );
    if (!moving.length) return;
    await run(
      async () => {
        for (const item of moving)
          await patchItem(item, item.type === "folder" ? { parentId: folderId } : { folderId });
        setSelected(new Set());
      },
      moving.length === 1 ? `„${nameOf(moving[0])}“ verschoben` : `${moving.length} Elemente verschoben`,
    );
  }

  // Hochladen (auch ganze Ordner); bei gleichem Namen Rückfrage wie im Explorer.
  async function uploadAll(list: File[], folderId: string | null, withPaths = false) {
    if (!list.length) return;
    let remembered: ConflictChoice | null = null;
    const folderIds = new Map<string, string>();
    let uploaded = 0;
    try {
      if (withPaths) {
        for (const folder of await loadTree(scope))
          folderIds.set(`${folder.parentId ?? ""}|${folder.name.toLocaleLowerCase("de-CH")}`, folder.id);
      }
      for (const [index, file] of list.entries()) {
        setProgress({ done: index, total: list.length, name: file.name });
        let target = folderId;
        if (withPaths && file.webkitRelativePath) {
          for (const part of file.webkitRelativePath.split("/").slice(0, -1)) {
            const key = `${target ?? ""}|${part.toLocaleLowerCase("de-CH")}`;
            let id = folderIds.get(key);
            if (!id) {
              id = (
                await call<{ id: string }>("/api/cloud/folders", {
                  method: "POST",
                  json: { scope, parentId: target, name: part },
                })
              ).id;
              folderIds.set(key, id);
            }
            target = id;
          }
        }
        const ask = (existing: { id: string; name: string }) =>
          remembered ??
          new Promise<ConflictChoice>((resolve) =>
            setConflict({
              name: existing.name,
              remaining: list.length - index - 1,
              canReplace: data?.files.find((item) => item.id === existing.id)?.canEdit ?? true,
              resolve: (value, all) => {
                if (all) remembered = value;
                setConflict(null);
                resolve(value);
              },
            }),
          );
        // Gleicher Name im geöffneten Ordner: vorher fragen (ohne Umweg über eine Fehlermeldung des Servers).
        const known =
          target === currentFolderId
            ? data?.files.find((item) => item.name.toLocaleLowerCase("de-CH") === file.name.toLocaleLowerCase("de-CH"))
            : undefined;
        let mode: ConflictChoice | undefined = known ? await ask(known) : undefined;
        if (mode === "skip") continue;
        let outcome: UploadOutcome = await uploadOne(file, scope, target, mode);
        if (outcome.kind === "conflict") {
          mode = await ask(outcome.existing);
          if (mode === "skip") continue;
          outcome = await uploadOne(file, scope, target, mode);
        }
        if (outcome.kind === "done") uploaded += 1;
      }
      if (uploaded) setNotice(uploaded === 1 ? "1 Datei hochgeladen" : `${uploaded} Dateien hochgeladen`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Hochladen fehlgeschlagen.");
    } finally {
      setProgress(null);
      if (fileInput.current) fileInput.current.value = "";
      if (folderInput.current) folderInput.current.value = "";
      await reload();
    }
  }

  function copyLink(item: Item) {
    const url = new URL(copy.route, window.location.origin);
    if (item.type === "folder") url.searchParams.set("folder", item.folder.id);
    else {
      if (item.file.folderId) url.searchParams.set("folder", item.file.folderId);
      url.searchParams.set("file", item.file.id);
    }
    void navigator.clipboard
      .writeText(url.toString())
      .then(() => setNotice("Link kopiert – öffnet sich für alle mit Zugriff auf diese Ablage"))
      .catch(() => setError("Link konnte nicht kopiert werden."));
  }

  function downloadItems(list: Item[]) {
    const files = list.flatMap((item) => (item.type === "file" ? [item.file.id] : []));
    const folders = list.flatMap((item) => (item.type === "folder" ? [item.folder.id] : []));
    if (files.length === 1 && !folders.length) return download(fileUrl(files[0]));
    download(zipUrl(scope, files, folders));
  }

  // Tastatur wie im Explorer: Entf, F2, Strg+A, Esc.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (dialog || conflict) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable]")) return;
      if (event.key === "Delete" && chosen.length && canEditChosen && !inTrash) {
        event.preventDefault();
        void trash(chosen);
      } else if (event.key === "F2" && single && canEditChosen && !inTrash) {
        event.preventDefault();
        setDialog({ kind: "rename", item: single });
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelected(new Set(items.map(keyOf)));
      } else if (event.key === "Escape") {
        setSelected(new Set());
        setMenu(null);
        setNewMenu(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Ziehen und Ablegen: Dateien vom Computer hochladen, Elemente in Ordner verschieben.
  const internalDrag = (event: DragEvent) => event.dataTransfer.types.includes(DRAG_TYPE);
  const externalDrag = (event: DragEvent) => event.dataTransfer.types.includes("Files");
  function dropOn(folderId: string | null) {
    return {
      onDragOver: (event: DragEvent) => {
        if (inTrash || (!internalDrag(event) && !externalDrag(event))) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = internalDrag(event) ? "move" : "copy";
        setDropTarget(folderId ?? "root");
      },
      onDragLeave: () => setDropTarget(null),
      onDrop: (event: DragEvent) => {
        event.preventDefault();
        event.stopPropagation();
        setDropTarget(null);
        setDragFiles(false);
        if (internalDrag(event)) {
          const keys = JSON.parse(event.dataTransfer.getData(DRAG_TYPE) || "[]") as string[];
          const list = items.filter((item) => keys.includes(keyOf(item)));
          if (list.some((item) => item.type === "folder" && item.folder.id === folderId)) return;
          void moveTo(list, folderId);
        } else if (event.dataTransfer.files.length) void uploadAll(Array.from(event.dataTransfer.files), folderId);
      },
    };
  }
  function dragFrom(item: Item) {
    return {
      draggable: !inTrash && (item.type === "file" ? item.file.canEdit : item.folder.canEdit),
      onDragStart: (event: DragEvent) => {
        const keys = selected.has(keyOf(item)) ? [...selected] : [keyOf(item)];
        if (!selected.has(keyOf(item))) setSelected(new Set(keys));
        event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(keys));
        event.dataTransfer.effectAllowed = "move";
      },
    };
  }

  function contextMenu(item: Item, event: MouseEvent) {
    event.preventDefault();
    if (!selected.has(keyOf(item))) select(item);
    setMenu({ item, x: event.clientX, y: event.clientY });
  }

  const tiles = layout === "tiles";
  const sortButton = (key: SortKey, label: string) => (
    <button
      type="button"
      className={sort.key === key ? "active" : ""}
      aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
      onClick={() =>
        setSort((current) => ({
          key,
          dir: current.key === key ? (current.dir === 1 ? -1 : 1) : key === "name" ? 1 : -1,
        }))
      }
    >
      {label}
      {sort.key === key && <CaretDown className={sort.dir === 1 ? "" : "up"} aria-hidden="true" />}
    </button>
  );

  const heading =
    view === "trash"
      ? "Papierkorb"
      : view === "recent"
        ? "Zuletzt geändert"
        : view === "search"
          ? `Suche: „${query}“`
          : (data?.folder?.name ?? copy.title);

  return (
    <ModulePageShell activeModule="cloud" activeChild={copy.title} pageClass="cloud-page files-page">
      {() => (
        <main className="workspace files-workspace">
          <header className="page-heading">
            <div className="heading-copy">
              <p className="eyebrow">Ablage</p>
              <h1>{copy.title}</h1>
              <p>{copy.lead}</p>
            </div>
            <button
              className="primary-button"
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={!!progress}
            >
              <UploadSimple aria-hidden="true" />
              Hochladen
            </button>
          </header>
          <input
            ref={fileInput}
            className="cloud-file-input"
            type="file"
            multiple
            aria-label="Dateien auswählen"
            onChange={(event) => void uploadAll(Array.from(event.target.files ?? []), currentFolderId)}
          />
          <input
            ref={folderInput}
            className="cloud-file-input"
            type="file"
            multiple
            aria-label="Ordner auswählen"
            onChange={(event) => void uploadAll(Array.from(event.target.files ?? []), currentFolderId, true)}
          />

          <section className="files-shell card">
            <aside className="files-nav" aria-label="Ablage">
              <nav className="files-places">
                <a className={scope === "shared" ? "active" : ""} href={COPY.shared.route}>
                  <UsersThree weight="duotone" aria-hidden="true" />
                  Gemeinsame Ablage
                </a>
                <a className={scope === "personal" ? "active" : ""} href={COPY.personal.route}>
                  <HouseLine weight="duotone" aria-hidden="true" />
                  Meine Dateien
                </a>
              </nav>
              <div className="files-views" role="group" aria-label="Ansicht">
                <button type="button" className={view === "folder" ? "active" : ""} onClick={() => openFolder(null)}>
                  <FolderOpen aria-hidden="true" />
                  Alle Dateien
                </button>
                <button
                  type="button"
                  className={view === "recent" ? "active" : ""}
                  onClick={() => changeView("recent")}
                >
                  <ClockCounterClockwise aria-hidden="true" />
                  Zuletzt geändert
                </button>
                <button type="button" className={view === "trash" ? "active" : ""} onClick={() => changeView("trash")}>
                  <Trash aria-hidden="true" />
                  Papierkorb
                </button>
              </div>
              <p className="files-nav-label">Ordner</p>
              <FolderTree
                folders={tree}
                active={currentFolderId}
                expanded={expanded}
                dropTarget={dropTarget}
                onToggle={(id) =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                onOpen={openFolder}
                dropOn={dropOn}
              />
              <p className="files-usage">
                {data
                  ? `${data.totalFiles} ${data.totalFiles === 1 ? "Datei" : "Dateien"} · ${prettyBytes(data.totalBytes)}`
                  : " "}
                <small>bis 4 MB je Datei</small>
              </p>
            </aside>

            <div
              className={`files-main ${dragFiles ? "is-dropping" : ""}`}
              {...dropOn(currentFolderId)}
              onDragEnter={(event) => externalDrag(event) && !inTrash && setDragFiles(true)}
              onDragLeave={(event) => {
                setDropTarget(null);
                if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragFiles(false);
              }}
            >
              <div className="files-commands" role="toolbar" aria-label="Befehle">
                {inTrash ? (
                  <>
                    <button
                      type="button"
                      className="files-command"
                      disabled={!chosen.length || !canEditChosen}
                      onClick={() => void restore(chosen)}
                    >
                      <ArrowCounterClockwise aria-hidden="true" />
                      Wiederherstellen
                    </button>
                    <button
                      type="button"
                      className="files-command danger"
                      disabled={!chosen.length || !canEditChosen}
                      onClick={() => setDialog({ kind: "purge", items: chosen })}
                    >
                      <Trash aria-hidden="true" />
                      Endgültig löschen
                    </button>
                    <span className="files-trash-hint">
                      Elemente im Papierkorb werden nach {TRASH_DAYS} Tagen endgültig gelöscht.
                    </span>
                  </>
                ) : chosen.length ? (
                  <>
                    <button type="button" className="files-command" onClick={() => downloadItems(chosen)}>
                      <DownloadSimple aria-hidden="true" />
                      Herunterladen
                    </button>
                    {chosenFiles.length > 0 && !chosenFolders.length && (
                      <button
                        type="button"
                        className="files-command"
                        onClick={() => setDialog({ kind: "share", files: chosenFiles })}
                      >
                        <ChatCircleDots aria-hidden="true" />
                        Im Chat teilen
                      </button>
                    )}
                    {single && (
                      <button type="button" className="files-command" onClick={() => copyLink(single)}>
                        <LinkSimple aria-hidden="true" />
                        Link kopieren
                      </button>
                    )}
                    {single && canEditChosen && (
                      <button
                        type="button"
                        className="files-command"
                        onClick={() => setDialog({ kind: "rename", item: single })}
                      >
                        <PencilSimple aria-hidden="true" />
                        Umbenennen
                      </button>
                    )}
                    {canEditChosen && (
                      <button
                        type="button"
                        className="files-command"
                        onClick={() => setDialog({ kind: "move", items: chosen })}
                      >
                        <ArrowRight aria-hidden="true" />
                        Verschieben
                      </button>
                    )}
                    {!chosenFolders.length && (
                      <button
                        type="button"
                        className="files-command"
                        onClick={() => setDialog({ kind: "copy", items: chosen })}
                      >
                        <Copy aria-hidden="true" />
                        Kopieren
                      </button>
                    )}
                    {scope === "personal" && chosenFiles.length > 0 && !chosenFolders.length && (
                      <button
                        type="button"
                        className="files-command"
                        onClick={() =>
                          void run(async () => {
                            for (const file of chosenFiles)
                              await call(`/api/cloud/files/${file.id}`, { method: "PATCH", json: { share: true } });
                            setSelected(new Set());
                          }, "In die gemeinsame Ablage verschoben")
                        }
                      >
                        <UsersThree aria-hidden="true" />
                        Mit dem Haus teilen
                      </button>
                    )}
                    {canEditChosen && (
                      <button type="button" className="files-command danger" onClick={() => void trash(chosen)}>
                        <Trash aria-hidden="true" />
                        Löschen
                      </button>
                    )}
                    <span className="files-selection">
                      {chosen.length} ausgewählt
                      <button
                        type="button"
                        aria-label="Auswahl aufheben"
                        data-tip="Auswahl aufheben"
                        onClick={() => setSelected(new Set())}
                      >
                        <X aria-hidden="true" />
                      </button>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="files-new">
                      <button
                        type="button"
                        className="files-command primary"
                        aria-expanded={newMenu}
                        aria-haspopup="menu"
                        disabled={view !== "folder"}
                        onClick={() => setNewMenu((open) => !open)}
                      >
                        <Plus weight="bold" aria-hidden="true" />
                        Neu
                        <CaretDown aria-hidden="true" />
                      </button>
                      {newMenu && (
                        <span className="files-menu" role="menu" onMouseLeave={() => setNewMenu(false)}>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setNewMenu(false);
                              setDialog({ kind: "folder" });
                            }}
                          >
                            <FolderPlus aria-hidden="true" />
                            Ordner
                          </button>
                          <span className="files-menu-separator" role="separator" />
                          {(Object.keys(OFFICE_TYPES) as OfficeKind[]).map((kind) => (
                            <button
                              key={kind}
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setNewMenu(false);
                                setDialog({ kind: "gallery", office: kind });
                              }}
                            >
                              <FileIcon
                                file={{
                                  name: `x.${OFFICE_TYPES[kind].extension}`,
                                  mimeType: OFFICE_TYPES[kind].mimeType,
                                }}
                              />
                              <span className="files-menu-text">
                                {OFFICE_TYPES[kind].label}
                                <small>
                                  {kind === "document" ? "Word" : kind === "sheet" ? "Excel" : "PowerPoint"}
                                </small>
                              </span>
                            </button>
                          ))}
                          <span className="files-menu-separator" role="separator" />
                          {(Object.keys(NEW_DOCUMENTS) as NewDocumentKind[]).map((kind) => (
                            <button
                              key={kind}
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setNewMenu(false);
                                setDialog({ kind: "document", initial: kind });
                              }}
                            >
                              <FileIcon
                                file={{
                                  name: `x.${NEW_DOCUMENTS[kind].extension}`,
                                  mimeType: NEW_DOCUMENTS[kind].mimeType,
                                }}
                              />
                              {NEW_DOCUMENTS[kind].label}
                            </button>
                          ))}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="files-command"
                      disabled={view !== "folder"}
                      onClick={() => fileInput.current?.click()}
                    >
                      <UploadSimple aria-hidden="true" />
                      Dateien hochladen
                    </button>
                    <button
                      type="button"
                      className="files-command"
                      disabled={view !== "folder"}
                      onClick={() => folderInput.current?.click()}
                    >
                      <FilePlus aria-hidden="true" />
                      Ordner hochladen
                    </button>
                    {view === "folder" && data?.folder?.id && (
                      <button
                        type="button"
                        className="files-command"
                        onClick={() => download(zipUrl(scope, [], [data.folder!.id!]))}
                      >
                        <DownloadSimple aria-hidden="true" />
                        Ordner herunterladen
                      </button>
                    )}
                  </>
                )}
                <span className="files-command-end">
                  <label className="files-search">
                    <MagnifyingGlass aria-hidden="true" />
                    <input
                      value={query}
                      placeholder="Suchen"
                      aria-label="Dateien und Ordner suchen"
                      onChange={(event) => {
                        const value = event.target.value;
                        setQuery(value);
                        if (searchTimer.current) window.clearTimeout(searchTimer.current);
                        searchTimer.current = window.setTimeout(
                          () => changeView(value.trim() ? "search" : "folder"),
                          250,
                        );
                      }}
                    />
                  </label>
                  <span className="files-layout" role="group" aria-label="Darstellung">
                    {(["list", "tiles"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={layout === mode}
                        aria-label={mode === "list" ? "Liste" : "Kacheln"}
                        data-tip={mode === "list" ? "Als Liste anzeigen" : "Als Kacheln anzeigen"}
                        title={mode === "list" ? "Liste" : "Kacheln"}
                        onClick={() => {
                          setLayout(mode);
                          try {
                            window.localStorage.setItem("carecore-files-layout", mode);
                          } catch {}
                        }}
                      >
                        {mode === "list" ? <ListBullets aria-hidden="true" /> : <SquaresFour aria-hidden="true" />}
                      </button>
                    ))}
                  </span>
                  <button
                    type="button"
                    className={`files-details-toggle ${details ? "active" : ""}`}
                    aria-pressed={details}
                    onClick={() => setDetails((open) => !open)}
                  >
                    <Info aria-hidden="true" />
                    Details
                  </button>
                </span>
              </div>

              {progress && (
                <div className="files-progress" role="status">
                  <span>
                    Wird hochgeladen: <strong>{progress.name}</strong> ({progress.done + 1} von {progress.total})
                  </span>
                  <i>
                    <b style={{ width: `${Math.round(((progress.done + 0.5) / progress.total) * 100)}%` }} />
                  </i>
                </div>
              )}
              {error && (
                <p className="files-error" role="alert">
                  {error}
                  <button type="button" aria-label="Hinweis schliessen" onClick={() => setError("")}>
                    <X aria-hidden="true" />
                  </button>
                </p>
              )}

              <div className="files-title-row">
                {view === "folder" ? (
                  <nav className="files-breadcrumb" aria-label="Pfad">
                    {(data?.path ?? [{ id: null, name: copy.title }]).map((crumb, index, path) => (
                      <span key={crumb.id ?? "root"}>
                        {index > 0 && <CaretRight aria-hidden="true" />}
                        {index === path.length - 1 ? (
                          <strong aria-current="page">{crumb.name}</strong>
                        ) : (
                          <button
                            type="button"
                            className={dropTarget === (crumb.id ?? "root") ? "is-drop" : ""}
                            onClick={() => openFolder(crumb.id)}
                            {...dropOn(crumb.id)}
                          >
                            {crumb.name}
                          </button>
                        )}
                      </span>
                    ))}
                  </nav>
                ) : (
                  <h2>{heading}</h2>
                )}
                <span className="files-count">
                  {items.length} {items.length === 1 ? "Element" : "Elemente"}
                </span>
              </div>

              <div className={`files-body ${details ? "with-details" : ""}`}>
                <div
                  className="files-content"
                  onClick={(event) => event.target === event.currentTarget && setSelected(new Set())}
                >
                  {loading ? (
                    <div className="files-empty">Ablage wird geladen …</div>
                  ) : !items.length ? (
                    <div className="files-empty">
                      <span className="files-empty-icon">
                        {inTrash ? <Trash aria-hidden="true" /> : <CloudArrowUp aria-hidden="true" />}
                      </span>
                      <strong>
                        {inTrash
                          ? "Der Papierkorb ist leer"
                          : view === "search"
                            ? "Nichts gefunden"
                            : view === "recent"
                              ? "Noch keine Dateien"
                              : "Dieser Ordner ist leer"}
                      </strong>
                      <p>
                        {inTrash
                          ? "Gelöschte Dateien und Ordner lassen sich hier 30 Tage lang wiederherstellen."
                          : view === "search"
                            ? "Anderen Suchbegriff versuchen."
                            : "Dateien hierher ziehen oder über „Neu“ einen Ordner oder ein Dokument anlegen."}
                      </p>
                      {view === "folder" && (
                        <button className="secondary-button" type="button" onClick={() => fileInput.current?.click()}>
                          <UploadSimple aria-hidden="true" />
                          Dateien hochladen
                        </button>
                      )}
                    </div>
                  ) : tiles ? (
                    <div className="files-tiles" role="grid" aria-label="Dateien und Ordner">
                      {items.map((item) => {
                        const key = keyOf(item);
                        const active = selected.has(key);
                        const folderId = item.type === "folder" ? item.folder.id : null;
                        return (
                          <div
                            key={key}
                            role="gridcell"
                            aria-selected={active}
                            className={`files-tile ${active ? "selected" : ""} ${folderId && dropTarget === folderId ? "is-drop" : ""}`}
                            onClick={(event) => select(item, event)}
                            onDoubleClick={() => openItem(item)}
                            onContextMenu={(event) => contextMenu(item, event)}
                            {...dragFrom(item)}
                            {...(folderId ? dropOn(folderId) : {})}
                          >
                            <input
                              type="checkbox"
                              className="files-check-box"
                              checked={active}
                              aria-label={`${nameOf(item)} auswählen`}
                              onClick={(event) => event.stopPropagation()}
                              onChange={() => toggle(item)}
                            />
                            <span className="files-tile-visual">
                              {item.type === "folder" ? (
                                <FolderIcon large />
                              ) : item.file.mimeType.startsWith("image/") && !inTrash ? (
                                <Image src={fileUrl(item.file.id, true)} alt="" width={176} height={112} unoptimized />
                              ) : (
                                <FileIcon file={item.file} large />
                              )}
                            </span>
                            <button
                              type="button"
                              className="files-tile-name"
                              onClick={(event) => {
                                event.stopPropagation();
                                openItem(item);
                              }}
                            >
                              {nameOf(item)}
                            </button>
                            <small>
                              {item.type === "folder"
                                ? elementCount(item.folder.itemCount)
                                : relative(item.file.updatedAt)}
                            </small>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <table className="files-table">
                      <thead>
                        <tr>
                          <th className="files-col-check">
                            <input
                              type="checkbox"
                              aria-label="Alle auswählen"
                              checked={items.length > 0 && chosen.length === items.length}
                              onChange={(event) =>
                                setSelected(event.target.checked ? new Set(items.map(keyOf)) : new Set())
                              }
                            />
                          </th>
                          <th>{sortButton("name", "Name")}</th>
                          {view !== "folder" && (
                            <th className="files-col-path">{inTrash ? "Ursprünglicher Ort" : "Ort"}</th>
                          )}
                          <th className="files-col-date">{inTrash ? "Gelöscht" : sortButton("updated", "Geändert")}</th>
                          <th className="files-col-by">{sortButton("by", "Geändert von")}</th>
                          <th className="files-col-size">{sortButton("size", "Grösse")}</th>
                          <th className="files-col-menu">
                            <span className="sr-only">Aktionen</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item) => {
                          const key = keyOf(item);
                          const active = selected.has(key);
                          const folderId = item.type === "folder" ? item.folder.id : null;
                          const entry = item.type === "folder" ? item.folder : item.file;
                          return (
                            <tr
                              key={key}
                              aria-selected={active}
                              className={`${active ? "selected" : ""} ${folderId && dropTarget === folderId ? "is-drop" : ""}`}
                              onClick={(event) => select(item, event)}
                              onDoubleClick={() => openItem(item)}
                              onContextMenu={(event) => contextMenu(item, event)}
                              {...dragFrom(item)}
                              {...(folderId ? dropOn(folderId) : {})}
                            >
                              <td className="files-col-check">
                                <input
                                  type="checkbox"
                                  checked={active}
                                  aria-label={`${entry.name} auswählen`}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={() => toggle(item)}
                                />
                              </td>
                              <td>
                                <span className="files-name">
                                  {item.type === "folder" ? <FolderIcon /> : <FileIcon file={item.file} />}
                                  <button
                                    type="button"
                                    className="files-name-link"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openItem(item);
                                    }}
                                  >
                                    {entry.name}
                                  </button>
                                  {item.type === "file" && item.file.versionNo > 1 && (
                                    <em className="files-version" data-tip="Aktuelle Version">
                                      V{item.file.versionNo}
                                    </em>
                                  )}
                                </span>
                              </td>
                              {view !== "folder" && <td className="files-col-path">{entry.path}</td>}
                              <td className="files-col-date">
                                {inTrash ? formatDate(entry.deletedAt) : relative(entry.updatedAt)}
                              </td>
                              <td className="files-col-by">
                                {(item.type === "file" ? item.file.updatedByName : item.folder.createdByName) ??
                                  (scope === "personal" ? "Du" : "–")}
                              </td>
                              <td className="files-col-size">
                                {item.type === "file"
                                  ? prettyBytes(item.file.sizeBytes)
                                  : elementCount(item.folder.itemCount)}
                              </td>
                              <td className="files-col-menu">
                                <button
                                  type="button"
                                  className="files-row-menu"
                                  aria-label={`Aktionen für ${entry.name}`}
                                  data-tip="Weitere Aktionen"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (!selected.has(key)) select(item);
                                    const box = event.currentTarget.getBoundingClientRect();
                                    setMenu({ item, x: box.right, y: box.bottom });
                                  }}
                                >
                                  <DotsThreeVertical weight="bold" aria-hidden="true" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                  {dragFiles && (
                    <div className="files-drop-hint" aria-hidden="true">
                      <CloudArrowUp />
                      <strong>Zum Hochladen loslassen</strong>
                      <span>in „{data?.folder?.name ?? copy.title}“</span>
                    </div>
                  )}
                </div>

                {details && (
                  <aside className="files-details" aria-label="Details">
                    {single ? (
                      <>
                        <div className="files-details-head">
                          {single.type === "folder" ? <FolderIcon large /> : <FileIcon file={single.file} large />}
                          <strong>{nameOf(single)}</strong>
                          <small>{single.type === "folder" ? "Ordner" : fileKind(single.file)}</small>
                        </div>
                        <dl>
                          <dt>Ort</dt>
                          <dd>{single.type === "folder" ? single.folder.path : single.file.path}</dd>
                          {single.type === "file" ? (
                            <>
                              <dt>Grösse</dt>
                              <dd>{prettyBytes(single.file.sizeBytes)}</dd>
                              <dt>Hochgeladen</dt>
                              <dd>
                                {formatDate(single.file.createdAt)}
                                {single.file.uploadedByName ? ` · ${single.file.uploadedByName}` : ""}
                              </dd>
                              <dt>Zuletzt geändert</dt>
                              <dd>
                                {formatDate(single.file.updatedAt)}
                                {single.file.updatedByName ? ` · ${single.file.updatedByName}` : ""}
                              </dd>
                            </>
                          ) : (
                            <>
                              <dt>Inhalt</dt>
                              <dd>{elementCount(single.folder.itemCount)}</dd>
                              <dt>Angelegt von</dt>
                              <dd>{single.folder.createdByName ?? (scope === "personal" ? "Dir" : "–")}</dd>
                            </>
                          )}
                        </dl>
                        {single.type === "file" && !inTrash && (
                          <section className="files-versions" aria-label="Versionen">
                            <h3>Versionen</h3>
                            {versions === null ? (
                              <p className="list-hint">Wird geladen …</p>
                            ) : (
                              <ol>
                                {versions.map((version) => (
                                  <li key={version.id}>
                                    <span>
                                      <strong>
                                        Version {version.versionNo}
                                        {version.current ? " · aktuell" : ""}
                                      </strong>
                                      <small>
                                        {formatDate(version.createdAt)}
                                        {version.uploadedByName ? ` · ${version.uploadedByName}` : ""} ·{" "}
                                        {prettyBytes(version.sizeBytes)}
                                      </small>
                                    </span>
                                    {!version.current && (
                                      <span className="files-version-actions">
                                        <button
                                          type="button"
                                          className="icon-button"
                                          aria-label={`Version ${version.versionNo} herunterladen`}
                                          data-tip="Diese Version herunterladen"
                                          onClick={() =>
                                            download(`/api/cloud/files/${single.file.id}?version=${version.id}`)
                                          }
                                        >
                                          <DownloadSimple aria-hidden="true" />
                                        </button>
                                        {single.file.canEdit && (
                                          <button
                                            type="button"
                                            className="icon-button"
                                            aria-label={`Version ${version.versionNo} wiederherstellen`}
                                            data-tip="Diese Version wiederherstellen"
                                            onClick={() =>
                                              void run(
                                                () =>
                                                  call(`/api/cloud/files/${single.file.id}`, {
                                                    method: "POST",
                                                    json: { action: "restoreVersion", versionId: version.id },
                                                  }),
                                                `Version ${version.versionNo} wiederhergestellt`,
                                              )
                                            }
                                          >
                                            <ArrowCounterClockwise aria-hidden="true" />
                                          </button>
                                        )}
                                      </span>
                                    )}
                                  </li>
                                ))}
                              </ol>
                            )}
                          </section>
                        )}
                      </>
                    ) : (
                      <div className="files-details-empty">
                        <Info aria-hidden="true" />
                        <p>
                          {chosen.length > 1
                            ? `${chosen.length} Elemente ausgewählt`
                            : "Eine Datei oder einen Ordner wählen, um Details und Versionen zu sehen."}
                        </p>
                      </div>
                    )}
                  </aside>
                )}
              </div>
            </div>
          </section>

          {menu && (
            <ItemMenu
              menu={menu}
              inTrash={inTrash}
              scope={scope}
              onClose={() => setMenu(null)}
              actions={{
                open: () => openItem(menu.item),
                download: () => downloadItems([menu.item]),
                share: () => menu.item.type === "file" && setDialog({ kind: "share", files: [menu.item.file] }),
                link: () => copyLink(menu.item),
                rename: () => setDialog({ kind: "rename", item: menu.item }),
                move: () => setDialog({ kind: "move", items: selected.has(keyOf(menu.item)) ? chosen : [menu.item] }),
                copy: () => setDialog({ kind: "copy", items: [menu.item] }),
                trash: () => void trash(selected.has(keyOf(menu.item)) ? chosen : [menu.item]),
                restore: () => void restore([menu.item]),
                purge: () => setDialog({ kind: "purge", items: [menu.item] }),
                details: () => setDetails(true),
              }}
            />
          )}

          {undo && (
            <div className="files-undo" role="status">
              <Trash aria-hidden="true" />
              {undo.text}
              <button
                type="button"
                onClick={() => {
                  const list = undo.items;
                  setUndo(null);
                  void restore(list);
                }}
              >
                Rückgängig
              </button>
            </div>
          )}
          {notice && (
            <div className="files-undo is-notice" role="status">
              {notice}
            </div>
          )}

          {conflict && (
            <ConflictDialog
              name={conflict.name}
              remaining={conflict.remaining}
              canReplace={conflict.canReplace}
              onChoose={conflict.resolve}
            />
          )}
          {dialog?.kind === "folder" && (
            <NameDialog
              eyebrow="Ablage · Neu"
              title="Neuer Ordner"
              label="Name"
              initial=""
              submitLabel="Ordner anlegen"
              onClose={() => setDialog(null)}
              onSubmit={async (name) => {
                const result = await call<{ id: string }>("/api/cloud/folders", {
                  method: "POST",
                  json: { scope, parentId: currentFolderId, name },
                });
                setDialog(null);
                setNotice(`Ordner „${name}“ angelegt`);
                await reload();
                setSelected(new Set([`d:${result.id}`]));
              }}
            />
          )}
          {dialog?.kind === "document" && (
            <NewDocumentDialog
              initialKind={dialog.initial}
              onClose={() => setDialog(null)}
              onSubmit={async (kind, name) => {
                const result = await call<{ file: ExplorerFile }>("/api/cloud/files", {
                  method: "POST",
                  json: { action: "document", scope, folderId: currentFolderId, kind, name },
                });
                await reload();
                setDialog({ kind: "editor", file: result.file });
              }}
            />
          )}
          {dialog?.kind !== "office" && <TooltipLayer />}
          {dialog?.kind === "gallery" && (
            <NewOfficeDialog
              initialKind={dialog.office}
              onClose={() => setDialog(null)}
              onSubmit={async (template, name) => {
                const result = await call<{ file: ExplorerFile }>("/api/cloud/files", {
                  method: "POST",
                  json: { action: "document", scope, folderId: currentFolderId, template: template.id, name },
                });
                await reload();
                setDialog({ kind: "office", file: result.file });
              }}
            />
          )}
          {dialog?.kind === "office" && (
            <OfficeEditor
              key={dialog.file.id}
              file={dialog.file}
              scope={scope}
              onClose={(changed) => {
                setDialog(null);
                if (fileParam) router.replace(folderParam ? `${pathname}?folder=${folderParam}` : pathname);
                if (changed) void reload();
              }}
              onCopied={(copy) => {
                setNotice(`Als „${copy.name}“ gespeichert`);
                void reload();
                setDialog({ kind: "office", file: copy });
              }}
            />
          )}
          {dialog?.kind === "rename" && (
            <NameDialog
              eyebrow="Ablage · Umbenennen"
              title={`„${nameOf(dialog.item)}“ umbenennen`}
              label="Neuer Name"
              initial={nameOf(dialog.item)}
              submitLabel="Umbenennen"
              onClose={() => setDialog(null)}
              onSubmit={async (name) => {
                await patchItem(dialog.item, { name });
                setDialog(null);
                setNotice("Umbenannt");
                await reload();
              }}
            />
          )}
          {(dialog?.kind === "move" || dialog?.kind === "copy") && (
            <FolderPickerDialog
              scope={scope}
              mode={dialog.kind}
              count={dialog.items.length}
              current={currentFolderId}
              blocked={
                dialog.kind === "move"
                  ? dialog.items.flatMap((item) => (item.type === "folder" ? [item.folder.id] : []))
                  : []
              }
              onClose={() => setDialog(null)}
              onSubmit={async (target) => {
                if (dialog.kind === "move") await moveTo(dialog.items, target);
                else {
                  for (const item of dialog.items)
                    if (item.type === "file")
                      await call(`/api/cloud/files/${item.file.id}`, {
                        method: "POST",
                        json: { action: "copy", folderId: target },
                      });
                  setNotice(dialog.items.length === 1 ? "Kopie angelegt" : `${dialog.items.length} Kopien angelegt`);
                  await reload();
                }
                setDialog(null);
              }}
            />
          )}
          {dialog?.kind === "editor" && (
            <TextEditorDialog
              file={dialog.file}
              onClose={() => {
                setDialog(null);
                if (fileParam) router.replace(folderParam ? `${pathname}?folder=${folderParam}` : pathname);
                void reload();
              }}
              onSaved={() => setNotice("Gespeichert – neue Version angelegt")}
            />
          )}
          {dialog?.kind === "preview" && (
            <PreviewDialog
              file={dialog.file}
              onClose={() => {
                setDialog(null);
                if (fileParam) router.replace(folderParam ? `${pathname}?folder=${folderParam}` : pathname);
              }}
            />
          )}
          {dialog?.kind === "share" && (
            <ShareToChatDialog
              files={dialog.files}
              onClose={() => setDialog(null)}
              onShared={(title) => {
                setDialog(null);
                setNotice(`In „${title}“ geteilt`);
              }}
            />
          )}
          {dialog?.kind === "purge" && (
            <ConfirmDialog
              title={
                dialog.items.length === 1
                  ? `„${nameOf(dialog.items[0])}“ endgültig löschen?`
                  : `${dialog.items.length} Elemente endgültig löschen?`
              }
              text="Endgültig gelöschte Dateien und Ordner samt aller Versionen lassen sich nicht wiederherstellen."
              confirmLabel="Endgültig löschen"
              onClose={() => setDialog(null)}
              onConfirm={async () => {
                for (const item of dialog.items)
                  await call(
                    item.type === "folder"
                      ? `/api/cloud/folders/${item.folder.id}`
                      : `/api/cloud/files/${item.file.id}`,
                    {
                      method: "DELETE",
                    },
                  );
                setDialog(null);
                setSelected(new Set());
                setNotice("Endgültig gelöscht");
                await reload();
              }}
            />
          )}
        </main>
      )}
    </ModulePageShell>
  );
}

const elementCount = (count: number) => (count === 1 ? "1 Element" : `${count} Elemente`);
const nameOf = (item: Item) => (item.type === "folder" ? item.folder.name : item.file.name);

type TreeNode = FolderNode & { children: TreeNode[] };

function FolderTree({
  folders,
  active,
  expanded,
  dropTarget,
  onToggle,
  onOpen,
  dropOn,
}: {
  folders: FolderNode[];
  active: string | null;
  expanded: Set<string>;
  dropTarget: string | null;
  onToggle: (id: string) => void;
  onOpen: (id: string | null) => void;
  dropOn: (folderId: string | null) => Record<string, unknown>;
}) {
  const roots = useMemo(() => {
    const nodes = new Map<string, TreeNode>(folders.map((folder) => [folder.id, { ...folder, children: [] }]));
    const list: TreeNode[] = [];
    for (const node of nodes.values())
      (node.parentId && nodes.get(node.parentId) ? nodes.get(node.parentId)!.children : list).push(node);
    return list;
  }, [folders]);
  const render = (node: TreeNode, depth: number) => (
    <li key={node.id}>
      <div
        className={`files-tree-row ${active === node.id ? "active" : ""} ${dropTarget === node.id ? "is-drop" : ""}`}
        style={{ paddingLeft: 4 + depth * 14 }}
        {...dropOn(node.id)}
      >
        <button
          type="button"
          className="files-tree-toggle"
          disabled={!node.children.length}
          aria-label={expanded.has(node.id) ? `${node.name} zuklappen` : `${node.name} aufklappen`}
          onClick={() => onToggle(node.id)}
        >
          {node.children.length ? expanded.has(node.id) ? <CaretDown /> : <CaretRight /> : null}
        </button>
        <button type="button" className="files-tree-label" onClick={() => onOpen(node.id)}>
          <FolderSimple weight={active === node.id ? "fill" : "regular"} aria-hidden="true" />
          {node.name}
        </button>
      </div>
      {expanded.has(node.id) && node.children.length > 0 && (
        <ul>{node.children.map((child) => render(child, depth + 1))}</ul>
      )}
    </li>
  );
  if (!roots.length) return <p className="files-tree-empty">Noch keine Ordner</p>;
  return <ul className="files-tree nav">{roots.map((node) => render(node, 0))}</ul>;
}

function ItemMenu({
  menu,
  inTrash,
  scope,
  onClose,
  actions,
}: {
  menu: NonNullable<Menu>;
  inTrash: boolean;
  scope: FileScope;
  onClose: () => void;
  actions: Record<
    "open" | "download" | "share" | "link" | "rename" | "move" | "copy" | "trash" | "restore" | "purge" | "details",
    () => void
  >;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: menu.x, top: menu.y });
  useEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (box)
      setPosition({
        left: Math.max(
          8,
          Math.min(
            menu.x - (menu.x + box.width > window.innerWidth - 8 ? box.width : 0),
            window.innerWidth - box.width - 8,
          ),
        ),
        top: menu.y + box.height > window.innerHeight - 8 ? Math.max(8, menu.y - box.height) : menu.y,
      });
    const close = (event: globalThis.MouseEvent) => !ref.current?.contains(event.target as Node) && onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [menu, onClose]);
  const item = menu.item;
  const editable = item.type === "file" ? item.file.canEdit : item.folder.canEdit;
  const entries: Array<[string, () => void, boolean?]> = inTrash
    ? [
        ["Wiederherstellen", actions.restore, !editable],
        ["Endgültig löschen", actions.purge, !editable],
      ]
    : [
        ["Öffnen", actions.open],
        ["Herunterladen", actions.download],
        ...(item.type === "file" ? ([["Im Chat teilen", actions.share]] as Array<[string, () => void]>) : []),
        ["Link kopieren", actions.link],
        ["Details und Versionen", actions.details],
        ["Umbenennen", actions.rename, !editable],
        ["Verschieben nach …", actions.move, !editable],
        ...(item.type === "file" ? ([["Kopieren nach …", actions.copy]] as Array<[string, () => void]>) : []),
        [scope === "shared" ? "Löschen" : "In den Papierkorb", actions.trash, !editable],
      ];
  return (
    <div ref={ref} className="files-menu files-context-menu" role="menu" style={position}>
      {entries.map(([label, action, disabled]) => (
        <button
          key={label}
          type="button"
          role="menuitem"
          disabled={disabled}
          className={label.includes("öschen") || label.includes("Papierkorb") ? "danger" : ""}
          onClick={() => {
            onClose();
            action();
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
