"use client";

import type { ReactNode } from "react";
import { Icon } from "./dashboard-shared";
import { AppGrid, openAppLauncher, useApps } from "@/app/components/app-launcher";
import { useNavigationBadges } from "@/app/components/care-context";
import type { DashboardState } from "./use-dashboard";

export function HomeHero({ r, children }: { r: DashboardState; children: ReactNode }) {
  const { primaryCareUnitName, dashboardEditing, setDashboardEditing, hiddenWidgets } = r;
  return (
    <section className="home-hero" aria-labelledby="home-hero-title">
      {/* Ohne Begrüssung behält die Seite eine Hauptüberschrift für Screenreader. */}
      {hiddenWidgets.includes("greeting") && <h1 className="home-hero-hidden-title">Startseite</h1>}
      <div className="home-hero-top">
        <span className="home-kicker" id="home-hero-title">
          <Icon name="home" /> Startseite
        </span>
        <div className="home-hero-tools">
          <span className="home-scope">
            <Icon name="building" />
            {primaryCareUnitName || "Gesamtes Haus"}
          </span>
          <button
            className="home-edit-button"
            type="button"
            aria-pressed={dashboardEditing}
            onClick={() => setDashboardEditing((value) => !value)}
          >
            <Icon name="settings" />
            {dashboardEditing ? "Fertig" : "Startseite anpassen"}
          </button>
        </div>
      </div>
      {children}
    </section>
  );
}

// Begrüssung mit Datum und Uhrzeit: ein Baustein wie alle anderen (verschieben, Breite, Bereich, ausblenden).
export function HomeGreetingCard({ r }: { r: DashboardState }) {
  const { formattedDate, formattedTime, greeting, firstName, currentScope } = r;
  return (
    <div className="home-hero-intro home-greeting">
      <div>
        <p className="home-date">{formattedDate}</p>
        <h1 id="page-title">
          {greeting}, {firstName}.
        </h1>
        <p>
          Das ist dein Überblick für {currentScope}. Notizen, Aufgaben und {r.terms.prefix}-Neuigkeiten sind hier an
          einem Ort.
        </p>
      </div>
      <div className="home-clock" aria-label={`Aktuelle Uhrzeit ${formattedTime}`}>
        <strong>{formattedTime}</strong>
        <span>Uhr · Zürich</span>
      </div>
    </div>
  );
}

// Startbildschirm von CareOS: alle Apps, die die Person nutzen darf, als grosse farbige Kacheln mit Zählern
// (wie auf einem Tablet). Dieselben Kacheln stehen unter „Alle Apps“ in der Leiste.
export function HomeShortcutsCard({ r }: { r: DashboardState }) {
  const { router } = r;
  const { groups, terms } = useApps();
  const badges = useNavigationBadges();
  return (
    <section className="home-desk-card home-shortcuts careos-home-apps" aria-labelledby="home-shortcuts-title">
      <div className="home-card-head">
        <div>
          <p className="eyebrow">Antippen zum Öffnen</p>
          <h2 id="home-shortcuts-title">Meine Apps</h2>
        </div>
        <button className="careos-home-all" type="button" onClick={openAppLauncher} aria-haspopup="dialog">
          <Icon name="search" />
          App suchen
        </button>
      </div>
      <AppGrid groups={groups} terms={terms} badges={badges} onOpen={(href) => router.push(href)} />
    </section>
  );
}

