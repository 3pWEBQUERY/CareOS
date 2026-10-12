"use client";

import { useState } from "react";
import { CareMultiSelect, CareOptionSelect } from "@/app/components/care-form-controls";
import { ModuleIcon } from "@/app/components/module-icon";
import {
  EditorDialog,
  EmptyState,
  LoadError,
  PageHeading,
  requestJson,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import { DAY_PARTS, DAY_PART_KEYS } from "@/lib/intervention-proofs-shared";
import {
  CARE_RESOURCES,
  GOAL_CATEGORIES,
  RESPONSIBLE_ROLES,
  splitResources,
  type CareTemplates,
  type GoalTemplate,
  type InterventionTemplate,
  type TemplateIntervention,
} from "@/lib/care-planning-shared";

// Vorlagen der Einrichtung: Standardpläne (Ziel mit Massnahmen) und Massnahmenkatalog. CareOS gibt keine Inhalte
// vor; übernommen wird bei der Person immer eine Kopie, die angepasst werden kann.

const EMPTY_INTERVENTION: TemplateIntervention = {
  title: "",
  instructions: "",
  frequency: "",
  responsibleRole: RESPONSIBLE_ROLES[0],
  dayParts: [],
};

const categoryOptions = GOAL_CATEGORIES.map((value) => ({ value, label: value }));
const roleOptions = RESPONSIBLE_ROLES.map((value) => ({ value, label: value }));

function DayPartToggles({
  value,
  onChange,
  label,
}: {
  value: TemplateIntervention["dayParts"];
  onChange: (value: TemplateIntervention["dayParts"]) => void;
  label: string;
}) {
  return (
    <div className="chip-row" role="group" aria-label={label}>
      {DAY_PART_KEYS.map((part) => {
        const active = value.includes(part);
        return (
          <button
            type="button"
            key={part}
            className={`day-toggle ${active ? "active" : ""}`}
            aria-pressed={active}
            onClick={() => onChange(DAY_PART_KEYS.filter((key) => (key === part ? !active : value.includes(key))))}
          >
            {DAY_PARTS[part].label}
          </button>
        );
      })}
    </div>
  );
}

// Felder einer Massnahme (im Katalog und in einem Standardplan).
function InterventionFields({
  value,
  onChange,
  index,
}: {
  value: TemplateIntervention;
  onChange: (value: TemplateIntervention) => void;
  index?: number;
}) {
  const suffix = index === undefined ? "" : ` ${index + 1}`;
  return (
    <>
      <label className="area-editor-wide">
        <span>{`Massnahme${suffix}`}</span>
        <input
          required
          maxLength={220}
          value={value.title}
          onChange={(event) => onChange({ ...value, title: event.target.value })}
        />
      </label>
      <label>
        <span>{`Häufigkeit${suffix}`}</span>
        <input
          required
          maxLength={100}
          value={value.frequency}
          onChange={(event) => onChange({ ...value, frequency: event.target.value })}
          placeholder="z. B. 2× täglich"
        />
      </label>
      <label>
        <span>{`Zuständig${suffix}`}</span>
        <CareOptionSelect
          label={`Zuständig${suffix}`}
          value={value.responsibleRole}
          options={roleOptions}
          onChange={(responsibleRole) => onChange({ ...value, responsibleRole })}
        />
      </label>
      <div className="area-editor-wide form-field">
        <span>{`Nachweis je Tageszeit${suffix}`}</span>
        <DayPartToggles
          label={`Nachweis je Tageszeit${suffix}`}
          value={value.dayParts}
          onChange={(dayParts) => onChange({ ...value, dayParts })}
        />
      </div>
      <label className="area-editor-wide">
        <span>{`Durchführung${suffix}`}</span>
        <textarea
          rows={2}
          maxLength={4000}
          value={value.instructions}
          onChange={(event) => onChange({ ...value, instructions: event.target.value })}
        />
      </label>
    </>
  );
}

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

function GoalTemplateDialog({
  template,
  catalog,
  onClose,
  onSaved,
}: {
  template: GoalTemplate | null;
  catalog: InterventionTemplate[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState({
    category: template?.category ?? "",
    title: template?.title ?? "",
    problem: template?.problem ?? "",
    resources: template?.resources ?? "",
    statement: template?.statement ?? "",
    reviewDays: template?.reviewDays ? String(template.reviewDays) : "",
  });
  const [interventions, setInterventions] = useState<TemplateIntervention[]>(template?.interventions ?? []);
  const { saving, error, save } = useSave(onSaved);
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <EditorDialog
      id="care-goal-template"
      eyebrow="Vorlagen"
      title={template ? "Standardplan bearbeiten" : "Neuer Standardplan"}
      description="Pflegeproblem, Ressourcen, Ziel und Massnahmen, wie sie in der Einrichtung üblich sind. Bei der Person wird eine Kopie übernommen und angepasst."
      onClose={onClose}
      onSubmit={() =>
        save(
          () =>
            requestJson(template ? `/api/care-planning/templates/${template.id}` : "/api/care-planning/templates", {
              method: template ? "PATCH" : "POST",
              body: {
                kind: "goal",
                ...form,
                reviewDays: form.reviewDays ? Number(form.reviewDays) : null,
                interventions,
              },
            }),
          template ? "Standardplan gespeichert" : "Standardplan erfasst",
        )
      }
      saving={saving}
      error={error}
      submitLabel="Speichern"
    >
      <label className="area-editor-wide">
        <span>Name der Vorlage</span>
        <input
          required
          maxLength={160}
          value={form.title}
          onChange={(event) => set("title", event.target.value)}
          placeholder="z. B. Sturzgefahr nach Spitalaufenthalt"
        />
      </label>
      <label>
        <span>Pflegebereich</span>
        <CareOptionSelect
          label="Pflegebereich"
          value={form.category}
          placeholder="Bitte wählen"
          options={categoryOptions}
          onChange={(value) => set("category", value)}
        />
      </label>
      <label>
        <span>Überprüfung nach Tagen (optional)</span>
        <input
          type="number"
          min={1}
          max={365}
          value={form.reviewDays}
          onChange={(event) => set("reviewDays", event.target.value)}
        />
      </label>
      <label className="area-editor-wide">
        <span>Pflegeproblem</span>
        <textarea
          required
          rows={2}
          maxLength={4000}
          value={form.problem}
          onChange={(e) => set("problem", e.target.value)}
        />
      </label>
      <label className="area-editor-wide">
        <span>Ressourcen (optional)</span>
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
        />
      </label>
      <div className="area-editor-wide care-template-interventions">
        <strong>Massnahmen ({interventions.length})</strong>
        {interventions.map((intervention, index) => (
          <fieldset key={index} className="care-template-intervention">
            <legend>
              Massnahme {index + 1}
              <button
                type="button"
                className="quiet-button"
                onClick={() => setInterventions((list) => list.filter((_, position) => position !== index))}
              >
                Entfernen
              </button>
            </legend>
            <InterventionFields
              value={intervention}
              index={index}
              onChange={(next) =>
                setInterventions((list) => list.map((item, position) => (position === index ? next : item)))
              }
            />
          </fieldset>
        ))}
        <div className="care-template-add">
          <button
            type="button"
            className="secondary-button"
            onClick={() => setInterventions((list) => [...list, { ...EMPTY_INTERVENTION }])}
          >
            <ModuleIcon name="plus" className="button-icon" /> Massnahme
          </button>
          {catalog.length > 0 && (
            <CareOptionSelect
              label="Aus dem Katalog"
              value=""
              placeholder="Aus dem Katalog übernehmen"
              options={catalog.map((item) => ({ value: item.id, label: `${item.title} · ${item.frequency}` }))}
              onChange={(id) => {
                const item = catalog.find((entry) => entry.id === id);
                if (item)
                  setInterventions((list) => [
                    ...list,
                    {
                      title: item.title,
                      instructions: item.instructions,
                      frequency: item.frequency,
                      responsibleRole: item.responsibleRole || RESPONSIBLE_ROLES[0],
                      dayParts: item.dayParts,
                    },
                  ]);
              }}
            />
          )}
        </div>
      </div>
    </EditorDialog>
  );
}

function InterventionTemplateDialog({
  template,
  onClose,
  onSaved,
}: {
  template: InterventionTemplate | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [category, setCategory] = useState(template?.category ?? "");
  const [value, setValue] = useState<TemplateIntervention>(
    template
      ? {
          title: template.title,
          instructions: template.instructions,
          frequency: template.frequency,
          responsibleRole: template.responsibleRole || RESPONSIBLE_ROLES[0],
          dayParts: template.dayParts,
        }
      : { ...EMPTY_INTERVENTION },
  );
  const { saving, error, save } = useSave(onSaved);
  return (
    <EditorDialog
      id="intervention-template"
      eyebrow="Massnahmenkatalog"
      title={template ? "Massnahme bearbeiten" : "Massnahme in den Katalog"}
      description="Massnahmen, die in der Einrichtung häufig geplant werden. Bei der Person wird eine Kopie übernommen und angepasst."
      onClose={onClose}
      onSubmit={() =>
        save(
          () =>
            requestJson(template ? `/api/care-planning/templates/${template.id}` : "/api/care-planning/templates", {
              method: template ? "PATCH" : "POST",
              body: { kind: "intervention", category, ...value },
            }),
          template ? "Massnahme gespeichert" : "Massnahme in den Katalog aufgenommen",
        )
      }
      saving={saving}
      error={error}
      submitLabel="Speichern"
    >
      <label className="area-editor-wide">
        <span>Pflegebereich</span>
        <CareOptionSelect
          label="Pflegebereich"
          value={category}
          placeholder="Bitte wählen"
          options={categoryOptions}
          onChange={setCategory}
        />
      </label>
      <InterventionFields value={value} onChange={setValue} />
    </EditorDialog>
  );
}

export default function TemplatesView({ showToast }: { showToast: ShowToast }) {
  const data = useApiData<CareTemplates>("/api/care-planning/templates");
  const [goal, setGoal] = useState<GoalTemplate | "new" | null>(null);
  const [intervention, setIntervention] = useState<InterventionTemplate | "new" | null>(null);
  const templates = data.data;
  const done = (message: string) => {
    setGoal(null);
    setIntervention(null);
    showToast(message);
    data.reload();
  };
  const archive = async (kind: "goal" | "intervention", id: string, title: string) => {
    await requestJson(`/api/care-planning/templates/${id}`, { method: "PATCH", body: { kind, archive: true } });
    done(`„${title}“ wird nicht mehr angeboten`);
  };
  return (
    <>
      <PageHeading
        eyebrow="Pflegeplanung"
        title="Vorlagen"
        description="Standardpläne und Massnahmenkatalog der Einrichtung. Bei der Person wird eine Kopie übernommen und angepasst; Änderungen an Vorlagen ändern bestehende Pflegepläne nicht."
      />
      {data.error && <LoadError message={data.error} onRetry={data.reload} />}
      <div className="care-templates-layout">
        <section className="card service-records" aria-labelledby="care-templates-goals">
          <header className="fund-cash-head">
            <div>
              <h2 className="card-title" id="care-templates-goals">
                Standardpläne
              </h2>
              <p className="card-subtitle">Ziel mit Problem, Ressourcen, Überprüfung und Massnahmen.</p>
            </div>
            <button className="secondary-button" type="button" onClick={() => setGoal("new")}>
              <ModuleIcon name="plus" className="button-icon" /> Neuer Standardplan
            </button>
          </header>
          {templates && !templates.goals.length ? (
            <EmptyState
              icon="plan"
              title="Noch keine Standardpläne"
              text="Erfassen Sie die in der Einrichtung üblichen Pläne."
            />
          ) : (
            <ul aria-label="Standardpläne">
              {templates?.goals.map((template) => (
                <li key={template.id}>
                  <div>
                    <strong>{template.title}</strong>
                    <small>
                      {[
                        template.category,
                        template.reviewDays ? `Überprüfung nach ${template.reviewDays} Tagen` : "",
                        `${template.interventions.length} ${template.interventions.length === 1 ? "Massnahme" : "Massnahmen"}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                    <p>{template.statement}</p>
                  </div>
                  <button className="secondary-button" type="button" onClick={() => setGoal(template)}>
                    Bearbeiten
                  </button>
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => void archive("goal", template.id, template.title)}
                  >
                    Nicht mehr anbieten
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card service-records" aria-labelledby="care-templates-catalog">
          <header className="fund-cash-head">
            <div>
              <h2 className="card-title" id="care-templates-catalog">
                Massnahmenkatalog
              </h2>
              <p className="card-subtitle">Einzelne Massnahmen zum Übernehmen in Pläne und Ziele.</p>
            </div>
            <button className="secondary-button" type="button" onClick={() => setIntervention("new")}>
              <ModuleIcon name="plus" className="button-icon" /> Neue Massnahme
            </button>
          </header>
          {templates && !templates.interventions.length ? (
            <EmptyState icon="note" title="Katalog ist leer" text="Nehmen Sie häufig geplante Massnahmen auf." />
          ) : (
            <ul aria-label="Massnahmenkatalog">
              {templates?.interventions.map((template) => (
                <li key={template.id}>
                  <div>
                    <strong>{template.title}</strong>
                    <small>
                      {[template.category, template.frequency, template.responsibleRole].filter(Boolean).join(" · ")}
                    </small>
                  </div>
                  <button className="secondary-button" type="button" onClick={() => setIntervention(template)}>
                    Bearbeiten
                  </button>
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => void archive("intervention", template.id, template.title)}
                  >
                    Nicht mehr anbieten
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {goal && templates && (
        <GoalTemplateDialog
          template={goal === "new" ? null : goal}
          catalog={templates.interventions}
          onClose={() => setGoal(null)}
          onSaved={done}
        />
      )}
      {intervention && (
        <InterventionTemplateDialog
          template={intervention === "new" ? null : intervention}
          onClose={() => setIntervention(null)}
          onSaved={done}
        />
      )}
    </>
  );
}
