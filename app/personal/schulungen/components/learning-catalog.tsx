"use client";

import { ModuleIcon } from "@/app/components/module-icon";
import { formatDate } from "@/app/components/workspace-ui";
import { COMPLIANCE_STATES } from "@/lib/learning-shared";
import { ScheduleSelect } from "@/app/betrieb/components/operations-ui";
import { SearchField } from "../../components/personal-ui";
import {
  CATEGORY_ICONS,
  ME,
  ALL_PEOPLE,
  trainingState,
  trainingMeta,
  complianceText,
  STATE_ICON,
} from "./learning-utils";
import type { LearningViewState } from "./use-learning-view";

export function LearningCatalog({ r }: { r: LearningViewState }) {
  const {
    compliance,
    searchRef,
    person,
    setPerson,
    filter,
    setFilter,
    query,
    setQuery,
    setSelectedId,
    now,
    data,
    today,
    courseFilters,
    courses,
    focusTraining,
    complianceFilters,
    register,
    focusRow,
    team,
  } = r;
  return (
    <section className="card learning-catalog-card">
      <div className="learning-catalog-header" ref={searchRef}>
        <div>
          <p className="eyebrow">{compliance ? "Nachweisregister" : "Kurskatalog"}</p>
          <h2 className="card-title">{compliance ? "Pflichtnachweise" : "Meine Schulungen"}</h2>
          <p className="card-subtitle">
            {compliance ? `${register.length} Nachweise` : `${courses.length} passende Schulungen`}
          </p>
        </div>
        <div className="learning-catalog-tools">
          {compliance && data?.canManage && (
            <ScheduleSelect
              label="Person"
              value={
                person === ME || person === ALL_PEOPLE ? person : (data.people.find((p) => p.id === person)?.name ?? ME)
              }
              options={[ME, ALL_PEOPLE, ...data.people.map((p) => p.name)]}
              onChange={(value) => {
                setSelectedId(null);
                setPerson(
                  value === ME || value === ALL_PEOPLE ? value : (data.people.find((p) => p.name === value)?.id ?? ME),
                );
              }}
            />
          )}
          <SearchField
            label={compliance ? "Nachweise durchsuchen" : "Kurse durchsuchen"}
            query={query}
            setQuery={setQuery}
            placeholder={compliance ? "Nachweise suchen…" : "Kurse suchen…"}
          />
        </div>
      </div>
      <div className="learning-filter-row operations-filter-buttons">
        {(compliance ? complianceFilters : courseFilters).map((item) => (
          <button
            className={filter === item ? "active" : ""}
            type="button"
            key={item}
            aria-pressed={filter === item}
            onClick={() => setFilter(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="learning-course-grid">
        {compliance
          ? register.map((row) => (
              <button
                className={`learning-course ${focusRow?.key === row.key ? "selected" : ""}`}
                type="button"
                key={row.key}
                onClick={() => setSelectedId(row.key)}
              >
                <span className={`learning-course-icon ${COMPLIANCE_STATES[row.state].tone}`}>
                  <ModuleIcon name={STATE_ICON[row.state]} />
                </span>
                <span>
                  <strong>
                    {row.title}
                    {team ? ` · ${row.userName}` : ""}
                  </strong>
                  <small>{complianceText(row, today)}</small>
                </span>
                <span className={`status-badge ${COMPLIANCE_STATES[row.state].tone}`}>
                  {COMPLIANCE_STATES[row.state].label}
                </span>
                <em>
                  {row.enrollment?.completedAt
                    ? `Nachweis vom ${formatDate(row.enrollment.completedAt)}`
                    : row.category}
                  {row.enrollment?.certificateName ? " · Zertifikat" : ""}
                </em>
              </button>
            ))
          : courses.map((t) => {
              const state = trainingState(t);
              return (
                <button
                  className={`learning-course ${focusTraining?.id === t.id ? "selected" : ""}`}
                  type="button"
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                >
                  <span
                    className={`learning-course-icon ${state.tone === "critical" ? "critical" : state.tone === "stable" ? "stable" : ""}`}
                  >
                    <ModuleIcon name={CATEGORY_ICONS[t.category] ?? "learn"} />
                  </span>
                  <span>
                    <strong>{t.title}</strong>
                    <small>{t.description ?? `${t.category}${t.mandatory ? " · Pflichtschulung" : ""}`}</small>
                  </span>
                  <span className={`status-badge ${state.tone}`}>{state.label}</span>
                  <em>{trainingMeta(t, now)}</em>
                </button>
              );
            })}
      </div>
      {data && (compliance ? !register.length : !courses.length) && (
        <div className="resident-empty">
          <ModuleIcon name="search" />
          <strong>Nichts gefunden</strong>
          <p>Suchbegriff oder Filter anpassen.</p>
        </div>
      )}
    </section>
  );
}
