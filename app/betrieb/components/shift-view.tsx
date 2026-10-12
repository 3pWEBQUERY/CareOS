"use client";

import { useTerms } from "@/app/components/care-context";
import Link from "next/link";
import { ModuleIcon } from "@/app/components/module-icon";
import { LoadError, useApiData, type ShowToast } from "@/app/components/workspace-ui";
import { type ShiftOverview } from "@/lib/shift-shared";
import { ScheduleSelect, Summary, formatScheduleDate } from "./operations-ui";
import { useTaskToggle } from "./task-parts";
import { clock, zurichDay, longDate, ALL_UNITS, kindIcon } from "./shift-utils";

export function ShiftView({
  showToast,
  overview,
  reload,
  unitParam,
  setUnitParam,
  fullDay,
  setFullDay,
  onCreateTask,
}: {
  showToast: ShowToast;
  overview: ReturnType<typeof useApiData<ShiftOverview>>;
  reload: () => void;
  unitParam: string;
  setUnitParam: (value: string) => void;
  fullDay: boolean;
  setFullDay: (value: boolean) => void;
  onCreateTask: () => void;
}) {
  const t = useTerms();
  const data = overview.data;
  const { toggle, dialog } = useTaskToggle(showToast, reload);
  const current = data?.current ?? null;
  const next = data?.next ?? null;
  const windowDay = data ? zurichDay(data.window.from) : "";
  return (
    <>
      <Summary
        items={[
          {
            icon: "calendar",
            value: current ? `${clock(current.startsAt)}–${clock(current.endsAt)}` : "–",
            label: current
              ? `${current.name}${current.checkedInAt ? " · eingecheckt" : " · geplant"}`
              : next
                ? `Nächster Dienst: ${next.name} ${formatScheduleDate(zurichDay(next.startsAt))}`
                : "Kein Dienst geplant",
          },
          {
            icon: "residents",
            value: String(data?.stats.residents ?? "–"),
            label: `${t.many} · ${data?.careUnit.name ?? ""}`,
          },
          {
            icon: "tasks",
            value: String(data?.stats.tasks ?? "–"),
            label: current && !fullDay ? "Aufgaben im Dienst" : "Aufgaben heute",
            tone: "attention",
          },
          {
            icon: "check",
            value: data ? `${data.stats.done}/${data.stats.total}` : "–",
            label: "Dienstfortschritt",
            tone: "info",
          },
        ]}
      />
      {overview.error && <LoadError message={overview.error} onRetry={reload} />}
      <div className="operations-grid">
        <section className="card operations-timeline">
          <div className="card-header">
            <div>
              <p className="eyebrow">{data ? longDate(data.window.from) : "Wird geladen …"}</p>
              <h2 className="card-title">{current ? "Dein heutiger Dienst" : "Dein Tag"}</h2>
              <p className="card-subtitle">
                {data?.careUnit.name}
                {data ? ` · ${data.window.label}` : ""}
                {current?.checkedInAt ? ` · eingecheckt ${clock(current.checkedInAt)} Uhr` : ""}
              </p>
            </div>
            <div className="shift-timeline-controls">
              <ScheduleSelect
                label="Wohnbereich"
                value={
                  unitParam === "all"
                    ? ALL_UNITS
                    : (data?.careUnits.find((unit) => unit.id === (unitParam || data?.careUnit.id))?.name ?? ALL_UNITS)
                }
                options={[...(data?.careUnits ?? []).map((unit) => unit.name), ALL_UNITS]}
                onChange={(name) => setUnitParam(data?.careUnits.find((unit) => unit.name === name)?.id ?? "all")}
              />
              {current && (
                <button className="secondary-button" type="button" onClick={() => setFullDay(!fullDay)}>
                  {fullDay ? "Nur mein Dienst" : "Ganzer Tag"}
                </button>
              )}
            </div>
          </div>
          <div>
            {(data?.timeline ?? []).map((item) => (
              <article
                className={`operations-timeline-row ${item.done ? "complete" : ""} ${item.overdue ? "overdue" : ""}`}
                key={item.id}
              >
                <time>
                  {clock(item.at)}
                  {zurichDay(item.at) !== windowDay && (
                    <small>{formatScheduleDate(zurichDay(item.at)).slice(0, 6)}</small>
                  )}
                </time>
                <span
                  className={`operations-timeline-icon ${item.done ? "stable" : item.overdue ? "critical" : item.tone}`}
                >
                  <ModuleIcon name={kindIcon[item.kind]} />
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <small>
                    {item.detail}
                    {item.overdue ? " · überfällig" : ""}
                  </small>
                </div>
                {item.kind === "task" && item.taskId ? (
                  <button
                    type="button"
                    aria-label={`${item.title} ${item.done ? "wieder öffnen" : "erledigt markieren"}`}
                    onClick={() =>
                      void toggle({
                        id: item.taskId!,
                        title: item.title,
                        done: item.done,
                        residentName: item.detail.split(" · ")[0] || null,
                        documentOnCompletion: Boolean(item.documentOnCompletion),
                      })
                    }
                  >
                    <ModuleIcon name={item.done ? "check" : "plus"} />
                  </button>
                ) : (
                  <Link href={item.href} aria-label={`${item.title} öffnen`} title="Öffnen">
                    <ModuleIcon name={item.done ? "check" : "chevron"} />
                  </Link>
                )}
              </article>
            ))}
            {data && !data.timeline.length && (
              <div className="resident-empty">
                <ModuleIcon name="check" />
                <strong>Nichts geplant</strong>
                <p>In diesem Zeitraum sind keine Aufgaben, Runden, Wundversorgungen oder Termine fällig.</p>
              </div>
            )}
            {!data && overview.loading && <p className="list-hint">Dienst wird geladen …</p>}
          </div>
        </section>
        <aside className="operations-sidebar">
          <section className="card">
            <div className="card-header">
              <div>
                <p className="eyebrow">Aktuell wichtig</p>
                <h2 className="card-title">Hinweise für dich</h2>
              </div>
            </div>
            <div className="operations-note-list">
              {(data?.hints ?? []).map((hint) => (
                <Link className={`operations-hint ${hint.tone}`} href={hint.href} key={hint.id}>
                  <ModuleIcon
                    name={
                      hint.tone === "critical"
                        ? "alert"
                        : hint.id.startsWith("order")
                          ? "med"
                          : hint.id.startsWith("note")
                            ? "handover"
                            : "note"
                    }
                  />
                  <span>
                    <strong>{hint.title}</strong>
                    <small>{hint.text}</small>
                  </span>
                </Link>
              ))}
              {data && !data.hints.length && (
                <p className="stable">
                  <ModuleIcon name="check" />
                  <span>
                    <strong>Keine offenen Hinweise</strong>
                    <small>Übergabe gelesen, keine kritischen Werte oder Änderungen.</small>
                  </span>
                </p>
              )}
            </div>
          </section>
          <section className="card operations-quick">
            <div className="card-header">
              <div>
                <p className="eyebrow">Direktzugriff</p>
                <h2 className="card-title">Schnellaktionen</h2>
              </div>
            </div>
            <div>
              <Link href="/pflegedokumentation">
                <ModuleIcon name="note" />
                <span>Dokumentieren</span>
              </Link>
              <Link href="/vitalwerte">
                <ModuleIcon name="vitals" />
                <span>Vitalwerte</span>
              </Link>
              <button type="button" onClick={onCreateTask}>
                <ModuleIcon name="tasks" />
                <span>Aufgabe erstellen</span>
              </button>
              <Link href="/betrieb/uebergabe">
                <ModuleIcon name="handover" />
                <span>Übergabe{data?.unreadHandover ? ` (${data.unreadHandover})` : ""}</span>
              </Link>
            </div>
          </section>
        </aside>
      </div>
      {dialog}
    </>
  );
}
