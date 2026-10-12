"use client";

import { useState } from "react";
import { CareDatePicker, CareSelect } from "@/app/components/care-form-controls";
import { ModuleIcon } from "@/app/components/module-icon";
import {
  EmptyState,
  LoadError,
  PageHeading,
  SummaryTiles,
  formatDate,
  formatDateTime,
  timeInZurich,
  todayInZurich,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import {
  expectedShare,
  fluidStatusLabel,
  fluidStatusTone,
  formatMl,
  type ResidentNutrition,
} from "@/lib/nutrition-shared";
import DayPanel from "./day-panel";
import { residentFluidStatus, type NutritionOverview } from "./plan-view";
import { useCareResident, useTerms } from "@/app/components/care-context";
import { ResuscitationBadge } from "@/app/components/resuscitation-badge";

const ALL_UNITS = "Gesamtes Haus";

export default function FluidsView({ showToast }: { showToast: ShowToast }) {
  const t = useTerms();
  const [date, setDate] = useState(todayInZurich);
  const [unit, setUnit] = useState(ALL_UNITS);
  const [onlyBehind, setOnlyBehind] = useState(false);
  const [selectedId, setSelectedId] = useCareResident();
  const overview = useApiData<NutritionOverview>(`/api/nutrition?date=${date}`);
  const isToday = date === todayInZurich();
  const share = isToday ? expectedShare(timeInZurich()) : 1;
  const residents = (overview.data?.residents ?? []).filter((r) => unit === ALL_UNITS || r.careUnit === unit);
  const rows = residents
    .map((r) => ({ resident: r, status: residentFluidStatus(r, share) }))
    .filter((row) => !onlyBehind || ["behind", "over_limit"].includes(row.status));
  const selected = residents.find((r) => r.id === selectedId) ?? rows[0]?.resident ?? null;
  const detail = useApiData<ResidentNutrition & { date: string }>(
    selected ? `/api/nutrition/residents/${selected.id}?date=${date}` : null,
  );
  const reload = () => {
    overview.reload();
    detail.reload();
  };

  return (
    <>
      <PageHeading
        eyebrow="Ernährung"
        title="Trinkprotokoll"
        description={
          isToday
            ? "Flüssigkeitsaufnahme im Tagesverlauf – verglichen mit dem Soll bis jetzt (07–21 Uhr)."
            : `Flüssigkeitsaufnahme am ${formatDate(date)} – verglichen mit dem Tagesziel.`
        }
      />
      <SummaryTiles
        label="Trinkstatus"
        tiles={[
          {
            icon: "nutrition",
            value: formatMl(residents.reduce((sum, r) => sum + r.fluidTotalMl, 0)),
            caption: "Gesamt dokumentiert",
          },
          { icon: "check", value: rows.filter((r) => r.status === "reached").length, caption: "Tagesziel erreicht" },
          {
            icon: "alert",
            value: residents.filter((r) => residentFluidStatus(r, share) === "behind").length,
            caption: "unter Soll",
            tone: "critical",
          },
          {
            icon: "calendar",
            value: residents.filter((r) => !r.fluidTargetMl).length,
            caption: "ohne Trinkziel",
            tone: "info",
          },
        ]}
      />
      {overview.error && <LoadError message={overview.error} onRetry={overview.reload} />}
      <div className="nutrition-fluids-layout">
        <section className="card fluids-table-card">
          <div className="fluids-table-heading nutrition-fluids-toolbar">
            <div>
              <p className="eyebrow">Tagesprotokoll</p>
              <h2 className="card-title">{isToday ? "Heute" : formatDate(date)}</h2>
            </div>
            <CareDatePicker label="Protokolldatum" value={date} onChange={setDate} />
            <CareSelect
              label="Wohnbereich"
              value={unit}
              options={[ALL_UNITS, ...(overview.data?.careUnits ?? []).map((u) => u.name)]}
              onChange={setUnit}
            />
            <label className="form-checkbox">
              <input type="checkbox" checked={onlyBehind} onChange={(e) => setOnlyBehind(e.target.checked)} />
              Nur unter Soll
            </label>
          </div>
          <div className="fluids-table">
            <div className="fluids-table-head">
              <span>{t.one}</span>
              <span>Aufgenommen</span>
              <span>Fortschritt</span>
              <span>Letzter Eintrag</span>
              <span />
            </div>
            {rows.map(({ resident, status }) => {
              const percent = resident.fluidTargetMl
                ? Math.round((resident.fluidTotalMl / resident.fluidTargetMl) * 100)
                : null;
              return (
                <button
                  className={selected?.id === resident.id ? "selected" : ""}
                  type="button"
                  key={resident.id}
                  onClick={() => setSelectedId(resident.id)}
                >
                  <span className="fluids-resident">
                    <span className="resident-avatar">{resident.initials}</span>
                    <span>
                      <strong>
                        {resident.name} <ResuscitationBadge residentId={resident.id} />
                      </strong>
                      <small>{[resident.room, resident.careUnit].filter(Boolean).join(" · ")}</small>
                      {resident.trends.length > 0 && (
                        <small className="status-text critical" title={resident.trends.map((t) => t.text).join("\n")}>
                          Trendhinweis
                        </small>
                      )}
                    </span>
                  </span>
                  <span>
                    <strong>{formatMl(resident.fluidTotalMl)}</strong>
                    <small>
                      {resident.fluidTargetMl ? `von ${formatMl(resident.fluidTargetMl)}` : "kein Trinkziel"}
                    </small>
                  </span>
                  <span className="fluids-progress">
                    <i>
                      <em style={{ width: `${Math.min(percent ?? 0, 100)}%` }} />
                    </i>
                    <b>{percent === null ? "–" : `${percent} %`}</b>
                  </span>
                  <span>
                    <strong>
                      {resident.lastFluidAt ? formatDateTime(resident.lastFluidAt).replace(/^.*, /, "") : "–"}
                    </strong>
                    <small className={`status-text ${fluidStatusTone[status]}`}>{fluidStatusLabel[status]}</small>
                  </span>
                  <ModuleIcon name="chevron" />
                </button>
              );
            })}
            {!overview.loading && !rows.length && (
              <EmptyState
                icon="nutrition"
                title={`Keine ${t.many}`}
                text={onlyBehind ? "Alle liegen im Soll." : "Filter anpassen."}
              />
            )}
            {overview.loading && !overview.data && <p className="list-hint">Trinkprotokoll wird geladen …</p>}
          </div>
        </section>
        <aside className="fluids-detail">
          {selected && detail.data && (
            <>
              <section className="card nutrition-selected">
                <span className="resident-avatar">{selected.initials}</span>
                <span>
                  <strong>
                    {selected.name} <ResuscitationBadge residentId={selected.id} />
                  </strong>
                  <small>
                    {detail.data.plan
                      ? [detail.data.plan.diet, detail.data.plan.texture, detail.data.plan.assistance]
                          .filter(Boolean)
                          .join(" · ")
                      : "Kein Ernährungsplan"}
                  </small>
                </span>
              </section>
              <DayPanel
                resident={selected}
                data={detail.data}
                date={date}
                canWrite={overview.data?.canWrite ?? false}
                showToast={showToast}
                onChanged={reload}
              />
            </>
          )}
          {selected && detail.error && <LoadError message={detail.error} onRetry={detail.reload} />}
          {selected && detail.loading && !detail.data && <p className="list-hint">Tagesverlauf wird geladen …</p>}
        </aside>
      </div>
    </>
  );
}
