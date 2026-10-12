"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModuleIcon } from "@/app/components/module-icon";
import { CareDatePicker, CareOptionSelect } from "@/app/components/care-form-controls";
import { useCareResident, useTerms } from "@/app/components/care-context";
import HeaderResidentHint from "@/app/components/header-resident-hint";
import {
  EditorDialog,
  LoadError,
  formatDate,
  formatDateTime,
  requestJson,
  useApiData,
} from "@/app/components/workspace-ui";
import {
  KOMPASS_DOMAINS,
  KOMPASS_NAME,
  NOT_APPLICABLE,
  NOT_APPLICABLE_LABEL,
  OCCASIONS,
  PARTICIPANTS,
  SCALES,
  answerRank,
  domainProgress,
  domainSummary,
  kompassProgress,
  optionLabel,
  type DomainNotes,
  type KompassData,
  type KompassDomain,
  type KompassItem,
  type Occasion,
} from "@/lib/kompass-instrument";
import type { AiDraft } from "@/lib/ai-shared";
import type { KompassAssessment, KompassDetail, KompassReport } from "@/lib/kompass-shared";

const NOBODY = "";

// Abklärung mit dem CareOS Kompass für die Person in der Kopfzeile.
export function AssessmentView({ showToast }: { showToast: (message: string) => void }) {
  const [residentId] = useCareResident();
  const detail = useApiData<KompassDetail>(residentId ? `/api/rai/residents/${residentId}` : null);
  if (!residentId) return <HeaderResidentHint loading={false} missing={false} />;
  if (detail.error && !detail.data)
    return /nicht gefunden/i.test(detail.error) ? (
      <HeaderResidentHint loading={false} missing />
    ) : (
      <LoadError message={detail.error} onRetry={detail.reload} />
    );
  if (!detail.data || detail.data.resident.id !== residentId) return <HeaderResidentHint loading missing={false} />;
  const data = detail.data;
  return data.draft?.kompass ? (
    <KompassForm
      key={data.draft.id}
      detail={data}
      draft={data.draft}
      data={data.draft.kompass}
      reload={detail.reload}
      showToast={showToast}
    />
  ) : (
    <StartCard key={data.history[0]?.id ?? "start"} detail={data} reload={detail.reload} showToast={showToast} />
  );
}

// ---------------------------------------------------------------- Beginn

function StartCard({
  detail,
  reload,
  showToast,
}: {
  detail: KompassDetail;
  reload: () => void;
  showToast: (message: string) => void;
}) {
  const t = useTerms();
  const { resident, previous, planned, people, history, settings, today } = detail;
  const [occasion, setOccasion] = useState<Occasion>(previous ? "routine" : "admission");
  const [assessedOn, setAssessedOn] = useState(today);
  const [assessorId, setAssessorId] = useState(NOBODY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    try {
      await requestJson(`/api/rai/residents/${resident.id}`, {
        method: "POST",
        body: { occasion, assessedOn, assessorId: assessorId || null },
      });
      showToast(`Abklärung für ${resident.name} begonnen`);
      reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die Abklärung konnte nicht begonnen werden.");
      setBusy(false);
    }
  }

  return (
    <section className="kompass-start-layout">
      <section className="card kompass-start">
        <div className="kompass-start-head">
          <span className="kompass-start-icon">
            <ModuleIcon name="compass" />
          </span>
          <div>
            <p className="eyebrow">{KOMPASS_NAME}</p>
            <h2 className="card-title">Neue Abklärung · {resident.name}</h2>
            <p className="card-subtitle">
              {[resident.room, resident.unit].filter(Boolean).join(" · ") || `${t.one} in der Kopfzeile`}
            </p>
          </div>
        </div>
        <p className="kompass-start-text">
          Der Kompass führt durch {KOMPASS_DOMAINS.length} Bereiche des Alltags. Du beschreibst, was du beobachtest und
          was die Person erzählt, und hältst je Bereich fest, ob die Pflegeplanung etwas aufgreifen soll. Alles wird
          automatisch gespeichert; du kannst jederzeit unterbrechen.
        </p>
        <ul className="kompass-start-facts">
          <li>
            <span>Letzte Abklärung</span>
            <strong>
              {previous?.completedAt ? formatDate(previous.kompass?.assessedOn ?? previous.completedAt) : "noch keine"}
            </strong>
          </li>
          <li>
            <span>Fällig</span>
            <strong>
              {planned?.dueOn
                ? formatDate(planned.dueOn)
                : previous?.dueOn
                  ? formatDate(previous.dueOn)
                  : settings.intervalMonths || settings.admissionDays
                    ? "noch nicht geplant"
                    : "Fristen nicht festgelegt"}
            </strong>
          </li>
        </ul>
        <div className="kompass-start-form">
          <CareOptionSelect
            label="Anlass"
            value={occasion}
            onChange={(value) => setOccasion(value as Occasion)}
            options={Object.entries(OCCASIONS).map(([value, label]) => ({ value, label }))}
          />
          <CareDatePicker label="Datum der Abklärung" value={assessedOn} max={today} onChange={setAssessedOn} />
          <CareOptionSelect
            label="Verantwortlich"
            value={assessorId}
            onChange={setAssessorId}
            options={[
              { value: NOBODY, label: "Ich selbst" },
              ...people.map((person) => ({ value: person.id, label: person.name })),
            ]}
          />
        </div>
        {error && (
          <p className="kompass-error" role="alert">
            {error}
          </p>
        )}
        <div className="kompass-start-actions">
          <button className="primary-button" type="button" disabled={busy || !assessedOn} onClick={() => void start()}>
            <ModuleIcon name="compass" className="button-icon" /> Abklärung beginnen
          </button>
        </div>
      </section>
      <div className="kompass-side">
        {previous?.kompass && (
          <NeedsCard
            key={previous.id}
            assessmentId={previous.id}
            residentId={resident.id}
            today={today}
            showToast={showToast}
          />
        )}
        <HistoryCard history={history} />
      </div>
    </section>
  );
}

