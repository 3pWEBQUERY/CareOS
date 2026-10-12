"use client";

import { useEffect, useState } from "react";
import { EditorDialog } from "@/app/components/workspace-ui";
import { rosterRequest } from "@/app/dienstplan/components/roster-api";
import { ViolationList } from "@/app/dienstplan/components/violation-dialog";
import type { SwapCandidate } from "@/lib/roster/swap-service";
import { localTime, zonedToUtc } from "@/lib/roster/time";
import {
  EXCLUSION_LABELS,
  PREFERENCE_LABELS,
  PRIORITY_LABELS,
  WEEKDAY_LABELS,
  type ExclusionCategory,
  type PreferenceKind,
  type Priority,
  type Violation,
} from "@/lib/roster/types";
import { CareDatePicker, CareOptionSelect } from "@/app/components/care-form-controls";

// Formulare für Mitarbeitende: Wunschfrei, Abwesenheit, Dienstwunsch, Zeitkorrektur, Tausch.

type Done = (message: string) => void;
const failure = (cause: unknown) => (cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");

function useSubmit(action: () => Promise<string>, onDone: Done) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      onDone(await action());
    } catch (cause) {
      setError(failure(cause));
      setSaving(false);
    }
  };
  return { saving, error, submit, setError };
}

export function TimeOffDialog({ today, onClose, onDone }: { today: string; onClose: () => void; onDone: Done }) {
  const [form, setForm] = useState({
    startDate: "",
    endDate: "",
    priority: "MEDIUM" as Priority,
    reason: "",
    comment: "",
  });
  const { saving, error, submit } = useSubmit(async () => {
    if (!form.startDate) throw new Error("Bitte ein Datum wählen.");
    await rosterRequest("/api/dienstplan/time-off", {
      method: "POST",
      body: { ...form, endDate: form.endDate || form.startDate },
    });
    return "Wunschfrei beantragt";
  }, onDone);
  return (
    <EditorDialog
      id="roster-time-off"
      eyebrow="Mein Dienstplan · Anträge"
      title="Wunschfrei beantragen"
      description="Die Leitung wird benachrichtigt. Genehmigtes Wunschfrei wird bei der Planung wie eine Abwesenheit behandelt."
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Antrag senden"
    >
      <label>
        <span>Von</span>
        <CareDatePicker
          label="Von"
          value={form.startDate}
          min={today}
          onChange={(value) => setForm({ ...form, startDate: value })}
        />
      </label>
      <label>
        <span>Bis (optional)</span>
        <CareDatePicker
          clearable
          label="Bis"
          value={form.endDate}
          min={form.startDate || today}
          onChange={(value) => setForm({ ...form, endDate: value })}
        />
      </label>
      <label>
        <span>Priorität</span>
        <CareOptionSelect
          label="Priorität"
          value={form.priority}
          onChange={(value) => setForm({ ...form, priority: value as Priority })}
          options={[
            ...(Object.keys(PRIORITY_LABELS) as Priority[]).map((key) => ({
              value: String(key),
              label: String(PRIORITY_LABELS[key]),
            })),
          ]}
        />
      </label>
      <label>
        <span>Grund (optional)</span>
        <input maxLength={200} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
      </label>
      <label className="area-editor-wide">
        <span>Kommentar (optional)</span>
        <textarea
          rows={3}
          maxLength={1000}
          value={form.comment}
          onChange={(e) => setForm({ ...form, comment: e.target.value })}
        />
      </label>
    </EditorDialog>
  );
}

const ABSENCE_KINDS = [
  ["vacation", "Ferien"],
  ["sick", "Krankheit"],
  ["training", "Weiterbildung"],
  ["personal", "Persönlicher Termin"],
] as const;

