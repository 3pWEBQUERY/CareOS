"use client";

import { useTerms } from "@/app/components/care-context";
import { useState } from "react";
import { CareDatePicker, CareSelect } from "@/app/components/care-form-controls";
import { EditorDialog, requestJson, todayInZurich, timeInZurich } from "@/app/components/workspace-ui";
import {
  EFFECTIVENESS,
  EVENT_STATUS,
  SEVERITIES,
  type Effectiveness,
  type EventStatus,
  type Option,
  type QualityAction,
  type QualityEvent,
  type Severity,
} from "@/lib/quality-shared";

const NONE = "Keine Angabe";
const NOBODY = "Noch nicht festgelegt";
const optionLabel = (option: Option) => (option.detail ? `${option.name} · ${option.detail}` : option.name);

function useSubmit(onSaved: (message: string) => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async (request: () => Promise<unknown>, message: string) => {
    setSaving(true);
    setError("");
    try {
      await request();
      onSaved(message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  };
  return { saving, error, submit };
}

function OptionSelect({
  label,
  options,
  value,
  empty,
  onChange,
}: {
  label: string;
  options: Option[];
  value: string;
  empty: string;
  onChange: (id: string) => void;
}) {
  const selected = options.find((option) => option.id === value);
  return (
    <CareSelect
      label={label}
      value={selected ? optionLabel(selected) : empty}
      options={[empty, ...options.map(optionLabel)]}
      onChange={(next) => onChange(options.find((option) => optionLabel(option) === next)?.id ?? "")}
    />
  );
}

type DialogProps = { onClose: () => void; onSaved: (message: string) => void };

export function ReportEventDialog({
  residents,
  careUnits,
  workflowSteps,
  eventTypes,
  onClose,
  onSaved,
}: DialogProps & {
  residents: Option[];
  careUnits: Option[];
  workflowSteps: Record<string, number>;
  eventTypes: string[];
}) {
  const t = useTerms();
  const [form, setForm] = useState({
    type: eventTypes[0] ?? "",
    severity: "attention" as Severity,
    title: "",
    date: todayInZurich(),
    time: timeInZurich(),
    residentId: "",
    careUnitId: "",
    description: "",
    immediateAction: "",
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const severities = Object.entries(SEVERITIES) as Array<[Severity, (typeof SEVERITIES)[Severity]]>;
  const { saving, error, submit } = useSubmit(onSaved);
  const followUps = workflowSteps[form.type] ?? 0;
  return (
    <EditorDialog
      id="quality-event"
      eyebrow="Qualität · Ereignis"
      title="Ereignis melden"
      description="Meldungen gehen direkt an das Qualitätsmanagement. Beschreibe sachlich, was passiert ist und was sofort unternommen wurde."
      onClose={onClose}
      onSubmit={() =>
        submit(
          () =>
            requestJson("/api/quality/events", {
              method: "POST",
              body: {
                ...form,
                residentId: form.residentId || null,
                careUnitId: form.careUnitId || null,
                occurredAt: new Date(`${form.date}T${form.time}`).toISOString(),
              },
            }),
          followUps
            ? `Ereignis gemeldet · ${followUps} ${followUps === 1 ? "Folgeaufgabe" : "Folgeaufgaben"} erstellt`
            : "Ereignis gemeldet",
        )
      }
      saving={saving}
      error={error}
      submitLabel="Ereignis melden"
    >
      <label>
        <span>Art</span>
        <CareSelect
          label="Art des Ereignisses"
          value={form.type}
          options={eventTypes}
          onChange={(v) => set("type", v)}
        />
      </label>
      <label>
        <span>Schweregrad</span>
        <CareSelect
          label="Schweregrad"
          value={SEVERITIES[form.severity].label}
          options={severities.map(([, item]) => item.label)}
          onChange={(v) => set("severity", severities.find(([, item]) => item.label === v)?.[0] ?? "attention")}
        />
      </label>
      {followUps > 0 && (
        <p className="area-editor-wide list-hint quality-workflow-hint">
          Aus der Ablaufkette „{form.type}“ entstehen {followUps} {followUps === 1 ? "Folgeaufgabe" : "Folgeaufgaben"}{" "}
          für das Team.
        </p>
      )}
      <label className="area-editor-wide">
        <span>Kurztitel (optional)</span>
        <input
          maxLength={180}
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="z. B. Beinahe-Sturz beim Transfer"
        />
      </label>
      <label>
        <span>Datum</span>
        <CareDatePicker label="Datum des Ereignisses" value={form.date} onChange={(v) => set("date", v)} />
      </label>
      <label>
        <span>Uhrzeit</span>
        <input type="time" required value={form.time} onChange={(e) => set("time", e.target.value)} />
      </label>
      <label>
        <span>Betroffener {t.one}</span>
        <OptionSelect
          label={t.one}
          options={residents}
          value={form.residentId}
          empty={NONE}
          onChange={(v) => set("residentId", v)}
        />
      </label>
      <label>
        <span>Wohnbereich</span>
        <OptionSelect
          label="Wohnbereich"
          options={careUnits}
          value={form.careUnitId}
          empty={form.residentId ? `Wie ${t.one}` : NONE}
          onChange={(v) => set("careUnitId", v)}
        />
      </label>
      <label className="area-editor-wide">
        <span>Was ist passiert?</span>
        <textarea
          required
          rows={4}
          maxLength={4000}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="Hergang, beteiligte Personen, Folgen"
        />
      </label>
      <label className="area-editor-wide">
        <span>Sofortmassnahmen</span>
        <textarea
          rows={3}
          maxLength={2000}
          value={form.immediateAction}
          onChange={(e) => set("immediateAction", e.target.value)}
          placeholder="z. B. Arzt informiert, Vitalwerte kontrolliert, Angehörige benachrichtigt"
        />
      </label>
    </EditorDialog>
  );
}

// Quality management moves the event through the workflow and assigns an owner.
export function HandleEventDialog({
  event,
  status,
  staff,
  onClose,
  onSaved,
}: DialogProps & { event: QualityEvent; status: EventStatus; staff: Option[] }) {
  const [ownerId, setOwnerId] = useState(event.ownerId ?? "");
  const [severity, setSeverity] = useState<Severity>(event.severity);
  const [resolution, setResolution] = useState(event.resolution ?? "");
  const severities = Object.entries(SEVERITIES) as Array<[Severity, (typeof SEVERITIES)[Severity]]>;
  const closing = status === "resolved" || status === "closed";
  const { saving, error, submit } = useSubmit(onSaved);
  return (
    <EditorDialog
      id="quality-event-handle"
      eyebrow={`Qualität · ${event.title}`}
      title={status === event.status ? "Ereignis bearbeiten" : EVENT_STATUS[status].label}
      description={
        closing
          ? "Halte fest, welche Ursachen gefunden und welche Massnahmen umgesetzt wurden."
          : "Lege Verantwortung und Einstufung für die Prüfung fest."
      }
      onClose={onClose}
      onSubmit={() =>
        submit(
          () =>
            requestJson(`/api/quality/events/${event.id}`, {
              method: "PATCH",
              body: { status, severity, ownerId: ownerId || null, resolution },
            }),
          status === event.status ? "Ereignis aktualisiert" : `Ereignis: ${EVENT_STATUS[status].label}`,
        )
      }
      saving={saving}
      error={error}
      submitLabel={status === event.status ? "Speichern" : EVENT_STATUS[status].label}
    >
      <label>
        <span>Verantwortlich</span>
        <OptionSelect label="Verantwortlich" options={staff} value={ownerId} empty={NOBODY} onChange={setOwnerId} />
      </label>
      <label>
        <span>Schweregrad</span>
        <CareSelect
          label="Schweregrad"
          value={SEVERITIES[severity].label}
          options={severities.map(([, item]) => item.label)}
          onChange={(v) => setSeverity(severities.find(([, item]) => item.label === v)?.[0] ?? severity)}
        />
      </label>
      <label className="area-editor-wide">
        <span>{closing ? "Ergebnis und umgesetzte Massnahmen" : "Erkenntnisse (optional)"}</span>
        <textarea
          required={closing}
          rows={5}
          maxLength={4000}
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
          placeholder="Ursachenanalyse, Gespräche, angepasste Abläufe"
        />
      </label>
    </EditorDialog>
  );
}

const plusDays = (days: number) => {
  const date = new Date(`${todayInZurich()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export function ActionDialog({
  action,
  eventId,
  events,
  careUnits,
  staff,
  onClose,
  onSaved,
}: DialogProps & {
  action: QualityAction | null;
  eventId?: string | null;
  events: Option[];
  careUnits: Option[];
  staff: Option[];
}) {
  const [form, setForm] = useState({
    title: action?.title ?? "",
    description: action?.description ?? "",
    ownerId: action?.ownerId ?? "",
    dueOn: action?.dueOn ?? plusDays(14),
    eventId: action?.eventId ?? eventId ?? "",
    careUnitId: careUnits.find((unit) => unit.name === action?.careUnit)?.id ?? "",
    status: (action?.status === "planned" ? "planned" : "open") as "open" | "planned",
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const { saving, error, submit } = useSubmit(onSaved);
  const body = {
    ...form,
    ownerId: form.ownerId || null,
    eventId: form.eventId || null,
    careUnitId: form.careUnitId || null,
  };
  return (
    <EditorDialog
      id="quality-action"
      eyebrow="Qualität · Massnahme"
      title={action ? "Massnahme bearbeiten" : "Massnahme planen"}
      description="Verbesserungen mit klarer Verantwortung und Termin; die Wirksamkeit wird beim Abschluss bewertet."
      onClose={onClose}
      onSubmit={() =>
        submit(
          () =>
            action
              ? requestJson(`/api/quality/actions/${action.id}`, { method: "PATCH", body })
              : requestJson("/api/quality/actions", { method: "POST", body }),
          action ? "Massnahme aktualisiert" : "Massnahme geplant",
        )
      }
      saving={saving}
      error={error}
      submitLabel={action ? "Speichern" : "Massnahme anlegen"}
    >
      <label className="area-editor-wide">
        <span>Massnahme</span>
        <input
          required
          maxLength={180}
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="z. B. Doppelkontrolle bei Hochrisikomedikamenten"
        />
      </label>
      <label>
        <span>Verantwortlich</span>
        <OptionSelect
          label="Verantwortlich"
          options={staff}
          value={form.ownerId}
          empty={NOBODY}
          onChange={(v) => set("ownerId", v)}
        />
      </label>
      <label>
        <span>Termin</span>
        <CareDatePicker label="Termin" value={form.dueOn} onChange={(v) => set("dueOn", v)} />
      </label>
      <label>
        <span>Auslösendes Ereignis</span>
        <OptionSelect
          label="Ereignis"
          options={events.map((event) => ({ id: event.id, name: event.name }))}
          value={form.eventId}
          empty="Kein Ereignis"
          onChange={(v) => set("eventId", v)}
        />
      </label>
      <label>
        <span>Wohnbereich</span>
        <OptionSelect
          label="Wohnbereich"
          options={careUnits}
          value={form.careUnitId}
          empty="Gesamtes Haus"
          onChange={(v) => set("careUnitId", v)}
        />
      </label>
      {!action && (
        <label>
          <span>Status</span>
          <CareSelect
            label="Status"
            value={form.status === "planned" ? "Geplant" : "Offen"}
            options={["Offen", "Geplant"]}
            onChange={(v) => set("status", v === "Geplant" ? "planned" : "open")}
          />
        </label>
      )}
      <label className="area-editor-wide">
        <span>Beschreibung</span>
        <textarea
          rows={4}
          maxLength={4000}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="Ziel, Vorgehen und erwarteter Nachweis"
        />
      </label>
    </EditorDialog>
  );
}

export function CompleteActionDialog({
  action,
  cancel,
  onClose,
  onSaved,
}: DialogProps & { action: QualityAction; cancel?: boolean }) {
  const [effectiveness, setEffectiveness] = useState<Effectiveness>("effective");
  const [note, setNote] = useState("");
  const options = Object.entries(EFFECTIVENESS) as Array<[Effectiveness, string]>;
  const { saving, error, submit } = useSubmit(onSaved);
  return (
    <EditorDialog
      id="quality-action-complete"
      eyebrow={`Qualität · ${action.title}`}
      title={cancel ? "Massnahme verwerfen" : "Massnahme abschliessen"}
      description={
        cancel
          ? "Verworfene Massnahmen bleiben mit Begründung im Verlauf."
          : "Bewerte die Wirkung und halte den Nachweis fest."
      }
      onClose={onClose}
      onSubmit={() =>
        submit(
          () =>
            requestJson(`/api/quality/actions/${action.id}`, {
              method: "PATCH",
              body: cancel ? { status: "cancelled", note } : { status: "done", effectiveness, note },
            }),
          cancel ? "Massnahme verworfen" : "Massnahme abgeschlossen",
        )
      }
      saving={saving}
      error={error}
      danger={cancel}
      submitLabel={cancel ? "Verwerfen" : "Abschliessen"}
    >
      {!cancel && (
        <label className="area-editor-wide">
          <span>Wirksamkeit</span>
          <CareSelect
            label="Wirksamkeit"
            value={EFFECTIVENESS[effectiveness]}
            options={options.map(([, label]) => label)}
            onChange={(v) => setEffectiveness(options.find(([, label]) => label === v)?.[0] ?? "effective")}
          />
        </label>
      )}
      <label className="area-editor-wide">
        <span>{cancel ? "Grund" : "Nachweis / Ergebnis"}</span>
        <textarea
          required
          rows={4}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            cancel ? "z. B. durch andere Massnahme ersetzt" : "z. B. Schulung am 18.09. mit 12 Teilnehmenden"
          }
        />
      </label>
    </EditorDialog>
  );
}
