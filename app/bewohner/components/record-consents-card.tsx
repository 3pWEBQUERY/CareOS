"use client";

import { useState } from "react";
import { CareDatePicker } from "@/app/components/care-form-controls";
import { ArrowCounterClockwise, Plus } from "@phosphor-icons/react";
import { EditorDialog, formatDate, requestJson, todayInZurich, useApiData } from "@/app/components/workspace-ui";
import {
  CONSENT_DECISIONS,
  CONSENT_STATUS,
  type ConsentDecision,
  type ConsentEntry,
  type ConsentList,
} from "@/lib/consents-shared";

type Draft = { topic: string; decision: ConsentDecision | null; decidedBy: string; decidedOn: string; note: string };

// Einwilligungen und Freigaben (Themen legt die Einrichtung fest): Stand je Thema, neuer Entscheid, Widerruf, Verlauf.
export function RecordConsentsCard({
  residentId,
  residentName,
  onAction,
}: {
  residentId: string;
  residentName: string;
  onAction: (message: string) => void;
}) {
  const list = useApiData<ConsentList>(`/api/residents/${residentId}/consents`);
  const data = list.data;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [revoking, setRevoking] = useState<ConsentEntry | null>(null);
  const [revokedOn, setRevokedOn] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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

  const open = (topic: string) => {
    setError("");
    setDraft({ topic, decision: null, decidedBy: "", decidedOn: todayInZurich(), note: "" });
  };

  return (
    <section className="record-card master-data-card" aria-labelledby="consents-title">
      <div className="record-card-heading">
        <div>
          <span className="record-section-label">Datenschutz</span>
          <h3 id="consents-title">Einwilligungen &amp; Freigaben</h3>
        </div>
        {data?.canWrite && (
          <button type="button" aria-label="Entscheid erfassen" onClick={() => open("")}>
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
        ) : !data.topics.length ? (
          <p className="record-export-note">
            Noch keine Themen – die Administration legt sie unter Leitung › Konfiguration fest (z. B. Fotos, Weitergabe
            von Daten).
          </p>
        ) : (
          <>
            <ul className="death-checklist diagnosis-list" aria-label="Stand je Thema">
              {data.topics.map((item) => (
                <li key={item.topic}>
                  <div>
                    <strong>
                      {item.topic}
                      <span className={`diagnosis-code consent-${item.status}`}>{CONSENT_STATUS[item.status]}</span>
                    </strong>
                    {item.current && (
                      <small>
                        {item.current.revoked
                          ? `Widerrufen am ${formatDate(item.current.revoked.on)}${item.current.revoked.note ? ` · ${item.current.revoked.note}` : ""}`
                          : `${formatDate(item.current.decidedOn)} · ${item.current.decidedBy}${item.current.note ? ` · ${item.current.note}` : ""}`}
                      </small>
                    )}
                  </div>
                  {data.canWrite && (
                    <span className="diagnosis-actions">
                      {item.current && !item.current.revoked && item.current.decision === "granted" && (
                        <button
                          type="button"
                          className="death-checklist-action"
                          aria-label={`${item.topic} widerrufen`}
                          onClick={() => {
                            setError("");
                            setNote("");
                            setRevokedOn(todayInZurich());
                            setRevoking(item.current);
                          }}
                        >
                          <ArrowCounterClockwise aria-hidden="true" />
                        </button>
                      )}
                      <button
                        type="button"
                        className="death-checklist-action"
                        aria-label={`${item.topic}: Entscheid erfassen`}
                        onClick={() => open(item.topic)}
                      >
                        <Plus aria-hidden="true" />
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {data.history.length > 0 && (
              <details className="diagnosis-resolved">
                <summary>Verlauf ({data.history.length})</summary>
                <ul className="death-checklist diagnosis-list" aria-label="Verlauf der Einwilligungen">
                  {data.history.map((entry) => (
                    <li key={entry.id} className="resolved">
                      <div>
                        <strong>
                          {entry.topic}: {CONSENT_DECISIONS[entry.decision]}
                        </strong>
                        <small>
                          {formatDate(entry.decidedOn)} · {entry.decidedBy}
                          {entry.recordedBy ? ` · erfasst von ${entry.recordedBy}` : ""}
                          {entry.revoked ? ` · widerrufen am ${formatDate(entry.revoked.on)}` : ""}
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

      {draft && data && (
        <EditorDialog
          id="consent"
          eyebrow={`${residentName} · Einwilligungen & Freigaben`}
          title="Entscheid erfassen"
          description="Wer hat wann zugestimmt oder abgelehnt? Ein neuer Entscheid gilt ab seinem Datum; frühere bleiben im Verlauf."
          onClose={() => setDraft(null)}
          onSubmit={async () => {
            if (!draft.decision) return setError("Bitte „zugestimmt“ oder „abgelehnt“ wählen.");
            const saved = await run(
              () => requestJson(`/api/residents/${residentId}/consents`, { method: "POST", body: draft }),
              "Entscheid erfasst",
            );
            if (saved) setDraft(null);
          }}
          saving={saving}
          error={error}
          submitLabel="Entscheid speichern"
        >
          <label className="area-editor-wide">
            <span>Thema</span>
            <input
              required
              maxLength={160}
              value={draft.topic}
              onChange={(event) => setDraft({ ...draft, topic: event.target.value })}
            />
          </label>
          {data.topics.length > 0 && (
            <div className="area-editor-wide repositioning-choices" role="group" aria-label="Themen der Einrichtung">
              {data.topics.map((item) => (
                <button
                  key={item.topic}
                  type="button"
                  className={`day-toggle ${draft.topic === item.topic ? "active" : ""}`}
                  aria-pressed={draft.topic === item.topic}
                  onClick={() => setDraft({ ...draft, topic: item.topic })}
                >
                  {item.topic}
                </button>
              ))}
            </div>
          )}
          <fieldset className="area-editor-wide">
            <legend>Entscheid</legend>
            <div className="repositioning-choices" role="group" aria-label="Entscheid">
              {(Object.keys(CONSENT_DECISIONS) as ConsentDecision[]).map((decision) => (
                <button
                  key={decision}
                  type="button"
                  className={`day-toggle ${draft.decision === decision ? "active" : ""}`}
                  aria-pressed={draft.decision === decision}
                  onClick={() => setDraft({ ...draft, decision })}
                >
                  {CONSENT_DECISIONS[decision]}
                </button>
              ))}
            </div>
          </fieldset>
          <label>
            <span>Entschieden von</span>
            <input
              required
              maxLength={200}
              placeholder="z. B. die Person selbst oder Name der Vertretung"
              value={draft.decidedBy}
              onChange={(event) => setDraft({ ...draft, decidedBy: event.target.value })}
            />
          </label>
          <label>
            <span>Datum</span>
            <CareDatePicker
              label="Datum"
              value={draft.decidedOn}
              max={todayInZurich()}
              onChange={(value) => setDraft({ ...draft, decidedOn: value })}
            />
          </label>
          <label className="area-editor-wide">
            <span>Bemerkung</span>
            <input
              maxLength={2000}
              placeholder="z. B. nur Gruppenfotos, keine Veröffentlichung im Internet"
              value={draft.note}
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            />
          </label>
        </EditorDialog>
      )}

      {revoking && (
        <EditorDialog
          id="consent-revoke"
          eyebrow={`${residentName} · Einwilligungen & Freigaben`}
          title="Einwilligung widerrufen"
          description={`„${revoking.topic}“ vom ${formatDate(revoking.decidedOn)} wird als widerrufen vermerkt.`}
          onClose={() => setRevoking(null)}
          onSubmit={async () => {
            const done = await run(
              () => requestJson(`/api/consents/${revoking.id}`, { method: "PATCH", body: { revokedOn, note } }),
              `${revoking.topic}: widerrufen`,
            );
            if (done) setRevoking(null);
          }}
          saving={saving}
          error={error}
          submitLabel="Widerruf speichern"
          danger
        >
          <label>
            <span>Widerrufen am</span>
            <CareDatePicker
              label="Widerrufen am"
              value={revokedOn}
              max={todayInZurich()}
              onChange={(value) => setRevokedOn(value)}
            />
          </label>
          <label className="area-editor-wide">
            <span>Bemerkung</span>
            <input
              maxLength={500}
              placeholder="z. B. telefonisch durch die Tochter"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        </EditorDialog>
      )}
    </section>
  );
}
