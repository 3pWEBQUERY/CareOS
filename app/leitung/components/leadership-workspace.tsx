"use client";

import { useEffect, useState } from "react";
import ModulePageShell from "@/app/components/module-page-shell";
import { ModuleIcon } from "@/app/components/module-icon";
import { AdminBoard } from "./admin-board";
import { LeadershipVariant } from "./leadership-variants";
import type { AdminUserStats } from "@/lib/admin-users";
import type { OrganizationStructure } from "@/lib/organization-shared";
import type { ConfigurationData } from "./configuration-view";
import { SETTING_DEFINITIONS, SETTING_KEYS, type SettingKey } from "@/lib/settings-shared";
import { useApiData } from "@/app/components/workspace-ui";
import { meta } from "./leadership-data";
import { LeadershipView, Tone } from "./leadership-data";

export default function LeadershipWorkspace({ view }: { view: LeadershipView }) {
  const page = meta[view];
  const [settingKey, setSettingKey] = useState<SettingKey>(SETTING_KEYS[0]);
  const [settingEditorOpen, setSettingEditorOpen] = useState(false);
  const [locationEditorOpen, setLocationEditorOpen] = useState(false);
  const [employeeCreatorOpen, setEmployeeCreatorOpen] = useState(false);
  const [employeeStats, setEmployeeStats] = useState<AdminUserStats | null>(null);
  useEffect(() => {
    if (view !== "users") return;
    let active = true;
    void fetch("/api/admin/users")
      .then((response) => (response.ok ? (response.json() as Promise<{ stats: AdminUserStats }>) : null))
      .then((payload) => {
        if (active && payload?.stats) setEmployeeStats(payload.stats);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [view]);
  const organization = useApiData<OrganizationStructure>(view === "organization" ? "/api/organization" : null);
  const orgTotals = organization.data?.totals;
  const configuration = useApiData<NonNullable<ConfigurationData["data"]>>(
    view === "configuration" ? "/api/settings" : null,
  );
  const config = configuration.data;
  const enabledSettings = config ? SETTING_KEYS.filter((key) => config.settings[key].enabled) : [];
  const disabledReminders = config
    ? (["documentationReminder", "vitalsReminder", "medicationOverdue"] as SettingKey[]).filter(
        (key) => !config.settings[key].enabled,
      )
    : [];

  const kpis =
    view === "users" && employeeStats
      ? [
          [
            String(employeeStats.activeEmployees),
            "Mitarbeiter aktiv",
            `${employeeStats.archivedEmployees} archiviert`,
            "stable" as Tone,
          ],
          [
            String(employeeStats.roleCount),
            "Rollen",
            `${employeeStats.customRoleCount} eigene Rolle${employeeStats.customRoleCount === 1 ? "" : "n"}`,
            "info" as Tone,
          ],
          [
            String(employeeStats.unassignedActiveEmployees),
            "Ohne Arbeitsbereich",
            employeeStats.unassignedActiveEmployees === 0 ? "alle Profile zugeteilt" : "aktive Profile zuweisen",
            employeeStats.unassignedActiveEmployees === 0 ? ("stable" as Tone) : ("attention" as Tone),
          ],
          [
            employeeStats.auditEntriesLast30Days > 0 ? "Aktiv" : "Offen",
            "Auditstatus",
            employeeStats.lastAuditAt
              ? `letzte Änderung ${new Intl.DateTimeFormat("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(employeeStats.lastAuditAt))}`
              : "noch keine Änderung",
            employeeStats.auditEntriesLast30Days > 0 ? ("stable" as Tone) : ("attention" as Tone),
          ],
        ]
      : view === "organization" && orgTotals
        ? [
            [
              String(orgTotals.units),
              orgTotals.units === 1 ? "Wohnbereich" : "Wohnbereiche",
              `${orgTotals.occupied} von ${orgTotals.places} Plätzen belegt`,
              orgTotals.places && orgTotals.occupied > orgTotals.places ? ("critical" as Tone) : ("info" as Tone),
            ],
            [String(orgTotals.staff), "Mitarbeitende", `in ${orgTotals.roles} Rollen`, "stable" as Tone],
            [
              String(orgTotals.sites),
              orgTotals.sites === 1 ? "Standort" : "Standorte",
              orgTotals.unassignedStaff
                ? `${orgTotals.unassignedStaff} Mitarbeitende ohne Bereich`
                : "alle Mitarbeitenden zugeteilt",
              orgTotals.unassignedStaff ? ("attention" as Tone) : ("info" as Tone),
            ],
            [
              String(orgTotals.unitsWithoutLead),
              "Ohne Leitung",
              orgTotals.unitsWithoutLead ? "Wohnbereiche zuweisen" : "alle Bereiche geführt",
              orgTotals.unitsWithoutLead ? ("attention" as Tone) : ("stable" as Tone),
            ],
          ]
        : view === "configuration" && config
          ? [
              [
                String(enabledSettings.length),
                "Einstellungen aktiv",
                `von ${SETTING_KEYS.length} Einstellungen`,
                "stable" as Tone,
              ],
              [
                config.system.schemaVersion ?? "–",
                "Datenbankstand",
                `${config.system.migrations} Migrationen · ${config.system.databaseMs} ms`,
                "info" as Tone,
              ],
              [
                String(disabledReminders.length),
                "Prüfung empfohlen",
                disabledReminders.length
                  ? disabledReminders.map((key) => SETTING_DEFINITIONS[key].title).join(", ")
                  : "alle Erinnerungen aktiv",
                disabledReminders.length ? ("attention" as Tone) : ("stable" as Tone),
              ],
              [
                String(config.system.auditEntries30Days),
                "Protokolleinträge",
                "in den letzten 30 Tagen",
                "stable" as Tone,
              ],
            ]
          : page.kpis;
  return (
    <ModulePageShell
      activeModule={page.module}
      activeChild={page.child}
      pageClass={`leadership-page leadership-${view}`}
      locationSecondary="Gesamtes Haus · alle Wohnbereiche"
    >
      {(showToast) => (
        <main className="workspace leadership-workspace">
          <section className="leadership-heading page-heading">
            <div className="heading-copy">
              <p className="eyebrow">{page.eyebrow}</p>
              <h1>{page.title}</h1>
              <p>{page.description}</p>
            </div>
            <button
              className="primary-button"
              type="button"
              onClick={() =>
                view === "organization"
                  ? setLocationEditorOpen(true)
                  : view === "users"
                    ? setEmployeeCreatorOpen(true)
                    : setSettingEditorOpen(true)
              }
            >
              <ModuleIcon name="plus" className="button-icon" />
              {page.action}
            </button>
          </section>
          <section className="leadership-kpis" aria-label="Leitungskennzahlen">
            {kpis.map(([value, label, note, tone]) => (
              <article key={label} className={tone ? `leadership-kpi ${tone}` : "leadership-kpi"}>
                <span className="leadership-kpi-value">{value}</span>
                <strong>{label}</strong>
                <small>{note}</small>
              </article>
            ))}
          </section>
          <LeadershipVariant
            view={view}
            showToast={showToast}
            employeeCreatorOpen={employeeCreatorOpen}
            onCloseEmployeeCreator={() => setEmployeeCreatorOpen(false)}
            organization={organization}
            siteCreatorOpen={locationEditorOpen}
            onCloseSiteCreator={() => setLocationEditorOpen(false)}
            configuration={configuration}
            settingKey={settingKey}
            onSelectSetting={setSettingKey}
            settingEditorOpen={settingEditorOpen}
            onCloseSettingEditor={() => setSettingEditorOpen(false)}
          />
          <AdminBoard view={view} />
        </main>
      )}
    </ModulePageShell>
  );
}
