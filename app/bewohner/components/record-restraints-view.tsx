"use client";

import { useState } from "react";
import { ClipboardText, NotePencil, Plus } from "@phosphor-icons/react";
import { useTerms, useWorkContext } from "@/app/components/care-context";
import { CareDatePicker, CareOptionSelect } from "@/app/components/care-form-controls";
import { EditorDialog, formatDate, formatDateTime, requestJson, useApiData } from "@/app/components/workspace-ui";
import {
  RESTRAINT_CONSENT,
  RESTRAINT_KINDS,
  RESTRAINT_KIND_KEYS,
  RESTRAINT_LAW,
  RESTRAINT_REVIEW_OUTCOMES,
  restraintLabel,
  type RestraintConsent,
  type RestraintKind,
  type RestraintMeasure,
  type RestraintReviewOutcome,
} from "@/lib/restraints-shared";
import type { ResidentRecordState } from "./use-resident-record";

type Draft = {
  id: string | null;
  kind: RestraintKind | "";
  description: string;
  reason: string;
  alternatives: string;
  schedule: string;
  orderedBy: string;
  residentConsent: RestraintConsent | "";
  residentInformed: boolean;
  representativeName: string;
  representativeInformed: boolean;
  representativeInformedOn: string;
  approvalReference: string;
  startDate: string;
  startTime: string;
  planned: boolean;
  plannedUntil: string;
  reviewOn: string;
};

type ReviewDraft = {
  measure: RestraintMeasure;
  outcome: RestraintReviewOutcome | "";
  note: string;
  nextReviewOn: string;
};

const zurichDay = (date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(date);
const zurichTime = (date = new Date()) =>
  new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" }).format(date);

const emptyDraft = (representativeName = ""): Draft => ({
  id: null,
  kind: "",
  description: "",
  reason: "",
  alternatives: "",
  schedule: "",
  orderedBy: "",
  residentConsent: "",
  residentInformed: false,
  representativeName,
  representativeInformed: false,
  representativeInformedOn: zurichDay(),
  approvalReference: "",
  startDate: zurichDay(),
  startTime: zurichTime(),
  planned: false,
  plannedUntil: zurichDay(),
  // Den Termin der ersten Überprüfung legt die Person fest, die erfasst; vorgeschlagen ist der heutige Tag.
  reviewOn: zurichDay(),
});

const draftFrom = (measure: RestraintMeasure): Draft => ({
  id: measure.id,
  kind: measure.kind,
  description: measure.description,
  reason: measure.reason,
  alternatives: measure.alternatives,
  schedule: measure.schedule,
  orderedBy: measure.orderedBy,
  residentConsent: measure.residentConsent,
  residentInformed: measure.residentInformed,
  representativeName: measure.representativeName,
  representativeInformed: measure.representativeInformedOn !== null,
  representativeInformedOn: measure.representativeInformedOn ?? zurichDay(),
  approvalReference: measure.approvalReference,
  startDate: zurichDay(new Date(measure.startsAt)),
  startTime: zurichTime(new Date(measure.startsAt)),
  planned: measure.plannedUntil !== null,
  plannedUntil: measure.plannedUntil ?? zurichDay(),
  reviewOn: measure.reviewOn,
});

// Ortszeit Zürich (Datum + Uhrzeit) als Zeitpunkt; die Abweichung wird für das gewählte Datum bestimmt.
function zurichInstant(day: string, time: string) {
  const guess = new Date(`${day}T${time}:00Z`);
  const local = new Date(guess.toLocaleString("en-US", { timeZone: "Europe/Zurich" }));
  const utc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() - (local.getTime() - utc.getTime())).toISOString();
}

