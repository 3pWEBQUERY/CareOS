"use client";

import { useState } from "react";
import { EditorDialog, requestJson, useApiData } from "@/app/components/workspace-ui";
import type { StaffOption } from "@/lib/activity-leaders";

type Settings = { staff: StaffOption[]; leaders: StaffOption[] };

// Wer Angebote der Alltagsgestaltung und Aktivierung leitet: Auswahl im Dialog „Angebot planen“.
export function ActivityLeadersCard({ showToast }: { showToast: (message: string) => void }) {
  const data = useApiData<Settings>("/api/admin/activity-leaders");
  const [draft, setDraft] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const leaders = data.data?.leaders ?? [];
  return (
    <section className="card admin-terminology-card admin-retention-card" aria-labelledby="activity-leaders-card-title">
      <div className="card-header">
        <div>
          <p className="eyebrow">Alltag &amp; Aktivierung</p>
          <h2 className="card-title" id="activity-leaders-card-title">
            Leitung von Angeboten
          </h2>
          <p className="card-subtitle">
            {leaders.length
              ? `${leaders.length} ${leaders.length === 1 ? "Person" : "Personen"} · Auswahl bei „Angebot planen“`
              : "Noch niemand zugeteilt – die Einrichtung bestimmt, wer Angebote leitet"}
          </p>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={!data.data}
          onClick={() => {
            setError("");
            setDraft(leaders.map((person) => person.id));
          }}
        >
          {leaders.length ? "Bearbeiten" : "Festlegen"}
        </button>
      </div>
      <div className="admin-retention-list">
        {data.error && <p className="list-hint">{data.error}</p>}
        {leaders.map((person) => (
          <div className="admin-retention-row" key={person.id}>
            <span>
              <strong>{person.name}</strong>
            </span>
          </div>
        ))}
      </div>
      {draft !== null && data.data && (
        <EditorDialog
          id="activity-leaders"
          eyebrow="Konfiguration · Alltag & Aktivierung"
          title="Leitung von Angeboten"
          description="Diese Mitarbeitenden stehen beim Planen eines Angebots als Leitung zur Auswahl. Bereits geplante Angebote behalten ihre Leitung."
          onClose={() => setDraft(null)}
          onSubmit={async () => {
            setSaving(true);
            setError("");
            try {
              await requestJson("/api/admin/activity-leaders", { method: "PUT", body: { leaderIds: draft } });
              setDraft(null);
              data.reload();
              showToast("Leitung von Angeboten gespeichert");
            } catch (cause) {
              setError((cause as Error).message);
            } finally {
              setSaving(false);
            }
          }}
          saving={saving}
          error={error}
          submitLabel="Speichern"
        >
          <fieldset className="area-editor-wide">
            <legend>Mitarbeitende</legend>
            <div className="repositioning-choices" role="group" aria-label="Mitarbeitende">
              {data.data.staff.map((person) => {
                const chosen = draft.includes(person.id);
                return (
                  <button
                    key={person.id}
                    type="button"
                    className={`day-toggle ${chosen ? "active" : ""}`}
                    aria-pressed={chosen}
                    onClick={() => setDraft(chosen ? draft.filter((id) => id !== person.id) : [...draft, person.id])}
                  >
                    {person.name}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </EditorDialog>
      )}
    </section>
  );
}
