"use client";

import { useState } from "react";
import { EditorDialog, ReasonDialog, requestJson, useApiData } from "@/app/components/workspace-ui";
import type { Instrument } from "@/lib/assessment-instruments";

type CustomInstrument = Instrument & { id: string; active: boolean };
type QuestionDraft = { label: string; options: string };
type Draft = {
  id: string | null;
  name: string;
  category: string;
  description: string;
  source: string;
  reassessDays: string;
  questions: QuestionDraft[];
  bands: string;
};

const EMPTY: Draft = {
  id: null,
  name: "",
  category: "",
  description: "",
  source: "",
  reassessDays: "",
  questions: [{ label: "", options: "" }],
  bands: "",
};

// „0 = Text“ je Zeile → Antworten; „0-3 = Text“ je Zeile → Bereiche. Prüfung auf dem Server.
const parseOptions = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(-?\d+)\s*[=:]\s*(.+)$/.exec(line);
      return { value: match ? Number(match[1]) : Number.NaN, label: match ? match[2].trim() : line };
    });
const parseBands = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(-?\d+)\s*[-–]\s*(-?\d+)\s*[=:]\s*(.+)$/.exec(line);
      return match
        ? { min: Number(match[1]), max: Number(match[2]), label: match[3].trim() }
        : { min: Number.NaN, max: Number.NaN, label: line };
    });

function toDraft(instrument: CustomInstrument): Draft {
  return {
    id: instrument.id,
    name: instrument.name,
    category: instrument.category,
    description: instrument.description,
    source: instrument.custom?.source ?? "",
    reassessDays: String(instrument.reassessDays),
    questions: instrument.items.map((item) => ({
      label: item.label,
      options: item.options.map((option) => `${option.value} = ${option.label}`).join("\n"),
    })),
    bands: instrument.bands.map((band) => `${band.min}-${band.max} = ${band.label}`).join("\n"),
  };
}