export function RecordRestraintsView({ r }: { r: ResidentRecordState }) {
  const t = useTerms();
  const context = useWorkContext();
  const law = RESTRAINT_LAW[context?.country ?? "CH"];
  const { resident, contentRef, onAction } = r;
  const data = useApiData<{ measures: RestraintMeasure[]; canWrite: boolean }>(
    resident.id ? `/api/restraints?residentId=${resident.id}` : null,
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [review, setReview] = useState<ReviewDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const measures = data.data?.measures ?? [];
  const active = measures.filter((measure) => !measure.endedAt);
  const ended = measures.filter((measure) => measure.endedAt);
  const canWrite = data.data?.canWrite ?? false;
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  async function save() {
    if (!draft || !resident.id) return;
    setSaving(true);
    setError("");
    try {
      const body = {
        id: draft.id,
        residentId: resident.id,
        kind: draft.kind,
        description: draft.description,
        reason: draft.reason,
        alternatives: draft.alternatives,
        schedule: draft.schedule,
        orderedBy: draft.orderedBy,
        residentConsent: draft.residentConsent,
        residentInformed: draft.residentInformed,
        representativeName: draft.representativeName,
        representativeInformedOn: draft.representativeInformed ? draft.representativeInformedOn : null,
        approvalReference: draft.approvalReference,
        startsAt: zurichInstant(draft.startDate, draft.startTime),
        plannedUntil: draft.planned ? draft.plannedUntil : null,
        reviewOn: draft.reviewOn,
      };
      await requestJson("/api/restraints", { method: draft.id ? "PATCH" : "POST", body });
      setDraft(null);
      data.reload();
      onAction(draft.id ? "Massnahme aktualisiert" : "Massnahme erfasst");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Massnahme konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  async function saveReview() {
    if (!review) return;
    setSaving(true);
    setError("");
    try {
      await requestJson("/api/restraints/review", {
        method: "POST",
        body: {
          id: review.measure.id,
          outcome: review.outcome,
          note: review.note,
          nextReviewOn: review.outcome === "continue" ? review.nextReviewOn : null,
        },
      });
      setReview(null);
      data.reload();
      onAction(review.outcome === "end" ? "Massnahme beendet" : "Überprüfung gespeichert");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Überprüfung konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  const facts = (measure: RestraintMeasure) =>
    [
      ["Grund und Zweck", measure.reason],
      ["Geprüfte mildere Massnahmen", measure.alternatives],
      ["Zeitraum", measure.schedule || "durchgehend"],
      ["Angeordnet von", measure.orderedBy],
      [
        "Haltung der Person",
        `${RESTRAINT_CONSENT[measure.residentConsent]}${measure.residentInformed ? " · vorab informiert" : " · nicht vorab informiert"}`,
      ],
      [
        "Vertretung",
        measure.representativeInformedOn
          ? `${measure.representativeName || "Vertretung"} · informiert am ${formatDate(measure.representativeInformedOn)}`
          : `${measure.representativeName || "Keine Angabe"} · noch nicht informiert`,
      ],
      [law.approval, measure.approvalReference || "–"],
      ["Beginn", formatDateTime(measure.startsAt)],
      ["Geplantes Ende", measure.plannedUntil ? formatDate(measure.plannedUntil) : "offen"],
    ] as const;

  return (
    <main className="resident-record-content restraints-view" ref={contentRef} key="restraints">
      <div className="record-subpage-heading">
        <div>
          <span className="record-section-label">{`${t.prefix}akte`}</span>
          <h3>Freiheitsbeschränkende Massnahmen</h3>
          <p>Protokoll nach {law.basis}: Art, Grund, anordnende Person, Information und regelmässige Überprüfung.</p>
        </div>
        {canWrite && (
          <button
            className="primary-button"
            type="button"
            onClick={() => {
              setError("");
              setDraft(emptyDraft(r.live.summary.data?.representative?.name ?? ""));
            }}
          >
            <Plus aria-hidden="true" /> Massnahme erfassen
          </button>
        )}
      </div>

      {data.error && (
        <p className="restraints-error" role="alert">
          {data.error}
        </p>
      )}
      {data.loading && !data.data && <p className="restraints-empty">Massnahmen werden geladen…</p>}
      {data.data && !active.length && (
        <p className="restraints-empty">Keine laufende freiheitsbeschränkende Massnahme.</p>
      )}

      <div className="restraints-list">
        {active.map((measure) => (
          <section className="record-card restraint-card" key={measure.id} aria-label={restraintLabel(measure)}>
            <div className="record-card-heading">
              <div>
                <span className="record-section-label">Laufend seit {formatDate(measure.startsAt)}</span>
                <h3>{restraintLabel(measure)}</h3>
              </div>
              <div className="restraint-badges">
                {!measure.representativeInformedOn && (
                  <span className="status-badge attention">Vertretung nicht informiert</span>
                )}
                <span className={`status-badge ${measure.reviewDue ? "critical" : "info"}`}>
                  {measure.reviewDue ? "Überprüfung fällig" : "Überprüfung"} {formatDate(measure.reviewOn)}
                </span>
              </div>
            </div>
            {measure.kind !== "other" && measure.description && (
              <p className="restraint-description">{measure.description}</p>
            )}
            <dl className="restraint-facts">
              {facts(measure).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {measure.reviews.length > 0 && (
              <ol className="restraint-reviews" aria-label="Überprüfungen">
                {measure.reviews.map((item) => (
                  <li key={item.id}>
                    <strong>
                      {formatDateTime(item.reviewedAt)} · {RESTRAINT_REVIEW_OUTCOMES[item.outcome]}
                    </strong>
                    <span>{item.note}</span>
                    <small>
                      {item.reviewedBy}
                      {item.nextReviewOn ? ` · nächste Überprüfung ${formatDate(item.nextReviewOn)}` : ""}
                    </small>
                  </li>
                ))}
              </ol>
            )}
            {canWrite && (
              <div className="restraint-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setError("");
                    setDraft(draftFrom(measure));
                  }}
                >
                  <NotePencil aria-hidden="true" /> Bearbeiten
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => {
                    setError("");
                    setReview({ measure, outcome: "", note: "", nextReviewOn: zurichDay() });
                  }}
                >
                  <ClipboardText aria-hidden="true" /> Überprüfen
                </button>
              </div>
            )}
          </section>
        ))}
      </div>

      {ended.length > 0 && (
        <details className="restraints-ended">
          <summary>Beendete Massnahmen ({ended.length})</summary>
          <ul>
            {ended.map((measure) => (
              <li key={measure.id}>
                <strong>{restraintLabel(measure)}</strong>
                <span>
                  {formatDate(measure.startsAt)} – {formatDate(measure.endedAt)} · {measure.endReason}
                </span>
                <small>
                  Angeordnet von {measure.orderedBy} · {measure.reviews.length} Überprüfung
                  {measure.reviews.length === 1 ? "" : "en"}
                </small>
              </li>
            ))}
          </ul>
        </details>
      )}

      {draft && (
        <EditorDialog
          id="restraint-editor"
          eyebrow="Freiheitsbeschränkende Massnahme"
          title={draft.id ? "Massnahme bearbeiten" : "Massnahme erfassen"}
          description={`Nur wenn mildere Massnahmen nicht genügen. Jede Änderung wird protokolliert (${law.basis}).`}
          onClose={() => setDraft(null)}
          onSubmit={save}
          saving={saving}
          error={error}
          submitLabel={draft.id ? "Speichern" : "Erfassen"}
        >
          <label className="area-editor-wide">
            <span>Art der Massnahme</span>
            <CareOptionSelect
              label="Art der Massnahme"
              value={draft.kind}
              options={RESTRAINT_KIND_KEYS.map((key) => ({ value: key, label: RESTRAINT_KINDS[key] }))}
              onChange={(value) => update("kind", value as RestraintKind)}
            />
          </label>
          <label className="area-editor-wide">
            <span>{draft.kind === "other" ? "Beschreibung" : "Beschreibung (optional)"}</span>
            <input
              value={draft.description}
              maxLength={2000}
              required={draft.kind === "other"}
              placeholder="z. B. beidseitig, nur nachts hochgestellt"
              onChange={(event) => update("description", event.target.value)}
            />
          </label>
          <label className="area-editor-wide">
            <span>Grund und Zweck</span>
            <textarea
              value={draft.reason}
              rows={3}
              maxLength={4000}
              required
              onChange={(event) => update("reason", event.target.value)}
            />
          </label>
          <label className="area-editor-wide">
            <span>Geprüfte mildere Massnahmen</span>
            <textarea
              value={draft.alternatives}
              rows={3}
              maxLength={4000}
              required
              placeholder="Was wurde versucht oder geprüft und warum genügt es nicht?"
              onChange={(event) => update("alternatives", event.target.value)}
            />
          </label>
          <label>
            <span>Anordnende Person (Name, Funktion)</span>
            <input
              value={draft.orderedBy}
              maxLength={160}
              required
              onChange={(event) => update("orderedBy", event.target.value)}
            />
          </label>
          <label>
            <span>Zeitraum (optional)</span>
            <input
              value={draft.schedule}
              maxLength={500}
              placeholder="z. B. nachts 22–6 Uhr"
              onChange={(event) => update("schedule", event.target.value)}
            />
          </label>
          <label>
            <span>Beginn</span>
            <CareDatePicker label="Beginn" value={draft.startDate} onChange={(value) => update("startDate", value)} />
          </label>
          <label>
            <span>Uhrzeit</span>
            <input
              type="time"
              required
              value={draft.startTime}
              onChange={(event) => update("startTime", event.target.value)}
            />
          </label>
          <div className="form-field">
            <span>Dauer</span>
            <label className="form-checkbox">
              <input
                type="checkbox"
                checked={draft.planned}
                onChange={(event) => update("planned", event.target.checked)}
              />
              befristet
            </label>
          </div>
          {draft.planned && (
            <label>
              <span>Geplantes Ende</span>
              <CareDatePicker
                label="Geplantes Ende"
                value={draft.plannedUntil}
                onChange={(value) => update("plannedUntil", value)}
              />
            </label>
          )}
          <label>
            <span>Nächste Überprüfung</span>
            <CareDatePicker
              label="Nächste Überprüfung"
              value={draft.reviewOn}
              onChange={(value) => update("reviewOn", value)}
            />
          </label>
          <label>
            <span>Haltung der Person</span>
            <CareOptionSelect
              label="Haltung der Person"
              value={draft.residentConsent}
              options={(Object.keys(RESTRAINT_CONSENT) as RestraintConsent[]).map((key) => ({
                value: key,
                label: RESTRAINT_CONSENT[key],
              }))}
              onChange={(value) => update("residentConsent", value as RestraintConsent)}
            />
          </label>
          <div className="form-field">
            <span>Information der Person</span>
            <label className="form-checkbox">
              <input
                type="checkbox"
                checked={draft.residentInformed}
                onChange={(event) => update("residentInformed", event.target.checked)}
              />
              vorab erklärt (Grund, Art, Dauer)
            </label>
          </div>
          <label>
            <span>Vertretungsberechtigte Person</span>
            <input
              value={draft.representativeName}
              maxLength={160}
              onChange={(event) => update("representativeName", event.target.value)}
            />
          </label>
          <div className="form-field">
            <span>Information der Vertretung</span>
            <label className="form-checkbox">
              <input
                type="checkbox"
                checked={draft.representativeInformed}
                onChange={(event) => update("representativeInformed", event.target.checked)}
              />
              informiert
            </label>
          </div>
          {draft.representativeInformed && (
            <label>
              <span>Informiert am</span>
              <CareDatePicker
                label="Informiert am"
                value={draft.representativeInformedOn}
                onChange={(value) => update("representativeInformedOn", value)}
              />
            </label>
          )}
          <label className="area-editor-wide">
            <span>{`${law.approval} (optional)`}</span>
            <input
              value={draft.approvalReference}
              maxLength={240}
              placeholder={law.approvalHint}
              onChange={(event) => update("approvalReference", event.target.value)}
            />
          </label>
        </EditorDialog>
      )}

      {review && (
        <EditorDialog
          id="restraint-review"
          eyebrow={restraintLabel(review.measure)}
          title="Massnahme überprüfen"
          description="Ist die Massnahme weiterhin nötig? Das Ergebnis wird mit Begründung festgehalten."
          onClose={() => setReview(null)}
          onSubmit={saveReview}
          saving={saving}
          error={error}
          submitLabel={review.outcome === "end" ? "Massnahme beenden" : "Überprüfung speichern"}
        >
          <fieldset className="area-editor-wide">
            <legend>Ergebnis</legend>
            <div className="area-service-options">
              {(Object.keys(RESTRAINT_REVIEW_OUTCOMES) as RestraintReviewOutcome[]).map((outcome) => (
                <label key={outcome}>
                  <input
                    type="radio"
                    name="restraint-outcome"
                    checked={review.outcome === outcome}
                    onChange={() => setReview({ ...review, outcome })}
                  />
                  <span>{RESTRAINT_REVIEW_OUTCOMES[outcome]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="area-editor-wide">
            <span>{review.outcome === "end" ? "Grund für das Beenden" : "Begründung"}</span>
            <textarea
              value={review.note}
              rows={4}
              maxLength={4000}
              required
              onChange={(event) => setReview({ ...review, note: event.target.value })}
            />
          </label>
          {review.outcome === "continue" && (
            <label>
              <span>Nächste Überprüfung</span>
              <CareDatePicker
                label="Nächste Überprüfung"
                value={review.nextReviewOn}
                onChange={(value) => setReview({ ...review, nextReviewOn: value })}
              />
            </label>
          )}
        </EditorDialog>
      )}
    </main>
  );
}
