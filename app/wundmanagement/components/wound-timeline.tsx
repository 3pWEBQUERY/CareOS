"use client";

import { formatDateTime } from "@/app/components/workspace-ui";
import { materialLabel, sizeLabel, type WoundEntry } from "@/lib/wounds-shared";

export function WoundTimeline({ entries, loading }: { entries: WoundEntry[]; loading: boolean }) {
  if (loading) return <p className="list-hint">Verlauf wird geladen …</p>;
  if (!entries.length) return <p className="list-hint">Noch keine Einträge dokumentiert.</p>;
  return (
    <ol className="wound-timeline">
      {entries.map((entry) => (
        <li key={entry.id} className={entry.infectionSigns ? "infection" : ""}>
          <time>{formatDateTime(entry.observedAt)}</time>
          <strong>
            {entry.entryType} · {sizeLabel(entry)}
          </strong>
          <small>
            {[
              entry.tissue,
              entry.exudate && `Exsudat ${entry.exudate.toLowerCase()}`,
              entry.woundEdge && `Rand ${entry.woundEdge.toLowerCase()}`,
              entry.painScore !== null && `NRS ${entry.painScore}`,
              entry.infectionSigns && "Infektionszeichen",
              entry.odor && "Geruch",
            ]
              .filter(Boolean)
              .join(" · ") || "Keine strukturierten Befunde"}
          </small>
          {entry.treatment && <p>{entry.treatment}</p>}
          {entry.materials.length > 0 && (
            <p className="wound-timeline-materials">Material: {entry.materials.map(materialLabel).join(", ")}</p>
          )}
          {entry.note && <p className="wound-timeline-note">{entry.note}</p>}
          <em>{entry.author ?? "unbekannt"}</em>
        </li>
      ))}
    </ol>
  );
}
