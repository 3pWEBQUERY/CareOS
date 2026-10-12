"use client";

import { useState } from "react";
import { EditorDialog, requestJson } from "@/app/components/workspace-ui";
import { CHANNEL_COLORS, type ChannelColor, type TeamNewsPayload } from "@/lib/team-news-shared";
import { ScheduleSelect } from "@/app/betrieb/components/operations-ui";

export const COLOR_LABELS: Record<ChannelColor, string> = {
  blue: "Blau",
  green: "Grün",
  orange: "Orange",
  purple: "Violett",
  red: "Rot",
  gray: "Grau",
};

export const NO_UNIT = "Kein Wohnbereich";

export function ChannelEditor({
  data,
  onClose,
  onSaved,
}: {
  data: TeamNewsPayload;
  onClose: () => void;
  onSaved: (message: string, id: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<ChannelColor>("blue");
  const [unitId, setUnitId] = useState("");
  const [managersOnly, setManagersOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <EditorDialog
      id="channel-editor"
      eyebrow="Team · Kanäle"
      title="Kanal anlegen"
      description="Kanäle bündeln Beiträge zu einem Thema oder Wohnbereich. Bei einem Wohnbereich treten dessen Mitarbeitende automatisch bei."
      onClose={onClose}
      onSubmit={async () => {
        setSaving(true);
        setError("");
        try {
          const result = await requestJson<{ id: string }>("/api/team-news/channels", {
            method: "POST",
            body: { name, description, color, careUnitId: unitId || null, managersOnly },
          });
          onSaved(`Kanal „${name}“ angelegt`, result.id);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
          setSaving(false);
        }
      }}
      saving={saving}
      error={error}
      submitLabel="Kanal anlegen"
    >
      <label>
        <span>Name</span>
        <input value={name} maxLength={80} required autoFocus onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        <span>Farbe</span>
        <ScheduleSelect
          label="Farbe"
          value={COLOR_LABELS[color]}
          options={CHANNEL_COLORS.map((c) => COLOR_LABELS[c])}
          onChange={(label) => setColor(CHANNEL_COLORS.find((c) => COLOR_LABELS[c] === label) ?? "blue")}
        />
      </label>
      <label className="area-editor-wide">
        <span>Wohnbereich (optional)</span>
        <ScheduleSelect
          label="Wohnbereich"
          value={data.careUnits.find((unit) => unit.id === unitId)?.name ?? NO_UNIT}
          options={[NO_UNIT, ...data.careUnits.map((unit) => unit.name)]}
          onChange={(value) => setUnitId(data.careUnits.find((unit) => unit.name === value)?.id ?? "")}
        />
      </label>
      <label className="area-editor-wide">
        <span>Beschreibung</span>
        <input value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <fieldset className="area-editor-wide duty-assignment-options">
        <legend>Schreibrechte</legend>
        <div className="area-service-options">
          <label className={managersOnly ? "selected" : ""}>
            <input type="checkbox" checked={managersOnly} onChange={(event) => setManagersOnly(event.target.checked)} />
            <span>Nur die Leitung darf schreiben</span>
          </label>
        </div>
      </fieldset>
    </EditorDialog>
  );
}
