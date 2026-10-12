"use client";

import { useState } from "react";
import { ArrowCounterClockwise, Check } from "@phosphor-icons/react";
import ModulePageShell from "@/app/components/module-page-shell";
import { CareDatePicker, CareSelect } from "@/app/components/care-form-controls";
import {
  EditorDialog,
  LoadError,
  formatDate,
  formatDateTime,
  requestJson,
  todayInZurich,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import { ALL_ROLES, type Onboarding, type OnboardingOverview, type OnboardingStep } from "@/lib/onboarding-shared";
import { LeadershipHeading, LeadershipKpis } from "../../components/leadership-page-parts";

type StartDraft = { userId: string; mentorId: string; startedOn: string; note: string };
type SignDraft = { onboarding: Onboarding; step: OnboardingStep; note: string };

const NO_MENTOR = "Noch niemand";

function OnboardingCard({
  onboarding,
  canManage,
  busy,
  onSign,
  onReopen,
  onComplete,
}: {
  onboarding: Onboarding;
  canManage: boolean;
  busy: boolean;
  onSign: (step: OnboardingStep) => void;
  onReopen: (step: OnboardingStep) => void;
  onComplete: () => void;
}) {
  const done = onboarding.steps.filter((step) => step.done).length;
  const total = onboarding.steps.length;
  return (
    <li aria-label={onboarding.userName} className={onboarding.completed ? "retired" : ""}>
      <div>
        <strong>
          {onboarding.userName}
          <span className="diagnosis-code">{onboarding.roleName}</span>
        </strong>
        <small>
          {[
            `Beginn ${formatDate(onboarding.startedOn)}`,
            onboarding.mentorName ? `Einarbeitung durch ${onboarding.mentorName}` : "Einarbeitende Person offen",
            onboarding.note,
          ]
            .filter(Boolean)
            .join(" · ")}
        </small>
        <small className="device-due">
          {onboarding.completed
            ? `Abgeschlossen ${formatDateTime(onboarding.completed.at)}${onboarding.completed.by ? ` · ${onboarding.completed.by}` : ""}`
            : `${done} von ${total} ${total === 1 ? "Punkt" : "Punkten"} abgezeichnet`}
        </small>
        <details className="diagnosis-resolved" open={!onboarding.completed}>
          <summary>Checkliste ({total})</summary>
          <ul className="death-checklist" aria-label={`Checkliste ${onboarding.userName}`}>
            {onboarding.steps.map((step) => (
              <li key={step.id} className={step.done ? "done" : ""}>
                <span className="death-checklist-mark" aria-hidden="true">
                  {step.done && <Check />}
                </span>
                <div>
                  <strong>{step.title}</strong>
                  {step.done && (
                    <small>
                      Abgezeichnet {formatDateTime(step.done.at)}
                      {step.done.by ? ` · ${step.done.by}` : ""}
                      {step.note ? ` · ${step.note}` : ""}
                    </small>
                  )}
                </div>
                {onboarding.canSign &&
                  (step.done ? (
                    <button
                      type="button"
                      className="death-checklist-action"
                      disabled={busy}
                      aria-label={`${step.title} zurücknehmen`}
                      onClick={() => onReopen(step)}
                    >
                      <ArrowCounterClockwise aria-hidden="true" /> Zurücknehmen
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="death-checklist-action"
                      disabled={busy}
                      aria-label={`${step.title} abzeichnen`}
                      onClick={() => onSign(step)}
                    >
                      <Check aria-hidden="true" /> Abzeichnen
                    </button>
                  ))}
              </li>
            ))}
          </ul>
        </details>
      </div>
      {canManage && !onboarding.completed && (
        <span className="device-actions">
          <button
            type="button"
            className="death-checklist-action"
            disabled={busy || done < total}
            title={done < total ? "Erst möglich, wenn alle Punkte abgezeichnet sind" : undefined}
            aria-label={`Einarbeitung von ${onboarding.userName} abschliessen`}
            onClick={onComplete}
          >
            Abschliessen
          </button>
        </span>
      )}
    </li>
  );
}

function OnboardingContent({ showToast }: { showToast: ShowToast }) {
  const { data, error, reload } = useApiData<OnboardingOverview>("/api/onboarding");
  const [role, setRole] = useState(ALL_ROLES);
  const [listDraft, setListDraft] = useState<string | null>(null);
  const [start, setStart] = useState<StartDraft | null>(null);
  const [sign, setSign] = useState<SignDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const running = (data?.onboardings ?? []).filter((item) => !item.completed);
  const finished = (data?.onboardings ?? []).filter((item) => item.completed);
  const roleName = (key: string) =>
    key === ALL_ROLES ? "Alle Rollen" : (data?.roles.find((item) => item.key === key)?.name ?? key);
  const items = data?.checklists[role] ?? [];
  const busyFree = (data?.staff ?? []).filter((person) => !running.some((item) => item.userId === person.id));

  async function run(action: () => Promise<unknown>, message: string) {
    setSaving(true);
    setFormError("");
    try {
      await action();
      reload();
      showToast(message);
      return true;
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.";
      setFormError(text);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function quick(action: () => Promise<unknown>, message: string) {
    const ok = await run(action, message);
    if (!ok) reload();
  }

  const person = (id: string) => data?.staff.find((item) => item.id === id);

  return (
    <>
      <LeadershipHeading
        eyebrow="Mitarbeitende · Einarbeitung"
        title="Einarbeitung"
        description="Checkliste je Rolle für neue Mitarbeitende. Die Punkte legt die Einrichtung fest; die einarbeitende Person zeichnet sie ab."
        action={
          data?.canManage
            ? {
                label: "Einarbeitung starten",
                onClick: () => {
                  setFormError("");
                  setStart({ userId: "", mentorId: "", startedOn: todayInZurich(), note: "" });
                },
              }
            : undefined
        }
      />
      {error && <LoadError message={error} onRetry={reload} />}
      {data && (
        <LeadershipKpis
          kpis={[
            { value: String(running.length), label: "Laufende Einarbeitungen", note: "noch nicht abgeschlossen" },
            {
              value: String(running.reduce((sum, item) => sum + item.steps.filter((step) => !step.done).length, 0)),
              label: "Punkte offen",
              note: "noch nicht abgezeichnet",
            },
            { value: String(finished.length), label: "Abgeschlossen", note: "alle Punkte abgezeichnet" },
          ]}
        />
      )}
      {data && !data.onboardings.length ? (
        <section className="card hygiene-empty">
          <strong>Keine Einarbeitung erfasst</strong>
          <p>
            {data.canManage
              ? "Zuerst unten die Checkliste je Rolle festlegen, dann eine Einarbeitung starten."
              : "Hier erscheinen Einarbeitungen, die du begleitest oder selbst durchläufst."}
          </p>
        </section>
      ) : data ? (
        <section className="card device-list" aria-label="Einarbeitungen">
          <ul>
            {[...running, ...finished].map((onboarding) => (
              <OnboardingCard
                key={onboarding.id}
                onboarding={onboarding}
                canManage={data.canManage}
                busy={saving}
                onSign={(step) => {
                  setFormError("");
                  setSign({ onboarding, step, note: "" });
                }}
                onReopen={(step) =>
                  void quick(
                    () => requestJson(`/api/onboarding/steps/${step.id}`, { method: "PATCH", body: { done: false } }),
                    `${step.title}: zurückgenommen`,
                  )
                }
                onComplete={() =>
                  void quick(
                    () => requestJson(`/api/onboarding/${onboarding.id}/complete`, { method: "POST" }),
                    `Einarbeitung von ${onboarding.userName} abgeschlossen`,
                  )
                }
              />
            ))}
          </ul>
        </section>
      ) : (
        !error && <p className="record-export-note">Wird geladen …</p>
      )}
      {formError && !start && !sign && listDraft === null && (
        <p className="restraints-error" role="alert">
          {formError}
        </p>
      )}

      {data?.canManage && (
        <section className="card device-list onboarding-checklists" aria-labelledby="onboarding-lists-title">
          <div className="card-header">
            <div>
              <p className="eyebrow">Konfiguration</p>
              <h2 className="card-title" id="onboarding-lists-title">
                Checklisten je Rolle
              </h2>
              <p className="card-subtitle">
                Beim Start gelten die Punkte für alle Rollen und die der Rolle der Person. Spätere Änderungen betreffen
                nur neue Einarbeitungen.
              </p>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setFormError("");
                setListDraft(items.join("\n"));
              }}
            >
              {items.length ? "Bearbeiten" : "Festlegen"}
            </button>
          </div>
          <div className="repositioning-choices" role="group" aria-label="Rolle">
            {[ALL_ROLES, ...data.roles.map((item) => item.key)].map((key) => (
              <button
                key={key || "alle"}
                type="button"
                className={`day-toggle ${role === key ? "active" : ""}`}
                aria-pressed={role === key}
                onClick={() => setRole(key)}
              >
                {roleName(key)}
                {data.checklists[key]?.length ? ` (${data.checklists[key].length})` : ""}
              </button>
            ))}
          </div>
          {items.length ? (
            <ol className="device-checks onboarding-items">
              {items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          ) : (
            <p className="record-export-note">Für „{roleName(role)}“ sind noch keine Punkte festgelegt.</p>
          )}
        </section>
      )}

      {listDraft !== null && (
        <EditorDialog
          id="onboarding-list"
          eyebrow="Einarbeitung · Checkliste"
          title={`Checkliste: ${roleName(role)}`}
          description="Ein Punkt pro Zeile, z. B. Rundgang durch das Haus, Brandschutz und Fluchtwege, Datenschutz unterschrieben, Einführung in die Pflegedokumentation."
          onClose={() => setListDraft(null)}
          onSubmit={async () => {
            const saved = await run(
              () =>
                requestJson("/api/onboarding/checklists", {
                  method: "PUT",
                  body: { role, items: listDraft.split("\n") },
                }),
              `Checkliste „${roleName(role)}“ gespeichert`,
            );
            if (saved) setListDraft(null);
          }}
          saving={saving}
          error={formError}
          submitLabel="Checkliste speichern"
        >
          <label className="area-editor-wide">
            <span>Punkte</span>
            <textarea rows={10} value={listDraft} onChange={(event) => setListDraft(event.target.value)} />
          </label>
        </EditorDialog>
      )}

      {start && data && (
        <EditorDialog
          id="onboarding-start"
          eyebrow="Mitarbeitende · Einarbeitung"
          title="Einarbeitung starten"
          description="Die Punkte für alle Rollen und für die Rolle der Person werden übernommen."
          onClose={() => setStart(null)}
          onSubmit={async () => {
            if (!start.userId) return setFormError("Bitte die mitarbeitende Person wählen.");
            const saved = await run(
              () =>
                requestJson("/api/onboarding", {
                  method: "POST",
                  body: { ...start, mentorId: start.mentorId || null },
                }),
              `Einarbeitung von ${person(start.userId)?.name ?? ""} gestartet`,
            );
            if (saved) setStart(null);
          }}
          saving={saving}
          error={formError}
          submitLabel="Einarbeitung starten"
        >
          <label className="area-editor-wide">
            <span>Neue mitarbeitende Person</span>
            <CareSelect
              label="Neue mitarbeitende Person"
              value={
                person(start.userId)
                  ? `${person(start.userId)!.name} · ${person(start.userId)!.roleName}`
                  : "Person auswählen"
              }
              options={busyFree.map((item) => `${item.name} · ${item.roleName}`)}
              onChange={(value) =>
                setStart({
                  ...start,
                  userId: busyFree.find((item) => `${item.name} · ${item.roleName}` === value)?.id ?? "",
                })
              }
            />
          </label>
          <label>
            <span>Einarbeitung durch</span>
            <CareSelect
              label="Einarbeitung durch"
              value={person(start.mentorId)?.name ?? NO_MENTOR}
              options={[NO_MENTOR, ...data.staff.filter((item) => item.id !== start.userId).map((item) => item.name)]}
              onChange={(value) =>
                setStart({ ...start, mentorId: data.staff.find((item) => item.name === value)?.id ?? "" })
              }
            />
          </label>
          <label>
            <span>Beginn</span>
            <CareDatePicker
              label="Beginn"
              value={start.startedOn}
              onChange={(value) => setStart({ ...start, startedOn: value })}
            />
          </label>
          <label className="area-editor-wide">
            <span>Bemerkung</span>
            <input
              maxLength={2000}
              placeholder="z. B. Teilzeit 60 %, Einsatz im Wohnbereich EG"
              value={start.note}
              onChange={(event) => setStart({ ...start, note: event.target.value })}
            />
          </label>
        </EditorDialog>
      )}

      {sign && (
        <EditorDialog
          id="onboarding-sign"
          eyebrow={`Einarbeitung · ${sign.onboarding.userName}`}
          title="Punkt abzeichnen"
          description={`„${sign.step.title}“ wird mit deinem Namen und der Uhrzeit abgezeichnet.`}
          onClose={() => setSign(null)}
          onSubmit={async () => {
            const saved = await run(
              () =>
                requestJson(`/api/onboarding/steps/${sign.step.id}`, {
                  method: "PATCH",
                  body: { done: true, note: sign.note },
                }),
              `${sign.step.title}: abgezeichnet`,
            );
            if (saved) setSign(null);
          }}
          saving={saving}
          error={formError}
          submitLabel="Abzeichnen"
        >
          <label className="area-editor-wide">
            <span>Bemerkung</span>
            <input
              maxLength={500}
              placeholder="z. B. gemeinsam durchgeführt, Unterlagen abgegeben"
              value={sign.note}
              onChange={(event) => setSign({ ...sign, note: event.target.value })}
            />
          </label>
        </EditorDialog>
      )}
    </>
  );
}

// Leitung › Mitarbeitende › Einarbeitung.
export default function OnboardingView() {
  return (
    <ModulePageShell
      activeModule="staff"
      activeChild="Einarbeitung"
      pageClass="leadership-page onboarding-page"
      locationSecondary="Gesamtes Haus · alle Wohnbereiche"
    >
      {(showToast) => (
        <main className="workspace leadership-workspace">
          <OnboardingContent showToast={showToast} />
        </main>
      )}
    </ModulePageShell>
  );
}
