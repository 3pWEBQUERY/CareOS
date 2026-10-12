"use client";

import { useTerms } from "@/app/components/care-context";
import { CalendarDots, CaretLeft, CaretRight, MapPin, Plus } from "@phosphor-icons/react";
import { appointmentLocalParts, appointmentTargetLabel } from "@/lib/resident-appointments";
import { weekDayNames, dateHeading, TimedCalendarGrid } from "./calendar-grid";
import type { ResidentCalendarState } from "./use-resident-calendar";

export function CalendarBoard({ r }: { r: ResidentCalendarState }) {
  const t = useTerms();
  const {
    today,
    focusDate,
    setFocusDate,
    view,
    setView,
    setEditor,
    loading,
    error,
    setRevision,
    weekScrollRef,
    days,
    visible,
    toolbarTitle,
    move,
    create,
  } = r;
  return (
    <section className="card resident-calendar-board" aria-label={`${t.prefix}kalender`}>
      <div className="resident-calendar-toolbar">
        <div className="resident-calendar-navigation">
          <button className="secondary-button" type="button" onClick={() => setFocusDate(today)}>
            Heute
          </button>
          <button type="button" aria-label="Vorheriger Zeitraum" onClick={() => move(-1)}>
            <CaretLeft />
          </button>
          <button type="button" aria-label="Nächster Zeitraum" onClick={() => move(1)}>
            <CaretRight />
          </button>
          <strong>{toolbarTitle}</strong>
        </div>
        <div className="resident-calendar-view-switch" role="group" aria-label="Kalenderansicht">
          <button
            type="button"
            className={view === "day" ? "active" : ""}
            aria-pressed={view === "day"}
            onClick={() => setView("day")}
          >
            Tag
          </button>
          <button
            type="button"
            className={view === "week" ? "active" : ""}
            aria-pressed={view === "week"}
            onClick={() => setView("week")}
          >
            Woche
          </button>
          <button
            type="button"
            className={view === "month" ? "active" : ""}
            aria-pressed={view === "month"}
            onClick={() => setView("month")}
          >
            Monat
          </button>
        </div>
      </div>
      {error && (
        <div className="resident-calendar-error" role="alert">
          {error}
          <button type="button" onClick={() => setRevision((current) => current + 1)}>
            Erneut laden
          </button>
        </div>
      )}
      {loading && (
        <div className="resident-calendar-loading" role="status">
          Termine werden geladen…
        </div>
      )}
      {view === "month" ? (
        <div className="resident-calendar-month-scroll">
          <div className="resident-calendar-month-grid">
            {weekDayNames.map((name) => (
              <span className="resident-calendar-weekday" key={name}>
                {name}
              </span>
            ))}
            {days.map((date) => {
              const entries = visible.filter((item) => appointmentLocalParts(item.starts_at).date === date);
              return (
                <div
                  className={`resident-calendar-month-day ${date.slice(0, 7) !== focusDate.slice(0, 7) ? "outside" : ""} ${date === focusDate ? "selected" : ""}`}
                  key={date}
                >
                  <div className="resident-calendar-month-day-head">
                    <button
                      type="button"
                      className={date === today ? "today" : ""}
                      onClick={() => setFocusDate(date)}
                      aria-label={dateHeading(date, { day: "numeric", month: "long" })}
                    >
                      {Number(date.slice(-2))}
                    </button>
                    <button
                      type="button"
                      aria-label={`Termin am ${dateHeading(date, { day: "numeric", month: "long" })} erstellen`}
                      onClick={() => create(date)}
                    >
                      <Plus />
                    </button>
                  </div>
                  <div className="resident-calendar-month-events">
                    {entries.slice(0, 3).map((item) => (
                      <button
                        className={`resident-calendar-event ${item.kind === "care_unit_task" ? "care-unit-task" : ""} ${item.category === "Arzttermin" ? "medical" : ""} ${item.status}`}
                        type="button"
                        key={item.id}
                        onClick={() => setEditor({ appointment: item })}
                      >
                        <small>{appointmentLocalParts(item.starts_at).time}</small>
                        <span>
                          {item.title} · {appointmentTargetLabel(item)}
                        </span>
                      </button>
                    ))}
                    {entries.length > 3 && (
                      <button type="button" className="resident-calendar-more" onClick={() => setFocusDate(date)}>
                        + {entries.length - 3} weitere
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <TimedCalendarGrid
          days={days}
          today={today}
          view={view}
          appointments={visible}
          scrollRef={weekScrollRef}
          onCreate={create}
          onSelectDate={setFocusDate}
          onOpen={(item) => setEditor({ appointment: item })}
        />
      )}
      {!loading && !error && visible.length === 0 && (
        <div className="resident-calendar-empty">
          <CalendarDots />
          <strong>Keine Einträge in dieser Ansicht</strong>
          <p>Wähle einen anderen Zeitraum oder erfasse einen {t.prefix}termin oder eine Wohnbereichsaufgabe.</p>
          <button className="secondary-button" type="button" onClick={() => create()}>
            <Plus /> Termin erstellen
          </button>
        </div>
      )}
      <div className="resident-calendar-board-foot">
        <span>
          <i className="medical" /> Arzttermin
        </span>
        <span>
          <i /> Weitere Termine
        </span>
        <span>
          <i className="care-unit-task" /> Wohnbereichsaufgabe
        </span>
        <span>
          <i className="completed" /> Abgeschlossen
        </span>
        <span>
          <i className="cancelled" /> Abgesagt
        </span>
        <span className="resident-calendar-board-help">
          <MapPin /> Alle Wohnbereiche
        </span>
      </div>
    </section>
  );
}