// Konfiguration: eigene Einschätzungsinstrumente der Einrichtung (z. B. ein lizenziertes Schmerzinstrument).
export function AssessmentInstrumentsCard({ showToast }: { showToast: (message: string) => void }) {
  const data = useApiData<{ instruments: CustomInstrument[] }>("/api/admin/assessment-instruments");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<CustomInstrument | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const instruments = data.data?.instruments ?? [];
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  const setQuestion = (index: number, patch: Partial<QuestionDraft>) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            questions: current.questions.map((question, i) => (i === index ? { ...question, ...patch } : question)),
          }
        : current,
    );

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      await requestJson("/api/admin/assessment-instruments", {
        method: "POST",
        body: {
          id: draft.id,
          name: draft.name,
          category: draft.category,
          description: draft.description,
          source: draft.source,
          reassessDays: Number(draft.reassessDays),
          items: draft.questions.map((question) => ({
            label: question.label,
            options: parseOptions(question.options),
          })),
          bands: parseBands(draft.bands),
        },
      });
      showToast(`„${draft.name}“ gespeichert`);
      setDraft(null);
      data.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card admin-terminology-card admin-retention-card" aria-labelledby="admin-instruments-title">
      <div className="card-header">
        <div>
          <p className="eyebrow">Einschätzungen</p>
          <h2 className="card-title" id="admin-instruments-title">
            Eigene Instrumente
          </h2>
          <p className="card-subtitle">
            Instrumente, die die Einrichtung selbst nutzen darf (z. B. lizenzierte Schmerzinstrumente). Fragen, Punkte,
            Bereiche und Intervall stammen von der Einrichtung; CareOS zählt nur zusammen.
          </p>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            setDraft(EMPTY);
            setError("");
          }}
        >
          Instrument anlegen
        </button>
      </div>
      <div className="admin-retention-list">
        {data.error && <p className="list-hint">{data.error}</p>}
        {instruments.map((instrument) => (
          <div className="admin-retention-row" key={instrument.id}>
            <span>
              <strong>{instrument.name}</strong>
              <small>
                {instrument.active ? "Wird angeboten" : "Nicht mehr angeboten"} · Fassung {instrument.version} ·{" "}
                {instrument.items.length} {instrument.items.length === 1 ? "Frage" : "Fragen"} · Quelle:{" "}
                {instrument.custom?.source}
              </small>
            </span>
            {instrument.active && (
              <span className="occupancy-actions">
                <button
                  className="quiet-button"
                  type="button"
                  onClick={() => {
                    setDraft(toDraft(instrument));
                    setError("");
                  }}
                >
                  Bearbeiten
                </button>
                <button className="quiet-button" type="button" onClick={() => setRemoving(instrument)}>
                  Nicht mehr anbieten
                </button>
              </span>
            )}
          </div>
        ))}
        {data.data && !instruments.length && <p className="list-hint">Noch keine eigenen Instrumente.</p>}
      </div>
      {draft && (
        <EditorDialog
          id="assessment-instrument"
          eyebrow="Einschätzungen · Eigenes Instrument"
          title={draft.id ? "Instrument bearbeiten" : "Instrument anlegen"}
          description="Nur Instrumente erfassen, für die die Einrichtung das Nutzungsrecht hat. Ist das Instrument schon verwendet worden, entsteht beim Speichern eine neue Fassung; frühere Ergebnisse bleiben unverändert."
          onClose={() => setDraft(null)}
          onSubmit={save}
          saving={saving}
          error={error}
          submitLabel="Speichern"
        >
          <label>
            <span>Name</span>
            <input required maxLength={180} value={draft.name} onChange={(event) => set("name", event.target.value)} />
          </label>
          <label>
            <span>Bereich (optional)</span>
            <input
              maxLength={100}
              placeholder="z. B. Schmerz"
              value={draft.category}
              onChange={(event) => set("category", event.target.value)}
            />
          </label>
          <label className="area-editor-wide">
            <span>Quelle und Nutzungsrecht</span>
            <textarea
              required
              rows={2}
              maxLength={1000}
              placeholder="Herausgeber, Fassung, Erlaubnis zur Nutzung (z. B. Datum und Aktenzeichen)"
              value={draft.source}
              onChange={(event) => set("source", event.target.value)}
            />
          </label>
          <label className="area-editor-wide">
            <span>Beschreibung (optional)</span>
            <input
              maxLength={2000}
              value={draft.description}
              onChange={(event) => set("description", event.target.value)}
            />
          </label>
          <label>
            <span>Nächste Einschätzung nach (Tagen)</span>
            <input
              required
              type="number"
              inputMode="numeric"
              min={1}
              max={730}
              value={draft.reassessDays}
              onChange={(event) => set("reassessDays", event.target.value)}
            />
          </label>
          {draft.questions.map((question, index) => (
            <fieldset key={index} className="area-editor-wide">
              <legend>Frage {index + 1}</legend>
              <label>
                <span>Frage</span>
                <input
                  required
                  maxLength={300}
                  value={question.label}
                  onChange={(event) => setQuestion(index, { label: event.target.value })}
                />
              </label>
              <label>
                <span>Antworten (je Zeile: Punkte = Text)</span>
                <textarea
                  rows={3}
                  placeholder={"0 = trifft nicht zu\n1 = trifft teilweise zu\n2 = trifft zu"}
                  value={question.options}
                  onChange={(event) => setQuestion(index, { options: event.target.value })}
                />
              </label>
              {draft.questions.length > 1 && (
                <button
                  className="quiet-button"
                  type="button"
                  onClick={() =>
                    set(
                      "questions",
                      draft.questions.filter((_, i) => i !== index),
                    )
                  }
                >
                  Frage entfernen
                </button>
              )}
            </fieldset>
          ))}
          <div className="area-editor-wide">
            <button
              className="secondary-button"
              type="button"
              onClick={() => set("questions", [...draft.questions, { label: "", options: "" }])}
            >
              Frage hinzufügen
            </button>
          </div>
          <label className="area-editor-wide">
            <span>Bereiche laut Instrument (optional, je Zeile: von-bis = Bezeichnung)</span>
            <textarea rows={3} value={draft.bands} onChange={(event) => set("bands", event.target.value)} />
          </label>
        </EditorDialog>
      )}
      {removing && (
        <ReasonDialog
          title="Instrument nicht mehr anbieten"
          description={`„${removing.name}“ steht danach nicht mehr zur Auswahl. Frühere Ergebnisse bleiben in den Akten.`}
          label="Grund"
          placeholder="z. B. Nutzungsrecht abgelaufen, durch neue Fassung ersetzt"
          submitLabel="Nicht mehr anbieten"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await requestJson("/api/admin/assessment-instruments", { method: "DELETE", body: { id: removing.id } });
            setRemoving(null);
            showToast(`„${removing.name}“ wird nicht mehr angeboten`);
            data.reload();
          }}
        />
      )}
    </section>
  );
}
