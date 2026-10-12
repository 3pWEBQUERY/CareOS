"use client";

import Link from "next/link";
import { useState } from "react";
import { setCareResident, useTerms } from "@/app/components/care-context";
import type { Terms } from "@/lib/terminology";
import ModulePageShell from "@/app/components/module-page-shell";
import { ModuleIcon } from "@/app/components/module-icon";
import { LoadError, useApiData } from "@/app/components/workspace-ui";
import { PageBoard, PageBoardCustomizer, usePageBoard, type BoardWidget } from "@/app/components/page-board";
import {
  formatPercent,
  percent,
  type CareInsights,
  type Indicator,
  type LeadershipInsights,
  type ResidentInsights,
  type WorkforceInsights,
} from "@/lib/insights-shared";
import { LeadershipHeading, LeadershipKpis, initialsOf, type Kpi } from "../../components/leadership-page-parts";
import { ResuscitationBadge } from "@/app/components/resuscitation-badge";

export type InsightsView = "care" | "residents" | "leadership" | "workforce";

const pages: Record<InsightsView, { child: string; title: string; description: string; pageClass: string }> = {
  care: {
    child: "Pflege",
    title: "Pflegekennzahlen",
    description: "Versorgungsqualität und Pflegeindikatoren als Entscheidungsgrundlage – live aus der Dokumentation.",
    pageClass: "careInsights",
  },
  residents: {
    child: "Bewohner",
    title: "Bewohnerübersicht",
    description: "Resident 360: der Stand jedes Bewohners über alle Module – die dringendsten zuerst.",
    pageClass: "residentInsights",
  },
  leadership: {
    child: "Leitung",
    title: "Leitungskennzahlen",
    description: "Belegung, Qualität und offene Themen für den täglichen Führungsentscheid.",
    pageClass: "leadershipInsights",
  },
  workforce: {
    child: "Personal",
    title: "Personalkennzahlen",
    description: "Besetzung, Verfügbarkeit und Pflichtschulungen im Überblick.",
    pageClass: "workforceInsights",
  },
};

// Überschrift der Bewohnerübersicht mit der Bezeichnung der Einrichtung.
const residentsPage = (page: (typeof pages)["residents"], t: Terms) => ({
  ...page,
  title: `${t.prefix}übersicht`,
  description: `Resident 360: der Stand jedes ${t.oneGenitive} über alle Module – die dringendsten zuerst.`,
});

const LOADING: Kpi[] = ["Kennzahl 1", "Kennzahl 2", "Kennzahl 3", "Kennzahl 4"].map((label) => ({
  value: "–",
  label,
  note: "wird geladen",
  tone: "info",
}));

// Opens the module behind an indicator.
function IndicatorLink({ item }: { item: Indicator }) {
  return (
    <Link href={item.href}>
      <span className={`governance-icon ${item.tone}`}>
        <ModuleIcon name={item.icon} />
      </span>
      <span>
        <strong>{item.title}</strong>
        <small>{item.detail}</small>
      </span>
      <b>{item.metric}</b>
      <span className={`status-badge ${item.tone}`}>{item.status}</span>
    </Link>
  );
}

// Bausteine je Ansicht; die Standardanteile entsprechen den bisherigen Spaltenverhältnissen.
function careWidgets(data: CareInsights, t: Terms): BoardWidget[] {
  return [
    {
      id: "indicators",
      label: "Indikatoren",
      fraction: 1.15 / 2,
      content: (
        <section className="card care-indicator-card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Pflegequalität</p>
              <h2 className="card-title">Indikatoren</h2>
              <p className="card-subtitle">Aktueller Stand aller aktiven {t.many}</p>
            </div>
          </div>
          <div className="care-indicator-list">
            {data.indicators.map((item) => (
              <IndicatorLink item={item} key={item.id} />
            ))}
          </div>
        </section>
      ),
    },
    {
      id: "documentation",
      label: "Dokumentation (Zielerreichung)",
      fraction: 0.85 / 2,
      content: (
        <aside className="card care-target-card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Zielerreichung</p>
              <h2 className="card-title">Dokumentation</h2>
            </div>
            <ModuleIcon name="chart" className="care-target-icon" />
          </div>
          <div className="care-target-ring gauge" style={{ ["--value" as string]: data.documentation ?? 0 }}>
            <strong>{formatPercent(data.documentation)}</strong>
            <span>letzte 24 h</span>
          </div>
          <p>
            {data.belowTarget
              ? `${data.belowTarget} Indikator${data.belowTarget === 1 ? " liegt" : "en liegen"} unter dem Zielwert oder benötigen Aufmerksamkeit.`
              : "Alle Indikatoren liegen im Zielbereich."}
          </p>
          <Link className="primary-button" href="/pflegedokumentation">
            Zur Pflegedokumentation
          </Link>
        </aside>
      ),
    },
  ];
}

