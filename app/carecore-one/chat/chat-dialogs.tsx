"use client";

import { useEffect, useMemo, useState } from "react";
import { CaretRight, Check, HouseLine, MagnifyingGlass, UsersThree } from "@phosphor-icons/react";
import { EditorDialog } from "@/app/components/workspace-ui";
import { CareDatePicker, CareOptionSelect } from "@/app/components/care-form-controls";
import { TASK_PRIORITIES, type TaskPriority } from "@/lib/tasks-shared";
import { prettyBytes, type ExplorerFile, type ExplorerListing, type FileScope } from "@/lib/files-shared";
import type { ChatMember, ChatPerson } from "@/lib/messenger-shared";
import { call } from "@/app/carecore-one/files/explorer-api";
import { FileIcon, FolderIcon } from "@/app/carecore-one/files/file-icon";
import { initials } from "./chat-utils";

const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : "Das hat nicht geklappt.");

export function Presence({ duty }: { duty: ChatPerson["duty"] }) {
  return (
    <i
      className={`chat-presence ${duty ?? "off"}`}
      title={duty === "present" ? "Im Dienst" : duty === "planned" ? "Laut Dienstplan eingeteilt" : "Nicht im Dienst"}
      aria-hidden="true"
    />
  );
}

export function Avatar({ name, duty, group }: { name: string; duty?: ChatPerson["duty"]; group?: boolean }) {
  return (
    <span className={`chat-avatar ${group ? "is-group" : ""}`} aria-hidden="true">
      {group ? <UsersThree weight="bold" /> : initials(name)}
      {!group && duty !== undefined && <Presence duty={duty} />}
    </span>
  );
}

