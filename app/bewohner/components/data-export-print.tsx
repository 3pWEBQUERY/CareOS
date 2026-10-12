"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Printer, X } from "@phosphor-icons/react";
import { formatDateTime, requestJson } from "@/app/components/workspace-ui";
import { fieldLabel, fieldValue, UUID } from "@/lib/audit-labels";
import {
  EXPORT_COLUMN_LABELS,
  EXPORT_HIDDEN_COLUMNS,
  EXPORT_LEGAL_NOTE,
  EXPORT_SECTION_VALUE_LABELS,
  EXPORT_VALUE_LABELS,
  type ResidentExport,
} from "@/lib/data-export-shared";

const label = (key: string) => EXPORT_COLUMN_LABELS[key] ?? fieldLabel(key);

// Ein Wert in lesbarer Form; Kennungen der Mitarbeitenden als Name, Zusatzangaben als „Bezeichnung: Wert“.
function display(key: string, value: unknown, staff: Record<string, string>): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && UUID.test(value)) return staff[value] ?? null;
  if (Array.isArray(value)) {
    const items = value.map((item) => display(key, item, staff)).filter((item): item is string => item !== null);
    return items.length ? items.join(", ") : null;
  }
  if (typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>)
      .filter(([inner]) => !EXPORT_HIDDEN_COLUMNS.has(inner) && inner !== "residentId")
      .map(([inner, innerValue]) => {
        const shown = display(inner, innerValue, staff);
        const name = label(inner);
        return shown === null || !name ? null : `${name}: ${shown}`;
      })
      .filter((part): part is string => part !== null);
    return parts.length ? parts.join(" · ") : null;
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return formatDateTime(value);
  if (typeof value === "string" && EXPORT_VALUE_LABELS[value]) return EXPORT_VALUE_LABELS[value];
  return fieldValue(key, value) ?? String(value);
}

// Auskunft (A4 hoch): alle Daten der Akte nach Bereichen; wird beim Öffnen erstellt und protokolliert.
export default function DataExportPrint() {
  const params = useSearchParams();
  const residentId = params.get("resident") ?? "";
  const requestedBy = params.get("verlangt") ?? "";
  const [data, setData] = useState<ResidentExport | null>(null);
  const [error, setError] = useState("");
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !residentId) return;
    started.current = true;
    requestJson<ResidentExport>(`/api/residents/${residentId}/export`, {
      method: "POST",
      body: { requestedBy, format: "print" },
    })
      .then(setData)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Die Auskunft konnte nicht erstellt werden."),
      );
  }, [residentId, requestedBy]);

  const sections = data?.sections.filter((section) => section.rows.length) ?? [];
  return (
    <main className="transfer-print">
      <style>{"@page { size: A4 portrait; margin: 12mm; }"}</style>
      <div className="roster-print-bar">
        <strong>Auskunft</strong>
        <span>A4 hoch · im Druckdialog „Als PDF speichern“ wählen</span>
        <button className="primary-button" type="button" disabled={!data} onClick={() => window.print()}>
          <Printer className="button-icon" /> Drucken / PDF
        </button>
        <button className="secondary-button" type="button" onClick={() => window.close()}>
          <X className="button-icon" /> Schliessen
        </button>
      </div>
      {!data && <h1 className="print-hidden-heading">Auskunft über gespeicherte Daten</h1>}
      {!residentId ? (
        <p className="roster-print-message" role="alert">
          Keine Akte gewählt.
        </p>
      ) : error ? (
        <p className="roster-print-message" role="alert">
          Die Auskunft konnte nicht erstellt werden: {error}
        </p>
      ) : !data ? (
        <p className="roster-print-message">Auskunft wird erstellt …</p>
      ) : (
        <article className="transfer-sheet export-sheet">
          <header className="transfer-head">
            <div>
              <p>Auskunft über gespeicherte Daten</p>
              <h1>{data.resident.name}</h1>
              <span>
                Erstellt {formatDateTime(data.generatedAt)} von {data.generatedBy} · verlangt von {data.requestedBy}
              </span>
            </div>
            <div className="transfer-facility">
              <strong>{data.organization}</strong>
            </div>
          </header>
          <p className="export-legal">{EXPORT_LEGAL_NOTE}</p>
          <ul className="export-notes">
            {data.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <nav aria-label="Inhalt" className="export-toc">
            {sections.map((section) => (
              <span key={section.key}>
                {section.title} ({section.rows.length})
              </span>
            ))}
          </nav>
          {sections.map((section) => (
            <section key={section.key} aria-label={section.title}>
              <h2>{section.title}</h2>
              {section.rows.map((row, index) => (
                <dl key={index} className="export-row">
                  {Object.entries(row)
                    .filter(([key]) => !EXPORT_HIDDEN_COLUMNS.has(key) && label(key))
                    .map(
                      ([key, value]) =>
                        [
                          key,
                          (typeof value === "string" && EXPORT_SECTION_VALUE_LABELS[section.key]?.[key]?.[value]) ||
                            display(key, value, data.staff),
                        ] as const,
                    )
                    .filter((entry): entry is readonly [string, string] => entry[1] !== null)
                    .map(([key, value]) => (
                      <div key={key}>
                        <dt>{label(key)}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                </dl>
              ))}
            </section>
          ))}
        </article>
      )}
    </main>
  );
}
