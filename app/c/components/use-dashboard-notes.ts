"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  QUEUE_EVENT,
  offlineUser,
  queuedWrites,
  sendOrQueue,
  type QueuedWrite,
  type WriteMethod,
} from "@/app/components/offline-queue";
import { DashboardNote } from "./dashboard-shared";

const NOTES_URL = "/api/dashboard/notes";
const byOrder = (a: DashboardNote, b: DashboardNote) =>
  Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at);

// Offline vorgemerkte Änderungen auf die geladenen Notizen anwenden, damit sie auch nach dem Neuladen ohne
// Verbindung sichtbar bleiben (die Liste selbst stammt dann aus dem Zwischenspeicher des Service Workers).
function applyQueued(notes: DashboardNote[], writes: QueuedWrite[]) {
  let result = [...notes];
  for (const write of writes) {
    if (write.url !== NOTES_URL || write.error || !write.body || typeof write.body !== "object") continue;
    const input = write.body as Partial<DashboardNote> & { archived?: boolean };
    const method = write.method ?? "POST";
    if (method === "DELETE") result = result.filter((note) => note.id !== input.id);
    else if (method === "POST" && !result.some((note) => note.id === input.id))
      result.push({
        id: String(input.id),
        title: String(input.title ?? ""),
        body: String(input.body ?? ""),
        pinned: input.pinned === true,
        archived_at: null,
        updated_at: write.createdAt,
      });
    else if (method === "PATCH")
      result = result.map((note) =>
        note.id !== input.id
          ? note
          : {
              ...note,
              ...(input.title !== undefined
                ? { title: String(input.title), body: String(input.body), pinned: input.pinned === true }
                : {}),
              ...(input.archived !== undefined ? { archived_at: input.archived ? write.createdAt : null } : {}),
              updated_at: input.title !== undefined ? write.createdAt : note.updated_at,
            },
      );
  }
  return result;
}