export function AbsenceDialog({ today, onClose, onDone }: { today: string; onClose: () => void; onDone: Done }) {
  const [form, setForm] = useState({ kind: "vacation", startsOn: today, endsOn: "", note: "" });
  const sick = form.kind === "sick";
  const { saving, error, submit } = useSubmit(async () => {
    const result = await rosterRequest<{ created: number }>("/api/dienstplan/absences", {
      method: "POST",
      body: { ...form, endsOn: form.endsOn || form.startsOn },
    });
    return sick
      ? `Krankmeldung erfasst${result.created ? ` · ${result.created} Dienst(e) angepasst` : ""}`
      : "Abwesenheit beantragt";
  }, onDone);
  return (
    <EditorDialog
      id="roster-absence"
      eyebrow="Mein Dienstplan · Anträge"
      title="Abwesenheit melden"
      description={
        sick
          ? "Eine Krankmeldung gilt sofort: geplante Dienste werden als „Krank“ eingetragen und die Leitung informiert."
          : "Ferien, Weiterbildung und persönliche Termine gehen zur Bewilligung an die Leitung."
      }
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel={sick ? "Krankmeldung senden" : "Antrag senden"}
    >
      <label className="area-editor-wide">
        <span>Art</span>
        <CareOptionSelect
          label="Art"
          value={form.kind}
          onChange={(value) => setForm({ ...form, kind: value })}
          options={[...ABSENCE_KINDS.map(([key, label]) => ({ value: String(key), label: String(label) }))]}
        />
      </label>
      <label>
        <span>Von</span>
        <CareDatePicker label="Von" value={form.startsOn} onChange={(value) => setForm({ ...form, startsOn: value })} />
      </label>
      <label>
        <span>Bis (optional)</span>
        <CareDatePicker
          clearable
          label="Bis"
          value={form.endsOn}
          min={form.startsOn}
          onChange={(value) => setForm({ ...form, endsOn: value })}
        />
      </label>
      <label className="area-editor-wide">
        <span>Notiz (optional, nur für die Leitung)</span>
        <textarea
          rows={3}
          maxLength={1000}
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
        />
      </label>
    </EditorDialog>
  );
}

export type PreferenceValue = {
  id?: string;
  kind: PreferenceKind;
  shiftTypeId: string | null;
  weekday: number | null;
  category: string | null;
  validFrom: string | null;
  validUntil: string | null;
  comment: string | null;
};

export function PreferenceDialog({
  shiftTypes,
  initial,
  onClose,
  onDone,
}: {
  shiftTypes: Array<{ id: string; code: string; name: string }>;
  initial: PreferenceValue | null;
  onClose: () => void;
  onDone: Done;
}) {
  const [form, setForm] = useState({
    kind: initial?.kind ?? ("PREFER_SHIFT_TYPE" as PreferenceKind),
    shiftTypeId: initial?.shiftTypeId ?? shiftTypes[0]?.id ?? "",
    weekday: String(initial?.weekday ?? 1),
    category: initial?.category ?? "NIGHT",
    validFrom: initial?.validFrom ?? "",
    validUntil: initial?.validUntil ?? "",
    comment: initial?.comment ?? "",
  });
  const byType = form.kind === "PREFER_SHIFT_TYPE" || form.kind === "AVOID_SHIFT_TYPE";
  const byWeekday = form.kind === "PREFER_WEEKDAY" || form.kind === "AVOID_WEEKDAY";
  const { saving, error, submit } = useSubmit(async () => {
    const body = {
      kind: form.kind,
      shiftTypeId: byType ? form.shiftTypeId : null,
      weekday: byWeekday ? Number(form.weekday) : null,
      category: form.kind === "AVOID_CATEGORY" ? form.category : null,
      validFrom: form.validFrom || null,
      validUntil: form.validUntil || null,
      comment: form.comment,
    };
    await rosterRequest(initial?.id ? `/api/dienstplan/preferences/${initial.id}` : "/api/dienstplan/preferences", {
      method: initial?.id ? "PATCH" : "POST",
      body,
    });
    return "Dienstwunsch gespeichert";
  }, onDone);
  return (
    <EditorDialog
      id="roster-preference"
      eyebrow="Mein Dienstplan · Dienstwünsche"
      title={initial?.id ? "Dienstwunsch bearbeiten" : "Dienstwunsch erfassen"}
      description="Wünsche sind weich: Die Planung berücksichtigt sie, wo es geht, garantiert sie aber nicht."
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Wunsch speichern"
    >
      <label className="area-editor-wide">
        <span>Art des Wunsches</span>
        <CareOptionSelect
          label="Art des Wunsches"
          value={form.kind}
          onChange={(value) => setForm({ ...form, kind: value as PreferenceKind })}
          options={[
            ...(Object.keys(PREFERENCE_LABELS) as PreferenceKind[]).map((key) => ({
              value: String(key),
              label: String(PREFERENCE_LABELS[key]),
            })),
          ]}
        />
      </label>
      {byType && (
        <label className="area-editor-wide">
          <span>Diensttyp</span>
          <CareOptionSelect
            label="Diensttyp"
            value={form.shiftTypeId}
            onChange={(value) => setForm({ ...form, shiftTypeId: value })}
            options={[...shiftTypes.map((type) => ({ value: String(type.id), label: `${type.code} · ${type.name}` }))]}
          />
        </label>
      )}
      {byWeekday && (
        <label className="area-editor-wide">
          <span>Wochentag</span>
          <CareOptionSelect
            label="Wochentag"
            value={form.weekday}
            onChange={(value) => setForm({ ...form, weekday: value })}
            options={[...WEEKDAY_LABELS.map((label, index) => ({ value: String(index + 1), label: String(label) }))]}
          />
        </label>
      )}
      {form.kind === "AVOID_CATEGORY" && (
        <label className="area-editor-wide">
          <span>Dienstart</span>
          <CareOptionSelect
            label="Dienstart"
            value={form.category}
            onChange={(value) => setForm({ ...form, category: value })}
            options={[
              ...(Object.keys(EXCLUSION_LABELS) as ExclusionCategory[]).map((key) => ({
                value: String(key),
                label: String(EXCLUSION_LABELS[key]),
              })),
            ]}
          />
        </label>
      )}
      <label>
        <span>Gültig ab (optional)</span>
        <CareDatePicker
          clearable
          label="Gültig ab"
          value={form.validFrom}
          onChange={(value) => setForm({ ...form, validFrom: value })}
        />
      </label>
      <label>
        <span>Gültig bis (optional)</span>
        <CareDatePicker
          clearable
          label="Gültig bis"
          value={form.validUntil}
          min={form.validFrom}
          onChange={(value) => setForm({ ...form, validUntil: value })}
        />
      </label>
      <label className="area-editor-wide">
        <span>Kommentar (optional)</span>
        <textarea
          rows={2}
          maxLength={300}
          value={form.comment}
          onChange={(e) => setForm({ ...form, comment: e.target.value })}
        />
      </label>
    </EditorDialog>
  );
}

