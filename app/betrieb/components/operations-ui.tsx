"use client";

import { useTerms } from "@/app/components/care-context";
import { useEffect, useRef, useState } from "react";
import ModulePageShell from "@/app/components/module-page-shell";
import { type ModuleIconName } from "@/app/components/module-icon";
import { ModuleIcon } from "@/app/components/module-icon";
import { todayInZurich, useApiData, type ShowToast } from "@/app/components/workspace-ui";
import type { ShiftPulse } from "@/lib/shift-shared";

// Controls and layout parts shared by the Betrieb workspaces (shift, tasks, schedule).

export type Tone = "stable" | "attention" | "critical" | "info";

// Fired after check-in/out or task changes so the pulse and lists reload.
export const OPERATIONS_CHANGED = "carecore:operations-changed";
export const notifyOperationsChanged = () => window.dispatchEvent(new Event(OPERATIONS_CHANGED));

export function ScheduleSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);
  const toggle = () =>
    setOpen((current) => {
      if (!current) {
        const rect = rootRef.current?.getBoundingClientRect();
        const menuHeight = Math.min(options.length * 42 + 16, 300);
        setOpenUp(Boolean(rect && window.innerHeight - rect.bottom < menuHeight && rect.top > menuHeight));
      } else setOpenUp(false);
      return !current;
    });
  return (
    <div className="area-custom-select" ref={rootRef}>
      <button
        className="area-select-trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={toggle}
      >
        <span>{value}</span>
        <ModuleIcon name="caretDown" className={open ? "open" : ""} />
      </button>
      {open && (
        <div className={`area-select-menu ${openUp ? "up" : ""}`} role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={value === option}
              className={value === option ? "selected" : ""}
              key={option}
              onClick={() => {
                onChange(option);
                setOpen(false);
                setOpenUp(false);
              }}
            >
              {option}
              <ModuleIcon name="check" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function formatScheduleDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function ScheduleDatePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => new Date(`${value}T12:00:00`));
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);
  const firstDay = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const offset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  const calendarDays: Array<number | null> = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  const monthLabel = viewMonth.toLocaleDateString("de-CH", { month: "long", year: "numeric" });
  const toggle = () =>
    setOpen((current) => {
      if (!current) {
        const rect = rootRef.current?.getBoundingClientRect();
        setOpenUp(Boolean(rect && window.innerHeight - rect.bottom < 350 && rect.top > 350));
      } else setOpenUp(false);
      return !current;
    });
  const selectDay = (day: number) => {
    const next = `${viewMonth.getFullYear()}-${String(viewMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    onChange(next);
    setOpen(false);
    setOpenUp(false);
  };
  return (
    <div className="schedule-date-picker" ref={rootRef}>
      <button
        className="schedule-date-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        onClick={toggle}
      >
        <span>{formatScheduleDate(value)}</span>
        <ModuleIcon name="calendar" />
      </button>
      {open && (
        <div className={`schedule-date-menu ${openUp ? "up" : ""}`} role="dialog" aria-label={`${label} auswählen`}>
          <div className="schedule-date-menu-header">
            <button
              type="button"
              aria-label="Vorheriger Monat"
              onClick={() => setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
            >
              <ModuleIcon name="chevron" className="previous" />
            </button>
            <strong>{monthLabel}</strong>
            <button
              type="button"
              aria-label="Nächster Monat"
              onClick={() => setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
            >
              <ModuleIcon name="chevron" />
            </button>
          </div>
          <div className="schedule-date-weekdays">
            {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="schedule-date-grid">
            {calendarDays.map((day, index) =>
              day ? (
                <button
                  type="button"
                  key={day}
                  className={
                    value ===
                    `${viewMonth.getFullYear()}-${String(viewMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
                      ? "selected"
                      : ""
                  }
                  onClick={() => selectDay(day)}
                >
                  {day}
                </button>
              ) : (
                <span aria-hidden="true" key={`empty-${index}`} />
              ),
            )}
          </div>
          <div className="schedule-date-menu-footer">
            <span>{formatScheduleDate(value)}</span>
            <button
              type="button"
              onClick={() => {
                setViewMonth(new Date(`${todayInZurich()}T12:00:00`));
                onChange(todayInZurich());
                setOpen(false);
              }}
            >
              Heute
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Summary({
  items,
}: {
  items: Array<{ icon: ModuleIconName; value: string; label: string; tone?: Tone }>;
}) {
  return (
    <section className="wound-summary operations-summary" aria-label="Zusammenfassung">
      {items.map((item) => (
        <div key={item.label}>
          <span
            className={`summary-icon ${item.tone === "attention" ? "attention" : item.tone === "critical" ? "critical" : item.tone === "info" ? "info" : ""}`}
          >
            <ModuleIcon name={item.icon} />
          </span>
          <span>
            <strong>{item.value}</strong>
            <small>{item.label}</small>
          </span>
        </div>
      ))}
    </section>
  );
}
export function OperationsPulse({ showToast }: { showToast: ShowToast }) {
  const t = useTerms();
  const pulse = useApiData<ShiftPulse>("/api/shift/pulse");
  const { reload } = pulse;
  useEffect(() => {
    const timer = window.setInterval(reload, 60_000);
    window.addEventListener(OPERATIONS_CHANGED, reload);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(OPERATIONS_CHANGED, reload);
    };
  }, [reload]);
  const data = pulse.data;
  return (
    <section className="operations-pulse" aria-label="Operativer Puls">
      <div className="operations-pulse-intro">
        <span className="operations-live-dot" />
        <div>
          <p className="eyebrow">Operativer Puls</p>
          <strong>{data?.label ?? "Wird geladen …"}</strong>
          <small>{data?.detail ?? "Live-Überblick für deinen Arbeitsbereich"}</small>
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          reload();
          showToast("Überblick aktualisiert");
        }}
        aria-label="Überblick aktualisieren"
      >
        <span>
          <strong>{data?.residents ?? "–"}</strong>
          <small>{t.many}</small>
        </span>
        <span>
          <strong>{data?.openTasks ?? "–"}</strong>
          <small>Aufgaben offen</small>
        </span>
        <span>
          <strong>
            {data ? (data.staffPlanned ? `${data.staffPresent}/${data.staffPlanned}` : data.staffPresent) : "–"}
          </strong>
          <small>im Dienst</small>
        </span>
        <ModuleIcon name="chevron" className="chevron" />
      </button>
    </section>
  );
}