const RESIDENT_FILTERS = [
  { id: "all", label: "Alle" },
  { id: "critical", label: "Kritisch" },
  { id: "attention", label: "Wichtig" },
  { id: "info", label: "Routine" },
  { id: "stable", label: "Stabil" },
] as const;

const dateTime = (value: string) =>
  new Date(value).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function ResidentsView({ data }: { data: ResidentInsights }) {
  const t = useTerms();
  const [filter, setFilter] = useState<(typeof RESIDENT_FILTERS)[number]["id"]>("all");
  const count = (id: (typeof RESIDENT_FILTERS)[number]["id"]) =>
    id === "all" ? data.residents.length : data.residents.filter((resident) => resident.tone === id).length;
  const residents = filter === "all" ? data.residents : data.residents.filter((resident) => resident.tone === filter);
  return (
    <section className="card resident-insights-card">
      <div className="card-header">
        <div>
          <p className="eyebrow">Resident 360</p>
          <h2 className="card-title">Alle {t.many}</h2>
          <p className="card-subtitle">
            Heute fällig · Wunden · Ereignisse der letzten {data.eventDays} Tage · Ernährung
          </p>
        </div>
        <div className="worklist-filters" role="group" aria-label={`${t.many} filtern`}>
          {RESIDENT_FILTERS.map((item) => (
            <button
              className={filter === item.id ? "active" : ""}
              type="button"
              key={item.id}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label} {count(item.id)}
            </button>
          ))}
        </div>
      </div>
      <div className="resident-insights-list">
        {residents.map((resident) => (
          <Link
            className="resident-insights-row"
            href={`/c/bewohner?resident=${resident.id}`}
            key={resident.id}
            onClick={() => setCareResident(resident.id)}
          >
            <span className={`resident-avatar ${resident.tone === "critical" ? "critical" : ""}`}>
              {resident.initials}
            </span>
            <span className="resident-insights-person">
              <strong>
                {resident.name} <ResuscitationBadge residentId={resident.id} />
              </strong>
              <small>{[resident.room, resident.careUnit].filter(Boolean).join(" · ")}</small>
            </span>
            <span className="resident-insights-cell">
              <small>Heute</small>
              <strong>
                {resident.today.critical + resident.today.attention + resident.today.info
                  ? [
                      resident.today.critical && `${resident.today.critical} kritisch`,
                      resident.today.attention && `${resident.today.attention} wichtig`,
                      resident.today.info && `${resident.today.info} Routine`,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "nichts offen"}
              </strong>
              {resident.today.labels.length > 0 && <em>{resident.today.labels.join(", ")}</em>}
            </span>
            <span className="resident-insights-cell">
              <small>Wunden</small>
              <strong>
                {resident.wounds.active
                  ? `${resident.wounds.active} aktiv${resident.wounds.critical ? ` · ${resident.wounds.critical} kritisch` : ""}`
                  : "keine"}
              </strong>
            </span>
            <span className="resident-insights-cell">
              <small>Ereignisse</small>
              <strong>
                {resident.events.total
                  ? `${resident.events.total}${resident.events.falls ? ` (davon ${resident.events.falls} ${resident.events.falls === 1 ? "Sturz" : "Stürze"})` : ""}`
                  : "keine"}
              </strong>
              {resident.events.open > 0 && <em>{resident.events.open} in Bearbeitung</em>}
            </span>
            <span className="resident-insights-cell">
              <small>Ernährung</small>
              <strong>
                {resident.trends.length
                  ? `${resident.trends.length} Hinweis${resident.trends.length === 1 ? "" : "e"}`
                  : "unauffällig"}
              </strong>
              {resident.trends.length > 0 && <em>{resident.trends.join(" · ")}</em>}
            </span>
            <span className="resident-insights-cell">
              <small>Letzte Doku</small>
              <strong>{resident.lastDocumentation ? dateTime(resident.lastDocumentation) : "keine"}</strong>
            </span>
            <span className={`status-badge ${resident.tone}`}>
              {RESIDENT_FILTERS.find((item) => item.id === resident.tone)?.label}
            </span>
          </Link>
        ))}
        {!residents.length && <p className="list-hint">Keine {t.many} in dieser Stufe.</p>}
      </div>
    </section>
  );
}

