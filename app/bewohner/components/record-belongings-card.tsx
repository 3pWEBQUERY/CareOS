"use client";

import { useState } from "react";
import { PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { EditorDialog, formatDateTime, requestJson, useApiData } from "@/app/components/workspace-ui";
import { CareOptionSelect } from "@/app/components/care-form-controls";
import {
  BELONGING_KINDS,
  BELONGING_LOCATIONS,
  BELONGING_SUGGESTIONS,
  type Belonging,
  type BelongingKind,
  type BelongingList,
} from "@/lib/belongings-shared";

type Draft = {
  id: string | null;
  kind: BelongingKind;
  name: string;
  quantity: string;
  marking: string;
  location: string;
  note: string;
  updatedAt: string | null;
};

// Kurzbezeichnung der Art in der Liste (Hilfsmittel ohne Zusatz).
const KIND_TAGS: Record<BelongingKind, string> = {
  aid: "",
  personal: "persönlich",
  clothing: "Wäsche",
  furniture: "Einrichtung",
};

// Hilfsmittel, persönliche Gegenstände, Kleidung bzw. Wäsche und Einrichtung mit Anzahl, Kennzeichnung und Standort;
// daraus die Inventarliste beim Eintritt zum Unterschreiben. Nicht mehr vorhandene bleiben mit Grund im Verlauf.
export function RecordBelongingsCard({
  residentId,
  residentName,
  onAction,
}: {
  residentId: string;
  residentName: string;
  onAction: (message: string) => void;
}) {
  const list = useApiData<BelongingList>(`/api/residents/${residentId}/belongings`);
  const data = list.data;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<Belonging | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const present = data?.belongings.filter((item) => !item.removed) ?? [];
  const removed = data?.belongings.filter((item) => item.removed) ?? [];

  async function run(action: () => Promise<unknown>, message: string) {
    setSaving(true);
    setError("");
    try {
      await action();
      list.reload();
      onAction(message);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="record-card master-data-card" aria-labelledby="belongings-title">
      <div className="record-card-heading">
        <div>
          <span className="record-section-label">Pflege</span>
          <h3 id="belongings-title">Hilfsmittel &amp; Gegenstände</h3>
        </div>
        {data?.canWrite && (
          <button
            type="button"
            aria-label="Hilfsmittel oder Gegenstand erfassen"
            onClick={() => {
              setError("");
              setDraft({
                id: null,
                kind: "aid",
                name: "",
                quantity: "1",
                marking: "",
                location: "",
                note: "",
                updatedAt: null,
              });
            }}
          >
            <Plus aria-hidden="true" /> Erfassen
          </button>
        )}
      </div>
      <div className="master-data-form-grid single-column">
        {list.error && !data ? (
          <p className="restraints-error" role="alert">
            {list.error}
          </p>
        ) : !data ? (
          <p className="record-export-note">Wird geladen …</p>
        ) : !data.belongings.length ? (
          <p className="record-export-note">
            Noch nichts erfasst – z. B. Brille, Hörgerät, Kleidung mit Namensetikett oder eigene Möbel mit Kennzeichnung
            und Standort.
          </p>
        ) : (
          <>
            {present.length > 0 && (
              <ul className="death-checklist diagnosis-list" aria-label="Vorhandene Hilfsmittel und Gegenstände">
                {present.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>
                        {item.quantity > 1 ? `${item.quantity} × ${item.name}` : item.name}
                        {KIND_TAGS[item.kind] && <span className="diagnosis-code">{KIND_TAGS[item.kind]}</span>}
                      </strong>
                      <small>
                        {[
                          item.marking && `Kennzeichnung: ${item.marking}`,
                          item.location && `Standort: ${item.location}`,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "Ohne Kennzeichnung und Standort"}
                      </small>
                      {item.note && <small>{item.note}</small>}
                    </div>
                    {data.canWrite && (
                      <span className="diagnosis-actions">
                        <button
                          type="button"
                          className="death-checklist-action"
                          aria-label={`${item.name} bearbeiten`}
                          onClick={() => {
                            setError("");
                            setDraft({
                              id: item.id,
                              kind: item.kind,
                              name: item.name,
                              quantity: String(item.quantity),
                              marking: item.marking,
                              location: item.location,
                              note: item.note,
                              updatedAt: item.updatedAt,
                            });
                          }}
                        >
                          <PencilSimple aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="death-checklist-action"
                          aria-label={`${item.name} nicht mehr vorhanden`}
                          onClick={() => {
                            setError("");
                            setReason("");
                            setRemoving(item);
                          }}
                        >
                          <Trash aria-hidden="true" />
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {present.length > 0 && (
              <a
                className="death-checklist-action belongings-print"
                href={`/c/bewohner/inventar?resident=${residentId}`}
                target="_blank"
                rel="noreferrer"
              >
                Inventarliste drucken
              </a>
            )}
            {removed.length > 0 && (
              <details className="diagnosis-resolved">
                <summary>Nicht mehr vorhanden ({removed.length})</summary>
                <ul className="death-checklist diagnosis-list" aria-label="Nicht mehr vorhanden">
                  {removed.map((item) => (
                    <li key={item.id} className="resolved">
                      <div>
                        <strong>{item.name}</strong>
                        <small>
                          {item.removed?.reason} · {formatDateTime(item.removed?.at ?? null)}
                          {item.removed?.by ? ` · ${item.removed.by}` : ""}
                        </small>
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>

      {draft && (
        <EditorDialog
          id="belonging"
          eyebrow={`${residentName} · Hilfsmittel & Gegenstände`}
          title={draft.id ? "Gegenstand bearbeiten" : "Hilfsmittel oder Gegenstand erfassen"}
          onClose={() => setDraft(null)}
          onSubmit={async () => {
            const saved = await run(
              () =>
                draft.id
                  ? requestJson(`/api/belongings/${draft.id}`, {
                      method: "PATCH",
                      body: { ...draft, quantity: Number(draft.quantity) || 0 },
                    })
                  : requestJson(`/api/residents/${residentId}/belongings`, {
                      method: "POST",
                      body: { ...draft, quantity: Number(draft.quantity) || 0 },
                    }),
              draft.id ? "Gegenstand gespeichert" : "Gegenstand erfasst",
            );
            if (saved) setDraft(null);
          }}
          saving={saving}
          error={error}
          submitLabel="Speichern"
        >
          <fieldset className="area-editor-wide">
            <legend>Art</legend>
            <div className="repositioning-choices" role="group" aria-label="Art">
              {(Object.keys(BELONGING_KINDS) as BelongingKind[]).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={`day-toggle ${draft.kind === kind ? "active" : ""}`}
                  aria-pressed={draft.kind === kind}
                  onClick={() => setDraft({ ...draft, kind })}
                >
                  {BELONGING_KINDS[kind]}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="area-editor-wide">
            <span>Gegenstand</span>
            <input
              required
              maxLength={160}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          {!draft.id && (
            <div className="area-editor-wide repositioning-choices" role="group" aria-label="Häufige Gegenstände">
              {BELONGING_SUGGESTIONS[draft.kind].map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`day-toggle ${draft.name === name ? "active" : ""}`}
                  aria-pressed={draft.name === name}
                  onClick={() => setDraft({ ...draft, name })}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
          <label>
            <span>Anzahl</span>
            <input
              inputMode="numeric"
              required
              value={draft.quantity}
              onChange={(event) => setDraft({ ...draft, quantity: event.target.value.replace(/\D/g, "").slice(0, 3) })}
            />
          </label>
          <label>
            <span>Kennzeichnung</span>
            <input
              maxLength={160}
              placeholder="z. B. Namensetikett, Name eingraviert, roter Punkt"
              value={draft.marking}
              onChange={(event) => setDraft({ ...draft, marking: event.target.value })}
            />
          </label>
          <label>
            <span>Standort</span>
            <CareOptionSelect
              label="Standort"
              value={draft.location}
              placeholder="Standort wählen"
              onChange={(value) => setDraft({ ...draft, location: value })}
              options={[
                { value: "", label: "Nicht angegeben" },
                // Ein früher frei erfasster Standort bleibt wählbar.
                ...(draft.location && !BELONGING_LOCATIONS.includes(draft.location)
                  ? [{ value: draft.location, label: draft.location }]
                  : []),
                ...BELONGING_LOCATIONS.map((item) => ({ value: item, label: item })),
              ]}
            />
          </label>
          <label className="area-editor-wide">
            <span>Bemerkung</span>
            <textarea
              rows={2}
              maxLength={2000}
              value={draft.note}
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            />
          </label>
        </EditorDialog>
      )}

      {removing && (
        <EditorDialog
          id="belonging-remove"
          eyebrow={`${residentName} · Hilfsmittel & Gegenstände`}
          title="Nicht mehr vorhanden"
          description={`„${removing.name}“ wird als nicht mehr vorhanden vermerkt und bleibt im Verlauf sichtbar.`}
          onClose={() => setRemoving(null)}
          onSubmit={async () => {
            if (!reason.trim()) return setError("Bitte den Grund angeben.");
            const done = await run(
              () => requestJson(`/api/belongings/${removing.id}`, { method: "DELETE", body: { reason } }),
              `${removing.name}: nicht mehr vorhanden`,
            );
            if (done) setRemoving(null);
          }}
          saving={saving}
          error={error}
          submitLabel="Vermerken"
        >
          <label className="area-editor-wide">
            <span>Grund</span>
            <input
              required
              maxLength={500}
              placeholder="z. B. nach Hause mitgegeben, verloren und gemeldet"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        </EditorDialog>
      )}
    </section>
  );
}
