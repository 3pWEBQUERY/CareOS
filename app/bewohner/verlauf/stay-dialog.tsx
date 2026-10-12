"use client";

import { useTerms } from "@/app/components/care-context";
import { useState } from "react";
import { CareDatePicker, CareSelect } from "@/app/components/care-form-controls";
import { EditorDialog, requestJson, todayInZurich } from "@/app/components/workspace-ui";
import { EXIT_KINDS, type ExitKind, type HistoryResident } from "@/lib/resident-history-shared";

export type StayDialogMode = { kind: "exit" | "return"; resident: HistoryResident };

const kinds = Object.entries(EXIT_KINDS) as Array<[ExitKind, (typeof EXIT_KINDS)[ExitKind]]>;

// Records the end of a stay (discharge, external transfer, death) or the return after a transfer.
export function StayDialog({
  mode,
  onClose,
  onSaved,
}: {
  mode: StayDialogMode;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const t = useTerms();
  const [kind, setKind] = useState<ExitKind>("discharged");
  const [date, setDate] = useState(todayInZurich);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const exit = mode.kind === "exit";

  async function submit() {
    setSaving(true);
    setError("");
    try {
      const result = await requestJson<{ message: string }>(`/api/resident-history/${mode.resident.id}/${mode.kind}`, {
        method: "POST",
        body: exit ? { kind, date, note } : { date, note },
      });
      onSaved(result.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="stay-dialog"
      eyebrow={`CareOS ${t.many} · ${mode.resident.name}`}
      title={exit ? "Austritt erfassen" : "Rückkehr erfassen"}
      description={
        exit
          ? "Beim Austritt und Todesfall werden Aufenthalt und offener Pflegeplan abgeschlossen; die Akte wandert ins Archiv. Bei einer externen Verlegung bleibt das Zimmer reserviert."
          : `Der ${t.one} ist wieder im Haus und erscheint erneut in allen Pflegemodulen.`
      }
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel={exit ? `${EXIT_KINDS[kind].label} speichern` : "Rückkehr speichern"}
      danger={exit && kind !== "transferred"}
    >
      {exit && (
        <label>
          <span>Art</span>
          <CareSelect
            label="Art des Austritts"
            value={EXIT_KINDS[kind].label}
            options={kinds.map(([, item]) => item.label)}
            onChange={(value) => setKind(kinds.find(([, item]) => item.label === value)?.[0] ?? "discharged")}
          />
        </label>
      )}
      <label>
        <span>{exit ? EXIT_KINDS[kind].dateLabel : "Rückkehrdatum"}</span>
        <CareDatePicker label="Datum" value={date} onChange={setDate} />
      </label>
      <label className="area-editor-wide">
        <span>{exit ? "Notiz zum Verlauf" : "Notiz (optional)"}</span>
        <textarea
          required={exit}
          rows={4}
          maxLength={2000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={
            exit
              ? "z. B. Rückkehr nach Hause mit Spitex-Anschluss; Unterlagen übergeben"
              : "z. B. Rückkehr aus dem Spital, Austrittsbericht liegt vor"
          }
        />
      </label>
    </EditorDialog>
  );
}