export function HomeNotesCard({ r }: { r: DashboardState }) {
  const {
    notes,
    archivedNotes,
    pendingNoteIds,
    showArchive,
    setShowArchive,
    notesLoading,
    notesError,
    setViewingNote,
    openNote,
  } = r;
  return (
    <section className="home-desk-card home-notes" aria-labelledby="home-notes-title">
      <div className="home-card-head">
        <div>
          <p className="eyebrow">Nur für dich sichtbar</p>
          <h2 id="home-notes-title">{showArchive ? "Archivierte Notizen" : "Meine Notizen"}</h2>
        </div>
        <div className="home-notes-tools">
          <button
            type="button"
            className={`home-notes-archive-toggle ${showArchive ? "active" : ""}`}
            aria-pressed={showArchive}
            onClick={() => setShowArchive(!showArchive)}
          >
            {showArchive ? "Aktuelle" : `Archiv (${archivedNotes.length})`}
          </button>
          <button type="button" aria-label="Notiz erstellen" onClick={() => openNote("new")}>
            <Icon name="plus" />
          </button>
        </div>
      </div>
      {notesError && !notes.length && !archivedNotes.length ? (
        <p className="home-card-message error">{notesError}</p>
      ) : notesLoading ? (
        <p className="home-card-message">Notizen werden geladen…</p>
      ) : showArchive ? (
        archivedNotes.length ? (
          <div className="home-note-list archived">
            {archivedNotes.map((note) => (
              <button type="button" key={note.id} onClick={() => setViewingNote(note)}>
                <span>
                  <strong>{note.title}</strong>
                  {pendingNoteIds.includes(note.id) && <small className="pending">Nicht gesendet</small>}
                </span>
                <p>{note.body}</p>
                <time>
                  Archiviert{" "}
                  {new Date(note.archived_at ?? note.updated_at).toLocaleDateString("de-CH", {
                    day: "2-digit",
                    month: "short",
                  })}
                </time>
              </button>
            ))}
          </div>
        ) : (
          <p className="home-card-message">Keine archivierten Notizen.</p>
        )
      ) : notes.length ? (
        <div className="home-note-list">
          {notes.map((note) => (
            <button type="button" key={note.id} onClick={() => setViewingNote(note)}>
              <span>
                <strong>{note.title}</strong>
                {pendingNoteIds.includes(note.id) ? (
                  <small className="pending">Nicht gesendet</small>
                ) : (
                  note.pinned && <small>Fixiert</small>
                )}
              </span>
              <p>{note.body}</p>
              <time>{new Date(note.updated_at).toLocaleDateString("de-CH", { day: "2-digit", month: "short" })}</time>
            </button>
          ))}
        </div>
      ) : (
        <div className="home-notes-empty">
          <Icon name="note" />
          <strong>Platz für deine Gedanken</strong>
          <p>
            Halte persönliche To-dos und Merkpunkte fest. Klinische Einträge gehören weiterhin in die {r.terms.prefix}
            akte.
          </p>
          <button type="button" onClick={() => openNote("new")}>
            Erste Notiz erstellen <Icon name="chevron" />
          </button>
        </div>
      )}
    </section>
  );
}

export function HomeTodayCard({ r }: { r: DashboardState }) {
  const { router, assignedResidents, changes, openTasks, nextTasks, currentScope } = r;
  return (
    <section className="home-desk-card home-day-card" aria-labelledby="home-day-title">
      <div className="home-card-head">
        <div>
          <p className="eyebrow">Auf einen Blick</p>
          <h2 id="home-day-title">Heute wichtig</h2>
        </div>
        <span className="home-count">{openTasks.length} offen</span>
      </div>
      <div className="home-day-summary">
        <strong>{assignedResidents.length}</strong>
        <span>{r.terms.many} im Blick</span>
        <i />
        <strong>{changes.filter((item) => item.type === "critical").length}</strong>
        <span>wichtige Einträge</span>
      </div>
      <div className="home-day-tasks">
        {nextTasks.length ? (
          nextTasks.map((task) => (
            <button key={task.id} type="button" onClick={() => router.push("/c/betrieb/aufgaben")}>
              <span className="home-task-time">{task.time}</span>
              <span>
                <strong>{task.title}</strong>
                <small>{task.resident || currentScope}</small>
              </span>
              <Icon name="chevron" />
            </button>
          ))
        ) : (
          <p>Keine terminierten Aufgaben offen.</p>
        )}
      </div>
      <button className="home-card-footer" type="button" onClick={() => router.push("/c/betrieb/aufgaben")}>
        Aufgaben öffnen <Icon name="chevron" />
      </button>
    </section>
  );
}
