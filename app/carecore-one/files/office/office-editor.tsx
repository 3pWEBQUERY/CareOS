"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  CloudCheck,
  CloudArrowUp,
  DownloadSimple,
  FloppyDisk,
  Printer,
  Warning,
} from "@phosphor-icons/react";
import type { ExplorerFile, FileScope } from "@/lib/files-shared";
import {
  OFFICE_TYPES,
  type DeckModel,
  type DocumentModel,
  type OfficeKind,
  type OfficeModel,
  type SheetModel,
} from "@/lib/office/model";
import { mergeModels } from "@/lib/office/merge";
import { collaboratorColor, type Collaborator, type OfficePlace } from "@/lib/office/presence";
import { initials } from "@/lib/office/comments";
import { RequestError, call, download, fileUrl } from "../explorer-api";
import { FileIcon } from "../file-icon";
import { TooltipLayer } from "./tooltip-layer";
import type { EditorProps } from "./editor-props";

// Vollbild-Editor für Dokument, Tabelle und Präsentation: lädt die Datei, speichert automatisch (ohne für jeden
// Zwischenstand eine Version anzulegen), „Speichern“ legt eine Version an. Arbeiten mehrere Personen gleichzeitig
// in der Datei, werden ihre Änderungen laufend zusammengeführt; wer gerade wo ist, zeigen Kopfzeile und Editor.
const DocEditor = dynamic(() => import("./doc-editor"), { ssr: false, loading: () => <EditorLoading /> });
const SheetEditor = dynamic(() => import("./sheet-editor"), { ssr: false, loading: () => <EditorLoading /> });
const DeckEditor = dynamic(() => import("./deck-editor"), { ssr: false, loading: () => <EditorLoading /> });

const AUTOSAVE_MS = 1500;
// Abstand der Lebenszeichen: mit laufender Verbindung selten (sie meldet Änderungen sofort), ohne Verbindung öfter,
// im Hintergrund am seltensten; eigene Bewegungen gehen nach kurzer Sammelzeit.
const HEARTBEAT_MS = 10_000;
const LIVE_MS = 2500;
const LIVE_HIDDEN_MS = 15_000;
const PLACE_MS = 600;
type Live = { revision: number; people: Collaborator[]; model?: OfficeModel };

function EditorLoading() {
  return <p className="office-loading">Editor wird geladen …</p>;
}

type Loaded = {
  kind: OfficeKind;
  model: OfficeModel;
  revision: number;
  canEdit: boolean;
  imported: boolean;
  file: ExplorerFile;
  user: string;
};
type Status = "saved" | "dirty" | "saving" | "error" | "conflict";

const time = () => new Intl.DateTimeFormat("de-CH", { timeStyle: "short" }).format(new Date());

