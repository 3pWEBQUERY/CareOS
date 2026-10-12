"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ModulePageShell from "@/app/components/module-page-shell";
import type { SettingsPayload } from "@/lib/roster/settings-service";
import { useRosterData } from "./roster-api";
import { CareOptionSelect } from "@/app/components/care-form-controls";
import { ShiftTypesTab } from "./settings-shift-types";
import { StaffingTab } from "./settings-staffing";
import { RulesTab } from "./settings-rules";
import { HolidaysTab } from "./settings-holidays";
import { PeopleTab } from "./settings-people";
import { WageTypesTab } from "./settings-wage-types";

const TABS = ["Diensttypen", "Mindestbesetzung", "Regelwerk", "Feiertage", "Personal", "Lohnarten"] as const;
type Tab = (typeof TABS)[number];

export default function SettingsWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = (TABS.find((t) => t === params.get("bereich")) ?? "Diensttypen") as Tab;
  const unitParam = params.get("einheit");
  const { data, error, reload } = useRosterData<SettingsPayload>(
    `/api/dienstplan/settings${unitParam ? `?einheit=${unitParam}` : ""}`,
  );
  const go = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) next.set(key, value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  return (
    <ModulePageShell pageClass="roster-page">
      {(showToast) => (
        <main className="workspace roster-workspace">
          <header className="page-heading roster-heading">
            <div className="heading-copy">
              <p className="eyebrow">Leitung · Dienstplan</p>
              <h1>Einstellungen</h1>
              <p>
                Diensttypen, Mindestbesetzung, Regelwerk, Feiertage, Personal und Lohnarten. Jede Änderung wird
                protokolliert.
              </p>
            </div>
          </header>
          <section className="roster-toolbar">
            <div className="roster-settings-tabs" role="tablist" aria-label="Bereiche">
              {TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={t === tab}
                  className={t === tab ? "active" : ""}
                  onClick={() => go({ bereich: t })}
                >
                  {t}
                </button>
              ))}
            </div>
            {data && data.units.length > 1 && (
              <CareOptionSelect
                label="Wohnbereich"
                value={data.unitId ?? ""}
                onChange={(value) => go({ einheit: value })}
                options={[...data.units.map((unit) => ({ value: String(unit.id), label: String(unit.name) }))]}
              />
            )}
          </section>
          {error && !data && (
            <section className="critical-alert" role="alert">
              <div>
                <strong>Einstellungen konnten nicht geladen werden</strong>
                <p>{error.message}</p>
              </div>
              <button className="secondary-button" type="button" onClick={reload}>
                Erneut laden
              </button>
            </section>
          )}
          {!data && !error && (
            <div className="roster-skeleton">
              {Array.from({ length: 5 }, (_, i) => (
                <span key={i} />
              ))}
            </div>
          )}
          {data && tab === "Diensttypen" && <ShiftTypesTab data={data} reload={reload} showToast={showToast} />}
          {data && tab === "Mindestbesetzung" && <StaffingTab data={data} reload={reload} showToast={showToast} />}
          {data && tab === "Regelwerk" && (
            <RulesTab key={data.unitId ?? "org"} data={data} reload={reload} showToast={showToast} />
          )}
          {data && tab === "Feiertage" && <HolidaysTab data={data} reload={reload} showToast={showToast} />}
          {data && tab === "Personal" && <PeopleTab data={data} reload={reload} showToast={showToast} />}
          {data && tab === "Lohnarten" && <WageTypesTab data={data} reload={reload} showToast={showToast} />}
        </main>
      )}
    </ModulePageShell>
  );
}