const toLocalInput = (value: string | null, timeZone: string) => {
  if (!value) return "";
  const date = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(value));
  return `${date}T${localTime(value, timeZone)}`;
};
const fromLocalInput = (value: string, timeZone: string) =>
  value ? zonedToUtc(value.slice(0, 10), value.slice(11, 16), timeZone).toISOString() : null;

export type CorrectableEntry = {
  id: string;
  clockIn: string;
  clockOut: string | null;
  breakMinutes: number;
  version?: number;
};

// Korrektur beantragen (Mitarbeitende) oder direkt korrigieren (Leitung, mit Begründung).
export function CorrectionDialog({
  entry,
  timezone,
  direct,
  title,
  onClose,
  onDone,
}: {
  entry: CorrectableEntry;
  timezone: string;
  direct?: boolean;
  title: string;
  onClose: () => void;
  onDone: Done;
}) {
  const [form, setForm] = useState({
    clockIn: toLocalInput(entry.clockIn, timezone),
    clockOut: toLocalInput(entry.clockOut, timezone),
    breakMinutes: String(entry.breakMinutes),
    reason: "",
  });
  const { saving, error, submit } = useSubmit(async () => {
    if (!form.reason.trim()) throw new Error("Bitte eine Begründung angeben.");
    const clockIn = fromLocalInput(form.clockIn, timezone);
    const clockOut = fromLocalInput(form.clockOut, timezone);
    const body = {
      clockIn: clockIn !== entry.clockIn || direct ? clockIn : null,
      clockOut: clockOut !== entry.clockOut || direct ? clockOut : null,
      breakMinutes: Number(form.breakMinutes) !== entry.breakMinutes || direct ? Number(form.breakMinutes) : null,
      reason: form.reason,
    };
    if (direct) {
      await rosterRequest(`/api/dienstplan/time/${entry.id}`, {
        method: "PATCH",
        body: { ...body, expectedVersion: entry.version ?? 1 },
      });
      return "Zeiteintrag korrigiert";
    }
    await rosterRequest(`/api/dienstplan/time/${entry.id}/correction`, { method: "POST", body });
    return "Korrektur beantragt";
  }, onDone);
  return (
    <EditorDialog
      id="roster-correction"
      eyebrow={direct ? "Leitung · Arbeitszeit" : "Mein Dienstplan · Zeiten"}
      title={title}
      description={
        direct
          ? "Die Korrektur wird mit Begründung im Protokoll festgehalten und der Person mitgeteilt."
          : "Die Leitung prüft die Korrektur. Bis zur Entscheidung gilt die erfasste Zeit."
      }
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel={direct ? "Korrektur speichern" : "Korrektur beantragen"}
    >
      <label>
        <span>Beginn</span>
        <input
          type="datetime-local"
          value={form.clockIn}
          onChange={(e) => setForm({ ...form, clockIn: e.target.value })}
          required
        />
      </label>
      <label>
        <span>Ende</span>
        <input
          type="datetime-local"
          value={form.clockOut}
          onChange={(e) => setForm({ ...form, clockOut: e.target.value })}
        />
      </label>
      <label>
        <span>Pause (Minuten)</span>
        <input
          type="number"
          min={0}
          max={600}
          value={form.breakMinutes}
          onChange={(e) => setForm({ ...form, breakMinutes: e.target.value })}
        />
      </label>
      <label className="area-editor-wide">
        <span>Begründung</span>
        <textarea
          rows={3}
          maxLength={500}
          value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
          placeholder="z. B. Ausstempeln vergessen, Einsatz bei Notfall verlängert"
          required
        />
      </label>
    </EditorDialog>
  );
}

