"use client";

import { ModuleIcon } from "@/app/components/module-icon";
import { timeInZurich } from "@/app/components/workspace-ui";
import { COMPLIANCE_STATES, TRAINING_FORMATS } from "@/lib/learning-shared";
import { MONTHS, zurichDay } from "./learning-utils";
import type { LearningViewState } from "./use-learning-view";

export function LearningCalendar({ r }: { r: LearningViewState }) {
  const { compliance, showAll, setShowAll, data, upcoming, dueCourses, deadlines, team } = r;
  return (
    <aside className="card learning-calendar-card">
      <div className="card-header">
        <div>
          <p className="eyebrow">{compliance ? "Fristen" : "Termine"}</p>
          <h2 className="card-title">
            {compliance ? "Fällige Nachweise" : showAll ? "Alle Kurstermine" : "Deine nächsten Kurse"}
          </h2>
        </div>
        <ModuleIcon name={compliance ? "alert" : "calendar"} className="learning-calendar-icon" />
      </div>
      {compliance
        ? deadlines.slice(0, showAll ? 50 : 4).map((row) => (
            <div className="learning-session" key={row.key}>
              <strong>{row.deadline ? row.deadline.slice(8, 10) : "–"}</strong>
              <span>
                <b>
                  {row.title}
                  {team ? ` · ${row.userName}` : ""}
                </b>
                <small>
                  {row.deadline ? `${MONTHS[Number(row.deadline.slice(5, 7)) - 1]} ${row.deadline.slice(0, 4)} · ` : ""}
                  {COMPLIANCE_STATES[row.state].label.toLowerCase()}
                </small>
              </span>
            </div>
          ))
        : [
            ...upcoming.slice(0, showAll ? 50 : 4).map(({ t, s }) => (
              <div className="learning-session" key={s.id}>
                <strong>{zurichDay(s.startsAt).slice(8, 10)}</strong>
                <span>
                  <b>{t.title}</b>
                  <small>
                    {MONTHS[Number(zurichDay(s.startsAt).slice(5, 7)) - 1]} · {timeInZurich(new Date(s.startsAt))} Uhr
                    {s.location ? ` · ${s.location}` : ""}
                    {showAll && s.mine ? " · angemeldet" : ""}
                  </small>
                </span>
              </div>
            )),
            ...dueCourses.slice(0, 3).map((t) => (
              <div className="learning-session" key={`due-${t.id}`}>
                <strong>{t.enrollment!.dueOn!.slice(8, 10)}</strong>
                <span>
                  <b>{t.title}</b>
                  <small>
                    {MONTHS[Number(t.enrollment!.dueOn!.slice(5, 7)) - 1]} · Frist · {TRAINING_FORMATS[t.format]}
                  </small>
                </span>
              </div>
            )),
          ]}
      {data && (compliance ? !deadlines.length : !upcoming.length && !dueCourses.length) && (
        <p className="list-hint learning-empty">
          {compliance
            ? "Keine offenen Fristen – alles aktuell."
            : showAll
              ? "Keine Kurstermine geplant."
              : "Du bist für keinen Termin angemeldet."}
        </p>
      )}
      <button className="quiet-button" type="button" onClick={() => setShowAll((current) => !current)}>
        {showAll ? "Nur meine" : compliance ? "Alle Fristen" : "Alle Termine"} <ModuleIcon name="chevron" />
      </button>
    </aside>
  );
}
