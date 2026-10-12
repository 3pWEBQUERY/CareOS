"use client";

import { useTerms } from "@/app/components/care-context";
import { useState } from "react";
import { ClockCounterClockwise } from "@phosphor-icons/react";
import { formatDateTime, useApiData } from "@/app/components/workspace-ui";
import { describeAudit, type ResidentAuditEntry } from "@/lib/resident-audit-labels";

// Änderungsprotokoll der Akte: wer hat wann was geändert (Stammdaten, Kontakte, Befunde, Dokumentation …).
// Wird erst beim Öffnen geladen.
export function RecordAuditCard({ residentId }: { residentId: string }) {
  const t = useTerms();
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(50);
  const audit = useApiData<{ entries: ResidentAuditEntry[] }>(
    open ? `/api/residents/${residentId}/audit?limit=${limit}` : null,
  );
  const entries = audit.data?.entries ?? [];
  return (
    <section className="record-card record-audit-card" aria-labelledby="record-audit-title">
      <div className="record-card-heading">
        <div>
          <span className="record-section-label">Nachvollziehbarkeit</span>
          <h3 id="record-audit-title">Änderungsprotokoll</h3>
        </div>
        <button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
          <ClockCounterClockwise aria-hidden="true" /> {open ? "Ausblenden" : "Anzeigen"}
        </button>
      </div>
      {open && (
        <div className="record-audit-list">
          {audit.error && (
            <p className="body-observation-error" role="alert">
              {audit.error}
            </p>
          )}
          {audit.loading && !audit.data && <p className="body-observation-empty">Protokoll wird geladen…</p>}
          {!audit.loading && !audit.error && !entries.length && (
            <p className="body-observation-empty">Noch keine protokollierten Änderungen.</p>
          )}
          {entries.length > 0 && (
            <ol>
              {entries.map((entry) => {
                const described = describeAudit(entry, t);
                const text = { ...described, title: described.title.replace("Bewohnerbild", `${t.prefix}bild`) };
                return (
                  <li key={entry.id}>
                    <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                    <div>
                      <strong>
                        {text.title}
                        {text.name && <span> · {text.name}</span>}
                      </strong>
                      {text.detail && <small>{text.detail}</small>}
                    </div>
                    <em title={entry.device ? `Gerät: ${entry.device}` : undefined}>
                      {entry.actor}
                      {entry.device ? ` · ${entry.device}` : ""}
                    </em>
                  </li>
                );
              })}
            </ol>
          )}
          {entries.length >= limit && (
            <button className="secondary-button" type="button" onClick={() => setLimit((current) => current + 100)}>
              Ältere Einträge laden
            </button>
          )}
        </div>
      )}
    </section>
  );
}
