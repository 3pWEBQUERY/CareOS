"use client";

import { useState } from "react";
import type { OpenShift, OpenShiftInterest } from "@/lib/roster/open-shift-service";
import { formatDate } from "@/lib/roster/time";
import { OPEN_SHIFT_STATUS_LABELS } from "@/lib/roster/types";

export type OpenShiftsPayload = {
  from: string;
  to: string;
  shifts: OpenShift[];
  history: Array<OpenShiftInterest & { date: string; unitId: string }>;
};

// Anfangs sichtbare Zeilen; der Rest auf Wunsch (lange Listen verdrängen sonst die übrigen Anträge).
export const OPEN_SHIFTS_PREVIEW = 12;

export function ShowAllOpenShifts({ total, all, onToggle }: { total: number; all: boolean; onToggle: () => void }) {
  if (total <= OPEN_SHIFTS_PREVIEW) return null;
  return (
    <div className="roster-open-more">
      <button className="secondary-button" type="button" onClick={onToggle}>
        {all ? "Weniger anzeigen" : `Alle ${total} anzeigen`}
      </button>
    </div>
  );
}

export const shiftLabel = (s: Pick<OpenShift, "code" | "shiftType" | "startTime" | "endTime">) =>
  `${s.code} · ${s.shiftType} ${s.startTime}–${s.endTime}`;

// Börse für offene Dienste (Mitarbeitende): Interesse melden oder zurückziehen; zuteilen entscheidet die Leitung.
export function OpenShiftsCard({
  data,
  busy,
  act,
}: {
  data: OpenShiftsPayload;
  busy: string | null;
  act: (key: string, url: string, body: unknown, success: string) => Promise<void>;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? data.shifts : data.shifts.slice(0, OPEN_SHIFTS_PREVIEW);
  return (
    <section className="card roster-card" aria-label="Offene Dienste">
      <div className="roster-section-head">
        <div>
          <h2>Offene Dienste</h2>
          <p>
            Dienste im veröffentlichten Plan deiner Wohnbereiche, bei denen die Mindestbesetzung fehlt (bis{" "}
            {formatDate(data.to, true)}). Mit deinem Interesse entscheidet die Leitung über die Zuteilung.
          </p>
        </div>
      </div>
      <div className="roster-table-wrap">
        <table className="roster-table">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Dienst</th>
              <th>Wohnbereich</th>
              <th>Offen</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((shift) => (
              <tr key={shift.key}>
                <td>{formatDate(shift.date, true)}</td>
                <td>{shiftLabel(shift)}</td>
                <td>{shift.unit}</td>
                <td>
                  {shift.open} von {shift.required}
                </td>
                <td>
                  <div className="roster-row-actions">
                    {shift.mine?.status === "OPEN" ? (
                      <>
                        <span className="roster-pill attention">{OPEN_SHIFT_STATUS_LABELS.OPEN}</span>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={busy === shift.key}
                          onClick={() =>
                            act(
                              shift.key,
                              `/api/dienstplan/open-shifts/${shift.mine!.id}`,
                              { action: "withdraw" },
                              "Interesse zurückgezogen",
                            )
                          }
                        >
                          Zurückziehen
                        </button>
                      </>
                    ) : shift.hasShiftThatDay ? (
                      <span className="roster-muted">Du hast an diesem Tag Dienst</span>
                    ) : (
                      <button
                        className="primary-button"
                        type="button"
                        disabled={busy === shift.key}
                        onClick={() =>
                          act(
                            shift.key,
                            "/api/dienstplan/open-shifts",
                            { unitId: shift.unitId, shiftTypeId: shift.shiftTypeId, date: shift.date },
                            "Interesse gemeldet – die Leitung entscheidet",
                          )
                        }
                      >
                        Interesse melden
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!data.shifts.length && (
              <tr>
                <td colSpan={5} className="roster-muted">
                  Zurzeit sind keine Dienste offen.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <ShowAllOpenShifts total={data.shifts.length} all={all} onToggle={() => setAll((current) => !current)} />
      {data.history.length > 0 && (
        <ul className="roster-open-history">
          {data.history.map((item) => (
            <li key={item.id}>
              {formatDate(item.date, true)}:{" "}
              <span className={`roster-pill ${item.status === "ASSIGNED" ? "ok" : ""}`}>
                {OPEN_SHIFT_STATUS_LABELS[item.status]}
              </span>
              {item.decisionComment ? <small className="roster-muted"> {item.decisionComment}</small> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