// Personen wählen (neuer Chat, Personen hinzufügen) – mit Suche und Anwesenheit.
function PeoplePicker({
  people,
  selected,
  onToggle,
}: {
  people: ChatPerson[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const visible = people.filter((person) =>
    `${person.name} ${person.jobTitle} ${person.careUnit}`
      .toLocaleLowerCase("de-CH")
      .includes(query.trim().toLocaleLowerCase("de-CH")),
  );
  return (
    <div className="area-editor-wide chat-people-picker">
      <label className="chat-picker-search">
        <MagnifyingGlass aria-hidden="true" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, Funktion oder Wohnbereich"
          aria-label="Personen suchen"
        />
      </label>
      <div className="chat-picker-list" role="group" aria-label="Personen">
        {visible.map((person) => {
          const active = selected.includes(person.id);
          return (
            <button
              key={person.id}
              type="button"
              className={active ? "active" : ""}
              aria-pressed={active}
              onClick={() => onToggle(person.id)}
            >
              <Avatar name={person.name} duty={person.duty} />
              <span>
                <strong>{person.name}</strong>
                <small>
                  {[person.jobTitle, person.careUnit, person.duty === "present" ? "im Dienst" : ""]
                    .filter(Boolean)
                    .join(" · ") || "Mitarbeitende"}
                </small>
              </span>
              <i>{active && <Check weight="bold" />}</i>
            </button>
          );
        })}
        {!visible.length && <p className="list-hint">Niemand gefunden.</p>}
      </div>
    </div>
  );
}

// Neuer Chat wie im Team: eine Person = Direktnachricht (bestehender Chat öffnet sich), mehrere = Gruppe.
export function NewChatDialog({
  people,
  initial,
  onCreated,
  onClose,
}: {
  people: ChatPerson[];
  initial: string[];
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(initial);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const group = selected.length > 1;
  return (
    <EditorDialog
      id="chat-new"
      eyebrow="Messenger · Neuer Chat"
      title={group ? "Neue Gruppe" : "Neue Nachricht"}
      description={
        group
          ? "Mehrere Personen ergeben eine Gruppe mit Namen – z. B. für einen Wohnbereich oder ein Projekt."
          : "Eine Person wählen für eine Direktnachricht. Gibt es den Chat schon, öffnet er sich."
      }
      onClose={onClose}
      saving={saving}
      error={error}
      submitLabel={group ? "Gruppe erstellen" : "Chat öffnen"}
      onSubmit={async () => {
        if (!selected.length) return setError("Bitte mindestens eine Person wählen.");
        if (group && !title.trim()) return setError("Bitte gib der Gruppe einen Namen.");
        setSaving(true);
        setError("");
        try {
          const result = await call<{ id: string }>("/api/conversations", {
            method: "POST",
            json: { action: "conversation", kind: group ? "group" : "direct", title, memberIds: selected },
          });
          onCreated(result.id);
        } catch (cause) {
          setError(errorText(cause));
          setSaving(false);
        }
      }}
    >
      {group && (
        <label className="area-editor-wide">
          <span>Gruppenname</span>
          <input
            value={title}
            maxLength={180}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="z. B. Übergabe Wohnbereich 2"
          />
        </label>
      )}
      {selected.length > 0 && (
        <div className="area-editor-wide chat-selected-people" aria-label="Ausgewählt">
          {selected.map((id) => {
            const person = people.find((item) => item.id === id);
            return (
              <button key={id} type="button" onClick={() => setSelected((list) => list.filter((item) => item !== id))}>
                {person?.name ?? "Person"} <span aria-hidden="true">×</span>
              </button>
            );
          })}
        </div>
      )}
      <PeoplePicker
        people={people}
        selected={selected}
        onToggle={(id) =>
          setSelected((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]))
        }
      />
    </EditorDialog>
  );
}

export function AddMembersDialog({
  people,
  members,
  conversationId,
  onDone,
  onClose,
}: {
  people: ChatPerson[];
  members: ChatMember[];
  conversationId: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const candidates = people.filter((person) => !members.some((member) => member.userId === person.id));
  return (
    <EditorDialog
      id="chat-add"
      eyebrow="Messenger · Gruppe"
      title="Personen hinzufügen"
      description="Neue Mitglieder sehen den bisherigen Verlauf der Gruppe."
      onClose={onClose}
      saving={saving}
      error={error}
      submitLabel={selected.length > 1 ? `${selected.length} Personen hinzufügen` : "Hinzufügen"}
      onSubmit={async () => {
        if (!selected.length) return setError("Bitte mindestens eine Person wählen.");
        setSaving(true);
        try {
          await call("/api/conversations", {
            method: "POST",
            json: { action: "addMembers", conversationId, memberIds: selected },
          });
          onDone();
        } catch (cause) {
          setError(errorText(cause));
          setSaving(false);
        }
      }}
    >
      <PeoplePicker
        people={candidates}
        selected={selected}
        onToggle={(id) =>
          setSelected((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]))
        }
      />
    </EditorDialog>
  );
}

// Aus einer Nachricht eine Aufgabe machen (erscheint unter Aufgaben, die zugewiesene Person wird benachrichtigt).
export function TaskDialog({
  text,
  author,
  members,
  actorId,
  onCreated,
  onClose,
}: {
  text: string;
  author: string;
  members: ChatMember[];
  actorId: string;
  onCreated: () => void;
  onClose: () => void;
}) {
  const firstLine = text.split("\n")[0].replace(/[*_]/g, "").slice(0, 120);
  const [title, setTitle] = useState(firstLine);
  const [assignee, setAssignee] = useState(actorId);
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <EditorDialog
      id="chat-task"
      eyebrow="Messenger · Aufgabe"
      title="Als Aufgabe übernehmen"
      description="Die Aufgabe erscheint unter Betrieb › Aufgaben; die zugewiesene Person wird benachrichtigt."
      onClose={onClose}
      saving={saving}
      error={error}
      submitLabel="Aufgabe erstellen"
      onSubmit={async () => {
        if (!title.trim()) return setError("Bitte einen Titel angeben.");
        setSaving(true);
        setError("");
        try {
          await call("/api/tasks", {
            method: "POST",
            json: {
              title: title.trim(),
              description: `Aus dem Messenger (Nachricht von ${author}):\n${text}`,
              assignedTo: assignee,
              priority,
              dueAt: due ? new Date(`${due}T17:00:00`).toISOString() : null,
            },
          });
          onCreated();
        } catch (cause) {
          setError(errorText(cause));
          setSaving(false);
        }
      }}
    >
      <label className="area-editor-wide">
        <span>Aufgabe</span>
        <input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} autoFocus />
      </label>
      <label>
        <span>Zuständig</span>
        <CareOptionSelect
          label="Zuständig"
          value={assignee}
          onChange={setAssignee}
          options={members.map((member) => ({
            value: member.userId,
            label: member.userId === actorId ? `${member.name} (ich)` : member.name,
          }))}
        />
      </label>
      <label>
        <span>Wichtigkeit</span>
        <CareOptionSelect
          label="Wichtigkeit"
          value={priority}
          onChange={(value) => setPriority(value as TaskPriority)}
          options={(Object.keys(TASK_PRIORITIES) as TaskPriority[]).map((key) => ({
            value: key,
            label: TASK_PRIORITIES[key].label,
          }))}
        />
      </label>
      <label>
        <span>Fällig am (optional)</span>
        <CareDatePicker label="Fällig am (optional)" value={due} onChange={setDue} clearable />
      </label>
    </EditorDialog>
  );
}