function leadershipWidgets(data: LeadershipInsights): BoardWidget[] {
  return [
    {
      id: "cockpit",
      label: "Haus-Cockpit",
      fraction: 1.3 / 2,
      content: (
        <section className="card executive-scorecard">
          <div className="card-header">
            <div>
              <p className="eyebrow">Geschäftsführung</p>
              <h2 className="card-title">Haus-Cockpit</h2>
              <p className="card-subtitle">Aktueller Stand im gesamten Haus</p>
            </div>
          </div>
          <div className="executive-score-grid">
            {data.scores.map((score) => (
              <div key={score.label}>
                <span>{score.label}</span>
                <strong>{score.value}</strong>
                <small>{score.note}</small>
              </div>
            ))}
          </div>
          <div className="executive-trend">
            <span style={{ width: `${data.progress.value ?? 0}%` }} />
            <b>{data.progress.label}</b>
          </div>
          <div className="executive-units">
            {data.units.map((unit) => {
              const share = percent(unit.residents, unit.beds);
              return (
                <div key={unit.name}>
                  <strong>{unit.name}</strong>
                  <span className="executive-unit-bar">
                    <span style={{ width: `${Math.min(share ?? 0, 100)}%` }} />
                  </span>
                  <small>
                    {unit.residents} / {unit.beds || "–"} · {formatPercent(share)}
                  </small>
                </div>
              );
            })}
          </div>
        </section>
      ),
    },
    {
      id: "decisions",
      label: "Entscheidungen",
      fraction: 0.7 / 2,
      content: (
        <aside className="card executive-decisions">
          <div className="card-header">
            <div>
              <p className="eyebrow">Führungskreis</p>
              <h2 className="card-title">Entscheidungen</h2>
            </div>
            <span className={`status-badge ${data.decisions.length ? "attention" : "stable"}`}>
              {data.decisions.length ? `${data.decisions.length} offen` : "Alles im Plan"}
            </span>
          </div>
          {data.decisions.map((item) => (
            <Link href={item.href} key={item.id}>
              <span className={`governance-icon ${item.tone}`}>
                <ModuleIcon name={item.icon} />
              </span>
              <span>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </span>
              <span>
                <strong>{item.metric}</strong>
                <small>{item.status}</small>
              </span>
              <ModuleIcon name="chevron" className="chevron" />
            </Link>
          ))}
          {!data.decisions.length && <p className="list-hint">Keine offenen Themen für die Leitung.</p>}
        </aside>
      ),
    },
  ];
}

