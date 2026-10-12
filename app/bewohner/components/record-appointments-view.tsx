"use client";

import { useTerms } from "@/app/components/care-context";
import { appointmentDateLabel, appointmentLocalParts } from "@/lib/resident-appointments";
import { ArrowRight, CalendarDots, Plus } from "@phosphor-icons/react";
import type { ResidentRecordState } from "./use-resident-record";

export function RecordAppointmentsView({ r }: { r: ResidentRecordState }) {
  const t = useTerms();
  const {
    resident,
    contentRef,
    appointmentsLoading,
    appointmentsError,
    setAppointmentEditor,
    setAppointmentRevision,
    upcomingAppointments,
    pastAppointments,
  } = r;
  return (
    <main className="resident-record-content record-appointments-view" ref={contentRef} key="appointments">
      <div className="record-subpage-heading">
        <div>
          <span className="record-section-label">{`${t.prefix}akte`}</span>
          <h3>Termine</h3>
          <p>Arztbesuche, Therapien und weitere Termine für {resident.name}.</p>
        </div>
        {resident.id && (
          <button className="primary-button" type="button" onClick={() => setAppointmentEditor("new")}>
            <Plus /> Termin erstellen
          </button>
        )}
      </div>
      {appointmentsError && (
        <div className="resident-appointment-error" role="alert">
          {appointmentsError}
          <button type="button" onClick={() => setAppointmentRevision((current) => current + 1)}>
            Erneut laden
          </button>
        </div>
      )}
      {!resident.id ? (
        <section className="record-card resident-appointment-empty">
          <CalendarDots />
          <strong>Termine sind nach dem Speichern des {t.oneGenitive} verfügbar.</strong>
        </section>
      ) : appointmentsLoading ? (
        <div className="resident-appointment-loading" role="status">
          Termine werden geladen…
        </div>
      ) : (
        <div className="resident-appointment-sections">
          <section className="record-card resident-appointment-card">
            <div className="record-card-heading">
              <div>
                <span className="record-section-label">Planung</span>
                <h3>Bevorstehende Termine</h3>
              </div>
              <span>{upcomingAppointments.length} geplant</span>
            </div>
            {upcomingAppointments.length ? (
              <div className="resident-appointment-list">
                {upcomingAppointments.map((item) => (
                  <button
                    type="button"
                    className="resident-appointment-row"
                    key={item.id}
                    onClick={() => setAppointmentEditor(item)}
                  >
                    <span className="resident-appointment-date">
                      <strong>{appointmentDateLabel(item.starts_at, { day: "2-digit" })}</strong>
                      <small>{appointmentDateLabel(item.starts_at, { month: "short" })}</small>
                    </span>
                    <span className="resident-appointment-details">
                      <strong>{item.title}</strong>
                      <small>
                        {item.category} · {appointmentLocalParts(item.starts_at).time}–
                        {appointmentLocalParts(item.ends_at).time}
                        {item.location ? ` · ${item.location}` : ""}
                      </small>
                    </span>
                    <span className="status-badge info">Geplant</span>
                    <ArrowRight />
                  </button>
                ))}
              </div>
            ) : (
              <div className="resident-appointment-empty">
                <CalendarDots />
                <strong>Keine bevorstehenden Termine</strong>
                <p>Erstelle hier einen Termin; er erscheint automatisch auch im Betriebskalender.</p>
                <button className="secondary-button" type="button" onClick={() => setAppointmentEditor("new")}>
                  <Plus /> Termin erstellen
                </button>
              </div>
            )}
          </section>
          {pastAppointments.length > 0 && (
            <section className="record-card resident-appointment-card">
              <div className="record-card-heading">
                <div>
                  <span className="record-section-label">Chronik</span>
                  <h3>Frühere und abgesagte Termine</h3>
                </div>
                <span>
                  {pastAppointments.length} {pastAppointments.length === 1 ? "Eintrag" : "Einträge"}
                </span>
              </div>
              <div className="resident-appointment-list">
                {[...pastAppointments].reverse().map((item) => (
                  <button
                    type="button"
                    className="resident-appointment-row"
                    key={item.id}
                    onClick={() => setAppointmentEditor(item)}
                  >
                    <span className="resident-appointment-date">
                      <strong>{appointmentDateLabel(item.starts_at, { day: "2-digit" })}</strong>
                      <small>{appointmentDateLabel(item.starts_at, { month: "short" })}</small>
                    </span>
                    <span className="resident-appointment-details">
                      <strong>{item.title}</strong>
                      <small>
                        {item.category} · {appointmentLocalParts(item.starts_at).time}–
                        {appointmentLocalParts(item.ends_at).time}
                      </small>
                    </span>
                    <span
                      className={`status-badge ${item.status === "completed" ? "stable" : item.status === "cancelled" ? "attention" : "info"}`}
                    >
                      {item.status === "completed"
                        ? "Abgeschlossen"
                        : item.status === "cancelled"
                          ? "Abgesagt"
                          : "Vergangen"}
                    </span>
                    <ArrowRight />
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