// Datei aus der Ablage anhängen: gemeinsame Ablage (verknüpft) oder „Meine Dateien“ (als Kopie).
export function AblagePickerDialog({
  onPick,
  onClose,
}: {
  onPick: (files: ExplorerFile[]) => void;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<FileScope>("shared");
  const [folder, setFolder] = useState<string | null>(null);
  const [listing, setListing] = useState<ExplorerListing | null>(null);
  const [picked, setPicked] = useState<ExplorerFile[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const params = new URLSearchParams({ scope });
    if (folder) params.set("folder", folder);
    call<ExplorerListing>(`/api/cloud/files?${params}`)
      .then((result) => {
        setListing(result);
        setError("");
      })
      .catch((cause) => setError(errorText(cause)));
  }, [scope, folder]);
  const pickedIds = useMemo(() => new Set(picked.map((file) => file.id)), [picked]);
  return (
    <EditorDialog
      id="chat-ablage"
      eyebrow="Messenger · Datei anhängen"
      title="Aus der Ablage"
      description="Dateien der gemeinsamen Ablage bleiben verknüpft (immer die aktuelle Version); persönliche Dateien werden als Kopie geteilt."
      onClose={onClose}
      saving={false}
      error={error}
      submitLabel={picked.length > 1 ? `${picked.length} Dateien anhängen` : "Anhängen"}
      onSubmit={() => (picked.length ? onPick(picked) : setError("Bitte mindestens eine Datei wählen."))}
    >
      <div className="area-editor-wide chat-ablage-tabs" role="group" aria-label="Ablage">
        {(["shared", "personal"] as FileScope[]).map((item) => (
          <button
            key={item}
            type="button"
            className={`day-toggle ${scope === item ? "active" : ""}`}
            aria-pressed={scope === item}
            onClick={() => {
              setScope(item);
              setFolder(null);
            }}
          >
            {item === "shared" ? <UsersThree aria-hidden="true" /> : <HouseLine aria-hidden="true" />}
            {item === "shared" ? "Gemeinsame Ablage" : "Meine Dateien"}
          </button>
        ))}
      </div>
      <nav className="area-editor-wide chat-ablage-path" aria-label="Pfad">
        {(listing?.path ?? []).map((crumb, index, path) => (
          <span key={crumb.id ?? "root"}>
            {index > 0 && <CaretRight aria-hidden="true" />}
            {index === path.length - 1 ? (
              <strong>{crumb.name}</strong>
            ) : (
              <button type="button" onClick={() => setFolder(crumb.id)}>
                {crumb.name}
              </button>
            )}
          </span>
        ))}
      </nav>
      <div className="area-editor-wide chat-ablage-list">
        {listing?.folders.map((item) => (
          <button key={item.id} type="button" onClick={() => setFolder(item.id)}>
            <FolderIcon />
            <strong>{item.name}</strong>
            <small>{item.itemCount === 1 ? "1 Element" : `${item.itemCount} Elemente`}</small>
          </button>
        ))}
        {listing?.files.map((file) => (
          <button
            key={file.id}
            type="button"
            className={pickedIds.has(file.id) ? "active" : ""}
            aria-pressed={pickedIds.has(file.id)}
            onClick={() =>
              setPicked((list) =>
                pickedIds.has(file.id) ? list.filter((item) => item.id !== file.id) : [...list, file].slice(0, 10),
              )
            }
          >
            <FileIcon file={file} />
            <strong>{file.name}</strong>
            <small>{prettyBytes(file.sizeBytes)}</small>
          </button>
        ))}
        {listing && !listing.folders.length && !listing.files.length && (
          <p className="list-hint">Dieser Ordner ist leer.</p>
        )}
      </div>
    </EditorDialog>
  );
}