export function useDashboardNotes({ setToast }: { setToast: (message: string) => void }) {
  const [notes, setNotes] = useState<DashboardNote[]>([]);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [notesError, setNotesError] = useState("");
  const [showArchive, setShowArchive] = useState(false);
  const [noteEditor, setNoteEditor] = useState<DashboardNote | "new" | null>(null);
  const [viewingNote, setViewingNote] = useState<DashboardNote | null>(null);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [notePinned, setNotePinned] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteFormError, setNoteFormError] = useState("");
  const [noteConfirmDelete, setNoteConfirmDelete] = useState(false);

  const pendingWrites = useCallback(
    async () =>
      (await queuedWrites(offlineUser()).catch(() => [] as QueuedWrite[])).filter(
        (write) => write.url === NOTES_URL && !write.error,
      ),
    [],
  );

  const loadNotes = useCallback(async () => {
    let loaded: DashboardNote[] | null = null;
    try {
      const response = await fetch(NOTES_URL, { cache: "no-store" });
      const data = (await response.json()) as { notes?: DashboardNote[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Notizen konnten nicht geladen werden.");
      loaded = data.notes ?? [];
      setNotesError("");
    } catch (error) {
      setNotesError(error instanceof Error ? error.message : "Notizen konnten nicht geladen werden.");
    }
    const writes = await pendingWrites();
    setPendingIds(writes.map((write) => String((write.body as { id?: unknown }).id)));
    // Auch ohne geladene Liste (offline, nichts im Zwischenspeicher) bleiben vorgemerkte Änderungen sichtbar;
    // applyQueued ist wiederholbar, bereits angewandte Änderungen doppeln sich nicht.
    setNotes((current) => applyQueued(loaded ?? current, writes));
    if (loaded) setNotesError("");
    setNotesLoading(false);
  }, [pendingWrites]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadNotes(), 0);
    // Warteschlange geändert (nachgereicht, vorgemerkt oder Person erst jetzt bekannt): neu laden – ohne
    // Verbindung kommt die Liste aus dem Zwischenspeicher, die vorgemerkten Änderungen werden erneut angewandt.
    const onQueue = () => void loadNotes();
    window.addEventListener(QUEUE_EVENT, onQueue);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(QUEUE_EVENT, onQueue);
    };
  }, [loadNotes]);

  const activeNotes = useMemo(() => notes.filter((note) => !note.archived_at).sort(byOrder), [notes]);
  const archivedNotes = useMemo(
    () =>
      notes
        .filter((note) => note.archived_at)
        .sort((a, b) => String(b.archived_at).localeCompare(String(a.archived_at))),
    [notes],
  );

  // Änderung sofort anzeigen, senden oder – ohne Verbindung – auf dem Gerät vormerken.
  async function change(
    method: WriteMethod,
    payload: Record<string, unknown>,
    label: string,
    done: string,
    apply: (current: DashboardNote[]) => DashboardNote[],
  ) {
    const result = await sendOrQueue<unknown>(NOTES_URL, payload, label, undefined, method);
    setNotes(apply);
    if (result.queued) {
      setPendingIds((current) => [...current, String(payload.id)]);
      setToast(`${done} · offline vorgemerkt, wird gesendet, sobald die Verbindung zurück ist`);
    } else {
      setToast(done);
      void loadNotes();
    }
  }

  function openNote(note: DashboardNote | "new") {
    setNoteEditor(note);
    setNoteTitle(note === "new" ? "" : note.title);
    setNoteBody(note === "new" ? "" : note.body);
    setNotePinned(note === "new" ? false : note.pinned);
    setNoteFormError("");
    setNoteConfirmDelete(false);
  }

  async function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!noteEditor) return;
    setNoteSaving(true);
    setNoteFormError("");
    const now = new Date().toISOString();
    const content = { title: noteTitle.trim(), body: noteBody.trim(), pinned: notePinned };
    try {
      if (noteEditor === "new") {
        const id = crypto.randomUUID();
        await change("POST", { id, ...content }, `Notiz · ${content.title}`, "Notiz gespeichert", (current) => [
          ...current.filter((note) => note.id !== id),
          { id, ...content, archived_at: null, updated_at: now },
        ]);
      } else {
        const id = noteEditor.id;
        // Stand der bearbeiteten Fassung: der Server meldet einen Konflikt, falls sie inzwischen anderswo geändert wurde.
        const base = { baseUpdatedAt: noteEditor.updated_at };
        await change("PATCH", { id, ...content, ...base }, `Notiz · ${content.title}`, "Notiz gespeichert", (current) =>
          current.map((note) => (note.id === id ? { ...note, ...content, updated_at: now } : note)),
        );
      }
      setNoteEditor(null);
    } catch (error) {
      setNoteFormError(error instanceof Error ? error.message : "Notiz konnte nicht gespeichert werden.");
    } finally {
      setNoteSaving(false);
    }
  }

  // Ins Archiv verschieben bzw. wiederherstellen.
  async function archiveNote(note: DashboardNote, archived: boolean) {
    try {
      const now = new Date().toISOString();
      await change(
        "PATCH",
        { id: note.id, archived },
        `Notiz ${archived ? "archivieren" : "wiederherstellen"} · ${note.title}`,
        archived ? "Notiz archiviert" : "Notiz wiederhergestellt",
        (current) =>
          current.map((item) => (item.id === note.id ? { ...item, archived_at: archived ? now : null } : item)),
      );
      setViewingNote(null);
      setNoteEditor(null);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Notiz konnte nicht geändert werden.");
    }
  }

  async function deleteNote() {
    if (!noteEditor || noteEditor === "new") return;
    const target = noteEditor;
    setNoteSaving(true);
    setNoteFormError("");
    try {
      await change("DELETE", { id: target.id }, `Notiz löschen · ${target.title}`, "Notiz gelöscht", (current) =>
        current.filter((note) => note.id !== target.id),
      );
      setNoteEditor(null);
    } catch (error) {
      setNoteFormError(error instanceof Error ? error.message : "Notiz konnte nicht gelöscht werden.");
    } finally {
      setNoteSaving(false);
    }
  }

  return {
    notes: activeNotes,
    archivedNotes,
    pendingNoteIds: pendingIds,
    showArchive,
    setShowArchive,
    setNotes,
    notesLoading,
    setNotesLoading,
    notesError,
    setNotesError,
    noteEditor,
    setNoteEditor,
    viewingNote,
    setViewingNote,
    noteTitle,
    setNoteTitle,
    noteBody,
    setNoteBody,
    notePinned,
    setNotePinned,
    noteSaving,
    setNoteSaving,
    noteFormError,
    setNoteFormError,
    noteConfirmDelete,
    setNoteConfirmDelete,
    loadNotes,
    openNote,
    saveNote,
    archiveNote,
    deleteNote,
  };
}
