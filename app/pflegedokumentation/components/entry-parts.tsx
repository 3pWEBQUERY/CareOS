"use client";

import { useState } from "react";
import { CareDatePicker, CareSelect } from "@/app/components/care-form-controls";
import { EditorDialog, formatDateTime, requestJson, timeInZurich, todayInZurich } from "@/app/components/workspace-ui";
import { zurichTimeToIso } from "@/lib/resident-appointments";
import { DOC_CATEGORIES, IMPORTANCE, TEMPLATES, type DocEntry, type Importance } from "@/lib/documentation-shared";
import { useCareResident, useTerms } from "@/app/components/care-context";
import { sendOrQueue } from "@/app/components/offline-queue";
import { DictationButton, appendDictation } from "@/app/components/dictation-button";
import { AiRephrase } from "@/app/components/ai-rephrase";

export type ResidentOption = { id: string; name: string; room: string };

export type EntryDraft = {
  residentId: string;
  category: string;
  importance: Importance;
  body: string;
  date: string;
  time: string;
};

export const newDraft = (residentId = ""): EntryDraft => ({
  residentId,
  category: DOC_CATEGORIES[0],
  importance: "standard",
  body: "",
  date: todayInZurich(),
  time: timeInZurich(),
});

// Ohne Verbindung wird der Eintrag auf dem Gerät vorgemerkt und später mit dem erfassten Zeitpunkt gesendet.
export async function saveDraft(draft: EntryDraft, residentName: string) {
  const result = await sendOrQueue<{ id: string }>(
    "/api/documentation",
    {
      residentId: draft.residentId,
      category: draft.category,
      importance: draft.importance,
      body: draft.body,
      occurredAt: zurichTimeToIso(draft.date, draft.time),
    },
    `Dokumentation ${draft.category} · ${residentName}`,
    { field: "body", label: "Eintrag" },
  );
  return result.queued
    ? "Offline gespeichert – wird gesendet, sobald die Verbindung zurück ist"
    : "Dokumentation gespeichert";
}

// Fields of a documentation entry, used inline (quick documentation) and in the dialog.
export function EntryFields({
  draft,
  onChange,
  residents,
  lockResident,
}: {
  draft: EntryDraft;
  onChange: (draft: EntryDraft) => void;
  residents: ResidentOption[];
  // The quick documentation always documents for the resident chosen in the header.
  lockResident?: boolean;
}) {
  const t = useTerms();
  const set = <K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) => onChange({ ...draft, [key]: value });
  const label = (r: ResidentOption) => `${r.name}${r.room ? ` · ${r.room}` : ""}`;
  const resident = residents.find((r) => r.id === draft.residentId);
  return (
    <>
      <label className="area-editor-wide">
        <span>{t.one}</span>
        {lockResident ? (
          <input value={resident ? label(resident) : "In der Kopfzeile auswählen"} readOnly />
        ) : (
          <CareSelect
            label={t.one}
            value={resident ? label(resident) : `${t.oneOblique} wählen`}
            options={residents.map(label)}
            onChange={(value) => set("residentId", residents.find((r) => label(r) === value)?.id ?? "")}
          />
        )}
      </label>
      <label>
        <span>Dokumentationsart</span>
        <CareSelect
          label="Dokumentationsart"
          value={draft.category}
          options={[...DOC_CATEGORIES]}
          onChange={(v) => set("category", v)}
        />
      </label>
      <label>
        <span>Einordnung</span>
        <CareSelect
          label="Einordnung"
          value={IMPORTANCE[draft.importance].label}
          options={Object.values(IMPORTANCE).map((i) => i.label)}
          onChange={(v) =>
            set(
              "importance",
              (Object.keys(IMPORTANCE) as Importance[]).find((k) => IMPORTANCE[k].label === v) ?? "standard",
            )
          }
        />
      </label>
      <label>
        <span>Datum</span>
        <CareDatePicker label="Datum" value={draft.date} onChange={(v) => set("date", v)} />
      </label>
      <label>
        <span>Uhrzeit</span>
        <input type="time" required value={draft.time} onChange={(e) => set("time", e.target.value)} />
      </label>
      <div className="area-editor-wide form-field">
        <span>Textbausteine</span>
        <div className="chip-row">
          {TEMPLATES.map((template) => (
            <button
              key={template.label}
              type="button"
              className="day-toggle"
              onClick={() =>
                onChange({
                  ...draft,
                  category: template.category,
                  body: draft.body ? `${draft.body.trimEnd()} ${template.text}` : template.text,
                })
              }
            >
              {template.label}
            </button>
          ))}
        </div>
      </div>
      <label className="area-editor-wide">
        <span>Eintrag</span>
        <textarea
          required
          rows={6}
          maxLength={10000}
          value={draft.body}
          onChange={(e) => set("body", e.target.value)}
          placeholder="Was wurde beobachtet oder durchgeführt? Wirkung, Reaktion, nächste Schritte."
        />
      </label>
      <DictationButton onText={(text) => set("body", appendDictation(draft.body, text))} />
      <AiRephrase text={draft.body} residentId={draft.residentId || null} onAccept={(text) => set("body", text)} />
    </>
  );
}

