"use client";

import { useState } from "react";
import { CareDatePicker, CareSelect } from "@/app/components/care-form-controls";
import { EditorDialog, requestJson, todayInZurich } from "@/app/components/workspace-ui";
import { bandFor, scoreAnswers, type Instrument } from "@/lib/assessment-instruments";
import { useCareResident, useTerms } from "@/app/components/care-context";

const plusDays = (days: number) => {
  const date = new Date(`${todayInZurich()}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

export default function AssessmentDialog({
  instruments,
  residents,
  residentId: initialResident,
  instrument: initialInstrument,
  onClose,
  onSaved,
}: {
  // Katalog und eigene Instrumente der Einrichtung (aus /api/assessments).
  instruments: Instrument[];
  residents: Array<{ id: string; name: string; room: string }>;
  residentId?: string;
  instrument?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const t = useTerms();
  const [contextId] = useCareResident();
  const [residentId, setResidentId] = useState(
    initialResident ?? residents.find((r) => r.id === contextId)?.id ?? residents[0]?.id ?? "",
  );
  const byCode = (value: string) => instruments.find((item) => item.code === value);
  const [code, setCode] = useState(
    initialInstrument && byCode(initialInstrument) ? initialInstrument : instruments[0].code,
  );
  const instrument = byCode(code) ?? instruments[0];
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [nextDueOn, setNextDueOn] = useState(() => plusDays(instrument.reassessDays));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const score = scoreAnswers(instrument, answers);
  const band = score === null ? null : bandFor(instrument, score);
  const answered = instrument.items.filter((item) => answers[item.key] !== undefined).length;
  const residentLabel = (r: { name: string; room: string }) => `${r.name}${r.room ? ` · ${r.room}` : ""}`;
  const resident = residents.find((r) => r.id === residentId);

  const chooseInstrument = (name: string) => {
    const next = instruments.find((i) => i.name === name);
    if (!next) return;
    setCode(next.code);
    setAnswers({});
    setNextDueOn(plusDays(next.reassessDays));
  };

  async function save() {
    if (score === null) {
      setError(`Bitte alle ${instrument.items.length} Fragen beantworten (${answered} beantwortet).`);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await requestJson<{ score: number; riskLabel: string | null }>("/api/assessments", {
        method: "POST",
        body: { residentId, instrument: code, answers, note, nextDueOn },
      });
      onSaved(
        `${resident?.name}: ${instrument.name} ${result.score} Punkte${result.riskLabel ? ` · ${result.riskLabel}` : ""}`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Einschätzung konnte nicht gespeichert werden.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="assessment"
      eyebrow="Einschätzungen"
      title={instrument.name}
      description={
        instrument.custom
          ? [instrument.description, `Quelle: ${instrument.custom.source}`].filter(Boolean).join(" · ")
          : instrument.description
      }
      onClose={onClose}
      onSubmit={save}
      saving={saving}
      error={error}
      submitLabel="Einschätzung abschliessen"
    >
      <label>
        <span>{t.one}</span>
        {initialResident ? (
          <input value={resident ? residentLabel(resident) : ""} readOnly />
        ) : (
          <CareSelect
            label={t.one}
            value={resident ? residentLabel(resident) : `${t.oneOblique} wählen`}
            options={residents.map(residentLabel)}
            onChange={(value) => setResidentId(residents.find((r) => residentLabel(r) === value)?.id ?? residentId)}
          />
        )}
      </label>
      <label>
        <span>Instrument</span>
        {initialInstrument ? (
          <input value={instrument.name} readOnly />
        ) : (
          <CareSelect
            label="Instrument"
            value={instrument.name}
            options={instruments.map((i) => i.name)}
            onChange={chooseInstrument}
          />
        )}
      </label>
      {instrument.items.map((item, index) => {
        const chosen = item.options.find((option) => answers[item.key] === option.value);
        const compact = item.options.length > 5;
        return (
          <fieldset key={item.key} className={`area-editor-wide assessment-item ${chosen ? "answered" : ""}`}>
            <legend>
              <span className="assessment-item-number" aria-hidden="true">
                {index + 1}
              </span>
              <span className="assessment-item-title">{item.label}</span>
              <span className="assessment-item-state">
                {chosen ? `${chosen.value} ${chosen.value === 1 ? "Punkt" : "Punkte"}` : "offen"}
              </span>
            </legend>
            <div className={compact ? "compact" : ""}>
              {item.options.map((option) => {
                const active = answers[item.key] === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={active ? "active" : ""}
                    aria-pressed={active}
                    aria-label={compact ? option.label : `${option.label} (${option.value})`}
                    onClick={() => setAnswers((current) => ({ ...current, [item.key]: option.value }))}
                  >
                    {compact ? (
                      option.label
                    ) : (
                      <>
                        <span className="assessment-option-points" aria-hidden="true">
                          {option.value}
                        </span>
                        <span className="assessment-option-label">{option.label}</span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}
      <div className={`area-editor-wide assessment-score ${band?.tone ?? ""}`} aria-live="polite">
        <strong>{score === null ? `${answered} / ${instrument.items.length} beantwortet` : `${score} Punkte`}</strong>
        <span>{band?.label ?? "Ergebnis erscheint, sobald alle Fragen beantwortet sind."}</span>
      </div>
      <label>
        <span>Nächste Einschätzung</span>
        <CareDatePicker label="Nächste Einschätzung" value={nextDueOn} onChange={setNextDueOn} />
      </label>
      <label className="area-editor-wide">
        <span>Bemerkung</span>
        <textarea
          rows={2}
          maxLength={4000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="z. B. Einschätzung nach Sturz, abgeleitete Massnahmen"
        />
      </label>
    </EditorDialog>
  );
}
