"use client";

import Link from "next/link";
import { useState } from "react";
import { setCareResident, useCareResident, useTerms, useWorkContext } from "@/app/components/care-context";
import { CareDatePicker, CareOptionSelect } from "@/app/components/care-form-controls";
import ModulePageShell from "@/app/components/module-page-shell";
import {
  EditorDialog,
  EmptyState,
  LoadError,
  PageHeading,
  ReasonDialog,
  SummaryTiles,
  formatDate,
  formatDateTime,
  requestJson,
  timeInZurich,
  todayInZurich,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import {
  ISOLATION_KIND_KEYS,
  ISOLATION_KINDS,
  ISOLATION_REVIEW_OUTCOMES,
  isolationLabel,
  type HygieneOverview,
  type IsolationMeasure,
  type IsolationReviewOutcome,
  type Outbreak,
} from "@/lib/hygiene-shared";
import { zurichTimeToIso } from "@/lib/resident-appointments";
import { VaccinationOverviewCard } from "./vaccination-overview-card";

type Reload = () => void;

function IsolationDialog({
  outbreaks,
  onClose,
  onSaved,
}: {
  outbreaks: Outbreak[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const t = useTerms();
  const context = useWorkContext();
  const [contextId] = useCareResident();
  const residents = context?.residents ?? [];
  const [residentId, setResidentId] = useState(residents.some((r) => r.id === contextId) ? (contextId ?? "") : "");
  const [kind, setKind] = useState("contact");
  const [reason, setReason] = useState("");
  const [orderedBy, setOrderedBy] = useState("");
  const [precautions, setPrecautions] = useState("");
  const [startDay, setStartDay] = useState(todayInZurich);
  const [startTime, setStartTime] = useState(() => timeInZurich());
  const [reviewOn, setReviewOn] = useState(todayInZurich);
  const [outbreakId, setOutbreakId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setSaving(true);
    setError("");
    try {
      await requestJson("/api/hygiene/isolations", {
        method: "POST",
        body: {
          residentId,
          kind,
          reason,
          orderedBy,
          precautions,
          startsAt: zurichTimeToIso(startDay, startTime),
          reviewOn,
          outbreakId: outbreakId || null,
        },
      });
      onSaved("Isolation erfasst – die Leitung ist informiert");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="isolation-create"
      eyebrow="Isolation & Ausbruch"
      title="Isolation erfassen"
      description="Anlass und Massnahmen so, wie sie angeordnet wurden (Ärztin/Arzt, Hygienefachperson). CareOS stellt keine Diagnose."
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Erfassen"
    >
      <label className="area-editor-wide">
        <span>{t.one}</span>
        <CareOptionSelect
          label={t.one}
          value={residentId}
          onChange={setResidentId}
          placeholder={`${t.oneOblique} wählen`}
          options={residents.map((resident) => ({
            value: resident.id,
            label: [resident.name, resident.room, resident.group].filter(Boolean).join(" · "),
          }))}
        />
      </label>
      <label className="area-editor-wide">
        <span>Art der Isolation</span>
        <CareOptionSelect
          label="Art der Isolation"
          value={kind}
          onChange={setKind}
          options={ISOLATION_KIND_KEYS.map((key) => ({ value: key, label: ISOLATION_KINDS[key] }))}
        />
      </label>
      <label className="area-editor-wide">
        <span>Anlass laut Anordnung</span>
        <textarea
          required
          rows={3}
          maxLength={2000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="z. B. Befund laut Labor vom …, Anordnung Hausärztin"
        />
      </label>
      <label className="area-editor-wide">
        <span>Angeordnet von</span>
        <input
          required
          maxLength={160}
          value={orderedBy}
          onChange={(event) => setOrderedBy(event.target.value)}
          placeholder="Name, Funktion"
        />
      </label>
      <label className="area-editor-wide">
        <span>Hygienemassnahmen</span>
        <textarea
          rows={3}
          maxLength={2000}
          value={precautions}
          onChange={(event) => setPrecautions(event.target.value)}
          placeholder="z. B. Schutzkittel und Handschuhe bei der Pflege, eigenes WC, Mahlzeiten im Zimmer"
        />
      </label>
      <label>
        <span>Beginn</span>
        <CareDatePicker label="Beginn" value={startDay} onChange={setStartDay} />
      </label>
      <label>
        <span>Uhrzeit</span>
        <input type="time" required value={startTime} onChange={(event) => setStartTime(event.target.value)} />
      </label>
      <label>
        <span>Nächste Überprüfung</span>
        <CareDatePicker label="Nächste Überprüfung" value={reviewOn} onChange={setReviewOn} />
      </label>
      {outbreaks.length > 0 && (
        <label>
          <span>Ausbruch</span>
          <CareOptionSelect
            label="Ausbruch"
            value={outbreakId}
            onChange={setOutbreakId}
            options={[
              { value: "", label: "Keinem Ausbruch zugeordnet" },
              ...outbreaks.map((item) => ({ value: item.id, label: item.title })),
            ]}
          />
        </label>
      )}
    </EditorDialog>
  );
}

function ReviewDialog({
  measure,
  onClose,
  onSaved,
}: {
  measure: IsolationMeasure;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [outcome, setOutcome] = useState<IsolationReviewOutcome>("continue");
  const [note, setNote] = useState("");
  const [nextReviewOn, setNextReviewOn] = useState(todayInZurich);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setSaving(true);
    setError("");
    try {
      await requestJson(`/api/hygiene/isolations/${measure.id}/review`, {
        method: "POST",
        body: { outcome, note, nextReviewOn: outcome === "continue" ? nextReviewOn : null },
      });
      onSaved(outcome === "end" ? "Isolation aufgehoben" : "Überprüfung gespeichert");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="isolation-review"
      eyebrow={measure.residentName}
      title="Isolation überprüfen"
      description={`${isolationLabel(measure.kind)} seit ${formatDate(measure.startsAt)}. Weiterführen oder aufheben gemäss Anordnung.`}
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel={outcome === "end" ? "Aufheben" : "Speichern"}
      danger={outcome === "end"}
    >
      <label className="area-editor-wide">
        <span>Ergebnis</span>
        <CareOptionSelect
          label="Ergebnis"
          value={outcome}
          onChange={(value) => setOutcome(value as IsolationReviewOutcome)}
          options={Object.entries(ISOLATION_REVIEW_OUTCOMES).map(([value, label]) => ({ value, label }))}
        />
      </label>
      <label className="area-editor-wide">
        <span>{outcome === "end" ? "Grund für das Aufheben" : "Ergebnis der Überprüfung"}</span>
        <textarea
          required
          rows={3}
          maxLength={2000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={outcome === "end" ? "z. B. Aufhebung laut Hausärztin am …" : "z. B. Kontrollbefund ausstehend"}
        />
      </label>
      {outcome === "continue" && (
        <label>
          <span>Nächste Überprüfung</span>
          <CareDatePicker label="Nächste Überprüfung" value={nextReviewOn} onChange={setNextReviewOn} />
        </label>
      )}
    </EditorDialog>
  );
}

function OutbreakDialog({
  outbreak,
  onClose,
  onSaved,
}: {
  outbreak: Outbreak | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const context = useWorkContext();
  const units = context?.careUnits ?? [];
  const [title, setTitle] = useState(outbreak?.title ?? "");
  const [careUnitId, setCareUnitId] = useState(outbreak?.careUnitId ?? "");
  const [measures, setMeasures] = useState(outbreak?.measures ?? "");
  const [reported, setReported] = useState(outbreak?.authorityReportedOn ? "yes" : "no");
  const [reportedOn, setReportedOn] = useState(outbreak?.authorityReportedOn ?? todayInZurich());
  const [authorityNote, setAuthorityNote] = useState(outbreak?.authorityNote ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setSaving(true);
    setError("");
    const report = { measures, authorityReportedOn: reported === "yes" ? reportedOn : null, authorityNote };
    try {
      if (outbreak) await requestJson(`/api/hygiene/outbreaks/${outbreak.id}`, { method: "PATCH", body: report });
      else
        await requestJson("/api/hygiene/outbreaks", {
          method: "POST",
          body: { title, careUnitId: careUnitId || null, ...report },
        });
      onSaved(outbreak ? "Ausbruch gespeichert" : "Ausbruch erfasst – die Mitarbeitenden sind informiert");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="outbreak"
      eyebrow="Isolation & Ausbruch"
      title={outbreak ? "Ausbruch bearbeiten" : "Ausbruch erfassen"}
      description={
        outbreak
          ? "Massnahmen und Meldung an die Behörde nachtragen."
          : "Die Leitung erklärt den Ausbruch; die Mitarbeitenden des Bereichs werden benachrichtigt. Meldepflichten richten sich nach den Vorgaben von Kanton bzw. Land."
      }
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Speichern"
    >
      {!outbreak && (
        <>
          <label className="area-editor-wide">
            <span>Bezeichnung</span>
            <input
              required
              maxLength={160}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="z. B. Gastroenteritis Wohnbereich 2"
            />
          </label>
          <label className="area-editor-wide">
            <span>Betroffener Bereich</span>
            <CareOptionSelect
              label="Betroffener Bereich"
              value={careUnitId}
              onChange={setCareUnitId}
              options={[
                { value: "", label: "Ganzes Haus" },
                ...units.map((unit) => ({ value: unit.id, label: unit.name })),
              ]}
            />
          </label>
        </>
      )}
      <label className="area-editor-wide">
        <span>Massnahmen</span>
        <textarea
          rows={4}
          maxLength={4000}
          value={measures}
          onChange={(event) => setMeasures(event.target.value)}
          placeholder="z. B. Besuchsregelung, Schutzausrüstung, Mahlzeiten im Zimmer, Reinigung"
        />
      </label>
      <label>
        <span>Meldung an die Behörde</span>
        <CareOptionSelect
          label="Meldung an die Behörde"
          value={reported}
          onChange={setReported}
          options={[
            { value: "no", label: "Nicht gemeldet" },
            { value: "yes", label: "Gemeldet am" },
          ]}
        />
      </label>
      {reported === "yes" && (
        <label>
          <span>Gemeldet am</span>
          <CareDatePicker label="Gemeldet am" value={reportedOn} onChange={setReportedOn} />
        </label>
      )}
      <label className="area-editor-wide">
        <span>Notiz zur Meldung (optional)</span>
        <input
          maxLength={400}
          value={authorityNote}
          onChange={(event) => setAuthorityNote(event.target.value)}
          placeholder="z. B. Kantonsärztlicher Dienst, Ansprechperson"
        />
      </label>
    </EditorDialog>
  );
}

function OutbreakCard({
  outbreak,
  canManage,
  onEdit,
  onEnd,
}: {
  outbreak: Outbreak;
  canManage: boolean;
  onEdit: () => void;
  onEnd: () => void;
}) {
  return (
    <section className="card outbreak-card" aria-label={`Ausbruch: ${outbreak.title}`}>
      <header>
        <div>
          <p className="eyebrow">Laufender Ausbruch · {outbreak.careUnit ?? "Ganzes Haus"}</p>
          <h2 className="card-title">{outbreak.title}</h2>
          <p className="card-subtitle">
            Seit {formatDateTime(outbreak.declaredAt)} · erfasst von {outbreak.declaredBy} · {outbreak.activeIsolations}{" "}
            {outbreak.activeIsolations === 1 ? "Isolation" : "Isolationen"} zugeordnet
          </p>
        </div>
        {canManage && (
          <div className="outbreak-actions">
            <button className="secondary-button" type="button" onClick={onEdit}>
              Bearbeiten
            </button>
            <button className="danger-button" type="button" onClick={onEnd}>
              Ausbruch beenden
            </button>
          </div>
        )}
      </header>
      {outbreak.measures && <p className="outbreak-measures">{outbreak.measures}</p>}
      <p className="outbreak-authority">
        {outbreak.authorityReportedOn
          ? `Meldung an die Behörde am ${formatDate(outbreak.authorityReportedOn)}`
          : "Meldung an die Behörde: nicht erfasst"}
        {outbreak.authorityNote && ` · ${outbreak.authorityNote}`}
      </p>
    </section>
  );
}

function IsolationRow({ measure, onReview }: { measure: IsolationMeasure; onReview: (() => void) | null }) {
  const last = measure.reviews.at(-1);
  return (
    <li className="isolation-row">
      <div className="isolation-person">
        <Link href={`/c/bewohner?resident=${measure.residentId}`} onClick={() => setCareResident(measure.residentId)}>
          {measure.residentName}
        </Link>
        <small>{measure.room || "–"}</small>
      </div>
      <div className="isolation-detail">
        <strong>{isolationLabel(measure.kind)}</strong>
        <p>{measure.reason}</p>
        {measure.precautions && <p className="isolation-precautions">{measure.precautions}</p>}
        <small>
          Seit {formatDateTime(measure.startsAt)} · angeordnet von {measure.orderedBy}
          {last && ` · zuletzt überprüft ${formatDate(last.reviewedAt)}: ${last.note}`}
        </small>
      </div>
      <div className="isolation-review">
        <span className={`status-badge ${measure.reviewDue ? "attention" : "stable"}`}>
          {measure.reviewDue ? "Überprüfung fällig" : `Überprüfung ${formatDate(measure.reviewOn)}`}
        </span>
        {onReview && (
          <button className="secondary-button" type="button" onClick={onReview}>
            Überprüfen
          </button>
        )}
      </div>
    </li>
  );
}

function HygieneContent({ showToast }: { showToast: ShowToast }) {
  const t = useTerms();
  const context = useWorkContext();
  const units = context?.careUnits ?? [];
  const [unitId, setUnitId] = useState("");
  const [creating, setCreating] = useState(false);
  const [reviewing, setReviewing] = useState<IsolationMeasure | null>(null);
  const [editingOutbreak, setEditingOutbreak] = useState<Outbreak | null | "new">(null);
  const [endingOutbreak, setEndingOutbreak] = useState<Outbreak | null>(null);
  const data = useApiData<HygieneOverview>(`/api/hygiene${unitId ? `?careUnitId=${encodeURIComponent(unitId)}` : ""}`);
  const overview = data.data?.careUnitId === (unitId || null) ? data.data : null;
  const reload: Reload = data.reload;
  const done = (message: string) => {
    setCreating(false);
    setReviewing(null);
    setEditingOutbreak(null);
    showToast(message);
    reload();
  };

  const groups = new Map<string, IsolationMeasure[]>();
  for (const measure of overview?.active ?? []) {
    const key = measure.careUnit || "Ohne Wohnbereich";
    groups.set(key, [...(groups.get(key) ?? []), measure]);
  }

  return (
    <>
      <PageHeading
        eyebrow={`CareOS ${t.many}`}
        title="Isolation & Ausbruch"
        description={`Laufende Isolationen je Wohnbereich mit Überprüfung, Ausbrüche der Einrichtung und der Verlauf. Organisatorisch – Anlass und Massnahmen gemäss Anordnung.`}
        action={overview?.canWrite ? { label: "Isolation erfassen", onClick: () => setCreating(true) } : undefined}
      />
      <section className="hygiene-toolbar">
        <CareOptionSelect
          label="Wohnbereich"
          value={unitId}
          onChange={setUnitId}
          options={[
            { value: "", label: "Alle Wohnbereiche" },
            ...units.map((unit) => ({ value: unit.id, label: unit.name })),
          ]}
        />
        {overview?.canManage && (
          <button className="secondary-button" type="button" onClick={() => setEditingOutbreak("new")}>
            Ausbruch erfassen
          </button>
        )}
        <p>
          CareOS stellt keine Diagnose und erklärt keinen Ausbruch selbst. Neue Isolationen und Ausbrüche werden der
          Leitung gemeldet.
        </p>
      </section>
      {data.error && <LoadError message={data.error} onRetry={reload} />}
      {overview?.outbreaks.map((outbreak) => (
        <OutbreakCard
          key={outbreak.id}
          outbreak={outbreak}
          canManage={overview.canManage}
          onEdit={() => setEditingOutbreak(outbreak)}
          onEnd={() => setEndingOutbreak(outbreak)}
        />
      ))}
      <SummaryTiles
        label="Isolationen"
        tiles={[
          {
            icon: "alert",
            value: overview ? overview.active.length : "–",
            caption: "laufende Isolationen",
            tone: overview?.active.length ? "attention" : undefined,
          },
          {
            icon: "calendar",
            value: overview ? overview.active.filter((item) => item.reviewDue).length : "–",
            caption: "Überprüfung fällig",
            tone: overview?.active.some((item) => item.reviewDue) ? "attention" : undefined,
          },
          {
            icon: "quality",
            value: overview ? overview.outbreaks.length : "–",
            caption: "laufende Ausbrüche",
            tone: overview?.outbreaks.length ? "critical" : undefined,
          },
        ]}
      />
      {overview && !overview.active.length && (
        <section className="card hygiene-empty">
          <EmptyState
            icon="check"
            title="Keine laufenden Isolationen"
            text="Isolationen erscheinen hier, bis sie bei der Überprüfung aufgehoben werden."
          />
        </section>
      )}
      {[...groups].map(([unit, measures]) => (
        <section className="card isolation-group" key={unit} aria-label={`Isolationen ${unit}`}>
          <header>
            <h2 className="card-title">{unit}</h2>
            <p className="card-subtitle">
              {measures.length} {measures.length === 1 ? "laufende Isolation" : "laufende Isolationen"}
            </p>
          </header>
          <ul>
            {measures.map((measure) => (
              <IsolationRow
                key={measure.id}
                measure={measure}
                onReview={overview?.canWrite ? () => setReviewing(measure) : null}
              />
            ))}
          </ul>
        </section>
      ))}
      {overview && (overview.ended.length > 0 || overview.endedOutbreaks.length > 0) && (
        <section className="card hygiene-history" aria-label="Verlauf der letzten 90 Tage">
          <header>
            <h2 className="card-title">Verlauf der letzten 90 Tage</h2>
            <p className="card-subtitle">Aufgehobene Isolationen und beendete Ausbrüche</p>
          </header>
          <ul>
            {overview.endedOutbreaks.map((outbreak) => (
              <li key={outbreak.id}>
                <strong>Ausbruch: {outbreak.title}</strong>
                <small>
                  {outbreak.careUnit ?? "Ganzes Haus"} · {formatDate(outbreak.declaredAt)} –{" "}
                  {formatDate(outbreak.endedAt)}
                </small>
                <p>{outbreak.endNote}</p>
              </li>
            ))}
            {overview.ended.map((measure) => (
              <li key={measure.id}>
                <strong>
                  {measure.residentName} · {isolationLabel(measure.kind)}
                </strong>
                <small>
                  {measure.careUnit || "–"} · {formatDate(measure.startsAt)} – {formatDate(measure.endedAt)}
                </small>
                <p>{measure.endNote}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <VaccinationOverviewCard unitId={unitId} />
      {creating && overview && (
        <IsolationDialog outbreaks={overview.outbreaks} onClose={() => setCreating(false)} onSaved={done} />
      )}
      {reviewing && <ReviewDialog measure={reviewing} onClose={() => setReviewing(null)} onSaved={done} />}
      {editingOutbreak && (
        <OutbreakDialog
          outbreak={editingOutbreak === "new" ? null : editingOutbreak}
          onClose={() => setEditingOutbreak(null)}
          onSaved={done}
        />
      )}
      {endingOutbreak && (
        <ReasonDialog
          eyebrow="Isolation & Ausbruch"
          title="Ausbruch beenden"
          description={`„${endingOutbreak.title}“ wird beendet; die Mitarbeitenden werden benachrichtigt. Laufende Isolationen bleiben bestehen, bis sie überprüft werden.`}
          label="Abschluss"
          placeholder="z. B. seit … keine neuen Fälle, Massnahmen laut Hygienefachperson aufgehoben"
          submitLabel="Ausbruch beenden"
          danger
          onClose={() => setEndingOutbreak(null)}
          onConfirm={async (note) => {
            await requestJson(`/api/hygiene/outbreaks/${endingOutbreak.id}/end`, { method: "POST", body: { note } });
            setEndingOutbreak(null);
            showToast("Ausbruch beendet");
            reload();
          }}
        />
      )}
    </>
  );
}

// Bewohner › Isolation & Ausbruch.
export default function HygieneView() {
  return (
    <ModulePageShell activeModule="residents" activeChild="Isolation & Ausbruch" pageClass="hygiene-page">
      {(showToast) => (
        <main className="workspace module-workspace hygiene-workspace">
          <HygieneContent showToast={showToast} />
        </main>
      )}
    </ModulePageShell>
  );
}