export default function OfficeEditor({
  file,
  scope,
  onClose,
  onCopied,
}: {
  file: ExplorerFile;
  scope: FileScope;
  onClose: (changed: boolean) => void;
  onCopied: (copy: ExplorerFile) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState("");
  const [status, setStatusState] = useState<Status>("saved");
  const statusRef = useRef<Status>("saved");
  const setStatus = useCallback((next: Status) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);
  const [message, setMessage] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState(file.name);
  // Zuletzt gespeicherter Name (das Eingabefeld zeigt schon während des Tippens den neuen).
  const savedName = useRef(file.name);
  const model = useRef<OfficeModel | null>(null);
  const revision = useRef(0);
  const dirty = useRef(false);
  const saving = useRef<Promise<void> | null>(null);
  // Zählt jedes Speichern: eine Antwort auf ein Lebenszeichen, während der gespeichert wurde, ist veraltet.
  const saves = useRef(0);
  const timer = useRef<number | null>(null);
  const changed = useRef(false);
  const forceVersion = useRef(false);
  // Offene Eingabe im Editor (z. B. Zelle der Tabelle) vor jedem Speichern übernehmen.
  const flushRef = useRef<(() => boolean) | null>(null);
  // Gleichzeitiges Bearbeiten: zuletzt gemeinsamer Stand (Grundlage für das Zusammenführen), Kennung dieses
  // Fensters, eigene Stelle in der Datei und die anderen Personen.
  const base = useRef<OfficeModel | null>(null);
  const remoteRef = useRef<((model: OfficeModel) => void) | null>(null);
  const [session] = useState(() => crypto.randomUUID().replace(/-/g, ""));
  const place = useRef<OfficePlace | null>(null);
  const [people, setPeopleState] = useState<Collaborator[]>([]);
  // Nur bei Änderung neu zeichnen (die Liste kommt bei jedem Lebenszeichen neu).
  const setPeople = useCallback((next: Collaborator[]) => {
    setPeopleState((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
  }, []);

  useEffect(() => {
    call<Loaded>(`/api/cloud/files/${file.id}?office=1`)
      .then((result) => {
        model.current = result.model;
        base.current = result.model;
        revision.current = result.revision;
        // Aus Word, Excel oder PowerPoint: die erste Speicherung behält das Original als Version.
        forceVersion.current = result.imported;
        setLoaded(result);
      })
      .catch((cause) =>
        setLoadError(cause instanceof Error ? cause.message : "Die Datei konnte nicht geöffnet werden."),
      );
  }, [file.id]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(id);
  }, [notice]);

  // Neuer Stand anderer: mit den eigenen, noch nicht gespeicherten Änderungen zusammenführen und im Editor zeigen.
  const takeRemote = useCallback((live: Live) => {
    // Nur neuere Stände anderer (eine ältere oder gleiche Antwort stammt von vor dem eigenen Speichern).
    if (!live.model || live.revision <= revision.current || !base.current || !model.current) return false;
    const merged = mergeModels(base.current, model.current, live.model);
    base.current = live.model;
    revision.current = live.revision;
    model.current = merged;
    remoteRef.current?.(merged);
    return merged !== live.model;
  }, []);

  const live = useCallback(
    async (leave = false) =>
      call<Live>(`/api/cloud/files/${file.id}`, {
        method: "POST",
        json: {
          action: "live",
          session,
          revision: revision.current,
          place: place.current,
          ...(leave ? { leave } : {}),
        },
        ...(leave ? { keepalive: true } : {}),
      }),
    [file.id, session],
  );

  const save = useCallback(
    async (manual: boolean): Promise<void> => {
      // Eine offene Eingabe (z. B. in einer Zelle) übernimmt nur das Speichern von Hand; das automatische Speichern
      // liesse sonst mitten im Tippen das Eingabefeld zuklappen, und die nächsten Zeichen gingen verloren.
      // Schliessen, Herunterladen und Drucken übernehmen sie selbst.
      if (manual) flushRef.current?.();
      if (timer.current) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      if (saving.current) {
        await saving.current;
        if (!dirty.current && !manual) return;
      }
      if (!model.current || (!dirty.current && !manual)) return;
      const snapshot = model.current;
      dirty.current = false;
      saves.current += 1;
      setStatus("saving");
      const task = (async () => {
        try {
          let sent = snapshot;
          let result: { file: ExplorerFile; revision: number } | null = null;
          // Hat inzwischen jemand anderes gespeichert: dessen Stand holen, zusammenführen, erneut speichern.
          for (let attempt = 0; !result; attempt += 1) {
            try {
              result = await call<{ file: ExplorerFile; revision: number }>(`/api/cloud/files/${file.id}`, {
                method: "PUT",
                json: { model: sent, revision: revision.current, auto: !manual && !forceVersion.current },
              });
            } catch (cause) {
              if (!(cause instanceof RequestError && cause.status === 409) || attempt >= 3) throw cause;
              const latest = await live();
              setPeople(latest.people);
              takeRemote(latest);
              sent = model.current ?? sent;
            }
          }
          base.current = sent;
          revision.current = result.revision;
          forceVersion.current = false;
          changed.current = true;
          setSavedAt(time());
          setMessage("");
          if (manual) setNotice(`Version ${result.file.versionNo} gespeichert`);
          setStatus(dirty.current ? "dirty" : "saved");
        } catch (cause) {
          dirty.current = true;
          if (cause instanceof RequestError && cause.status === 409) {
            setStatus("conflict");
            setMessage(cause.message);
          } else {
            setStatus("error");
            setMessage(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
          }
        }
      })();
      saving.current = task;
      await task;
      saving.current = null;
    },
    [file.id, live, setPeople, setStatus, takeRemote],
  );

  // Gleichzeitiges Bearbeiten: Eine laufende Verbindung (Server-Sent Events) meldet sofort, wenn jemand anderes
  // gespeichert hat oder sich bewegt; dann wird der neue Stand geholt. Das Lebenszeichen (eigene Stelle) geht bei
  // jeder Bewegung und sonst alle 10 s. Ohne Verbindung fragt der Editor alle 2,5 s selbst nach.
  const kick = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!loaded) return;
    let stopped = false;
    let timer = 0;
    let running = false;
    let again = false;
    let streaming = false;
    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      if (!stopped) timer = window.setTimeout(tick, ms);
    };
    const tick = async () => {
      if (stopped) return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      // Während des Speicherns kurz warten (der Stand ändert sich gerade); Fehler beim Lebenszeichen nicht melden.
      if (saving.current) again = true;
      else
        try {
          const before = saves.current;
          const result = await live();
          if (stopped) return;
          setPeople(result.people);
          // Inzwischen selbst gespeichert: der mitgeschickte Stand ist überholt.
          if (saves.current !== before || saving.current) delete result.model;
          // Eigene, noch nicht gespeicherte Änderungen wurden mit dem neuen Stand zusammengeführt: gleich speichern.
          if (takeRemote(result) && dirty.current && statusRef.current !== "conflict") void save(false);
        } catch {
          // Nächster Versuch beim nächsten Lebenszeichen.
        }
      running = false;
      if (again) {
        again = false;
        schedule(500);
      } else schedule(document.hidden ? LIVE_HIDDEN_MS : streaming ? HEARTBEAT_MS : LIVE_MS);
    };
    // Eigene Stelle geändert: kurz sammeln, dann melden.
    kick.current = () => {
      if (!running) schedule(PLACE_MS);
    };
    let source: EventSource | null = null;
    if (typeof EventSource !== "undefined") {
      source = new EventSource(`/api/cloud/files/${file.id}/live?session=${session}`);
      source.addEventListener("state", (event) => {
        streaming = true;
        const state = JSON.parse((event as MessageEvent<string>).data) as Live;
        setPeople(state.people);
        if (state.revision > revision.current) schedule(0);
      });
      source.addEventListener("gone", () => {
        source?.close();
        streaming = false;
        schedule(0);
      });
      source.onerror = () => {
        if (source?.readyState === EventSource.CLOSED) streaming = false;
      };
    }
    schedule(400);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      kick.current = () => undefined;
      source?.close();
      void live(true).catch(() => undefined);
    };
  }, [file.id, loaded, live, save, session, setPeople, setStatus, takeRemote]);

  const onPlace = useCallback((next: OfficePlace) => {
    if (JSON.stringify(next) === JSON.stringify(place.current)) return;
    place.current = next;
    kick.current();
  }, []);

  const onChange = useCallback(
    (next: OfficeModel) => {
      model.current = next;
      dirty.current = true;
      if (statusRef.current === "conflict") return;
      setStatus("dirty");
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        if (statusRef.current !== "conflict") void save(false);
      }, AUTOSAVE_MS);
    },
    [save, setStatus],
  );

  // Fenster schliessen mit ungespeicherten Änderungen: Browser fragt nach.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      // Offene Eingabe übernehmen, damit der Browser auch dann nachfragt.
      flushRef.current?.();
      if (dirty.current || saving.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Seite unter dem Editor nicht mitscrollen; beim Drucken nur den Inhalt.
  useEffect(() => {
    document.body.classList.add("office-open");
    return () => document.body.classList.remove("office-open");
  }, []);

  async function close() {
    flushRef.current?.();
    if (status !== "conflict" && (dirty.current || saving.current)) await save(false);
    if (dirty.current && status !== "conflict") return;
    onClose(changed.current);
  }

  async function rename(next: string) {
    const clean = next.trim();
    if (!clean || clean === savedName.current) return setName(savedName.current);
    const extension = `.${OFFICE_TYPES[loaded?.kind ?? "document"].extension}`;
    const full = clean.toLowerCase().endsWith(extension) ? clean : `${clean}${extension}`;
    if (full === savedName.current) return setName(full);
    try {
      const result = await call<{ file: ExplorerFile }>(`/api/cloud/files/${file.id}`, {
        method: "PATCH",
        json: { name: full },
      });
      savedName.current = result.file.name;
      setName(result.file.name);
      changed.current = true;
      setNotice("Umbenannt");
    } catch (cause) {
      setName(savedName.current);
      setMessage(cause instanceof Error ? cause.message : "Umbenennen fehlgeschlagen.");
    }
  }

  async function saveCopy() {
    flushRef.current?.();
    if (!loaded || !model.current) return;
    const dot = name.lastIndexOf(".");
    try {
      const result = await call<{ file: ExplorerFile }>("/api/cloud/files", {
        method: "POST",
        json: {
          action: "document",
          office: loaded.kind,
          model: model.current,
          scope,
          folderId: file.folderId,
          name: `${dot > 0 ? name.slice(0, dot) : name} (meine Fassung ${time().replace(":", ".")})`,
        },
      });
      dirty.current = false;
      changed.current = true;
      onCopied(result.file);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Die Kopie konnte nicht gespeichert werden.");
    }
  }

  async function downloadFile() {
    flushRef.current?.();
    if (dirty.current || saving.current) await save(false);
    download(fileUrl(file.id));
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (loaded?.canEdit && status !== "conflict") void save(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        window.print();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loaded, save, status]);

  const kind = loaded?.kind;
  const editorProps: Omit<EditorProps<OfficeModel>, "model"> = {
    onChange,
    flushRef,
    remoteRef,
    people,
    onPlace,
    readOnly: !loaded?.canEdit || status === "conflict",
    title: name.replace(/\.[^.]+$/, ""),
    user: loaded?.user ?? "",
  };
  const statusText =
    status === "saving"
      ? "Wird gespeichert …"
      : status === "dirty"
        ? "Änderungen werden gespeichert …"
        : status === "error"
          ? "Nicht gespeichert"
          : status === "conflict"
            ? "Von anderer Person geändert"
            : savedAt
              ? `Gespeichert um ${savedAt}`
              : "Alle Änderungen gespeichert";

  return createPortal(
    <div className={`office-shell kind-${kind ?? "loading"}`} role="dialog" aria-modal="true" aria-label={name}>
      <header className="office-titlebar">
        <button
          type="button"
          className="office-back"
          aria-label="Zurück zur Ablage"
          data-tip="Zurück zur Ablage"
          onClick={() => void close()}
        >
          <ArrowLeft aria-hidden="true" />
          <span>Ablage</span>
        </button>
        <FileIcon file={{ name, mimeType: file.mimeType }} />
        <div className="office-title">
          {loaded?.canEdit ? (
            <input
              aria-label="Dateiname"
              value={name}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
              onBlur={(event) => void rename(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  setName(savedName.current);
                  event.currentTarget.blur();
                }
              }}
            />
          ) : (
            <strong>{name}</strong>
          )}
          <span className={`office-status status-${status}`} role="status" aria-live="polite">
            {status === "saved" ? (
              <CloudCheck aria-hidden="true" />
            ) : status === "saving" || status === "dirty" ? (
              <CloudArrowUp aria-hidden="true" />
            ) : (
              <Warning aria-hidden="true" />
            )}
            {loaded && !loaded.canEdit ? "Nur lesen" : statusText}
          </span>
        </div>
        {people.length > 0 && (
          <ul className="office-people" aria-label="Ebenfalls in der Datei">
            {people.slice(0, 5).map((person) => (
              <li
                key={person.session}
                style={{ background: collaboratorColor(person.session) }}
                data-tip={person.self ? `${person.name} (anderes Fenster)` : `${person.name} bearbeitet mit`}
                aria-label={person.self ? `${person.name} (anderes Fenster)` : person.name}
              >
                {initials(person.name)}
              </li>
            ))}
            {people.length > 5 && <li className="more">+{people.length - 5}</li>}
          </ul>
        )}
        <div className="office-actions">
          {loaded?.canEdit && (
            <button
              type="button"
              className="office-action"
              aria-label="Version speichern"
              disabled={status === "conflict"}
              onClick={() => void save(true)}
              data-tip="Als neue Version speichern"
              data-shortcut="Ctrl+S"
            >
              <FloppyDisk aria-hidden="true" />
              <span>Version speichern</span>
            </button>
          )}
          <button
            type="button"
            className="office-action"
            aria-label="Drucken oder als PDF sichern"
            disabled={!loaded}
            onClick={() => {
              flushRef.current?.();
              window.print();
            }}
            data-tip="Drucken oder als PDF sichern"
            data-shortcut="Ctrl+P"
          >
            <Printer aria-hidden="true" />
            <span>Drucken / PDF</span>
          </button>
          <button
            type="button"
            className="office-action"
            aria-label="Herunterladen"
            data-tip="Als Office-Datei herunterladen"
            disabled={!loaded}
            onClick={() => void downloadFile()}
          >
            <DownloadSimple aria-hidden="true" />
            <span>Herunterladen</span>
          </button>
        </div>
      </header>
      {(status === "conflict" || status === "error" || message) && (
        <div className={`office-banner ${status === "conflict" ? "critical" : "attention"}`} role="alert">
          <Warning aria-hidden="true" />
          <span>{message || "Speichern fehlgeschlagen."}</span>
          {status === "conflict" ? (
            <>
              <button type="button" onClick={() => void saveCopy()}>
                Meine Fassung als Kopie sichern
              </button>
              <button
                type="button"
                onClick={() => {
                  dirty.current = false;
                  onClose(true);
                }}
              >
                Verwerfen und schliessen
              </button>
            </>
          ) : status === "error" ? (
            <button type="button" onClick={() => void save(false)}>
              Erneut versuchen
            </button>
          ) : null}
        </div>
      )}
      {loaded?.imported && loaded.canEdit && (
        <div className="office-banner info" role="note">
          <span>
            Diese Datei stammt aus einem anderen Programm. Text, Tabellen, Bilder, Diagramme, Formen und Kommentare
            lassen sich hier bearbeiten; besondere Elemente wie Makros, SmartArt oder eingebettete Objekte werden beim
            Speichern nicht übernommen. Das Original bleibt als Version erhalten.
          </span>
        </div>
      )}
      <div className="office-body">
        {loadError ? (
          <p className="office-loading error" role="alert">
            {loadError}
          </p>
        ) : !loaded ? (
          <EditorLoading />
        ) : kind === "document" ? (
          <DocEditor {...editorProps} model={loaded.model as DocumentModel} />
        ) : kind === "sheet" ? (
          <SheetEditor {...editorProps} model={loaded.model as SheetModel} />
        ) : (
          <DeckEditor {...editorProps} model={loaded.model as DeckModel} />
        )}
      </div>
      <TooltipLayer />
      {notice && (
        <div className="office-toast" role="status">
          {notice}
        </div>
      )}
    </div>,
    document.body,
  );
}
