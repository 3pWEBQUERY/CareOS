"use client";

import { useTerms } from "@/app/components/care-context";
import { useState } from "react";
import { ModuleIcon } from "@/app/components/module-icon";
import {
  ReasonDialog,
  formatDate,
  formatDateTime,
  requestJson,
  timeInZurich,
  todayInZurich,
  type ShowToast,
} from "@/app/components/workspace-ui";
import {
  MEALS,
  expectedShare,
  fluidStatus,
  fluidStatusLabel,
  fluidStatusTone,
  formatMl,
  type FluidEntry,
  type MealEntry,
  type ResidentNutrition,
} from "@/lib/nutrition-shared";
import { FluidDialog, MealDialog } from "./nutrition-dialogs";
import { useActionRequest } from "@/app/components/actions";
import { sendOrQueue } from "@/app/components/offline-queue";

const QUICK_AMOUNTS = [100, 150, 200, 250];

export default function DayPanel({
  resident,
  data,
  date,
  canWrite,
  showToast,
  onChanged,
}: {
  resident: { id: string; name: string };
  data: ResidentNutrition;
  date: string;
  canWrite: boolean;
  showToast: ShowToast;
  onChanged: () => void;
}) {
  const t = useTerms();
  const [dialog, setDialog] = useState<{ kind: "fluid" } | { kind: "meal"; meal?: string } | null>(null);
  useActionRequest("fluid", () => setDialog({ kind: "fluid" }), canWrite);
  const [hiding, setHiding] = useState<
    { kind: "fluid"; entry: FluidEntry } | { kind: "meal"; entry: MealEntry } | null
  >(null);
  const [busy, setBusy] = useState(false);
  const isToday = date === todayInZurich();
  const total = data.fluids.reduce((sum, entry) => sum + entry.amountMl, 0);
  const target = data.plan?.fluidTargetMl ?? null;
  const limit = data.plan?.fluidLimitMl ?? null;
  const status =
    data.fluids.length || target
      ? fluidStatus(total, target, limit, isToday ? expectedShare(timeInZurich()) : 1)
      : "none";
  const percent = target ? Math.round((total / target) * 100) : null;
  const weekMax = Math.max(target ?? 0, limit ?? 0, ...data.week.map((d) => d.totalMl), 1);
  const done = (message: string) => {
    setDialog(null);
    setHiding(null);
    showToast(message);
    onChanged();
  };
  const quickAdd = async (amountMl: number) => {
    setBusy(true);
    try {
      const result = await sendOrQueue(
        "/api/nutrition/fluids",
        { residentId: resident.id, amountMl, beverage: "Wasser", consumedAt: new Date().toISOString() },
        `Trinkmenge ${amountMl} ml · ${resident.name}`,
      );
      done(
        `${resident.name}: ${amountMl} ml Wasser erfasst${result.queued ? " (offline – wird gesendet, sobald die Verbindung zurück ist)" : ""}`,
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {data.trends.length > 0 && (
        <section className="card nutrition-trends" role="status" aria-label="Trendhinweise Ernährung">
          <ModuleIcon name="alert" />
          <div>
            <p className="eyebrow">Trendhinweis</p>
            <ul>
              {data.trends.map((trend) => (
                <li key={trend.kind}>{trend.text}</li>
              ))}
            </ul>
          </div>
        </section>
      )}
      <section className="card nutrition-day">
        <div className="card-header">
          <div>
            <p className="eyebrow">{isToday ? "Heute" : formatDate(date)}</p>
            <h2 className="card-title">Flüssigkeit</h2>
            <p className="card-subtitle">
              {target ? `Trinkziel ${formatMl(target)}` : "Kein Trinkziel festgelegt"}
              {limit ? ` · Begrenzung ${formatMl(limit)}` : ""}
            </p>
          </div>
          <span className={`status-badge ${fluidStatusTone[status]}`}>{fluidStatusLabel[status]}</span>
        </div>
        <div className="nutrition-fluid-total">
          <strong>{formatMl(total)}</strong>
          {percent !== null && <small>{percent} % des Tagesziels</small>}
          <span className="nutrition-bar">
            <i className={status === "over_limit" ? "over" : ""} style={{ width: `${Math.min(percent ?? 0, 100)}%` }} />
            {isToday && target && (
              <b style={{ left: `${Math.round(expectedShare(timeInZurich()) * 100)}%` }} title="Soll bis jetzt" />
            )}
          </span>
        </div>
        {canWrite && isToday && (
          <div className="nutrition-quick" role="group" aria-label="Trinkmenge schnell erfassen">
            {QUICK_AMOUNTS.map((amount) => (
              <button key={amount} type="button" disabled={busy} onClick={() => void quickAdd(amount)}>
                +{amount} ml
              </button>
            ))}
            <button type="button" className="more" onClick={() => setDialog({ kind: "fluid" })}>
              <ModuleIcon name="plus" /> Andere Menge
            </button>
          </div>
        )}
        <ul className="nutrition-entries">
          {data.fluids.map((entry) => (
            <li key={entry.id}>
              <time>{formatDateTime(entry.consumedAt).replace(/^.*, /, "")}</time>
              <span>
                <strong>
                  {formatMl(entry.amountMl)} {entry.beverage ?? ""}
                </strong>
                <small>
                  {entry.enteredBy ?? "unbekannt"}
                  {entry.note ? ` · ${entry.note}` : ""}
                </small>
              </span>
              {canWrite && (
                <button type="button" className="quiet-button" onClick={() => setHiding({ kind: "fluid", entry })}>
                  Korrigieren
                </button>
              )}
            </li>
          ))}
          {!data.fluids.length && <li className="list-hint">Keine Trinkeinträge an diesem Tag.</li>}
        </ul>
        <div className="nutrition-week" aria-label="Trinkmenge der letzten 7 Tage">
          {data.week.map((day) => (
            <span key={day.date} title={`${formatDate(day.date)}: ${formatMl(day.totalMl)}`}>
              <i
                className={limit && day.totalMl > limit ? "over" : target && day.totalMl >= target ? "reached" : ""}
                style={{ height: `${Math.round((day.totalMl / weekMax) * 100)}%` }}
              />
              <small>{new Date(`${day.date}T12:00:00`).toLocaleDateString("de-CH", { weekday: "short" })}</small>
            </span>
          ))}
        </div>
      </section>

      <section className="card nutrition-day">
        <div className="card-header">
          <div>
            <p className="eyebrow">{isToday ? "Heute" : formatDate(date)}</p>
            <h2 className="card-title">Mahlzeiten</h2>
          </div>
          {data.weight && (
            <span className="nutrition-weight">
              {data.weight.latestKg.toLocaleString("de-DE", { maximumFractionDigits: 1 })} kg
              {data.weight.changeKg30d !== null && (
                <em className={data.weight.changeKg30d <= -2 ? "loss" : ""}>
                  {data.weight.changeKg30d > 0 ? "+" : ""}
                  {data.weight.changeKg30d.toLocaleString("de-DE", { maximumFractionDigits: 1 })} kg / 30 T
                </em>
              )}
            </span>
          )}
        </div>
        <div className="nutrition-meals">
          {MEALS.map((meal) => {
            const entries = data.meals.filter((entry) => entry.meal === meal);
            const last = entries.at(-1);
            return (
              <div key={meal} className={last ? `logged p${last.portionPercent}` : ""}>
                <span>
                  <strong>{meal}</strong>
                  <small>
                    {last
                      ? `${last.portionPercent === 0 ? "Nichts" : `${last.portionPercent} %`} · ${last.enteredBy ?? "unbekannt"}${last.note ? ` · ${last.note}` : ""}`
                      : "Nicht dokumentiert"}
                  </small>
                </span>
                {canWrite && last && (
                  <button
                    type="button"
                    className="quiet-button"
                    onClick={() => setHiding({ kind: "meal", entry: last })}
                  >
                    Korrigieren
                  </button>
                )}
                {canWrite && !last && isToday && (
                  <button type="button" className="quiet-button" onClick={() => setDialog({ kind: "meal", meal })}>
                    Erfassen
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {!data.weight && (
          <p className="list-hint">Kein Gewicht in den letzten 60 Tagen – unter „Vitalwerte“ erfassen.</p>
        )}
      </section>

      {dialog?.kind === "fluid" && (
        <FluidDialog
          residentId={resident.id}
          residentName={resident.name}
          onClose={() => setDialog(null)}
          onSaved={done}
        />
      )}
      {dialog?.kind === "meal" && (
        <MealDialog
          residentId={resident.id}
          residentName={resident.name}
          meal={dialog.meal}
          onClose={() => setDialog(null)}
          onSaved={done}
        />
      )}
      {hiding && (
        <ReasonDialog
          eyebrow={`Ernährung · ${resident.name}`}
          title="Eintrag korrigieren"
          description={
            hiding.kind === "fluid"
              ? `${formatMl(hiding.entry.amountMl)} ${hiding.entry.beverage ?? ""} · ${formatDateTime(hiding.entry.consumedAt)}. Der Eintrag wird ausgeblendet und zählt nicht mehr zur Tagessumme.`
              : `${hiding.entry.meal} ${hiding.entry.portionPercent} % · ${formatDateTime(hiding.entry.eatenAt)}. Der Eintrag wird ausgeblendet.`
          }
          label="Grund"
          placeholder={`z. B. falscher ${t.one}, doppelt erfasst, falsche Menge`}
          submitLabel="Ausblenden"
          danger
          onClose={() => setHiding(null)}
          onConfirm={async (reason) => {
            await requestJson(`/api/nutrition/${hiding.kind === "fluid" ? "fluids" : "meals"}/${hiding.entry.id}`, {
              method: "DELETE",
              body: { reason },
            });
            done("Eintrag korrigiert");
          }}
        />
      )}
    </>
  );
}