// Handlungsbedarf der letzten Abklärung: je Bereich als Ziel in die Pflegeplanung übernehmen.
function NeedsCard({
  assessmentId,
  residentId,
  today,
  showToast,
}: {
  assessmentId: string;
  residentId: string;
  today: string;
  showToast: (message: string) => void;
}) {
  const report = useApiData<KompassReport>(`/api/rai/assessments/${assessmentId}`);
  const [adopting, setAdopting] = useState<KompassDomain | null>(null);
  const data = report.data;
  const kompass = data?.assessment.kompass;
  const needs = kompass ? KOMPASS_DOMAINS.filter((domain) => kompass.domains[domain.id]?.need) : [];
  return (
    <section className="card kompass-needs" aria-label="Handlungsbedarf der letzten Abklärung">
      <div className="card-header">
        <div>
          <p className="eyebrow">Letzte Abklärung{kompass ? ` · ${formatDate(kompass.assessedOn)}` : ""}</p>
          <h2 className="card-title">Handlungsbedarf</h2>
        </div>
        <a className="secondary-button" href={`/c/kompass/bericht?id=${assessmentId}`} target="_blank" rel="noreferrer">
          <ModuleIcon name="docs" className="button-icon" /> Bericht
        </a>
      </div>
      {report.error && <p className="kompass-error">{report.error}</p>}
      {kompass && !needs.length && <p className="card-subtitle">Kein Handlungsbedarf festgehalten.</p>}
      <ul>
        {needs.map((domain) => {
          const notes = kompass?.domains[domain.id] ?? {};
          const goal = notes.goalId ? data?.goals[notes.goalId] : null;
          return (
            <li key={domain.id}>
              <strong>{domain.title}</strong>
              <p>{notes.needText}</p>
              {goal ? (
                <Link href="/c/pflegeplanung/ziele-massnahmen" className="kompass-goal">
                  <ModuleIcon name="check" /> Ziel in der Pflegeplanung: {goal.statement}
                </Link>
              ) : data?.canAdopt ? (
                <button className="secondary-button" type="button" onClick={() => setAdopting(domain)}>
                  <ModuleIcon name="plan" className="button-icon" /> Als Ziel übernehmen
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {adopting && kompass && (
        <AdoptDialog
          domain={adopting}
          notes={kompass.domains[adopting.id] ?? {}}
          residentId={residentId}
          assessmentId={assessmentId}
          today={today}
          onClose={() => setAdopting(null)}
          onDone={(message) => {
            setAdopting(null);
            showToast(message);
            report.reload();
          }}
        />
      )}
    </section>
  );
}

function AdoptDialog({
  domain,
  notes,
  residentId,
  assessmentId,
  today,
  onClose,
  onDone,
}: {
  domain: KompassDomain;
  notes: DomainNotes;
  residentId: string;
  assessmentId: string;
  today: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [statement, setStatement] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setSaving(true);
    setError("");
    try {
      const result = await requestJson<{ createdPlan: boolean }>(`/api/rai/residents/${residentId}/goals`, {
        method: "POST",
        body: { assessmentId, domainId: domain.id, statement, targetDate },
      });
      onDone(result.createdPlan ? "Pflegeplan angelegt und Ziel übernommen" : "Ziel in die Pflegeplanung übernommen");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Übernehmen fehlgeschlagen.");
      setSaving(false);
    }
  }
  return (
    <EditorDialog
      id="kompass-adopt"
      eyebrow={`${KOMPASS_NAME} · ${domain.title}`}
      title="Als Ziel in die Pflegeplanung"
      description="Pflegebereich, Problem und Ressourcen stammen aus der Abklärung. Formuliere das Ziel überprüfbar und lege fest, wann es überprüft wird; Massnahmen planst du danach in der Pflegeplanung."
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Ziel übernehmen"
    >
      <dl className="kompass-adopt-facts area-editor-wide">
        <div>
          <dt>Pflegebereich</dt>
          <dd>{domain.planCategory}</dd>
        </div>
        <div>
          <dt>Problem</dt>
          <dd>{notes.needText}</dd>
        </div>
        {notes.resources && (
          <div>
            <dt>Ressourcen</dt>
            <dd>{notes.resources}</dd>
          </div>
        )}
      </dl>
      <label className="area-editor-wide">
        <span>Ziel</span>
        <textarea
          required
          rows={3}
          maxLength={2000}
          value={statement}
          onChange={(event) => setStatement(event.target.value)}
          placeholder="z. B. Steht am Morgen mit Begleitung sicher auf und geht zum Lavabo"
        />
      </label>
      <label>
        <span>Überprüfung am</span>
        <CareDatePicker label="Überprüfung am" value={targetDate} min={today} onChange={setTargetDate} />
      </label>
    </EditorDialog>
  );
}

function HistoryCard({ history }: { history: KompassAssessment[] }) {
  return (
    <section className="card kompass-history" aria-label="Abgeschlossene Abklärungen">
      <div className="card-header">
        <div>
          <p className="eyebrow">Verlauf</p>
          <h2 className="card-title">Abgeschlossene Abklärungen</h2>
        </div>
      </div>
      {history.length ? (
        <ul>
          {history.map((item) => {
            const needs = item.kompass
              ? KOMPASS_DOMAINS.filter((domain) => item.kompass?.domains[domain.id]?.need).map((domain) => domain.title)
              : [];
            return (
              <li key={item.id}>
                <strong>
                  {formatDate(item.kompass?.assessedOn ?? item.legacy?.assessedOn ?? item.completedAt ?? "")} ·{" "}
                  {item.kompass ? OCCASIONS[item.kompass.occasion] : "Frühere vereinfachte Erfassung"}
                </strong>
                <small>
                  {item.kompass
                    ? needs.length
                      ? `Handlungsbedarf: ${needs.join(", ")}`
                      : "Kein Handlungsbedarf festgehalten"
                    : item.legacy?.notes || "ohne Notiz"}
                </small>
                <small>
                  {[item.completedBy ?? item.assessor, item.dueOn ? `nächste fällig am ${formatDate(item.dueOn)}` : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
                {item.kompass && (
                  <a href={`/c/kompass/bericht?id=${item.id}`} target="_blank" rel="noreferrer">
                    Bericht öffnen
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="card-subtitle">Noch keine abgeschlossene Abklärung.</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Erfassung

type Patch = {
  answers?: Record<string, string | null>;
  domains?: Record<string, Partial<Record<keyof DomainNotes, string | boolean | null>>>;
  occasion?: Occasion;
  assessedOn?: string;
  participants?: string[];
  summary?: string;
  assessorId?: string | null;
};
type SaveState = { kind: "saved" | "saving" | "pending" | "error"; at: string | null; message?: string };

function mergePatch(current: Patch, next: Patch): Patch {
  const domains = { ...current.domains };
  for (const [id, notes] of Object.entries(next.domains ?? {})) domains[id] = { ...domains[id], ...notes };
  return {
    ...current,
    ...next,
    answers: { ...current.answers, ...next.answers },
    domains,
  };
}

// Speichert Änderungen gesammelt nach einer kurzen Pause (und sofort vor dem Abschluss).
function useAutosave(residentId: string, draftId: string, savedAt: string) {
  const pending = useRef<Patch>({});
  const timer = useRef<number | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const [state, setState] = useState<SaveState>({ kind: "saved", at: savedAt });

  const flush = useCallback(async () => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (running.current) await running.current;
    const patch = pending.current;
    if (!Object.keys(patch).length) return;
    pending.current = {};
    setState((current) => ({ ...current, kind: "saving" }));
    const task = (async () => {
      try {
        const result = await requestJson<{ updatedAt: string }>(`/api/rai/residents/${residentId}`, {
          method: "PUT",
          body: { id: draftId, patch },
        });
        setState({ kind: Object.keys(pending.current).length ? "pending" : "saved", at: result.updatedAt });
      } catch (cause) {
        // Nicht verlieren: beim nächsten Speichern erneut senden.
        pending.current = mergePatch(patch, pending.current);
        setState((current) => ({
          ...current,
          kind: "error",
          message: cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.",
        }));
        throw cause;
      }
    })();
    running.current = task.finally(() => {
      running.current = null;
    });
    await task;
  }, [draftId, residentId]);

  const queue = useCallback(
    (patch: Patch) => {
      pending.current = mergePatch(pending.current, patch);
      setState((current) => ({ ...current, kind: "pending" }));
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush().catch(() => undefined), 700);
    },
    [flush],
  );

  // Fenster schliessen mit ungespeicherten Änderungen: der Browser fragt nach.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length || running.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  return { state, queue, flush };
}

const START = "start";
const FINISH = "finish";

function KompassForm({
  detail,
  draft,
  data: initial,
  reload,
  showToast,
}: {
  detail: KompassDetail;
  draft: KompassAssessment;
  data: KompassData;
  reload: () => void;
  showToast: (message: string) => void;
}) {
  const { resident, previous, people, context, today } = detail;
  const [data, setData] = useState<KompassData>(initial);
  const [assessorId, setAssessorId] = useState(draft.assessorId ?? NOBODY);
  const [step, setStep] = useState<string>(START);
  const [discarding, setDiscarding] = useState(false);
  const [completing, setCompleting] = useState(false);
  const { state, queue, flush } = useAutosave(resident.id, draft.id, draft.updatedAt);
  const mainRef = useRef<HTMLDivElement>(null);
  const progress = kompassProgress(data);
  const steps = [START, ...KOMPASS_DOMAINS.map((domain) => domain.id), FINISH];
  const index = steps.indexOf(step);

  const go = useCallback((next: string) => {
    setStep(next);
    mainRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  const change = (patch: Patch, apply: (current: KompassData) => KompassData) => {
    setData(apply);
    queue(patch);
  };
  const setAnswer = (key: string, value: string | null) =>
    change({ answers: { [key]: value } }, (current) => {
      const answers = { ...current.answers };
      if (value === null) delete answers[key];
      else answers[key] = value;
      return { ...current, answers };
    });
  const setNotes = (domainId: string, notes: Partial<DomainNotes>) =>
    change({ domains: { [domainId]: notes } }, (current) => ({
      ...current,
      domains: { ...current.domains, [domainId]: { ...current.domains[domainId], ...notes } },
    }));

  async function complete() {
    setCompleting(true);
    try {
      await flush();
      await requestJson(`/api/rai/residents/${resident.id}`, {
        method: "PUT",
        body: { id: draft.id, action: "complete" },
      });
      showToast(`Abklärung für ${resident.name} abgeschlossen`);
      reload();
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Abschliessen fehlgeschlagen.");
      setCompleting(false);
    }
  }

  const domain = KOMPASS_DOMAINS.find((item) => item.id === step) ?? null;
  return (
    <section className="kompass-layout">
      <header className="card kompass-bar">
        <div>
          <p className="eyebrow">
            {KOMPASS_NAME} · {OCCASIONS[data.occasion]}
          </p>
          <h2 className="card-title">{resident.name}</h2>
          <p className="card-subtitle">
            {[resident.room, resident.unit, data.assessedOn ? `Abklärung vom ${formatDate(data.assessedOn)}` : ""]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="kompass-bar-state">
          <div
            className="kompass-progress"
            role="progressbar"
            aria-label="Fortschritt der Abklärung"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <small aria-live="polite" data-state={state.kind}>
            {state.kind === "saving"
              ? "Wird gespeichert …"
              : state.kind === "pending"
                ? "Änderungen werden gleich gespeichert"
                : state.kind === "error"
                  ? `Nicht gespeichert: ${state.message}`
                  : `${progress}% erledigt · gespeichert${state.at ? ` um ${formatDateTime(state.at).split(", ").pop()}` : ""}`}
          </small>
        </div>
      </header>
      <nav className="card kompass-steps" aria-label="Bereiche der Abklärung">
        <ol>
          <li>
            <button type="button" aria-current={step === START ? "step" : undefined} onClick={() => go(START)}>
              <ModuleIcon name="note" />
              <span>Grunddaten</span>
              <small>{data.participants.length ? "erfasst" : ""}</small>
            </button>
          </li>
          {KOMPASS_DOMAINS.map((item) => {
            const state = domainProgress(item, data);
            return (
              <li key={item.id} data-complete={state.complete ? "true" : undefined}>
                <button type="button" aria-current={step === item.id ? "step" : undefined} onClick={() => go(item.id)}>
                  <ModuleIcon name={state.complete ? "check" : item.icon} />
                  <span>{item.title}</span>
                  <small>
                    {state.answered}/{state.total}
                  </small>
                </button>
              </li>
            );
          })}
          <li>
            <button type="button" aria-current={step === FINISH ? "step" : undefined} onClick={() => go(FINISH)}>
              <ModuleIcon name="check" />
              <span>Abschluss</span>
              <small>{progress}%</small>
            </button>
          </li>
        </ol>
      </nav>
      <div className="kompass-main" ref={mainRef}>
        {step === START && (
          <BasicsStep
            data={data}
            today={today}
            people={people}
            assessorId={assessorId}
            onAssessor={(value) => {
              setAssessorId(value);
              queue({ assessorId: value || null });
            }}
            onChange={(patch) => change(patch, (current) => ({ ...current, ...patch }) as KompassData)}
          />
        )}
        {domain && (
          <DomainStep
            key={domain.id}
            domain={domain}
            data={data}
            previous={previous?.kompass ?? null}
            previousOn={previous?.kompass?.assessedOn ?? null}
            facts={domain.context.flatMap((key) => context[key])}
            setAnswer={setAnswer}
            setNotes={setNotes}
            takePrevious={(answers) =>
              change({ answers }, (current) => ({ ...current, answers: { ...current.answers, ...answers } }))
            }
          />
        )}
        {step === FINISH && (
          <FinishStep
            data={data}
            previous={previous?.kompass ?? null}
            onSummary={(summary) => change({ summary }, (current) => ({ ...current, summary }))}
            requestDraft={
              detail.aiDraft
                ? async () => {
                    await flush();
                    const result = await requestJson<{ draft: AiDraft }>(`/api/rai/residents/${resident.id}/summary`, {
                      method: "POST",
                    });
                    return result.draft;
                  }
                : null
            }
            go={go}
            completing={completing}
            onComplete={() => void complete()}
            onDiscard={() => setDiscarding(true)}
          />
        )}
        <div className="kompass-nav">
          <button
            className="secondary-button"
            type="button"
            disabled={index <= 0}
            onClick={() => go(steps[Math.max(0, index - 1)])}
          >
            Zurück
          </button>
          {index < steps.length - 1 && (
            <button className="primary-button" type="button" onClick={() => go(steps[index + 1])}>
              Weiter: {steps[index + 1] === FINISH ? "Abschluss" : (KOMPASS_DOMAINS[index]?.title ?? "")}
              <ModuleIcon name="chevron" className="button-icon" />
            </button>
          )}
        </div>
      </div>
      {discarding && (
        <DiscardDialog
          residentId={resident.id}
          draftId={draft.id}
          onClose={() => setDiscarding(false)}
          onDone={() => {
            setDiscarding(false);
            showToast("Entwurf verworfen");
            reload();
          }}
        />
      )}
    </section>
  );
}

function BasicsStep({
  data,
  today,
  people,
  assessorId,
  onAssessor,
  onChange,
}: {
  data: KompassData;
  today: string;
  people: KompassDetail["people"];
  assessorId: string;
  onAssessor: (value: string) => void;
  onChange: (patch: Pick<Patch, "occasion" | "assessedOn" | "participants">) => void;
}) {
  return (
    <section className="card kompass-panel" aria-labelledby="kompass-basics">
      <header className="kompass-panel-head">
        <span className="kompass-domain-icon">
          <ModuleIcon name="note" />
        </span>
        <div>
          <h2 id="kompass-basics">Grunddaten</h2>
          <p>Anlass, Datum und wer an der Abklärung beteiligt ist.</p>
        </div>
      </header>
      <div className="kompass-basics">
        <CareOptionSelect
          label="Anlass"
          value={data.occasion}
          onChange={(value) => onChange({ occasion: value as Occasion })}
          options={Object.entries(OCCASIONS).map(([value, label]) => ({ value, label }))}
        />
        <CareDatePicker
          label="Datum der Abklärung"
          value={data.assessedOn}
          max={today}
          onChange={(assessedOn) => assessedOn && onChange({ assessedOn })}
        />
        <CareOptionSelect
          label="Verantwortlich"
          value={assessorId}
          onChange={onAssessor}
          options={[
            { value: NOBODY, label: "Noch nicht festgelegt" },
            ...people.map((person) => ({ value: person.id, label: person.name })),
          ]}
        />
      </div>
      <div className="form-field">
        <span>Beteiligt</span>
        <div className="chip-row" role="group" aria-label="Beteiligt">
          {PARTICIPANTS.map((participant) => {
            const active = data.participants.includes(participant);
            return (
              <button
                key={participant}
                type="button"
                className={`day-toggle ${active ? "active" : ""}`}
                aria-pressed={active}
                onClick={() =>
                  onChange({
                    participants: PARTICIPANTS.filter((item) =>
                      item === participant ? !active : data.participants.includes(item),
                    ),
                  })
                }
              >
                {participant}
              </button>
            );
          })}
        </div>
      </div>
      <p className="kompass-note">
        Der Kompass beschreibt, was beobachtet und erfragt wurde. Er berechnet keine Punktzahl, keine Pflegestufe und
        kein Risiko; ob Handlungsbedarf besteht, entscheidest du je Bereich.
      </p>
    </section>
  );
}

function DomainStep({
  domain,
  data,
  previous,
  previousOn,
  facts,
  setAnswer,
  setNotes,
  takePrevious,
}: {
  domain: KompassDomain;
  data: KompassData;
  previous: KompassData | null;
  previousOn: string | null;
  facts: Array<{ label: string; detail: string; href: string }>;
  setAnswer: (key: string, value: string | null) => void;
  setNotes: (domainId: string, notes: Partial<DomainNotes>) => void;
  takePrevious: (answers: Record<string, string>) => void;
}) {
  const notes = data.domains[domain.id] ?? {};
  const open = previous
    ? Object.fromEntries(
        domain.items
          .map((item) => `${domain.id}.${item.id}`)
          .filter((key) => data.answers[key] === undefined && previous.answers[key] !== undefined)
          .map((key) => [key, previous.answers[key]]),
      )
    : {};
  return (
    <section className="card kompass-panel" aria-labelledby={`kompass-${domain.id}`}>
      <header className="kompass-panel-head">
        <span className="kompass-domain-icon">
          <ModuleIcon name={domain.icon} />
        </span>
        <div>
          <h2 id={`kompass-${domain.id}`}>{domain.title}</h2>
          <p>{domain.focus}</p>
        </div>
      </header>
      {facts.length > 0 && (
        <aside className="kompass-facts" aria-label="Aus der Akte">
          <strong>Aus der Akte</strong>
          <ul>
            {facts.map((fact, index) => (
              <li key={`${fact.label}-${index}`}>
                <Link href={fact.href}>{fact.label}</Link>
                {fact.detail && <span>{fact.detail}</span>}
              </li>
            ))}
          </ul>
        </aside>
      )}
      {Object.keys(open).length > 0 && (
        <div className="kompass-previous">
          <span>
            {Object.keys(open).length === domain.items.length ? "Alle" : Object.keys(open).length} Fragen sind noch
            offen. Antworten vom {formatDate(previousOn ?? "")} als Ausgangslage übernehmen? Bitte danach jede Antwort
            prüfen.
          </span>
          <button className="secondary-button" type="button" onClick={() => takePrevious(open)}>
            Antworten übernehmen
          </button>
        </div>
      )}
      <ol className="kompass-items">
        {domain.items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            value={data.answers[`${domain.id}.${item.id}`]}
            previous={previous?.answers[`${domain.id}.${item.id}`]}
            onChange={(value) => setAnswer(`${domain.id}.${item.id}`, value)}
          />
        ))}
      </ol>
      <div className="kompass-texts">
        <label>
          <span>Ressourcen – was die Person selbst kann und gerne tut</span>
          <textarea
            rows={2}
            maxLength={4000}
            value={notes.resources ?? ""}
            onChange={(event) => setNotes(domain.id, { resources: event.target.value })}
          />
        </label>
        <label>
          <span>Wünsche und Gewohnheiten</span>
          <textarea
            rows={2}
            maxLength={4000}
            value={notes.wishes ?? ""}
            onChange={(event) => setNotes(domain.id, { wishes: event.target.value })}
          />
        </label>
        <label>
          <span>Beobachtungen und Ergänzungen</span>
          <textarea
            rows={2}
            maxLength={4000}
            value={notes.notes ?? ""}
            onChange={(event) => setNotes(domain.id, { notes: event.target.value })}
          />
        </label>
      </div>
      <fieldset className="kompass-need">
        <legend>Soll die Pflegeplanung in diesem Bereich etwas aufgreifen?</legend>
        <div className="kompass-choices" role="radiogroup" aria-label={`Handlungsbedarf: ${domain.title}`}>
          {[
            { value: false, label: "Kein Handlungsbedarf" },
            { value: true, label: "Handlungsbedarf" },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={notes.need === option.value}
              data-checked={notes.need === option.value ? "true" : undefined}
              onClick={() => setNotes(domain.id, { need: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
        {notes.need === true && (
          <label>
            <span>Was soll die Pflegeplanung aufgreifen? (Pflicht)</span>
            <textarea
              rows={3}
              maxLength={4000}
              value={notes.needText ?? ""}
              onChange={(event) => setNotes(domain.id, { needText: event.target.value })}
              placeholder="Beschreibung aus Sicht der Fachperson, z. B. Unterstützung beim Aufstehen am Morgen"
            />
          </label>
        )}
      </fieldset>
    </section>
  );
}

function ItemRow({
  item,
  value,
  previous,
  onChange,
}: {
  item: KompassItem;
  value: string | undefined;
  previous: string | undefined;
  onChange: (value: string | null) => void;
}) {
  const options = [
    ...SCALES[item.scale].options,
    ...(item.allowNa
      ? [{ value: NOT_APPLICABLE, label: NOT_APPLICABLE_LABEL, hint: "Gibt es im Alltag der Person nicht." }]
      : []),
  ];
  const chosen = options.find((option) => option.value === value);
  const before = optionLabel(item, previous);
  return (
    <li className="kompass-item" data-answered={value !== undefined ? "true" : undefined}>
      <div className="kompass-item-head">
        <strong>{item.label}</strong>
        {item.hint && <small>{item.hint}</small>}
      </div>
      <div className="kompass-choices" role="radiogroup" aria-label={item.label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            data-checked={value === option.value ? "true" : undefined}
            onClick={() => onChange(value === option.value ? null : option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {(chosen || before) && (
        <p className="kompass-item-hint">
          {chosen?.hint}
          {before && <span>{`Letzte Abklärung: ${before}`}</span>}
        </p>
      )}
    </li>
  );
}

// Vergleich je Frage mit der letzten Abklärung: mehr oder weniger Unterstützung bzw. häufiger oder seltener.
function changes(domain: KompassDomain, data: KompassData, previous: KompassData | null) {
  if (!previous) return { more: 0, less: 0 };
  let more = 0;
  let less = 0;
  for (const item of domain.items) {
    const key = `${domain.id}.${item.id}`;
    const now = answerRank(item, data.answers[key]);
    const before = answerRank(item, previous.answers[key]);
    if (now === null || before === null || now === before) continue;
    if (now > before) more += 1;
    else less += 1;
  }
  return { more, less };
}

function FinishStep({
  data,
  previous,
  onSummary,
  requestDraft,
  go,
  completing,
  onComplete,
  onDiscard,
}: {
  data: KompassData;
  previous: KompassData | null;
  onSummary: (summary: string) => void;
  requestDraft: (() => Promise<AiDraft>) | null;
  go: (step: string) => void;
  completing: boolean;
  onComplete: () => void;
  onDiscard: () => void;
}) {
  const rows = useMemo(
    () =>
      KOMPASS_DOMAINS.map((domain) => ({
        domain,
        progress: domainProgress(domain, data),
        summary: domainSummary(domain, data.answers),
        change: changes(domain, data, previous),
        need: data.domains[domain.id]?.need,
      })),
    [data, previous],
  );
  const open = rows.filter((row) => !row.progress.complete);
  const [suggestion, setSuggestion] = useState<AiDraft | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [aiError, setAiError] = useState("");
  async function createDraft() {
    if (!requestDraft) return;
    setDrafting(true);
    setAiError("");
    try {
      setSuggestion(await requestDraft());
    } catch (cause) {
      setAiError(cause instanceof Error ? cause.message : "Der Entwurf konnte nicht erstellt werden.");
    } finally {
      setDrafting(false);
    }
  }
  // Übernehmen ersetzt ein leeres Gesamtbild und ergänzt ein vorhandenes; der Entwurf wird als geprüft vermerkt.
  async function review(action: "accept" | "discard") {
    if (!suggestion) return;
    const content = suggestion.content;
    setSuggestion(null);
    if (action === "accept") onSummary(data.summary.trim() ? `${data.summary.trim()}\n\n${content}` : content);
    try {
      await requestJson(`/api/ai/drafts/${suggestion.id}`, { method: "PATCH", body: { action } });
    } catch {
      // Der Vermerk am Entwurf ist zweitrangig; das Gesamtbild ist bereits übernommen bzw. verworfen.
    }
  }
  return (
    <section className="card kompass-panel" aria-labelledby="kompass-finish">
      <header className="kompass-panel-head">
        <span className="kompass-domain-icon">
          <ModuleIcon name="check" />
        </span>
        <div>
          <h2 id="kompass-finish">Abschluss</h2>
          <p>
            Übersicht aller Bereiche. Abschliessen lässt sich, wenn alle Fragen beantwortet sind und je Bereich über den
            Handlungsbedarf entschieden ist.
          </p>
        </div>
      </header>
      <div className="kompass-table-wrap">
        <table className="kompass-table">
          <thead>
            <tr>
              <th scope="col">Bereich</th>
              <th scope="col">Antworten</th>
              {previous && <th scope="col">Seit der letzten Abklärung</th>}
              <th scope="col">Handlungsbedarf</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.domain.id} data-open={row.progress.complete ? undefined : "true"}>
                <th scope="row">
                  <button type="button" onClick={() => go(row.domain.id)}>
                    {row.domain.title}
                  </button>
                </th>
                <td>
                  {row.progress.answered < row.progress.total
                    ? `${row.progress.total - row.progress.answered} offen`
                    : row.summary.withSupport
                      ? `${row.summary.withSupport} von ${row.summary.answered} mit Unterstützung oder beobachtet`
                      : "keine Unterstützung, nichts beobachtet"}
                </td>
                {previous && (
                  <td>
                    {[
                      row.change.more ? `${row.change.more}× mehr` : "",
                      row.change.less ? `${row.change.less}× weniger` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ") || "unverändert"}
                  </td>
                )}
                <td data-need={row.need === true ? "true" : undefined}>
                  {row.need === true ? "Ja" : row.need === false ? "Nein" : "noch offen"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="kompass-summary">
        <span className="kompass-summary-label">
          <label htmlFor="kompass-summary-text">Gesamtbild aus Sicht der Fachperson</label>
          {requestDraft && (
            <button className="quiet-button" type="button" disabled={drafting} onClick={() => void createDraft()}>
              <ModuleIcon name="ai" /> {drafting ? "Entwurf wird geschrieben …" : "Entwurf mit CareOS KI"}
            </button>
          )}
        </span>
        <textarea
          id="kompass-summary-text"
          rows={4}
          maxLength={8000}
          value={data.summary}
          onChange={(event) => onSummary(event.target.value)}
          placeholder="Was prägt den Alltag der Person zurzeit? Was ist ihr wichtig? Was hat sich verändert?"
        />
      </div>
      {aiError && (
        <p className="kompass-missing" role="alert">
          {aiError}
        </p>
      )}
      {suggestion && (
        <div className="kompass-ai-draft" role="region" aria-label="Entwurf der CareOS KI">
          <p className="kompass-ai-draft-head">
            <ModuleIcon name="ai" /> Entwurf der CareOS KI – bitte prüfen und anpassen
          </p>
          <p className="kompass-ai-draft-text">{suggestion.content}</p>
          <p className="kompass-ai-draft-note">
            Der Entwurf stützt sich nur auf Ihre Antworten und Notizen und wurde ohne Namen erstellt. Er wird erst
            übernommen, wenn Sie es bestätigen.
          </p>
          <div className="kompass-ai-draft-actions">
            <button className="secondary-button" type="button" onClick={() => void review("discard")}>
              Verwerfen
            </button>
            <button className="primary-button" type="button" onClick={() => void review("accept")}>
              Ins Gesamtbild übernehmen
            </button>
          </div>
        </div>
      )}
      {open.length > 0 && (
        <p className="kompass-missing" role="status">
          Noch offen: {open.map((row) => row.domain.title).join(", ")}.
        </p>
      )}
      <div className="kompass-finish-actions">
        <button className="secondary-button kompass-discard" type="button" onClick={onDiscard}>
          Entwurf verwerfen
        </button>
        <button className="primary-button" type="button" disabled={completing || open.length > 0} onClick={onComplete}>
          <ModuleIcon name="check" className="button-icon" /> Abklärung abschliessen
        </button>
      </div>
    </section>
  );
}

function DiscardDialog({
  residentId,
  draftId,
  onClose,
  onDone,
}: {
  residentId: string;
  draftId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setSaving(true);
    setError("");
    try {
      await requestJson(`/api/rai/residents/${residentId}`, {
        method: "PUT",
        body: { id: draftId, action: "discard", reason },
      });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Verwerfen fehlgeschlagen.");
      setSaving(false);
    }
  }
  return (
    <EditorDialog
      id="kompass-discard"
      eyebrow={KOMPASS_NAME}
      title="Entwurf verwerfen"
      description="Die Antworten dieses Entwurfs werden nicht übernommen. Das Verwerfen steht im Änderungsprotokoll."
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Entwurf verwerfen"
      danger
    >
      <label className="area-editor-wide">
        <span>Grund</span>
        <textarea
          required
          rows={3}
          maxLength={2000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="z. B. versehentlich begonnen"
        />
      </label>
    </EditorDialog>
  );
}
