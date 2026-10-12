"use client";

import { useState } from "react";
import { CareDatePicker, CareSelect } from "@/app/components/care-form-controls";
import { EditorDialog, requestJson, timeInZurich, todayInZurich, useApiData } from "@/app/components/workspace-ui";
import { zurichTimeToIso } from "@/lib/resident-appointments";
import {
  ENTRY_TYPES,
  ORIGIN_LABELS,
  PRESSURE_CATEGORIES,
  STATUS_LABELS,
  WOUND_TYPES,
  type Wound,
  type WoundOrigin,
} from "@/lib/wounds-shared";
import EntryFields, { emptyEntry, entryPayload, type EntryDraft } from "./entry-fields";
import { useCareResident, useTerms } from "@/app/components/care-context";
import { sendOrQueue } from "@/app/components/offline-queue";

export type WoundsPayload = {
  wounds: Wound[];
  residents: Array<{ id: string; name: string; room: string }>;
  staff: Array<{ id: string; name: string }>;
  canWrite: boolean;
};

const INTERVALS = ["Kein festes Intervall", "täglich", ...Array.from({ length: 13 }, (_, i) => `alle ${i + 2} Tage`)];
const intervalLabel = (days: number | null) => (!days ? INTERVALS[0] : days === 1 ? "täglich" : `alle ${days} Tage`);
const intervalValue = (label: string) => (label === "täglich" ? 1 : Number(/\d+/.exec(label)?.[0]) || null);