// Page frame of the Betrieb workspaces: module shell, heading with primary action and the pulse.
export function OperationsFrame({
  module,
  child,
  view,
  eyebrow,
  title,
  description,
  action,
  children,
}: {
  module: string;
  child: string;
  view: string;
  eyebrow: string;
  title: string;
  description: string;
  action?: { label: string; icon?: ModuleIconName; onClick: (showToast: ShowToast) => void } | null;
  children: (showToast: ShowToast) => React.ReactNode;
}) {
  return (
    <ModulePageShell
      activeModule={module}
      activeChild={child}
      pageClass={`operations-page operations-${view}`}
      locationSecondary="Gesamtes Haus · alle Wohnbereiche"
    >
      {(showToast) => (
        <main className="workspace module-workspace operations-command-workspace">
          <section className="page-heading care-page-heading" aria-labelledby="operations-title">
            <div className="heading-copy">
              <p className="eyebrow">{eyebrow}</p>
              <h1 id="operations-title">{title}</h1>
              <p>{description}</p>
            </div>
            {action && (
              <button className="primary-button" type="button" onClick={() => action.onClick(showToast)}>
                <ModuleIcon name={action.icon ?? "plus"} className="button-icon" />
                {action.label}
              </button>
            )}
          </section>
          <OperationsPulse showToast={showToast} />
          {children(showToast)}
        </main>
      )}
    </ModulePageShell>
  );
}