// Tauschpartner wählen: die Liste ist bereits gegen Ruhezeit, Qualifikation und Abwesenheiten geprüft.
export function SwapDialog({ shiftId, onClose, onDone }: { shiftId: string; onClose: () => void; onDone: Done }) {
  const [options, setOptions] = useState<{
    shift: { label: string };
    candidates: SwapCandidate[];
    takeoverAllowed: boolean;
  } | null>(null);
  const [choice, setChoice] = useState("");
  const [message, setMessage] = useState("");
  const { saving, error, submit, setError } = useSubmit(async () => {
    const candidate = options?.candidates.find((c) => `${c.employeeId}|${c.targetShiftId ?? ""}` === choice);
    if (!candidate) throw new Error("Bitte eine Person wählen.");
    await rosterRequest("/api/dienstplan/swaps", {
      method: "POST",
      body: {
        sourceShiftId: shiftId,
        targetEmployeeId: candidate.employeeId,
        targetShiftId: candidate.targetShiftId,
        message,
      },
    });
    return `Tauschanfrage an ${candidate.name} gesendet`;
  }, onDone);
  useEffect(() => {
    let live = true;
    rosterRequest<{ shift: { label: string }; candidates: SwapCandidate[]; takeoverAllowed: boolean }>(
      `/api/dienstplan/shifts/${shiftId}/swap-candidates`,
    ).then(
      (result) => live && setOptions(result),
      (cause: unknown) => live && setError(failure(cause)),
    );
    return () => {
      live = false;
    };
  }, [shiftId, setError]);
  return (
    <EditorDialog
      id="roster-swap"
      eyebrow="Mein Dienstplan · Tausch"
      title="Tausch anfragen"
      description={
        options
          ? `${options.shift.label}. Angezeigt werden nur Kolleg:innen, bei denen der Tausch alle Regeln einhält.`
          : "Mögliche Tauschpartner werden gesucht …"
      }
      onClose={onClose}
      onSubmit={submit}
      saving={saving || !options}
      error={error}
      submitLabel="Anfrage senden"
    >
      <fieldset className="area-editor-wide roster-swap-options">
        <legend>Tauschen mit</legend>
        {options && !options.candidates.length && (
          <p className="roster-muted">
            Für diesen Dienst gibt es keine passende Tauschmöglichkeit innerhalb von 14 Tagen.
          </p>
        )}
        {options?.candidates.map((candidate) => {
          const key = `${candidate.employeeId}|${candidate.targetShiftId ?? ""}`;
          return (
            <label key={key} className="roster-checkbox">
              <input type="radio" name="swap-target" checked={choice === key} onChange={() => setChoice(key)} />
              <span>
                <strong>{candidate.name}</strong> ·{" "}
                {candidate.targetShift
                  ? `Gegendienst ${candidate.targetShift}`
                  : "übernimmt den Dienst (ohne Gegendienst)"}
                {candidate.warnings.length > 0 && <em> · Hinweis: {candidate.warnings.join(", ")}</em>}
              </span>
            </label>
          );
        })}
      </fieldset>
      <label className="area-editor-wide">
        <span>Nachricht (optional)</span>
        <textarea rows={2} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
    </EditorDialog>
  );
}

// Entscheidung mit optionalem oder verpflichtendem Kommentar.
export function DecisionDialog({
  title,
  description,
  submitLabel,
  danger,
  requireComment,
  violations,
  onClose,
  onSubmit,
}: {
  title: string;
  description: string;
  submitLabel: string;
  danger?: boolean;
  requireComment?: boolean;
  violations?: Violation[];
  onClose: () => void;
  onSubmit: (comment: string) => Promise<string>;
}) {
  const [comment, setComment] = useState("");
  const { saving, error, submit } = useSubmit(
    async () => {
      if (requireComment && !comment.trim()) throw new Error("Bitte eine Begründung angeben.");
      return onSubmit(comment);
    },
    () => undefined,
  );
  return (
    <EditorDialog
      id="roster-decision"
      eyebrow="Dienstplan · Entscheidung"
      title={title}
      description={description}
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel={submitLabel}
      danger={danger}
    >
      {violations && violations.length > 0 && (
        <div className="area-editor-wide">
          <ViolationList violations={violations} />
        </div>
      )}
      <label className="area-editor-wide">
        <span>{requireComment ? "Begründung" : "Kommentar (optional)"}</span>
        <textarea rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
      </label>
    </EditorDialog>
  );
}