export function WoundDialog({
  wound,
  data,
  initialResidentId,
  initialObservationId,
  onClose,
  onSaved,
}: {
  wound: Wound | null;
  data: WoundsPayload;
  initialResidentId?: string;
  initialObservationId?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const t = useTerms();
  const [contextId] = useCareResident();
  const [residentId, setResidentId] = useState(
    wound?.residentId ??
      initialResidentId ??
      data.residents.find((r) => r.id === contextId)?.id ??
      data.residents[0]?.id ??
      "",
  );
  const [form, setForm] = useState({
    woundType: wound?.woundType ?? "Dekubitus",
    category: wound?.category ?? "Kategorie 1",
    bodyLocation: wound?.bodyLocation ?? "",
    title: wound?.title ?? "",
    diagnosis: wound?.diagnosis ?? "",
    origin: (wound?.origin ?? "unknown") as WoundOrigin,
    discoveredOn: wound?.discoveredAt?.slice(0, 10) ?? todayInZurich(),
    careIntervalDays: (wound ? wound.careIntervalDays : 2) as number | null,
    treatmentPlan: wound?.treatmentPlan ?? "",
    responsibleId: wound?.responsibleId ?? "",
    bodyObservationId: wound?.bodyObservation?.id ?? initialObservationId ?? "",
  });
  const [entry, setEntry] = useState<EntryDraft>(emptyEntry);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Body map markers of the resident that are free or already linked to this wound.
  const markers = useApiData<{
    observations: Array<{ id: string; kind: string; label: string; location: string; wound_id: string | null }>;
  }>(residentId ? `/api/residents/${residentId}/body-observations` : null);
  const markerOptions = (markers.data?.observations ?? []).filter(
    (o) => (o.kind === "wound" || o.kind === "redness") && (!o.wound_id || o.wound_id === wound?.id),
  );
  const markerLabel = (o: { label: string; location: string }) => `${o.label} · ${o.location}`;
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const residentLabel = (r: { name: string; room: string }) => `${r.name}${r.room ? ` · ${r.room}` : ""}`;
  const resident = data.residents.find((r) => r.id === residentId);
  const responsible = data.staff.find((u) => u.id === form.responsibleId);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const body = {
        ...form,
        residentId,
        category: form.woundType === "Dekubitus" ? form.category : null,
        responsibleId: form.responsibleId || null,
        bodyObservationId: form.bodyObservationId || null,
        ...(wound ? {} : { initialEntry: entryPayload(entry) }),
      };
      if (wound) await requestJson(`/api/wounds/${wound.id}`, { method: "PATCH", body });
      else await requestJson("/api/wounds", { method: "POST", body });
      onSaved(wound ? "Wunddaten aktualisiert" : `Wunde für ${resident?.name ?? t.oneOblique} erfasst`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wunde konnte nicht gespeichert werden.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="wound-editor"
      eyebrow="Wunden"
      title={wound ? "Wunde bearbeiten" : "Neue Wunde erfassen"}
      description={
        wound
          ? "Änderungen werden protokolliert. Befunde bitte als neuen Verlaufseintrag dokumentieren."
          : "Stammdaten der Wunde und die Erstbeurteilung. Weitere Befunde folgen als Verlaufseinträge."
      }
      onClose={onClose}
      onSubmit={save}
      saving={saving}
      error={error}
      submitLabel={wound ? "Änderungen speichern" : "Wunde erfassen"}
    >
      <label className="area-editor-wide">
        <span>{t.one}</span>
        {wound || initialResidentId ? (
          <input value={resident ? residentLabel(resident) : (wound?.residentName ?? "")} readOnly />
        ) : (
          <CareSelect
            label={t.one}
            value={resident ? residentLabel(resident) : `${t.oneOblique} wählen`}
            options={data.residents.map(residentLabel)}
            onChange={(value) =>
              setResidentId(data.residents.find((r) => residentLabel(r) === value)?.id ?? residentId)
            }
          />
        )}
      </label>
      <label>
        <span>Wundart</span>
        <CareSelect
          label="Wundart"
          value={form.woundType}
          options={[...WOUND_TYPES]}
          onChange={(v) => set("woundType", v)}
        />
      </label>
      {form.woundType === "Dekubitus" ? (
        <label>
          <span>Kategorie (EPUAP/NPIAP)</span>
          <CareSelect
            label="Kategorie"
            value={form.category}
            options={[...PRESSURE_CATEGORIES]}
            onChange={(v) => set("category", v)}
          />
        </label>
      ) : (
        <label>
          <span>Diagnose / Beschreibung</span>
          <input
            maxLength={180}
            value={form.diagnosis}
            onChange={(e) => set("diagnosis", e.target.value)}
            placeholder="optional"
          />
        </label>
      )}
      <label>
        <span>Lokalisation</span>
        <input
          required
          maxLength={160}
          value={form.bodyLocation}
          onChange={(e) => set("bodyLocation", e.target.value)}
          placeholder="z. B. Sakralbereich, linke Ferse"
        />
      </label>
      <label>
        <span>Entstehung</span>
        <CareSelect
          label="Entstehung"
          value={ORIGIN_LABELS[form.origin]}
          options={Object.values(ORIGIN_LABELS)}
          onChange={(v) =>
            set(
              "origin",
              (Object.keys(ORIGIN_LABELS) as WoundOrigin[]).find((k) => ORIGIN_LABELS[k] === v) ?? "unknown",
            )
          }
        />
      </label>
      <label>
        <span>Festgestellt am</span>
        <CareDatePicker label="Festgestellt am" value={form.discoveredOn} onChange={(v) => set("discoveredOn", v)} />
      </label>
      <label>
        <span>Verbandwechsel</span>
        <CareSelect
          label="Verbandwechsel-Intervall"
          value={intervalLabel(form.careIntervalDays)}
          options={INTERVALS}
          onChange={(v) => set("careIntervalDays", intervalValue(v))}
        />
      </label>
      <label>
        <span>Verantwortlich</span>
        <CareSelect
          label="Verantwortlich"
          value={responsible?.name ?? "Nicht festgelegt"}
          options={["Nicht festgelegt", ...data.staff.map((u) => u.name)]}
          onChange={(v) => set("responsibleId", data.staff.find((u) => u.name === v)?.id ?? "")}
        />
      </label>
      <label className="area-editor-wide">
        <span>Markierung auf der Körperkarte</span>
        <CareSelect
          label="Markierung auf der Körperkarte"
          value={(() => {
            const marker = markerOptions.find((o) => o.id === form.bodyObservationId);
            return marker
              ? markerLabel(marker)
              : markerOptions.length
                ? "Keine Verknüpfung"
                : "Keine freie Markierung vorhanden";
          })()}
          options={["Keine Verknüpfung", ...markerOptions.map(markerLabel)]}
          onChange={(value) => set("bodyObservationId", markerOptions.find((o) => markerLabel(o) === value)?.id ?? "")}
        />
      </label>
      <label className="area-editor-wide">
        <span>Behandlungsplan</span>
        <textarea
          rows={2}
          maxLength={4000}
          value={form.treatmentPlan}
          onChange={(e) => set("treatmentPlan", e.target.value)}
          placeholder="z. B. Reinigung NaCl 0,9 %, Hydrokolloidverband, Lagerung alle 2 h (ärztlich verordnet am …)"
        />
      </label>
      {!wound && (
        <>
          <p className="wound-dialog-section area-editor-wide">Erstbeurteilung</p>
          <EntryFields draft={entry} onChange={setEntry} />
        </>
      )}
    </EditorDialog>
  );
}

export function EntryDialog({
  wound,
  onClose,
  onSaved,
}: {
  wound: Wound;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [entryType, setEntryType] = useState<string>(wound.careIntervalDays ? "Verbandwechsel" : "Verlaufskontrolle");
  const [date, setDate] = useState(todayInZurich);
  const [time, setTime] = useState(() => timeInZurich());
  const [status, setStatus] = useState<"active" | "healing">(wound.status === "healing" ? "healing" : "active");
  const [entry, setEntry] = useState<EntryDraft>(emptyEntry);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      const result = await sendOrQueue(
        `/api/wounds/${wound.id}/entries`,
        { ...entryPayload(entry), entryType, observedAt: zurichTimeToIso(date, time), woundStatus: status },
        `${entryType} · ${wound.residentName}`,
        { field: "note", label: "Bemerkung" },
      );
      onSaved(
        `${wound.residentName}: ${entryType} ${result.queued ? "offline gespeichert – wird gesendet, sobald die Verbindung zurück ist" : "dokumentiert"}`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Eintrag konnte nicht gespeichert werden.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="wound-entry"
      eyebrow={`Wunden · ${wound.residentName}`}
      title="Verlauf dokumentieren"
      description={`${wound.title}${wound.treatmentPlan ? ` · Plan: ${wound.treatmentPlan}` : ""}`}
      onClose={onClose}
      onSubmit={save}
      saving={saving}
      error={error}
      submitLabel="Eintrag speichern"
    >
      <label>
        <span>Art des Eintrags</span>
        <CareSelect
          label="Art des Eintrags"
          value={entryType}
          options={ENTRY_TYPES.filter((t) => t !== "Erstbeurteilung")}
          onChange={setEntryType}
        />
      </label>
      <label>
        <span>Wundstatus</span>
        <CareSelect
          label="Wundstatus"
          value={STATUS_LABELS[status]}
          options={[STATUS_LABELS.active, STATUS_LABELS.healing]}
          onChange={(v) => setStatus(v === STATUS_LABELS.healing ? "healing" : "active")}
        />
      </label>
      <label>
        <span>Datum</span>
        <CareDatePicker label="Datum" value={date} onChange={setDate} />
      </label>
      <label>
        <span>Uhrzeit</span>
        <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
      </label>
      <EntryFields draft={entry} onChange={setEntry} />
    </EditorDialog>
  );
}
