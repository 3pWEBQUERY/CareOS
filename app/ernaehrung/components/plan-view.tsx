"use client";

import { useState } from "react";
import {
  EmptyState,
  LoadError,
  PageHeading,
  SummaryTiles,
  formatDateTime,
  timeInZurich,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import {
  expectedShare,
  fluidStatus,
  formatMl,
  type NutritionResident,
  type ResidentNutrition,
} from "@/lib/nutrition-shared";
import DayPanel from "./day-panel";
import { PlanDialog } from "./nutrition-dialogs";
import { useHeaderResident, useTerms } from "@/app/components/care-context";
import HeaderResidentHint from "@/app/components/header-resident-hint";
import { ResuscitationBadge } from "@/app/components/resuscitation-badge";

export type NutritionOverview = {
  date: string;
  residents: NutritionResident[];
  careUnits: Array<{ id: string; name: string }>;
  canWrite: boolean;
};

// Status of today's intake for a resident, relative to what is expected by now.
export function residentFluidStatus(r: NutritionResident, share: number) {
  if (!r.fluidTargetMl && !r.fluidLimitMl) return r.fluidTotalMl ? "no_target" : "none";
  return fluidStatus(r.fluidTotalMl, r.fluidTargetMl, r.fluidLimitMl, share);
}

export default function PlanView({ showToast }: { showToast: ShowToast }) {
  const t = useTerms();
  const overview = useApiData<NutritionOverview>("/api/nutrition");
  const [editing, setEditing] = useState(false);
  const residents = overview.data?.residents ?? [];
  const { resident, missing } = useHeaderResident(residents, overview.loading);
  const detail = useApiData<ResidentNutrition & { date: string }>(
    resident ? `/api/nutrition/residents/${resident.id}` : null,
  );
  const plan = detail.data?.plan ?? null;
  const canWrite = overview.data?.canWrite ?? false;
  const share = expectedShare(timeInZurich());
  const reload = () => {
    overview.reload();
    detail.reload();
  };

  return (
    <>
      <PageHeading
        eyebrow="Ernährung"
        title="Ernährungsplan"
        description={`Kostform, Konsistenz, Trinkziele und Hilfestellung je ${t.one} – mit Tagesverlauf und Gewicht.`}
        action={
          canWrite && resident
            ? { label: plan ? "Plan anpassen" : "Plan anlegen", onClick: () => setEditing(true) }
            : undefined
        }
      />
      <SummaryTiles
        label="Ernährungsstatus heute"
        tiles={[
          {
            icon: "nutrition",
            value: resident ? (resident.hasPlan ? (resident.diet ?? "Plan vorhanden") : "Kein Plan") : "–",
            caption: resident?.texture ? `Kostform · ${resident.texture}` : "Kostform",
          },
          {
            icon: "alert",
            value: resident ? formatMl(resident.fluidTotalMl) : "–",
            caption: resident?.fluidTargetMl
              ? `getrunken · Ziel ${formatMl(resident.fluidTargetMl)}`
              : "heute getrunken",
            tone:
              resident && ["behind", "over_limit"].includes(residentFluidStatus(resident, share))
                ? "critical"
                : undefined,
          },
          { icon: "check", value: resident?.mealsLogged ?? "–", caption: "Mahlzeiten heute dokumentiert" },
          {
            icon: "note",
            value: resident?.lowMeals ?? "–",
            caption: "Mahlzeiten ≤ 25 % gegessen",
            tone: "attention",
          },
        ]}
      />
      {overview.error && <LoadError message={overview.error} onRetry={overview.reload} />}
      {(overview.data?.careUnits.length ?? 0) > 0 && (
        <nav className="kitchen-links" aria-label="Küchenliste drucken">
          <span>Küchenliste:</span>
          {overview.data?.careUnits.map((unit) => (
            <a
              key={unit.id}
              className="death-checklist-action"
              href={`/c/ernaehrung/kuechenliste?unit=${unit.id}`}
              target="_blank"
              rel="noopener"
              aria-label={`Küchenliste ${unit.name} drucken`}
            >
              {unit.name}
            </a>
          ))}
        </nav>
      )}
      <div className="medication-two-column header-resident-layout">
        <section className="med-main-column">
          {resident && detail.error && <LoadError message={detail.error} onRetry={detail.reload} />}
          {resident && detail.data && (
            <>
              <section className="card nutrition-plan-detail">
                <div className="care-profile-identity">
                  <span className="resident-avatar">{resident.initials}</span>
                  <div>
                    <p className="eyebrow">
                      {plan ? `Ernährungsplan · Stand ${formatDateTime(plan.updatedAt)}` : "Kein Ernährungsplan"}
                    </p>
                    <h2>
                      {resident.name} <ResuscitationBadge residentId={resident.id} />
                    </h2>
                    <span>{[resident.room, resident.careUnit].filter(Boolean).join(" · ")}</span>
                  </div>
                </div>
                {plan ? (
                  <dl>
                    {[
                      ["Kostform", plan.diet],
                      ["Konsistenz", plan.texture],
                      ["Trinkziel", plan.fluidTargetMl ? `${formatMl(plan.fluidTargetMl)} / Tag` : null],
                      ["Begrenzung", plan.fluidLimitMl ? `max. ${formatMl(plan.fluidLimitMl)} / Tag` : null],
                      [
                        "Energiebedarf",
                        plan.calorieTarget ? `${plan.calorieTarget.toLocaleString("de-CH")} kcal / Tag` : null,
                      ],
                      ["Mahlzeitenrhythmus", plan.mealRhythm],
                      ["Hilfestellung", plan.assistance],
                      ["Allergien", plan.allergies ?? "Nicht erfasst"],
                      ["Vorlieben", plan.preferences],
                      ["Hinweise", plan.instructions],
                    ]
                      .filter(([, value]) => value)
                      .map(([label, value]) => (
                        <div
                          key={label}
                          className={
                            label === "Begrenzung"
                              ? "limit"
                              : label === "Allergien" && value !== "Nicht erfasst"
                                ? "allergy"
                                : ""
                          }
                        >
                          <dt>{label}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                  </dl>
                ) : (
                  <EmptyState
                    icon="nutrition"
                    title="Noch kein Ernährungsplan"
                    text={
                      canWrite
                        ? "Über „Plan anlegen“ Kostform, Konsistenz und Trinkziel festlegen."
                        : `Für diesen ${t.oneOblique} ist kein Plan hinterlegt.`
                    }
                  />
                )}
              </section>
              <DayPanel
                resident={resident}
                data={detail.data}
                date={detail.data.date}
                canWrite={canWrite}
                showToast={showToast}
                onChanged={reload}
              />
            </>
          )}
          {resident && detail.loading && !detail.data && <p className="list-hint">Ernährungsdaten werden geladen …</p>}
          {!resident && <HeaderResidentHint loading={overview.loading} missing={missing} />}
        </section>
      </div>
      {editing && resident && (
        <PlanDialog
          residentId={resident.id}
          residentName={resident.name}
          plan={plan}
          onClose={() => setEditing(false)}
          onSaved={(message) => {
            setEditing(false);
            showToast(message);
            reload();
          }}
        />
      )}
    </>
  );
}
