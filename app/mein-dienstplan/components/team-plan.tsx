"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CaretLeft, CaretRight, MagnifyingGlass, Printer, Warning } from "@phosphor-icons/react";
import ModulePageShell from "@/app/components/module-page-shell";
import { useRosterData } from "@/app/dienstplan/components/roster-api";
import { RosterGrid } from "@/app/dienstplan/components/roster-grid";
import { ShiftDetail } from "@/app/dienstplan/components/shift-detail";
import { addDays, monthLabel, shiftMonth, weekStart } from "@/lib/roster/time";
import type { GridShift, SchedulePayload } from "@/lib/roster/view-types";
import { CareOptionSelect } from "@/app/components/care-form-controls";

const zurichMonth = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date()).slice(0, 7);
const noop = () => undefined;

// Teamplan (Spec 8.5): veröffentlichter Plan der Wohngruppe, nur lesend. Abwesenheiten anderer
// Personen erscheinen als „Abwesend“ ohne Grund.
export default function TeamPlan() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get("monat") ?? "") ? params.get("monat")! : zurichMonth();
  const view = params.get("ansicht") === "monat" ? "monat" : "woche";
  const unitParam = params.get("einheit");
  const { data, error, loading, reload } = useRosterData<SchedulePayload>(
    `/api/dienstplan/schedule?ansicht=team&monat=${month}${unitParam ? `&einheit=${unitParam}` : ""}`,
    (loaded) =>
      `/api/dienstplan/changes?einheit=${loaded.unit.id}&monat=${loaded.year}-${String(loaded.month).padStart(2, "0")}`,
  );
  const [open, setOpen] = useState<GridShift | null>(null);
  const [query, setQuery] = useState("");

  const navigate = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    router.replace(`${pathname}?${next}`, { scroll: false });
  };
  const [year, monthNumber] = month.split("-").map(Number);
  const days = useMemo(() => {
    if (!data) return [];
    if (view === "monat") return data.days;
    const start = params.get("woche") ?? weekStart(data.days.find((d) => d.today)?.date ?? data.days[0].date);
    const inWeek = new Set(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
    const week = data.days.filter((day) => inWeek.has(day.date));
    return week.length ? week : data.days.slice(0, 7);
  }, [data, view, params]);
  const goMonth = (delta: number) => {
    const next = shiftMonth(year, monthNumber, delta);
    navigate({ monat: `${next.year}-${String(next.month).padStart(2, "0")}`, woche: null });
  };
  const goWeek = (delta: number) => {
    if (!days[0]) return;
    const start = addDays(weekStart(days[0].date), delta * 7);
    navigate({ woche: start, monat: start.slice(0, 7) });
  };
  const employees = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("de-CH");
    return (data?.employees ?? []).filter((e) => !q || e.name.toLocaleLowerCase("de-CH").includes(q));
  }, [data, query]);
  const memberUnits = data?.units ?? [];
  const published = data?.period?.status === "PUBLISHED";

  return (
    <ModulePageShell pageClass="roster-page">
      {() =>
        error && !data ? (
          <main className="workspace roster-workspace">
            <section className="critical-alert" role="alert">
              <span className="critical-symbol">
                <Warning />
              </span>
              <div>
                <strong>Teamplan konnte nicht geladen werden</strong>
                <p>{error.message}</p>
              </div>
              <button className="secondary-button" type="button" onClick={reload}>
                Erneut laden
              </button>
            </section>
          </main>
        ) : (
          <main className="workspace roster-workspace">
            <header className="page-heading roster-heading">
              <div className="heading-copy">
                <p className="eyebrow">Mein Dienst · Dienstplan</p>
                <h1>Teamplan {data?.unit.name ?? ""}</h1>
                <p>Wer arbeitet wann? Veröffentlichte Dienste der Wohngruppe, Abwesenheiten ohne Grund.</p>
              </div>
              {data && published && (
                <div className="roster-heading-actions">
                  <a
                    className="secondary-button"
                    href={`/c/mein-dienstplan/team/drucken?monat=${month}&einheit=${data.unit.id}`}
                    target="_blank"
                    rel="noopener"
                  >
                    <Printer className="button-icon" /> Drucken / PDF
                  </a>
                </div>
              )}
            </header>
            <section className="roster-toolbar" aria-label="Zeitraum">
              <div className="roster-nav">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={view === "woche" ? "Vorherige Woche" : "Vorheriger Monat"}
                  onClick={() => (view === "woche" ? goWeek(-1) : goMonth(-1))}
                >
                  <CaretLeft />
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => navigate({ monat: zurichMonth(), woche: null })}
                >
                  Heute
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={view === "woche" ? "Nächste Woche" : "Nächster Monat"}
                  onClick={() => (view === "woche" ? goWeek(1) : goMonth(1))}
                >
                  <CaretRight />
                </button>
                <strong className="roster-title">{monthLabel(year, monthNumber)}</strong>
              </div>
              <div className="roster-filters">
                <div className="schedule-view-switch" role="group" aria-label="Ansicht">
                  <button
                    type="button"
                    className={view === "woche" ? "active" : ""}
                    onClick={() => navigate({ ansicht: null })}
                  >
                    Woche
                  </button>
                  <button
                    type="button"
                    className={view === "monat" ? "active" : ""}
                    onClick={() => navigate({ ansicht: "monat", woche: null })}
                  >
                    Monat
                  </button>
                </div>
                {memberUnits.length > 1 && data && (
                  <CareOptionSelect
                    label="Wohnbereich"
                    value={data.unit.id}
                    onChange={(value) => navigate({ einheit: value })}
                    options={[...memberUnits.map((unit) => ({ value: String(unit.id), label: String(unit.name) }))]}
                  />
                )}
                <label className="roster-search">
                  <MagnifyingGlass aria-hidden="true" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Person suchen"
                    aria-label="Person suchen"
                  />
                </label>
              </div>
            </section>
            <section className="card roster-card" aria-busy={loading}>
              {!data ? (
                <div className="roster-skeleton" aria-label="Teamplan wird geladen">
                  {Array.from({ length: 8 }, (_, i) => (
                    <span key={i} />
                  ))}
                </div>
              ) : !published ? (
                <div className="roster-empty">
                  <strong>Für {monthLabel(year, monthNumber)} ist noch kein Plan veröffentlicht</strong>
                  <p>Sobald die Leitung den Monat veröffentlicht, erscheint er hier.</p>
                </div>
              ) : (
                <>
                  <RosterGrid
                    data={data}
                    days={days}
                    employees={employees}
                    shifts={data.shifts}
                    highlightShiftIds={null}
                    onCreate={noop}
                    onOpen={setOpen}
                    onDrop={noop}
                  />
                  <p className="roster-legend">
                    Tastatur: Pfeiltasten, Enter öffnet.
                    {data.shiftTypes.map((type) => (
                      <span key={type.id}>
                        <i style={{ background: type.color }} /> {type.code} {type.name}
                      </span>
                    ))}
                  </p>
                </>
              )}
            </section>
            {data && open && (
              <ShiftDetail
                data={data}
                shift={open}
                onClose={() => setOpen(null)}
                onEdit={noop}
                onMove={noop}
                onDelete={noop}
              />
            )}
          </main>
        )
      }
    </ModulePageShell>
  );
}
