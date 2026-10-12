"use client";

import { Icon } from "./dashboard-shared";
import type { DashboardState } from "./use-dashboard";

export function NoteViewDialog({ r }: { r: DashboardState }) {
  const { viewingNote, setViewingNote, openNote, archiveNote } = r;
  const archived = Boolean(viewingNote?.archived_at);
  if (!viewingNote) return null;
  return (
    <div
      className="area-editor-overlay home-note-overlay"
      role="presentation"
      onMouseDown={(event) => event.currentTarget === event.target && setViewingNote(null)}
    >
      <section
        className="area-editor-panel home-note-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-note-view-title"
      >
        <div className="area-editor-header">
          <div>
            <p className="eyebrow">MEIN ARBEITSPLATZ · PRIVAT</p>
            <h2 id="home-note-view-title">{viewingNote.title}</h2>
            <p>
              {archived ? "Archivierte Notiz" : viewingNote.pinned ? "Angeheftete Notiz" : "Persönliche Notiz"} ·{" "}
              {archived ? "Archiviert am " : "Aktualisiert am "}
              {new Date((archived ? viewingNote.archived_at : null) ?? viewingNote.updated_at).toLocaleDateString(
                "de-CH",
                {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                },
              )}
            </p>
          </div>
          <button
            className="home-note-close"
            type="button"
            aria-label="Schliessen"
            onClick={() => setViewingNote(null)}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="home-note-reader">
          <p>{viewingNote.body}</p>
          <div className="home-note-actions">
            <button className="secondary-button" type="button" onClick={() => setViewingNote(null)}>
              Schliessen
            </button>
            <div>
              {archived ? (
                <button className="primary-button" type="button" onClick={() => void archiveNote(viewingNote, false)}>
                  Wiederherstellen
                </button>
              ) : (
                <>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void archiveNote(viewingNote, true)}
                  >
                    Archivieren
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => {
                      openNote(viewingNote);
                      setViewingNote(null);
                    }}
                  >
                    <Icon name="settings" /> Bearbeiten
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export function NoteEditorDialog({ r }: { r: DashboardState }) {
  const {
    noteEditor,
    setNoteEditor,
    noteTitle,
    setNoteTitle,
    noteBody,
    setNoteBody,
    notePinned,
    setNotePinned,
    noteSaving,
    noteFormError,
    noteConfirmDelete,
    setNoteConfirmDelete,
    saveNote,
    deleteNote,
    archiveNote,
  } = r;
  if (!noteEditor) return null;
  return (
    <div
      className="area-editor-overlay home-note-overlay"
      role="presentation"
      onMouseDown={(event) => event.currentTarget === event.target && setNoteEditor(null)}
    >
      <section
        className="area-editor-panel home-note-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-note-dialog-title"
      >
        <div className="area-editor-header">
          <div>
            <p className="eyebrow">MEIN ARBEITSPLATZ · PRIVAT</p>
            <h2 id="home-note-dialog-title">{noteEditor === "new" ? "Notiz erstellen" : "Notiz bearbeiten"}</h2>
            <p>
              Persönliche Merkpunkte für deinen Arbeitsalltag. Pflegebeobachtungen bitte in der {r.terms.prefix}akte
              dokumentieren.
            </p>
          </div>
          <button className="home-note-close" type="button" aria-label="Schliessen" onClick={() => setNoteEditor(null)}>
            <Icon name="close" />
          </button>
        </div>
        <form className="area-editor-form home-note-form" onSubmit={(event) => void saveNote(event)}>
          <div className="home-note-fields">
            <label>
              Titel
              <input
                required
                maxLength={160}
                value={noteTitle}
                onChange={(event) => setNoteTitle(event.target.value)}
                placeholder="Worum geht es?"
              />
            </label>
            <label>
              Notiz
              <textarea
                required
                maxLength={4000}
                rows={9}
                value={noteBody}
                onChange={(event) => setNoteBody(event.target.value)}
                placeholder="Schreibe deinen Merkpunkt auf…"
              />
            </label>
            <label className="home-note-pin">
              <input type="checkbox" checked={notePinned} onChange={(event) => setNotePinned(event.target.checked)} />
              <span>Oben anheften</span>
            </label>
            {noteFormError && (
              <p className="home-note-error" role="alert">
                {noteFormError}
              </p>
            )}
          </div>
          <div className="home-note-actions">
            {noteEditor !== "new" && !noteEditor.archived_at && (
              <button
                className="home-note-archive"
                type="button"
                disabled={noteSaving}
                onClick={() => void archiveNote(noteEditor, true)}
              >
                Archivieren
              </button>
            )}
            {noteEditor !== "new" && (
              <button
                className="home-note-delete"
                type="button"
                disabled={noteSaving}
                onClick={() => (noteConfirmDelete ? void deleteNote() : setNoteConfirmDelete(true))}
              >
                {noteConfirmDelete ? "Löschen bestätigen" : "Notiz löschen"}
              </button>
            )}
            <div>
              <button className="secondary-button" type="button" onClick={() => setNoteEditor(null)}>
                Abbrechen
              </button>
              <button className="primary-button" type="submit" disabled={noteSaving}>
                {noteSaving ? "Speichern…" : "Notiz speichern"}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
