"use client";

import { useState } from "react";
import { DownloadSimple } from "@phosphor-icons/react";
import { useTerms } from "@/app/components/care-context";
import { EditorDialog, requestJson, todayInZurich } from "@/app/components/workspace-ui";
import { EXPORT_LEGAL_NOTE, type ResidentExport } from "@/lib/data-export-shared";

type Format = "print" | "json";

// Auskunft und Datenexport: alle gespeicherten Daten der Akte für die Person bzw. ihre Vertretung, lesbar zum Drucken
// oder als Datei (JSON). Nur Administration; jede Auskunft steht im Änderungsprotokoll.
export function RecordExportCard({ residentId, residentName }: { residentId: string; residentName: string }) {
  const t = useTerms();
  const [open, setOpen] = useState(false);
  const [requestedBy, setRequestedBy] = useState("");
  const [format, setFormat] = useState<Format>("print");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!requestedBy.trim()) return setError("Bitte angeben, wer die Auskunft verlangt.");
    setError("");
    if (format === "print") {
      // Neues Fenster sofort öffnen (sonst blockiert der Browser es); die Seite erstellt die Auskunft selbst.
      window.open(
        `/c/bewohner/auskunft?resident=${residentId}&verlangt=${encodeURIComponent(requestedBy.trim())}`,
        "_blank",
        "noopener",
      );
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      const data = await requestJson<ResidentExport>(`/api/residents/${residentId}/export`, {
        method: "POST",
        body: { requestedBy, format: "json" },
      });
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `auskunft-${residentName.toLowerCase().replace(/[^a-z0-9äöüé]+/gi, "-")}-${todayInZurich()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die Auskunft konnte nicht erstellt werden.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="record-card record-export-card" aria-labelledby="record-export-card-title">
      <div className="record-card-heading">
        <div>
          <span className="record-section-label">Datenschutz</span>
          <h3 id="record-export-card-title">Auskunft &amp; Datenexport</h3>
        </div>
        <button
          type="button"
          onClick={() => {
            // Jede Auskunft beginnt neu: wer sie verlangt, wird jedes Mal angegeben.
            setRequestedBy("");
            setFormat("print");
            setError("");
            setOpen(true);
          }}
        >
          <DownloadSimple aria-hidden="true" /> Auskunft erstellen
        </button>
      </div>
      <p className="record-export-note">
        Alle gespeicherten Daten der {t.prefix}akte für die Person bzw. ihre Vertretung – lesbar zum Drucken oder als
        Datei. Jede Auskunft wird protokolliert.
      </p>
      {open && (
        <EditorDialog
          id="record-export"
          eyebrow={`${residentName} · Datenschutz`}
          title="Auskunft erstellen"
          description={EXPORT_LEGAL_NOTE}
          onClose={() => setOpen(false)}
          onSubmit={submit}
          saving={saving}
          error={error}
          submitLabel={format === "print" ? "Lesbare Fassung öffnen" : "Datei herunterladen"}
        >
          <label className="area-editor-wide">
            <span>Verlangt von</span>
            <input
              required
              maxLength={200}
              placeholder="z. B. die Person selbst oder Name der Vertretung"
              value={requestedBy}
              onChange={(event) => setRequestedBy(event.target.value)}
            />
          </label>
          <fieldset className="area-editor-wide">
            <legend>Form</legend>
            <div className="repositioning-choices" role="group" aria-label="Form der Auskunft">
              {(
                [
                  ["print", "Lesbare Fassung (Drucken / PDF)"],
                  ["json", "Datei, maschinenlesbar (JSON)"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`day-toggle ${format === value ? "active" : ""}`}
                  aria-pressed={format === value}
                  onClick={() => setFormat(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
        </EditorDialog>
      )}
    </section>
  );
}
