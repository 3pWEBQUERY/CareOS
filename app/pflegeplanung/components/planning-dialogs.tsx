"use client";

import { useState, type ReactNode } from "react";
import { CareDatePicker, CareMultiSelect, CareOptionSelect, CareSelect } from "@/app/components/care-form-controls";
import { EditorDialog, requestJson, todayInZurich, useApiData } from "@/app/components/workspace-ui";
import { useCountry } from "@/app/components/care-context";
import { NOT_ASSESSED, careLevelOptions } from "@/lib/country";
import { DAY_PARTS, DAY_PART_KEYS } from "@/lib/intervention-proofs-shared";
import {
  CARE_RESOURCES,
  GOAL_CATEGORIES,
  OUTCOME_LABELS,
  RESPONSIBLE_ROLES,
  splitResources,
  type CareGoal,
  type CarePlan,
  type CareTemplates,
  type TemplateIntervention,
  type Intervention,
  type Outcome,
} from "@/lib/care-planning-shared";

const plusDays = (days: number) => {
  const date = new Date(`${todayInZurich()}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

// Shared submit handling for the planning dialogs.
function useSave(onSaved: (message: string) => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async (request: () => Promise<unknown>, message: string) => {
    setSaving(true);
    setError("");
    try {
      await request();
      onSaved(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  };
  return { saving, error, save };
}

type DialogProps = { residentName: string; onClose: () => void; onSaved: (message: string) => void };

export function PlanDialog({
  residentId,
  plan,
  staff,
  residentName,
  onClose,
  onSaved,
}: DialogProps & { residentId: string; plan: CarePlan | null; staff: Array<{ id: string; name: string }> }) {
  const country = useCountry();
  const [form, setForm] = useState({
    careLevel: plan?.careLevel ?? "",
    focus: plan?.focus ?? "",
    ownerId: plan?.ownerId ?? "",
    startsOn: plan?.startsOn ?? todayInZurich(),
    reviewOn: plan?.reviewOn ?? plusDays(90),
  });
  const { saving, error, save } = useSave(onSaved);
  const set = <K extends keyof typeof form>(key: K, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const owner = staff.find((u) => u.id === form.ownerId);
  return (
    <EditorDialog
      id="care-plan"
      eyebrow={`Pflegeplanung · ${residentName}`}
      title={plan ? "Pflegeplan bearbeiten" : "Pflegeplan anlegen"}
      description="Der Pflegeplan bündelt Probleme, Ziele und Massnahmen. Zum Überprüfungsdatum erscheint er unter „Auswertung“."
      onClose={onClose}
      onSubmit={() =>
        save(
          () =>
            plan
              ? requestJson(`/api/care-planning/plans/${plan.id}`, {
                  method: "PATCH",
                  body: { ...form, ownerId: form.ownerId || null },
                })
              : requestJson("/api/care-planning/plans", {
                  method: "POST",
                  body: { ...form, residentId, ownerId: form.ownerId || null },
                }),
          plan ? "Pflegeplan aktualisiert" : `Pflegeplan für ${residentName} angelegt`,
        )
      }
      saving={saving}
      error={error}
      submitLabel={plan ? "Änderungen speichern" : "Pflegeplan anlegen"}
    >
      <label className="area-editor-wide">
        <span>Pflegefokus</span>
        <textarea
          required
          rows={3}
          maxLength={4000}
          value={form.focus}
          onChange={(e) => set("focus", e.target.value)}
          placeholder="z. B. Mobilität erhalten und Stürze vermeiden; Diabetes stabil einstellen"
        />
      </label>
      <label>
        <span>{country.careLevels.label}</span>
        <CareSelect
          label={country.careLevels.label}
          value={form.careLevel || NOT_ASSESSED}
          options={[NOT_ASSESSED, ...careLevelOptions(country.code, plan?.careLevel)]}
          onChange={(value) => set("careLevel", value === NOT_ASSESSED ? "" : value)}
        />
      </label>
      <label>
        <span>Bezugspflege</span>
        <CareSelect
          label="Bezugspflege"
          value={owner?.name ?? "Nicht festgelegt"}
          options={["Nicht festgelegt", ...staff.map((u) => u.name)]}
          onChange={(v) => set("ownerId", staff.find((u) => u.name === v)?.id ?? "")}
        />
      </label>
      <label>
        <span>Gültig ab</span>
        <CareDatePicker label="Gültig ab" value={form.startsOn} onChange={(v) => set("startsOn", v)} />
      </label>
      <label>
        <span>Überprüfung am</span>
        <CareDatePicker label="Überprüfung am" value={form.reviewOn} onChange={(v) => set("reviewOn", v)} />
      </label>
    </EditorDialog>
  );
}

export function GoalDialog({
  planId,
  goal,
  residentName,
  onClose,
  onSaved,
}: DialogProps & { planId: string; goal: CareGoal | null }) {
  const [form, setForm] = useState({
    category:
      goal?.category && (GOAL_CATEGORIES as readonly string[]).includes(goal.category)
        ? goal.category
        : GOAL_CATEGORIES[0],
    problem: goal?.problem ?? "",
    resources: goal?.resources ?? "",
    statement: goal?.statement ?? "",
    targetDate: goal?.targetDate ?? plusDays(28),
  });
  const { saving, error, save } = useSave(onSaved);
  const set = <K extends keyof typeof form>(key: K, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  // Vorlagen der Einrichtung (nur beim neuen Ziel): Inhalte werden übernommen und können angepasst werden.
  const templates = useApiData<CareTemplates>(goal ? null : "/api/care-planning/templates").data;
  const [templateId, setTemplateId] = useState("");
  const [picked, setPicked] = useState<TemplateIntervention[]>([]);
  const template = templates?.goals.find((entry) => entry.id === templateId) ?? null;
  const applyTemplate = (id: string) => {
    const chosen = templates?.goals.find((entry) => entry.id === id);
    if (!chosen) return;
    setTemplateId(id);
    setForm((current) => ({
      ...current,
      category: (GOAL_CATEGORIES as readonly string[]).includes(chosen.category) ? chosen.category : current.category,
      problem: chosen.problem,
      resources: chosen.resources,
      statement: chosen.statement,
      targetDate: chosen.reviewDays ? plusDays(chosen.reviewDays) : current.targetDate,
    }));
    setPicked(chosen.interventions);
  };
  return (
    <EditorDialog
      id="care-goal"
      eyebrow={`Pflegeplanung · ${residentName}`}
      title={goal ? "Pflegeziel bearbeiten" : "Pflegeziel hinzufügen"}
      description="Problem → Ressourcen → Ziel. Das Ziel möglichst konkret und überprüfbar formulieren (wer, was, wie gut, bis wann)."
      onClose={onClose}
      onSubmit={() =>
        save(
          () =>
            goal
              ? requestJson(`/api/care-planning/goals/${goal.id}`, { method: "PATCH", body: form })
              : requestJson(`/api/care-planning/plans/${planId}/goals`, {
                  method: "POST",
                  body: template ? { ...form, templateId: template.id, interventions: picked } : form,
                }),
          goal
            ? "Pflegeziel aktualisiert"
            : picked.length && template
              ? `Pflegeziel mit ${picked.length} ${picked.length === 1 ? "Massnahme" : "Massnahmen"} hinzugefügt`
              : "Pflegeziel hinzugefügt",
        )
      }
      saving={saving}
      error={error}
      submitLabel={goal ? "Änderungen speichern" : "Ziel hinzufügen"}
    >
      {!goal && templates && templates.goals.length > 0 && (
        <label className="area-editor-wide">
          <span>Vorlage (optional)</span>
          <CareOptionSelect
            label="Vorlage"
            value={templateId}
            placeholder="Ohne Vorlage"
            options={templates.goals.map((entry) => ({ value: entry.id, label: `${entry.category} · ${entry.title}` }))}
            onChange={applyTemplate}
          />
        </label>
      )}
      <label>
        <span>Pflegebereich</span>
        <CareSelect
          label="Pflegebereich"
          value={form.category}
          options={[...GOAL_CATEGORIES]}
          onChange={(v) => set("category", v)}
        />
      </label>
      <label>
        <span>Überprüfung am</span>
        <CareDatePicker label="Überprüfung am" value={form.targetDate} onChange={(v) => set("targetDate", v)} />
      </label>
      <label className="area-editor-wide">
        <span>Pflegeproblem</span>
        <textarea
          required
          rows={2}
          maxLength={4000}
          value={form.problem}
          onChange={(e) => set("problem", e.target.value)}
          placeholder="z. B. Gangunsicherheit nach Sturz am 12.09., Angst vor erneutem Sturz"
        />
      </label>
      <label className="area-editor-wide">
        <span>Ressourcen</span>
        <CareMultiSelect
          label="Ressourcen"
          values={splitResources(form.resources)}
          options={CARE_RESOURCES}
          placeholder="Ressourcen wählen"
          customLabel="Eigene Ressource ergänzen"
          onChange={(values) => set("resources", values.join(", "))}
        />
      </label>
      <label className="area-editor-wide">
        <span>Ziel</span>
        <textarea
          required
          rows={2}
          maxLength={2000}
          value={form.statement}
          onChange={(e) => set("statement", e.target.value)}
          placeholder="z. B. Herr Müller geht mit Rollator und Begleitung 20 m im Korridor ohne Sturz."
        />
      </label>
      {template && template.interventions.length > 0 && (
        <div className="area-editor-wide form-field care-template-pick">
          <span>Massnahmen aus der Vorlage</span>
          <div className="chip-row" role="group" aria-label="Massnahmen aus der Vorlage">
            {template.interventions.map((item, index) => {
              const active = picked.includes(item);
              return (
                <button
                  type="button"
                  key={`${item.title}:${index}`}
                  className={`day-toggle ${active ? "active" : ""}`}
                  aria-pressed={active}
                  onClick={() =>
                    setPicked(
                      template.interventions.filter((entry) => (entry === item ? !active : picked.includes(entry))),
                    )
                  }
                >
                  {item.title} · {item.frequency}
                </button>
              );
            })}
          </div>
          <small>Gewählte Massnahmen werden mit dem Ziel angelegt und lassen sich danach einzeln anpassen.</small>
        </div>
      )}
    </EditorDialog>
  );
}

export function InterventionDialog({
  goal,
  intervention,
  residentName,
  onClose,
  onSaved,
}: DialogProps & { goal: CareGoal; intervention: Intervention | null }) {
  const [form, setForm] = useState({
    title: intervention?.title ?? "",
    instructions: intervention?.instructions ?? "",
    frequency: intervention?.frequency ?? "",
    responsibleRole: intervention?.responsibleRole ?? RESPONSIBLE_ROLES[0],
    dayParts: intervention?.dayParts ?? [],
  });
  const { saving, error, save } = useSave(onSaved);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  // Massnahmenkatalog der Einrichtung (nur bei neuen Massnahmen), passende Pflegebereiche zuerst.
  const catalog =
    useApiData<CareTemplates>(intervention ? null : "/api/care-planning/templates").data?.interventions ?? [];
  const sorted = [...catalog].sort(
    (a, b) =>
      Number(b.category === goal.category) - Number(a.category === goal.category) || a.title.localeCompare(b.title),
  );
  return (
    <EditorDialog
      id="care-intervention"
      eyebrow={`Pflegeplanung · ${residentName}`}
      title={intervention ? "Massnahme bearbeiten" : "Massnahme planen"}
      description={`Zum Ziel: ${goal.statement}`}
      onClose={onClose}
      onSubmit={() =>
        save(
          () =>
            intervention
              ? requestJson(`/api/care-planning/interventions/${intervention.id}`, { method: "PATCH", body: form })
              : requestJson(`/api/care-planning/goals/${goal.id}/interventions`, { method: "POST", body: form }),
          intervention ? "Massnahme aktualisiert" : "Massnahme geplant",
        )
      }
      saving={saving}
      error={error}
      submitLabel={intervention ? "Änderungen speichern" : "Massnahme speichern"}
    >
      {!intervention && sorted.length > 0 && (
        <label className="area-editor-wide">
          <span>Aus dem Katalog (optional)</span>
          <CareOptionSelect
            label="Aus dem Katalog"
            value=""
            placeholder="Massnahme aus dem Katalog übernehmen"
            options={sorted.map((entry) => ({ value: entry.id, label: `${entry.category} · ${entry.title}` }))}
            onChange={(id) => {
              const entry = sorted.find((item) => item.id === id);
              if (entry)
                setForm({
                  title: entry.title,
                  instructions: entry.instructions,
                  frequency: entry.frequency,
                  responsibleRole: (RESPONSIBLE_ROLES as readonly string[]).includes(entry.responsibleRole)
                    ? entry.responsibleRole
                    : RESPONSIBLE_ROLES[0],
                  dayParts: entry.dayParts,
                });
            }}
          />
        </label>
      )}
      <label className="area-editor-wide">
        <span>Massnahme</span>
        <input
          required
          maxLength={220}
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="z. B. Begleitetes Gehtraining mit Rollator"
        />
      </label>
      <label>
        <span>Häufigkeit</span>
        <input
          required
          maxLength={100}
          value={form.frequency}
          onChange={(e) => set("frequency", e.target.value)}
          placeholder="z. B. 2× täglich, vor dem Mittagessen"
        />
      </label>
      <label>
        <span>Zuständig</span>
        <CareSelect
          label="Zuständig"
          value={form.responsibleRole}
          options={[...RESPONSIBLE_ROLES]}
          onChange={(v) => set("responsibleRole", v)}
        />
      </label>
      <div className="area-editor-wide form-field">
        <span>Nachweis je Tageszeit</span>
        <div className="chip-row" role="group" aria-label="Nachweis je Tageszeit">
          {DAY_PART_KEYS.map((part) => {
            const active = form.dayParts.includes(part);
            return (
              <button
                type="button"
                key={part}
                className={`day-toggle ${active ? "active" : ""}`}
                aria-pressed={active}
                onClick={() =>
                  set(
                    "dayParts",
                    DAY_PART_KEYS.filter((key) => (key === part ? !active : form.dayParts.includes(key))),
                  )
                }
              >
                {DAY_PARTS[part].label}
              </button>
            );
          })}
          <small>
            {form.dayParts.length
              ? "erscheint zu diesen Tageszeiten im Durchführungsnachweis"
              : "ohne Nachweis je Tageszeit"}
          </small>
        </div>
      </div>
      <label className="area-editor-wide">
        <span>Durchführung</span>
        <textarea
          rows={3}
          maxLength={4000}
          value={form.instructions}
          onChange={(e) => set("instructions", e.target.value)}
          placeholder="Vorgehen, Hilfsmittel, worauf achten, was dokumentieren"
        />
      </label>
    </EditorDialog>
  );
}

export function EvaluationDialog({ goal, residentName, onClose, onSaved }: DialogProps & { goal: CareGoal }) {
  const [outcome, setOutcome] = useState<Outcome>("partially");
  const [note, setNote] = useState("");
  const [nextReviewOn, setNextReviewOn] = useState(plusDays(28));
  const [closeGoal, setCloseGoal] = useState(false);
  const { saving, error, save } = useSave(onSaved);
  const closes = outcome === "achieved" || (outcome === "not_achieved" && closeGoal);
  const outcomeButtons: ReactNode = (
    <div className="appointment-kind-switch area-editor-wide" role="group" aria-label="Ergebnis">
      {(Object.keys(OUTCOME_LABELS) as Outcome[]).map((key) => (
        <button
          type="button"
          key={key}
          className={outcome === key ? "active" : ""}
          aria-pressed={outcome === key}
          onClick={() => setOutcome(key)}
        >
          {OUTCOME_LABELS[key]}
        </button>
      ))}
    </div>
  );
  return (
    <EditorDialog
      id="care-evaluation"
      eyebrow={`Pflegeplanung · ${residentName}`}
      title="Ziel evaluieren"
      description={goal.statement}
      onClose={onClose}
      onSubmit={() =>
        save(
          () =>
            requestJson(`/api/care-planning/goals/${goal.id}/evaluations`, {
              method: "POST",
              body: { outcome, note, nextReviewOn: closes ? null : nextReviewOn, closeGoal },
            }),
          `Evaluation gespeichert · ${OUTCOME_LABELS[outcome]}`,
        )
      }
      saving={saving}
      error={error}
      submitLabel="Evaluation speichern"
    >
      {outcomeButtons}
      <label className="area-editor-wide">
        <span>Begründung</span>
        <textarea
          required
          rows={4}
          maxLength={4000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Beobachtungen, Veränderungen seit der letzten Überprüfung, Anpassungen der Massnahmen"
        />
      </label>
      {outcome === "not_achieved" && (
        <label className="form-checkbox area-editor-wide">
          <input type="checkbox" checked={closeGoal} onChange={(e) => setCloseGoal(e.target.checked)} />
          Ziel nicht weiterverfolgen (abschliessen) – sonst bleibt es mit neuem Termin aktiv
        </label>
      )}
      {!closes && (
        <label>
          <span>Nächste Überprüfung</span>
          <CareDatePicker label="Nächste Überprüfung" value={nextReviewOn} onChange={setNextReviewOn} />
        </label>
      )}
    </EditorDialog>
  );
}