export function EntryDialog({
  residents,
  residentId,
  onClose,
  onSaved,
}: {
  residents: ResidentOption[];
  residentId?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const t = useTerms();
  const [contextId] = useCareResident();
  const [draft, setDraft] = useState<EntryDraft>(() =>
    newDraft(residentId ?? residents.find((r) => r.id === contextId)?.id ?? residents[0]?.id),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <EditorDialog
      id="documentation-entry"
      eyebrow="Dokumentation"
      title="Eintrag erfassen"
      description="Der Eintrag wird mit Zeitpunkt und deinem Namen gespeichert und kann danach nur noch per Nachtrag korrigiert werden."
      onClose={onClose}
      onSubmit={async () => {
        setSaving(true);
        setError("");
        try {
          onSaved(await saveDraft(draft, residents.find((r) => r.id === draft.residentId)?.name ?? t.one));
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
          setSaving(false);
        }
      }}
      saving={saving}
      error={error}
      submitLabel="Eintrag speichern"
    >
      <EntryFields draft={draft} onChange={setDraft} residents={residents} />
    </EditorDialog>
  );
}

export function AmendDialog({
  entry,
  onClose,
  onSaved,
}: {
  entry: DocEntry;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const t = useTerms();
  const [body, setBody] = useState(entry.body);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <EditorDialog
      id="documentation-amend"
      eyebrow={`Dokumentation · ${entry.residentName}`}
      title="Nachtrag / Korrektur"
      description={`Original vom ${formatDateTime(entry.occurredAt)} (${entry.author ?? "unbekannt"}) bleibt unverändert sichtbar und wird als korrigiert markiert.`}
      onClose={onClose}
      onSubmit={async () => {
        setSaving(true);
        setError("");
        try {
          await requestJson(`/api/documentation/${entry.id}/amendments`, { method: "POST", body: { body, reason } });
          onSaved("Korrektur als Nachtrag gespeichert");
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
          setSaving(false);
        }
      }}
      saving={saving}
      error={error}
      submitLabel="Nachtrag speichern"
    >
      <label className="area-editor-wide">
        <span>Grund der Korrektur</span>
        <input
          required
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={`z. B. falscher ${t.one}, Seite verwechselt, Ergänzung`}
        />
      </label>
      <label className="area-editor-wide">
        <span>Korrigierter Eintrag</span>
        <textarea required rows={6} maxLength={10000} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
    </EditorDialog>
  );
}

export function EntryItem({
  entry,
  onAmend,
  showResident = true,
}: {
  entry: DocEntry;
  onAmend: ((entry: DocEntry) => void) | null;
  showResident?: boolean;
}) {
  const importance = IMPORTANCE[entry.importance] ?? IMPORTANCE.standard;
  return (
    <article className={`doc-entry ${entry.amendedBy ? "amended" : ""} ${entry.amendedFromId ? "correction" : ""}`}>
      <time>{formatDateTime(entry.occurredAt)}</time>
      <div>
        <header>
          <span className="documentation-history-tag">{entry.category}</span>
          {entry.importance !== "standard" && (
            <span className={`status-badge ${importance.tone}`}>{importance.label}</span>
          )}
          {entry.amendedFromId && <span className="status-badge info">Nachtrag</span>}
          {entry.amendedBy && <span className="status-badge archived">Korrigiert</span>}
        </header>
        {showResident && (
          <strong>
            {entry.residentName}
            {entry.room ? ` · ${entry.room}` : ""}
          </strong>
        )}
        <p>{entry.body}</p>
        {entry.amendReason && <p className="doc-entry-reason">Grund der Korrektur: {entry.amendReason}</p>}
        <small>
          {entry.author ?? "unbekannt"}
          {entry.createdAt && Math.abs(Date.parse(entry.createdAt) - Date.parse(entry.occurredAt)) > 15 * 60_000
            ? ` · erfasst ${formatDateTime(entry.createdAt)}`
            : ""}
          {entry.amendedBy
            ? ` · korrigiert ${formatDateTime(entry.amendedBy.createdAt)} von ${entry.amendedBy.author ?? "unbekannt"}`
            : ""}
        </small>
      </div>
      {onAmend && !entry.amendedBy && (
        <button className="quiet-button" type="button" onClick={() => onAmend(entry)}>
          Nachtrag
        </button>
      )}
    </article>
  );
}
