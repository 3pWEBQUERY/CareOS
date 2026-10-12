"use client";

import { termsFor } from "@/lib/terminology";
import type { Language } from "@/lib/i18n-shared";
import { useState } from "react";
import { useRouter } from "next/navigation";
import ModulePageShell from "@/app/components/module-page-shell";
import { ModuleIcon } from "@/app/components/module-icon";
import { loadWorkContext, useWorkContext } from "@/app/components/care-context";
import { ProfilePopover } from "@/app/components/header-profile-popover";
import { announcePreferences } from "@/app/components/appearance";
import { requestJson, useApiData } from "@/app/components/workspace-ui";
import { clearOfflineData } from "@/app/components/offline-queue";
import { SETTING_DEFINITIONS, type AppSettings, type SettingKey } from "@/lib/settings-shared";
import { NOTIFY_CATEGORIES, type UserPreferences, type UserSettings } from "@/lib/user-settings-shared";
import PasswordChangePopover from "./password-change-popover";
import { SettingsView, VIEWS, NAV, ADMIN_VIEWS, Actions, itemsFor } from "./settings-detail-items";
import { DetailControl } from "./settings-detail-controls";

export type { SettingsView } from "./settings-detail-items";

export default function SettingsWorkspaceDetail({ view }: { view: SettingsView }) {
  const router = useRouter();
  const context = useWorkContext();
  const settings = useApiData<UserSettings>("/api/me/settings");
  const languages = useApiData<{ languages: Language[] }>("/api/i18n");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const page = VIEWS[view];
  const isAdmin = settings.data?.profile.permissions.includes("administration.manage") ?? false;
  const organization = useApiData<{ settings: AppSettings }>(
    view === "organization" && isAdmin ? "/api/settings" : null,
  );

  return (
    <ModulePageShell pageClass={`settings-page settings-${view}`} locationSecondary="Persönlicher Bereich">
      {(showToast) => {
        const data = settings.data;
        const savePreferences = async (change: Partial<UserPreferences>, message: string) => {
          try {
            const result = await requestJson<{ preferences: UserPreferences }>("/api/me/settings", {
              method: "PATCH",
              body: change,
            });
            settings.reload();
            announcePreferences(result.preferences);
            void loadWorkContext(true);
            showToast(message);
          } catch (reason) {
            showToast((reason as Error).message);
          }
        };
        const saveOrganization = async (key: SettingKey, change: { enabled?: boolean; value?: number }) => {
          try {
            await requestJson(`/api/settings/${key}`, { method: "PATCH", body: change });
            organization.reload();
            void loadWorkContext(true);
            const title = SETTING_DEFINITIONS[key].title;
            showToast(
              change.enabled === undefined
                ? `${title} gespeichert`
                : `${title} ${change.enabled ? "eingeschaltet" : "ausgeschaltet"}`,
            );
            return true;
          } catch (reason) {
            showToast((reason as Error).message);
            return false;
          }
        };
        const run = async (action: () => Promise<string>) => {
          try {
            showToast(await action());
          } catch (reason) {
            showToast((reason as Error).message);
          }
        };
        const actions: Actions = {
          exportData: () => {
            const link = document.createElement("a");
            link.href = "/api/me/export";
            link.download = "";
            link.click();
            showToast("Deine Daten werden heruntergeladen");
          },
          clearDevice: () => {
            clearOfflineData();
            showToast("Zwischengespeicherte Seiten und Daten auf diesem Gerät gelöscht");
          },
          endPushAll: () =>
            void run(async () => {
              const result = await requestJson<{ ended: number }>("/api/me/settings?scope=push", { method: "DELETE" });
              return result.ended
                ? `Push-Nachrichten auf ${result.ended} Gerät${result.ended === 1 ? "" : "en"} beendet`
                : "Push war auf keinem Gerät eingeschaltet";
            }),
          reset: () =>
            void run(async () => {
              const result = await requestJson<{ preferences: UserPreferences }>("/api/me/settings?scope=preferences", {
                method: "DELETE",
              });
              settings.reload();
              announcePreferences(result.preferences);
              void loadWorkContext(true);
              return "Persönliche Einstellungen zurückgesetzt";
            }),
        };
        const items = data
          ? itemsFor(view, data, savePreferences, {
              isAdmin,
              organization: organization.data?.settings ?? null,
              organizationError: organization.error ?? null,
              organizationShortcuts: context?.settings.keyboardShortcuts.enabled ?? true,
              saveOrganization,
              actions,
              terms: termsFor(context?.terminology),
              languages: languages.data?.languages ?? ["de"],
            })
          : [];
        const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
        const enabledCount = data ? Object.values(data.preferences.notify).filter(Boolean).length : 0;

        return (
          <>
            <main className="workspace settings-workspace">
              <section className="settings-heading page-heading">
                <div className="heading-copy">
                  <p className="eyebrow">{page.eyebrow}</p>
                  <h1>{page.title}</h1>
                  <p>{page.description}</p>
                </div>
                {view === "profile" && (
                  <button className="primary-button" type="button" onClick={() => setProfileOpen(true)}>
                    <ModuleIcon name="team" className="button-icon" />
                    Profil bearbeiten
                  </button>
                )}
                {view === "security" && (
                  <button className="primary-button" type="button" onClick={() => setPasswordOpen(true)}>
                    <ModuleIcon name="quality" className="button-icon" />
                    Passwort ändern
                  </button>
                )}
              </section>
              <div className="settings-layout">
                <aside className="card settings-nav">
                  <div className="card-header">
                    <div>
                      <p className="eyebrow">Mein Bereich</p>
                      <h2 className="card-title">Einstellungen</h2>
                    </div>
                  </div>
                  <nav aria-label="Einstellungsnavigation">
                    {NAV.filter(([id]) => isAdmin || !ADMIN_VIEWS.includes(id)).map(([id, label, icon]) => (
                      <button
                        className={view === id ? "active" : ""}
                        type="button"
                        key={id}
                        aria-current={view === id ? "page" : undefined}
                        onClick={() => router.push(id === "overview" ? "/c/einstellungen" : `/c/einstellungen/${id}`)}
                      >
                        <ModuleIcon name={icon} />
                        <span>{label}</span>
                        <ModuleIcon name="chevron" className="chevron" />
                      </button>
                    ))}
                  </nav>
                </aside>
                <section className="settings-content">
                  <section className="card settings-list">
                    <div className="card-header">
                      <div>
                        <p className="eyebrow">Arbeitsbereich</p>
                        <h2 className="card-title">{view === "overview" ? "Deine Einstellungen" : page.title}</h2>
                        <p className="card-subtitle">
                          {settings.error ??
                            (data
                              ? view === "notifications"
                                ? `${enabledCount} von ${Object.keys(NOTIFY_CATEGORIES).length} Kategorien aktiv`
                                : `${items.length} Bereiche`
                              : "Wird geladen …")}
                        </p>
                      </div>
                    </div>
                    <div>
                      {items.map((item) => (
                        <button
                          className={selected?.id === item.id ? "selected" : ""}
                          type="button"
                          key={item.id}
                          onClick={() => setSelectedId(item.id)}
                        >
                          <span className="settings-item-icon">
                            <ModuleIcon name={item.icon} />
                          </span>
                          <span>
                            <strong>{item.title}</strong>
                            <small>{item.description}</small>
                          </span>
                          <span className="settings-item-value">{item.value}</span>
                          <ModuleIcon name="chevron" className="chevron" />
                        </button>
                      ))}
                    </div>
                  </section>
                  {selected && data && (
                    <section className="card settings-detail">
                      <div className="card-header">
                        <div>
                          <p className="eyebrow">Ausgewählt</p>
                          <h2 className="card-title">{selected.title}</h2>
                          <p className="card-subtitle">{selected.value}</p>
                        </div>
                      </div>
                      <div className="settings-detail-body">
                        <p>{selected.detail.text}</p>
                        <DetailControl
                          item={selected}
                          data={data}
                          onOpenView={(next) => router.push(`/c/einstellungen/${next}`)}
                          onProfile={() => setProfileOpen(true)}
                          onPassword={() => setPasswordOpen(true)}
                          onMessage={showToast}
                          onChanged={settings.reload}
                          onToggle={(category, value) =>
                            savePreferences(
                              { notify: { ...data.preferences.notify, [category]: value } },
                              `${NOTIFY_CATEGORIES[category].label} ${value ? "eingeschaltet" : "ausgeschaltet"}`,
                            )
                          }
                          onEndSessions={async (id) => {
                            try {
                              const result = await requestJson<{ ended: number }>(
                                `/api/me/sessions${id ? `?id=${id}` : ""}`,
                                { method: "DELETE" },
                              );
                              settings.reload();
                              showToast(
                                result.ended
                                  ? `${result.ended} Gerät${result.ended === 1 ? "" : "e"} abgemeldet`
                                  : "Keine anderen Geräte angemeldet",
                              );
                            } catch (reason) {
                              showToast((reason as Error).message);
                            }
                          }}
                        />
                      </div>
                      <div className="settings-detail-footer">
                        <small>Änderungen werden sofort gespeichert.</small>
                      </div>
                    </section>
                  )}
                </section>
              </div>
            </main>
            <PasswordChangePopover
              key={passwordOpen ? "open" : "closed"}
              open={passwordOpen}
              onClose={() => setPasswordOpen(false)}
              onSuccess={() => {
                settings.reload();
                showToast("Passwort geändert · andere Geräte wurden abgemeldet");
              }}
            />
            {profileOpen && (
              <ProfilePopover
                context={context}
                onClose={() => setProfileOpen(false)}
                onSave={() => {
                  settings.reload();
                  void loadWorkContext(true);
                  showToast("Profil gespeichert");
                }}
              />
            )}
          </>
        );
      }}
    </ModulePageShell>
  );
}
