"use client";

import { ModuleIcon } from "@/app/components/module-icon";
import { COMPLIANCE_STATES } from "@/lib/learning-shared";
import { complianceText, STATE_ICON } from "./learning-utils";
import { FocusTraining } from "./focus-training";
import type { LearningViewState } from "./use-learning-view";

export function LearningProgressCard({ r }: { r: LearningViewState }) {
  const {
    compliance,
    setDialog,
    data,
    today,
    run,
    trainings,
    mine,
    active,
    completedCount,
    focusTraining,
    rows,
    focusRow,
    valid,
    team,
    teams,
    unit,
    setUnit,
    percent,
  } = r;
  return (
    <section className="card learning-progress-card">
      <div className="card-header">
        <div>
          <p className="eyebrow">{compliance ? (team ? "Team" : "Kompetenzprofil") : "Persönlicher Lernpfad"}</p>
          <h2 className="card-title">{compliance ? "Pflichtnachweise" : "Dein Fortschritt"}</h2>
          <p className="card-subtitle">
            {compliance
              ? `${valid} von ${rows.length} Nachweisen gültig`
              : `${completedCount} von ${mine.length} Lernzielen abgeschlossen`}
          </p>
        </div>
        <span className="learning-progress-value">{data ? `${percent} %` : "–"}</span>
      </div>
      <div className="learning-progress-bar">
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="learning-progress-meta">
        <span>{compliance ? "Sicherheitsstandard Pflege" : `Lernjahr ${today.slice(0, 4)}`}</span>
        <strong>
          {compliance
            ? `${rows.filter((r) => r.state === "due_soon").length} bald fällig`
            : `noch ${active.length} ${active.length === 1 ? "Kurs" : "Kurse"} offen`}
        </strong>
      </div>
      {teams.length > 0 && (
        <div className="learning-teams" role="group" aria-label="Übersicht je Team">
          <p className="eyebrow">Übersicht je Team</p>
          {teams.map((t) => (
            <button
              className={`learning-team ${unit === t.name ? "selected" : ""}`}
              type="button"
              key={t.name}
              aria-pressed={unit === t.name}
              onClick={() => setUnit(unit === t.name ? null : t.name)}
            >
              <strong>{t.name}</strong>
              <span className="learning-team-bar">
                <span style={{ width: `${t.percent}%` }} />
              </span>
              <b>{t.percent} %</b>
              <em>
                {t.valid} von {t.total} gültig{t.open ? ` · ${t.open} offen oder abgelaufen` : ""}
              </em>
            </button>
          ))}
        </div>
      )}
      {compliance && focusRow && (
        <div className="learning-focus">
          <span className={`governance-focus-icon ${COMPLIANCE_STATES[focusRow.state].tone}`}>
            <ModuleIcon name={STATE_ICON[focusRow.state]} />
          </span>
          <div>
            <p className="eyebrow">{team ? focusRow.userName : "Nächster Nachweis"}</p>
            <h3>{focusRow.title}</h3>
            <p>{complianceText(focusRow, today)}</p>
          </div>
          <div className="learning-focus-actions">
            {focusRow.enrollment?.certificateFileId && (
              <a
                className="quiet-button"
                href={`/api/cloud/files/${focusRow.enrollment.certificateFileId}?preview=1`}
                target="_blank"
                rel="noreferrer"
              >
                Zertifikat
              </a>
            )}
            {data?.canManage && focusRow.state === "pending" && focusRow.enrollment && (
              <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  void run(
                    `/api/learning/enrollments/${focusRow.enrollment!.id}`,
                    { action: "verify" },
                    "Nachweis bestätigt",
                  )
                }
              >
                Bestätigen
              </button>
            )}
            {(focusRow.userId === data?.currentUserId || data?.canManage) && (
              <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  setDialog({ kind: "evidence", trainingId: focusRow.trainingId, userId: focusRow.userId })
                }
              >
                Nachweis erfassen
              </button>
            )}
          </div>
        </div>
      )}
      {!compliance && focusTraining && (
        <FocusTraining training={focusTraining} data={data!} setDialog={setDialog} run={run} />
      )}
      {data && ((compliance && !rows.length) || (!compliance && !trainings.length)) && (
        <p className="list-hint learning-empty">
          {compliance
            ? "Für diese Auswahl sind keine Pflichtnachweise hinterlegt."
            : "Noch keine Schulungen im Katalog."}
        </p>
      )}
    </section>
  );
}
