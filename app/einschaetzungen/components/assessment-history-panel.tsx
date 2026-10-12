"use client";

import { useState } from "react";
import { X } from "@phosphor-icons/react";
import { ModuleIcon } from "@/app/components/module-icon";
import { formatDateTime, useApiData, type ShowToast } from "@/app/components/workspace-ui";
import type { Instrument } from "@/lib/assessment-instruments";
import type { AssessmentResult } from "@/lib/assessments";
import AssessmentDialog from "./assessment-dialog";
import { Overview } from "./assessment-view-utils";

export function HistoryPanel({
  instruments,
  result,
  residentName,
  canWrite,
  residents,
  showToast,
  onChanged,
  onClose,
}: {
  instruments: Instrument[];
  result: AssessmentResult;
  residentName: string;
  canWrite: boolean;
  residents: Overview["residents"];
  showToast: ShowToast;
  onChanged: () => void;
  onClose: () => void;
}) {
  const history = useApiData<{ results: AssessmentResult[] }>(
    `/api/assessments/residents/${result.residentId}?instrument=${result.code}`,
  );
  const [repeat, setRepeat] = useState(false);
  const instrument = instruments.find((item) => item.code === result.code);
  const labelOf = (key: string, value: unknown) =>
    instrument?.items.find((i) => i.key === key)?.options.find((o) => o.value === value)?.label ?? String(value);
  if (repeat)
    return (
      <AssessmentDialog
        instruments={instruments}
        residents={residents}
        residentId={result.residentId}
        instrument={result.code}
        onClose={() => setRepeat(false)}
        onSaved={(message) => {
          showToast(message);
          onChanged();
          onClose();
        }}
      />
    );
  return (
    <div
      className="area-editor-overlay"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className="area-editor-panel editor-dialog assessment-history"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assessment-history-title"
      >
        <header className="area-editor-header">
          <div>
            <p className="eyebrow">Einschätzungen · {residentName}</p>
            <h2 id="assessment-history-title">{result.name}</h2>
            <p>{instrument?.description ?? "Einschätzung aus einer früheren Version ohne hinterlegte Fragen."}</p>
          </div>
          <button className="area-editor-close" type="button" aria-label="Schliessen" onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="assessment-history-body">
          {canWrite && instrument && (
            <button className="primary-button" type="button" onClick={() => setRepeat(true)}>
              <ModuleIcon name="plus" /> Neu einschätzen
            </button>
          )}
          {(history.data?.results ?? []).map((entry) => (
            <article key={entry.id}>
              <header>
                <strong>
                  {entry.score === null ? "–" : `${entry.score} Punkte`} ·{" "}
                  <span className={`status-text ${entry.tone}`}>{entry.riskLabel ?? "Erfasst"}</span>
                </strong>
                <small>
                  {formatDateTime(entry.completedAt)} · {entry.assessor ?? "unbekannt"}
                </small>
              </header>
              {instrument ? (
                <dl>
                  {Object.entries(entry.answers).map(([key, value]) => (
                    <div key={key}>
                      <dt>{instrument.items.find((i) => i.key === key)?.label ?? key}</dt>
                      <dd>
                        {labelOf(key, value)} ({String(value)})
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {entry.summary && <p>{entry.summary}</p>}
            </article>
          ))}
          {history.loading && !history.data && <p className="list-hint">Verlauf wird geladen …</p>}
        </div>
      </section>
    </div>
  );
}
