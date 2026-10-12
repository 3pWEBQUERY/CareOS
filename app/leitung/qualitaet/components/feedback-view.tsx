"use client";

import { useState } from "react";
import ModulePageShell from "@/app/components/module-page-shell";
import { CareDatePicker, CareSelect } from "@/app/components/care-form-controls";
import {
  EditorDialog,
  LoadError,
  formatDate,
  requestJson,
  todayInZurich,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import {
  FEEDBACK_CHANNELS,
  FEEDBACK_KINDS,
  FEEDBACK_SOURCES,
  FEEDBACK_STATUSES,
  type Feedback,
  type FeedbackChannel,
  type FeedbackKind,
  type FeedbackOverview,
  type FeedbackSource,
} from "@/lib/feedback-shared";
import { LeadershipHeading, LeadershipKpis } from "../../components/leadership-page-parts";

type RecordDraft = {
  kind: FeedbackKind | null;
  source: FeedbackSource | null;
  sourceName: string;
  contact: string;
  channel: FeedbackChannel | null;
  residentId: string;
  careUnitId: string;
  topic: string;
  description: string;
  receivedOn: string;
  assignedTo: string;
};
type EditDraft = { item: Feedback; topic: string; measures: string; assignedTo: string; inProgress: boolean };
type AnswerDraft = { item: Feedback; response: string; answeredOn: string };

const NONE = "Keine Angabe";
const NOBODY = "Noch niemand";
const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

function Choices<K extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Record<K, string>;
  value: K | null;
  onChange: (value: K) => void;
}) {
  return (
    <fieldset className="area-editor-wide">
      <legend>{label}</legend>
      <div className="repositioning-choices" role="group" aria-label={label}>
        {(Object.keys(options) as K[]).map((key) => (
          <button
            key={key}
            type="button"
            className={`day-toggle ${value === key ? "active" : ""}`}
            aria-pressed={value === key}
            onClick={() => onChange(key)}
          >
            {options[key]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function FeedbackContent({ showToast }: { showToast: ShowToast }) {
  const [year, setYear] = useState("");
  const { data, error, reload } = useApiData<FeedbackOverview>(`/api/feedback${year ? `?year=${year}` : ""}`);
  const [kind, setKind] = useState<FeedbackKind | "">("");
  const [draft, setDraft] = useState<RecordDraft | null>(null);
  const [edit, setEdit] = useState<EditDraft | null>(null);
  const [answer, setAnswer] = useState<AnswerDraft | null>(null);
  const [days, setDays] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [pageError, setPageError] = useState("");
  const items = (data?.items ?? []).filter((item) => !kind || item.kind === kind);
  const open = (data?.items ?? []).filter((item) => item.status === "open" || item.status === "in_progress");
  const evaluation = data?.evaluation;
  const currentYear = Number((data?.today ?? todayInZurich()).slice(0, 4));

  async function run(action: () => Promise<unknown>, message: string) {
    setSaving(true);
    setFormError("");
    setPageError("");
    try {
      await action();
      reload();
      showToast(message);
      return true;
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function quick(item: Feedback, action: "close" | "reopen") {
    setSaving(true);
    setPageError("");
    try {
      await requestJson(`/api/feedback/${item.id}`, { method: "PATCH", body: { action } });
      reload();
      showToast(action === "close" ? "Rückmeldung abgeschlossen" : "Rückmeldung wieder geöffnet");
    } catch (cause) {
      setPageError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  const nameOf = (list: Array<{ id: string; name: string }>, id: string, empty: string) =>
    list.find((item) => item.id === id)?.name ?? empty;
  const idOf = (list: Array<{ id: string; name: string }>, name: string) =>
    list.find((item) => item.name === name)?.id ?? "";

  return (
    <>
      <LeadershipHeading
        eyebrow="Qualität · Rückmeldungen"
        title="Rückmeldungen & Beschwerden"
        description="Beschwerden, Anregungen und Lob erfassen, bearbeiten, beantworten und auswerten. Die Antwortfrist legt die Einrichtung fest."
        action={{
          label: "Rückmeldung erfassen",
          onClick: () => {
            setFormError("");
            setDraft({
              kind: null,
              source: null,
              sourceName: "",
              contact: "",
              channel: null,
              residentId: "",
              careUnitId: "",
              topic: "",
              description: "",
              receivedOn: todayInZurich(),
              assignedTo: "",
            });
          },
        }}
      />
      {error && <LoadError message={error} onRetry={reload} />}
      {data && evaluation && (
        <LeadershipKpis
          kpis={[
            { value: String(open.length), label: "Offen", note: "noch nicht beantwortet" },
            {
              value: String(open.filter((item) => item.overdue).length),
              label: "Frist überschritten",
              note: data.responseDays ? `Antwortfrist ${data.responseDays} Tage` : "keine Frist festgelegt",
              tone: open.some((item) => item.overdue) ? "critical" : undefined,
            },
            {
              value: String(evaluation.byKind.complaint),
              label: `Beschwerden ${evaluation.year}`,
              note: `${evaluation.byKind.suggestion} Anregungen · ${evaluation.byKind.praise} Lob`,
            },
            {
              value: evaluation.withDeadline ? `${evaluation.answeredInTime} / ${evaluation.withDeadline}` : "–",
              label: "In der Frist beantwortet",
              note:
                evaluation.medianDays === null
                  ? "noch keine Antworten"
                  : `im Mittel (Median) nach ${evaluation.medianDays.toLocaleString("de-CH")} Tagen`,
            },
          ]}
        />
      )}
      {data && (
        <div className="feedback-toolbar">
          <div className="repositioning-choices" role="group" aria-label="Art">
            {(["", ...Object.keys(FEEDBACK_KINDS)] as Array<FeedbackKind | "">).map((key) => (
              <button
                key={key || "alle"}
                type="button"
                className={`day-toggle ${kind === key ? "active" : ""}`}
                aria-pressed={kind === key}
                onClick={() => setKind(key)}
              >
                {key ? FEEDBACK_KINDS[key] : "Alle"}
              </button>
            ))}
          </div>
          <div className="repositioning-choices" role="group" aria-label="Jahr">
            {[currentYear, currentYear - 1, currentYear - 2].map((value) => (
              <button
                key={value}
                type="button"
                className={`day-toggle ${evaluation?.year === value ? "active" : ""}`}
                aria-pressed={evaluation?.year === value}
                onClick={() => setYear(String(value))}
              >
                {value}
              </button>
            ))}
          </div>
          {data.canManage && (
            <button
              type="button"
              className="death-checklist-action"
              onClick={() => {
                setFormError("");
                setDays(data.responseDays ? String(data.responseDays) : "");
              }}
            >
              {data.responseDays ? `Antwortfrist: ${data.responseDays} Tage` : "Antwortfrist festlegen"}
            </button>
          )}
        </div>
      )}
      {pageError && (
        <p className="restraints-error" role="alert">
          {pageError}
        </p>
      )}
      {data && !items.length ? (
        <section className="card hygiene-empty">
          <strong>Keine Rückmeldungen</strong>
          <p>Offene Rückmeldungen und die des gewählten Jahres erscheinen hier.</p>
        </section>
      ) : data ? (
        <section className="card device-list" aria-label="Rückmeldungen">
          <ul>
            {items.map((item) => (
              <li
                key={item.id}
                className={item.status === "closed" ? "retired" : item.overdue ? "due" : ""}
                aria-label={`${FEEDBACK_KINDS[item.kind]} ${item.topic || "ohne Thema"} vom ${formatDate(item.receivedOn)}`}
              >
                <div>
                  <strong>
                    {item.topic || "Ohne Thema"}
                    <span className={`diagnosis-code feedback-${item.kind}`}>{FEEDBACK_KINDS[item.kind]}</span>
                  </strong>
                  <small>
                    {[
                      `${FEEDBACK_SOURCES[item.source]}${item.sourceName ? `: ${item.sourceName}` : ""}`,
                      FEEDBACK_CHANNELS[item.channel],
                      `eingegangen ${formatDate(item.receivedOn)}`,
                      item.residentName,
                      item.careUnitName,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                  <small className="feedback-text">{item.description}</small>
                  <small className="device-due">
                    {[
                      FEEDBACK_STATUSES[item.status],
                      item.dueOn && (item.status === "open" || item.status === "in_progress")
                        ? `${item.overdue ? "Frist abgelaufen am" : "Frist bis"} ${formatDate(item.dueOn)}`
                        : "",
                      item.assignedName ? `zuständig: ${item.assignedName}` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                  {item.measures && <small>Massnahmen: {item.measures}</small>}
                  {item.answeredOn && (
                    <small>
                      Antwort vom {formatDate(item.answeredOn)}
                      {item.answeredBy ? ` (${item.answeredBy})` : ""}: {item.response}
                    </small>
                  )}
                </div>
                <span className="device-actions">
                  {item.canEdit && item.status !== "closed" && (
                    <>
                      <button
                        type="button"
                        className="death-checklist-action"
                        aria-label={`${item.topic || FEEDBACK_KINDS[item.kind]} bearbeiten`}
                        onClick={() => {
                          setFormError("");
                          setEdit({
                            item,
                            topic: item.topic,
                            measures: item.measures,
                            assignedTo: item.assignedTo ?? "",
                            inProgress: item.status !== "open",
                          });
                        }}
                      >
                        Bearbeiten
                      </button>
                      <button
                        type="button"
                        className="death-checklist-action"
                        aria-label={`${item.topic || FEEDBACK_KINDS[item.kind]}: Antwort festhalten`}
                        onClick={() => {
                          setFormError("");
                          setAnswer({ item, response: item.response, answeredOn: item.answeredOn ?? todayInZurich() });
                        }}
                      >
                        Antwort
                      </button>
                    </>
                  )}
                  {data.canManage && item.status !== "closed" && (item.answeredOn || item.kind === "praise") && (
                    <button
                      type="button"
                      className="death-checklist-action"
                      disabled={saving}
                      aria-label={`${item.topic || FEEDBACK_KINDS[item.kind]} abschliessen`}
                      onClick={() => void quick(item, "close")}
                    >
                      Abschliessen
                    </button>
                  )}
                  {data.canManage && item.status === "closed" && (
                    <button
                      type="button"
                      className="death-checklist-action"
                      disabled={saving}
                      aria-label={`${item.topic || FEEDBACK_KINDS[item.kind]} wieder öffnen`}
                      onClick={() => void quick(item, "reopen")}
                    >
                      Wieder öffnen
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        !error && <p className="record-export-note">Wird geladen …</p>
      )}

      {data?.canManage && evaluation && evaluation.total > 0 && (
        <section className="card feedback-evaluation" aria-labelledby="feedback-evaluation-title">
          <p className="eyebrow">Auswertung {evaluation.year}</p>
          <h2 className="card-title" id="feedback-evaluation-title">
            Auswertung für das Qualitätsmanagement
          </h2>
          <p className="card-subtitle">
            {evaluation.total} Rückmeldungen ·{" "}
            {(Object.keys(FEEDBACK_SOURCES) as FeedbackSource[])
              .filter((key) => evaluation.bySource[key])
              .map((key) => `${FEEDBACK_SOURCES[key]} ${evaluation.bySource[key]}`)
              .join(" · ")}{" "}
            · {evaluation.answered} beantwortet
          </p>
          <div className="feedback-table-wrap">
            <table className="feedback-table">
              <caption>Nach Thema</caption>
              <thead>
                <tr>
                  <th scope="col">Thema</th>
                  <th scope="col" className="number">
                    Beschwerden
                  </th>
                  <th scope="col" className="number">
                    Anregungen
                  </th>
                  <th scope="col" className="number">
                    Lob
                  </th>
                </tr>
              </thead>
              <tbody>
                {evaluation.byTopic.map((row) => (
                  <tr key={row.topic}>
                    <th scope="row">{row.topic}</th>
                    <td className="number">{row.complaint}</td>
                    <td className="number">{row.suggestion}</td>
                    <td className="number">{row.praise}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="feedback-table">
              <caption>Nach Monat</caption>
              <thead>
                <tr>
                  {MONTHS.map((month) => (
                    <th key={month} scope="col" className="number">
                      {month}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {evaluation.byMonth.map((count, index) => (
                    <td key={MONTHS[index]} className="number">
                      {count}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {draft && data && (
        <EditorDialog
          id="feedback"
          eyebrow="Qualität · Rückmeldungen"
          title="Rückmeldung erfassen"
          description={
            data.responseDays
              ? `Antwortfrist der Einrichtung: ${data.responseDays} Tage ab Eingang (nicht bei Lob).`
              : "Die Einrichtung hat keine Antwortfrist festgelegt."
          }
          onClose={() => setDraft(null)}
          onSubmit={async () => {
            if (!draft.kind) return setFormError("Bitte die Art wählen.");
            if (!draft.source) return setFormError("Bitte angeben, von wem die Rückmeldung kommt.");
            if (!draft.channel) return setFormError("Bitte den Weg wählen.");
            const saved = await run(
              () => requestJson("/api/feedback", { method: "POST", body: draft }),
              "Rückmeldung erfasst",
            );
            if (saved) setDraft(null);
          }}
          saving={saving}
          error={formError}
          submitLabel="Rückmeldung speichern"
        >
          <Choices
            label="Art"
            options={FEEDBACK_KINDS}
            value={draft.kind}
            onChange={(value) => setDraft({ ...draft, kind: value })}
          />
          <Choices
            label="Von"
            options={FEEDBACK_SOURCES}
            value={draft.source}
            onChange={(value) => setDraft({ ...draft, source: value })}
          />
          <Choices
            label="Weg"
            options={FEEDBACK_CHANNELS}
            value={draft.channel}
            onChange={(value) => setDraft({ ...draft, channel: value })}
          />
          <label>
            <span>Name</span>
            <input
              maxLength={200}
              placeholder="z. B. Frau Muster (Tochter)"
              value={draft.sourceName}
              onChange={(event) => setDraft({ ...draft, sourceName: event.target.value })}
            />
          </label>
          <label>
            <span>Kontakt für die Antwort</span>
            <input
              maxLength={200}
              placeholder="z. B. Telefon oder E-Mail"
              value={draft.contact}
              onChange={(event) => setDraft({ ...draft, contact: event.target.value })}
            />
          </label>
          <label>
            <span>Betrifft Person</span>
            <CareSelect
              label="Betrifft Person"
              value={nameOf(data.residents, draft.residentId, NONE)}
              options={[NONE, ...data.residents.map((item) => item.name)]}
              onChange={(value) => setDraft({ ...draft, residentId: idOf(data.residents, value) })}
            />
          </label>
          <label>
            <span>Wohnbereich</span>
            <CareSelect
              label="Wohnbereich"
              value={nameOf(data.careUnits, draft.careUnitId, NONE)}
              options={[NONE, ...data.careUnits.map((item) => item.name)]}
              onChange={(value) => setDraft({ ...draft, careUnitId: idOf(data.careUnits, value) })}
            />
          </label>
          <label>
            <span>Thema</span>
            <input
              maxLength={120}
              placeholder="z. B. Verpflegung, Wäsche, Pflege"
              value={draft.topic}
              onChange={(event) => setDraft({ ...draft, topic: event.target.value })}
            />
          </label>
          <label>
            <span>Eingegangen am</span>
            <CareDatePicker
              label="Eingegangen am"
              value={draft.receivedOn}
              max={todayInZurich()}
              onChange={(value) => setDraft({ ...draft, receivedOn: value })}
            />
          </label>
          {data.topics.length > 0 && (
            <div className="area-editor-wide repositioning-choices" role="group" aria-label="Bisherige Themen">
              {data.topics.map((topic) => (
                <button
                  key={topic}
                  type="button"
                  className={`day-toggle ${draft.topic === topic ? "active" : ""}`}
                  aria-pressed={draft.topic === topic}
                  onClick={() => setDraft({ ...draft, topic })}
                >
                  {topic}
                </button>
              ))}
            </div>
          )}
          <label className="area-editor-wide">
            <span>Rückmeldung</span>
            <textarea
              rows={4}
              required
              maxLength={4000}
              placeholder="Was wurde gesagt oder geschrieben?"
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </label>
          {data.canManage && (
            <label>
              <span>Zuständig</span>
              <CareSelect
                label="Zuständig"
                value={nameOf(data.staff, draft.assignedTo, NOBODY)}
                options={[NOBODY, ...data.staff.map((item) => item.name)]}
                onChange={(value) => setDraft({ ...draft, assignedTo: idOf(data.staff, value) })}
              />
            </label>
          )}
        </EditorDialog>
      )}

      {edit && data && (
        <EditorDialog
          id="feedback-edit"
          eyebrow={`${FEEDBACK_KINDS[edit.item.kind]} vom ${formatDate(edit.item.receivedOn)}`}
          title="Rückmeldung bearbeiten"
          description={edit.item.description}
          onClose={() => setEdit(null)}
          onSubmit={async () => {
            const saved = await run(
              () =>
                requestJson(`/api/feedback/${edit.item.id}`, {
                  method: "PATCH",
                  body: {
                    action: "update",
                    topic: edit.topic,
                    measures: edit.measures,
                    assignedTo: edit.assignedTo || null,
                    inProgress: edit.inProgress,
                  },
                }),
              "Rückmeldung gespeichert",
            );
            if (saved) setEdit(null);
          }}
          saving={saving}
          error={formError}
          submitLabel="Speichern"
        >
          <label>
            <span>Thema</span>
            <input
              maxLength={120}
              value={edit.topic}
              onChange={(event) => setEdit({ ...edit, topic: event.target.value })}
            />
          </label>
          {data.canManage && (
            <label>
              <span>Zuständig</span>
              <CareSelect
                label="Zuständig"
                value={nameOf(data.staff, edit.assignedTo, NOBODY)}
                options={[NOBODY, ...data.staff.map((item) => item.name)]}
                onChange={(value) => setEdit({ ...edit, assignedTo: idOf(data.staff, value) })}
              />
            </label>
          )}
          {edit.item.status === "open" && (
            <div className="area-editor-wide repositioning-choices" role="group" aria-label="Stand">
              <button
                type="button"
                className={`day-toggle ${edit.inProgress ? "active" : ""}`}
                aria-pressed={edit.inProgress}
                onClick={() => setEdit({ ...edit, inProgress: !edit.inProgress })}
              >
                In Bearbeitung
              </button>
            </div>
          )}
          <label className="area-editor-wide">
            <span>Massnahmen</span>
            <textarea
              rows={3}
              maxLength={4000}
              placeholder="Was wurde abgeklärt oder veranlasst?"
              value={edit.measures}
              onChange={(event) => setEdit({ ...edit, measures: event.target.value })}
            />
          </label>
        </EditorDialog>
      )}

      {answer && (
        <EditorDialog
          id="feedback-answer"
          eyebrow={`${FEEDBACK_KINDS[answer.item.kind]} vom ${formatDate(answer.item.receivedOn)}`}
          title="Antwort festhalten"
          description={`${answer.item.sourceName || FEEDBACK_SOURCES[answer.item.source]}${answer.item.contact ? ` · ${answer.item.contact}` : ""}: ${answer.item.description}`}
          onClose={() => setAnswer(null)}
          onSubmit={async () => {
            const saved = await run(
              () =>
                requestJson(`/api/feedback/${answer.item.id}`, {
                  method: "PATCH",
                  body: { action: "answer", response: answer.response, answeredOn: answer.answeredOn },
                }),
              "Antwort festgehalten",
            );
            if (saved) setAnswer(null);
          }}
          saving={saving}
          error={formError}
          submitLabel="Antwort speichern"
        >
          <label>
            <span>Beantwortet am</span>
            <CareDatePicker
              label="Beantwortet am"
              value={answer.answeredOn}
              max={todayInZurich()}
              onChange={(value) => setAnswer({ ...answer, answeredOn: value })}
            />
          </label>
          <label className="area-editor-wide">
            <span>Antwort</span>
            <textarea
              rows={4}
              required
              maxLength={4000}
              placeholder="Was wurde geantwortet (Gespräch, Brief, E-Mail)?"
              value={answer.response}
              onChange={(event) => setAnswer({ ...answer, response: event.target.value })}
            />
          </label>
        </EditorDialog>
      )}

      {days !== null && (
        <EditorDialog
          id="feedback-days"
          eyebrow="Qualität · Rückmeldungen"
          title="Antwortfrist der Einrichtung"
          description="Anzahl Tage ab Eingang, bis eine Beschwerde oder Anregung beantwortet sein soll. Leer lassen, wenn keine Frist gelten soll. Gilt für neu erfasste Rückmeldungen."
          onClose={() => setDays(null)}
          onSubmit={async () => {
            const saved = await run(
              () => requestJson("/api/feedback/settings", { method: "PUT", body: { days } }),
              days ? `Antwortfrist: ${days} Tage` : "Keine Antwortfrist",
            );
            if (saved) setDays(null);
          }}
          saving={saving}
          error={formError}
          submitLabel="Frist speichern"
        >
          <label>
            <span>Antwortfrist (Tage)</span>
            <input
              inputMode="numeric"
              placeholder="keine Frist"
              value={days}
              onChange={(event) => setDays(event.target.value.replace(/\D/g, ""))}
            />
          </label>
        </EditorDialog>
      )}
    </>
  );
}

// Leitung › Qualität & Kennzahlen › Rückmeldungen.
export default function FeedbackView() {
  return (
    <ModulePageShell
      activeModule="quality"
      activeChild="Rückmeldungen"
      pageClass="leadership-page feedback-page"
      locationSecondary="Gesamtes Haus · alle Wohnbereiche"
    >
      {(showToast) => (
        <main className="workspace leadership-workspace">
          <FeedbackContent showToast={showToast} />
        </main>
      )}
    </ModulePageShell>
  );
}