function workforceWidgets(data: WorkforceInsights): BoardWidget[] {
  const c = data.compliance;
  return [
    {
      id: "staffing",
      label: "Besetzung nach Wohnbereich",
      fraction: 1.3 / 2,
      content: (
        <section className="card workforce-matrix">
          <div className="card-header">
            <div>
              <p className="eyebrow">Dienstbesetzung</p>
              <h2 className="card-title">Besetzung nach Wohnbereich</h2>
              <p className="card-subtitle">Nächste 7 Tage · {formatPercent(data.coverage)} besetzt</p>
            </div>
            <Link className="secondary-button" href="/dienstplan">
              Dienstplan <ModuleIcon name="chevron" />
            </Link>
          </div>
          <div className="workforce-table week">
            <div className="workforce-table-head">
              <span>Bereich</span>
              {data.days.map((day) => (
                <span key={day.day}>{day.label}</span>
              ))}
            </div>
            {data.matrix.map((row) => (
              <div className="workforce-table-row" key={row.unit}>
                <strong>{row.unit}</strong>
                {row.cells.map((cell, index) => (
                  <span
                    className={!cell.required ? "empty" : cell.assigned < cell.required ? "warning" : "ok"}
                    key={data.days[index].day}
                    title={`${cell.assigned} von ${cell.required} Personen eingeplant`}
                  >
                    {!cell.required
                      ? "–"
                      : cell.assigned < cell.required
                        ? `${cell.required - cell.assigned} offen`
                        : `${cell.assigned}/${cell.required}`}
                  </span>
                ))}
              </div>
            ))}
            {!data.matrix.length && <p className="list-hint">Noch keine Wohnbereiche eingerichtet.</p>}
          </div>
        </section>
      ),
    },
    {
      id: "absences",
      label: "Abwesenheiten",
      fraction: 0.7 / 2,
      content: (
        <section className="card workforce-availability">
          <div className="card-header">
            <div>
              <p className="eyebrow">Verfügbarkeit</p>
              <h2 className="card-title">Abwesenheiten</h2>
              <p className="card-subtitle">Nächste 14 Tage</p>
            </div>
            <span
              className={`status-badge ${data.absences.some((a) => a.tone === "attention") ? "attention" : "stable"}`}
            >
              {data.absences.length}
            </span>
          </div>
          {data.absences.map((absence) => (
            <div className="workforce-person" key={absence.id}>
              <span className="avatar">{initialsOf(absence.name)}</span>
              <span>
                <strong>{absence.name}</strong>
                <small>{absence.period}</small>
              </span>
              <span className={`status-badge ${absence.tone}`}>{absence.status}</span>
            </div>
          ))}
          {!data.absences.length && <p className="list-hint workforce-hint">Keine Abwesenheiten geplant.</p>}
          <Link className="primary-button" href="/dienstplan">
            Vertretung planen
          </Link>
        </section>
      ),
    },
    {
      id: "trainings",
      label: "Pflichtschulungen",
      fraction: 0.7 / 2,
      stacked: true,
      content: c && (
        <section className="card quality-risk-card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Kompetenz</p>
              <h2 className="card-title">Pflichtschulungen</h2>
            </div>
          </div>
          <div className="quality-risk-meter">
            <span
              style={{
                width: `${percent(c.valid + c.dueSoon, c.valid + c.dueSoon + c.expired + c.missing + c.pending) ?? 0}%`,
              }}
            />
          </div>
          <p>
            {c.dueSoon} Nachweis{c.dueSoon === 1 ? " läuft" : "e laufen"} bald ab, {c.pending} warte
            {c.pending === 1 ? "t" : "n"} auf Prüfung.
          </p>
          <div className="quality-risk-stats">
            <span>
              <strong>{c.valid + c.dueSoon}</strong>
              <small>Gültig</small>
            </span>
            <span>
              <strong>{c.expired}</strong>
              <small>Abgelaufen</small>
            </span>
            <span>
              <strong>{c.missing}</strong>
              <small>Fehlend</small>
            </span>
          </div>
          <Link className="secondary-button" href="/personal/schulungen/pflichtnachweise">
            Pflichtnachweise <ModuleIcon name="chevron" />
          </Link>
        </section>
      ),
    },
  ];
}

export default function InsightsWorkspace({ view }: { view: InsightsView }) {
  const t = useTerms();
  const page = view === "residents" ? residentsPage(pages.residents, t) : pages[view];
  const data = useApiData<CareInsights | ResidentInsights | LeadershipInsights | WorkforceInsights>(
    `/api/insights?view=${view}`,
  );
  const board = usePageBoard(`insights-${view}`);
  const content = data.data;
  const widgets: BoardWidget[] = [
    {
      id: "kpis",
      label: "Kennzahlen",
      fraction: 1,
      content: <LeadershipKpis kpis={content?.kpis ?? LOADING} />,
    },
    ...(!content
      ? []
      : view === "care"
        ? careWidgets(content as CareInsights, t)
        : view === "residents"
          ? [
              {
                id: "residents",
                label: `Alle ${t.many}`,
                fraction: 1,
                content: <ResidentsView data={content as ResidentInsights} />,
              },
            ]
          : view === "leadership"
            ? leadershipWidgets(content as LeadershipInsights)
            : workforceWidgets(content as WorkforceInsights)),
  ];
  return (
    <ModulePageShell
      activeModule="insights"
      activeChild={page.child}
      pageClass={`leadership-page leadership-${page.pageClass}`}
      locationSecondary="Gesamtes Haus · alle Wohnbereiche"
    >
      {(showToast) => (
        <main className="workspace leadership-workspace">
          <LeadershipHeading
            eyebrow="Kennzahlen"
            title={page.title}
            description={page.description}
            action={{
              label: "Aktualisieren",
              icon: "docs",
              onClick: () => {
                data.reload();
                showToast("Kennzahlen werden neu berechnet");
              },
            }}
            customize={{ editing: board.editing, onToggle: () => board.setEditing((value) => !value) }}
          />
          {board.editing && <PageBoardCustomizer board={board} widgets={widgets} />}
          <PageBoard board={board} widgets={widgets} />
          {data.error && <LoadError message={data.error} onRetry={data.reload} />}
        </main>
      )}
    </ModulePageShell>
  );
}
