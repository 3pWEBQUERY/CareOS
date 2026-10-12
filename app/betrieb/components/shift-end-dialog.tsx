"use client";

import { useState } from "react";
import Link from "next/link";
import { ModuleIcon } from "@/app/components/module-icon";
import { EditorDialog, requestJson } from "@/app/components/workspace-ui";
import { type ShiftOverview } from "@/lib/shift-shared";
import { notifyOperationsChanged } from "./operations-ui";
import { clock, ALL_UNITS } from "./shift-utils";

export function ShiftEndDialog({
  overview,
  onClose,
  onEnded,
}: {
  overview: ShiftOverview;
  onClose: () => void;
  onEnded: (message: string) => void;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [now] = useState(() => Date.now());
  const current = overview.current;
  const openItems = overview.timeline.filter((item) => !item.done && Date.parse(item.at) < now);
  return (
    <EditorDialog
      id="shift-end"
      eyebrow="Mein Dienst"
      title="Dienst beenden"
      description={
        current
          ? `${current.name} · ${current.careUnit ?? ALL_UNITS} · eingecheckt seit ${current.checkedInAt ? clock(current.checkedInAt) : "–"} Uhr`
          : undefined
      }
      onClose={onClose}
      onSubmit={async () => {
        setSaving(true);
        setError("");
        try {
          await requestJson("/api/shift/check-out", { method: "POST", body: { note } });
          notifyOperationsChanged();
          onEnded("Dienst beendet – gute Erholung!");
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
          setSaving(false);
        }
      }}
      saving={saving}
      error={error}
      submitLabel="Dienst beenden"
    >
      <div className="area-editor-wide operations-note-list shift-end-checks">
        <p className={openItems.length ? "attention" : ""}>
          <ModuleIcon name={openItems.length ? "alert" : "check"} />
          <span>
            <strong>
              {overview.stats.done}/{overview.stats.total} Punkte im Tagesablauf erledigt
            </strong>
            <small>
              {openItems.length
                ? `${openItems.length} fällige Punkte sind noch offen – erledigen oder in der Übergabe erwähnen.`
                : "Alle fälligen Punkte sind erledigt."}
            </small>
          </span>
        </p>
        <p className="info">
          <ModuleIcon name="handover" />
          <span>
            <strong>Übergabe an den nächsten Dienst</strong>
            <small>
              Wichtige Hinweise gehören in die <Link href="/betrieb/uebergabe">Übergabe</Link>, damit sie der nächste
              Dienst bestätigen kann.
            </small>
          </span>
        </p>
      </div>
      <label className="area-editor-wide">
        <span>Notiz zum Dienstende (optional)</span>
        <textarea
          rows={4}
          maxLength={2000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="z. B. Ablauf, Besonderheiten, Überzeit"
        />
      </label>
    </EditorDialog>
  );
}
