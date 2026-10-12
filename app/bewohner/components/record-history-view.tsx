"use client";

import {
  ArrowsLeftRight,
  CalendarDots,
  ClipboardText,
  Heartbeat,
  NotePencil,
  Pill,
  Pulse,
  Warning,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { setCareResident, useTerms } from "@/app/components/care-context";
import { formatDateTime } from "@/app/components/workspace-ui";
import { appointmentDateLabel, appointmentLocalParts } from "@/lib/resident-appointments";
import { HistoryFilter } from "./resident-record-data";
import type { ResidentRecordState } from "./use-resident-record";
import { RecordAuditCard } from "./record-audit-card";
import { RecordExportCard } from "./record-export-card";
import { useNow } from "@/app/components/use-now";

export function RecordHistoryView({ r }: { r: ResidentRecordState }) {
  const t = useTerms();
  const {
    resident,
    contentRef,
    entries,
    setActiveView,
    historyFilter,
    setHistoryFilter,
    visibleHistoryEntries,
    historyEntries,
    openDocumentation,
    live,
    nextAppointment,
  } = r;
  const router = useRouter();
  const now = useNow();
  const lastWeek = historyEntries.filter((entry) => now - Date.parse(entry.occurredAt) < 7 * 86_400_000);
  const today = new Date(now).toLocaleDateString("de-CH", { timeZone: "Europe/Zurich" });
  const todayCount = historyEntries.filter(
    (entry) =>
      entry.category === "Pflege" &&
      new Date(entry.occurredAt).toLocaleDateString("de-CH", { timeZone: "Europe/Zurich" }) === today,
  ).length;
  const noticeable = lastWeek.filter((entry) => entry.tone === "critical" || entry.tone === "attention").length;
  const lastCare = historyEntries.find((entry) => entry.category === "Pflege");
  const flags = live.care.data?.flags ?? [];
  const openModule = (href: string) => {
    if (resident.id) setCareResident(resident.id);
    router.push(href);
  };
  return (
    <main className="resident-record-content record-history-view" ref={contentRef} key="history">
      <div className="record-subpage-heading">
        <div>
          <span className="record-section-label">{`${t.prefix}akte`}</span>
          <h3>Verlauf</h3>
          <p>Chronologische Übersicht aller pflege- und behandlungsrelevanten Ereignisse von {resident.name}.</p>
        </div>
        <button className="primary-button" type="button" onClick={() => openDocumentation()}>
          <NotePencil aria-hidden="true" /> Neuer Eintrag
        </button>
      </div>

      <section className="record-view-stats" aria-label="Verlaufsübersicht">
        <div>
          <span>
            <ClipboardText aria-hidden="true" />
          </span>
          <p>
            <small>Letzte 7 Tage</small>
            <strong>{lastWeek.length} Ereignisse</strong>
          </p>
        </div>
        <div>
          <span>
            <Heartbeat aria-hidden="true" />
          </span>
          <p>
            <small>Heute dokumentiert</small>
            <strong>
              {todayCount} Eintr{todayCount === 1 ? "ag" : "äge"}
            </strong>
          </p>
        </div>
        <div>
          <span className="attention">
            <Warning aria-hidden="true" />
          </span>
          <p>
            <small>Auffällig (7 Tage)</small>
            <strong>
              {noticeable} Ereignis{noticeable === 1 ? "" : "se"}
            </strong>
          </p>
        </div>
        <div>
          <span>
            <ArrowsLeftRight aria-hidden="true" />
          </span>
          <p>
            <small>Letzte Pflegedokumentation</small>
            <strong>{lastCare ? formatDateTime(lastCare.occurredAt) : "–"}</strong>
          </p>
        </div>
      </section>

      <div className="history-layout">
        <section className="record-card history-card" aria-labelledby="history-timeline-title">
          <div className="record-card-heading">
            <div>
              <span className="record-section-label">Chronologie</span>
              <h3 id="history-timeline-title">Aktivitäten und Ereignisse</h3>
            </div>
            <span>
              {visibleHistoryEntries.length} {visibleHistoryEntries.length === 1 ? "Eintrag" : "Einträge"}
            </span>
          </div>
          <div className="history-filters" aria-label="Verlauf filtern">
            {(["Alle", "Pflege", "Vitalwerte", "Medikation", "Termine"] as HistoryFilter[]).map((filter) => (
              <button
                className={historyFilter === filter ? "active" : ""}
                type="button"
                key={filter}
                aria-pressed={historyFilter === filter}
                onClick={() => setHistoryFilter(filter)}
              >
                {filter}
              </button>
            ))}
          </div>
          <div className="resident-history-timeline">
            {[...new Set(visibleHistoryEntries.map((entry) => entry.date))].map((date) => (
              <section className="resident-history-day" key={date} aria-label={date}>
                <h4>{date}</h4>
                {visibleHistoryEntries
                  .filter((entry) => entry.date === date)
                  .map((entry) => (
                    <article className="resident-history-entry" key={entry.id}>
                      <time>{entry.time}</time>
                      <span className={`resident-history-marker ${entry.tone}`}>
                        {entry.category === "Medikation" ? (
                          <Pill aria-hidden="true" />
                        ) : entry.category === "Vitalwerte" ? (
                          <Heartbeat aria-hidden="true" />
                        ) : entry.category === "Termine" ? (
                          <CalendarDots aria-hidden="true" />
                        ) : (
                          <Pulse aria-hidden="true" />
                        )}
                      </span>
                      <div>
                        <span className="history-entry-category">{entry.category}</span>
                        <h5>{entry.title}</h5>
                        <p>{entry.description}</p>
                        <small>{entry.author}</small>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const documentationEntry = entries.find((item) => item.id === entry.documentationId);
                          if (documentationEntry) openDocumentation(documentationEntry);
                          else
                            openModule(
                              entry.category === "Vitalwerte"
                                ? "/c/vitalwerte/entwicklung"
                                : entry.category === "Medikation"
                                  ? "/c/medikation"
                                  : "/c/carecore-one/kalender",
                            );
                        }}
                      >
                        Öffnen
                      </button>
                    </article>
                  ))}
              </section>
            ))}
          </div>
        </section>

        <aside className="history-sidebar">
          <section className="record-card">
            <div className="record-card-heading">
              <div>
                <span className="record-section-label">Im Fokus</span>
                <h3>Aktuelle Entwicklungen</h3>
              </div>
            </div>
            <div className="history-focus-list">
              {flags.map((flag) => (
                <article className={flag.severity === "critical" ? "critical" : "attention"} key={flag.id}>
                  {flag.severity === "critical" ? <Warning aria-hidden="true" /> : <Pulse aria-hidden="true" />}
                  <div>
                    <strong>{flag.label}</strong>
                    <p>{flag.details ?? flag.category}</p>
                    <button type="button" onClick={() => setActiveView("care-record")}>
                      Pflegeakte öffnen
                    </button>
                  </div>
                </article>
              ))}
              {!live.care.loading && !flags.length && (
                <p className="body-observation-empty">Keine aktuellen Risiken oder Beobachtungen erfasst.</p>
              )}
            </div>
          </section>
          <section className="record-card history-next-event">
            <div className="record-card-heading">
              <div>
                <span className="record-section-label">Nächster Termin</span>
                <h3>{nextAppointment?.title ?? "Kein Termin geplant"}</h3>
              </div>
            </div>
            <div>
              <CalendarDots aria-hidden="true" />
              <p>
                <strong>
                  {nextAppointment
                    ? `${appointmentDateLabel(nextAppointment.starts_at, { day: "2-digit", month: "2-digit" })}, ${appointmentLocalParts(nextAppointment.starts_at).time} Uhr`
                    : "–"}
                </strong>
                <small>
                  {nextAppointment
                    ? [nextAppointment.location, nextAppointment.category].filter(Boolean).join(" · ") || "Ohne Ort"
                    : "Termine werden im Reiter „Termine“ geplant."}
                </small>
              </p>
            </div>
          </section>
        </aside>
      </div>
      {resident.id && live.summary.data?.canViewAudit && <RecordAuditCard residentId={resident.id} />}
      {resident.id && live.summary.data?.canExport && (
        <RecordExportCard residentId={resident.id} residentName={resident.name} />
      )}
    </main>
  );
}
