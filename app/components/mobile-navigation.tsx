"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppRouter } from "./app-navigation";
import { ModuleIcon } from "./module-icon";
import { AppIcon, openAppLauncher } from "./app-launcher";
import {
  openResidentPicker,
  useCareResident,
  useNavigationBadges,
  useWorkContext,
  type NavigationBadges,
} from "./care-context";
import { MOBILE_DOCK_APPS, appHref, sidebarNavigation } from "./navigation";
import { availableActions, runAction, type CareAction } from "./actions";
import { navigationLabel, termsFor } from "@/lib/terminology";

// Untere Leiste auf dem Handy: Start, die drei meistgenutzten Apps und „Alle Apps“ – immer gleich, damit man sie
// blind findet. Gezeigt wird nur, was die angemeldete Person nutzen darf.
export function MobileNavigation({ activeModule }: { activeModule?: string }) {
  const router = useAppRouter();
  const [actionsOpen, setActionsOpen] = useState(false);
  const context = useWorkContext();
  const terms = termsFor(context?.terminology);
  const L = (label: string) => navigationLabel(label, terms);
  const permissions = context?.profile.permissions;
  const [residentId] = useCareResident();
  const resident = context?.residents.find((item) => item.id === residentId) ?? null;
  const groups = useMemo(() => sidebarNavigation(permissions), [permissions]);
  const badges = useNavigationBadges();
  const count = (keys: Array<keyof NavigationBadges>) =>
    badges ? keys.reduce((sum, key) => sum + (badges[key] ?? 0), 0) : 0;
  const modules = groups.flatMap((group) => group.modules);
  const bar = MOBILE_DOCK_APPS.map((id) => modules.find((module) => module.id === id)).filter((module) => !!module);
  // Schnellaktionen (Knopf über der unteren Leiste): häufige Erfassungen für den Bewohner aus der Kopfzeile.
  const actions = availableActions(permissions);
  const inBar = activeModule === "home" || bar.some((item) => item.id === activeModule);
  // Zähler der Apps, die nicht in der Leiste stehen (Aufgaben, Übergabe, Nachrichten), an „Alle Apps“.
  const otherCount = count(["tasks", "handover", "messages"]);

  useEffect(() => {
    if (!actionsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setActionsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.classList.add("mobile-menu-open");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("mobile-menu-open");
    };
  }, [actionsOpen]);

  function act(action: CareAction) {
    setActionsOpen(false);
    runAction(action, (href) => router.push(href));
  }

  function go(href: string | null) {
    setActionsOpen(false);
    if (href) router.push(href);
  }

  return (
    <>
      {actionsOpen && (
        <>
          <div className="mobile-nav-backdrop" role="presentation" onClick={() => setActionsOpen(false)} />
          <div
            className="mobile-nav-menu mobile-actions-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Schnellaktionen"
          >
            <div className="mobile-nav-menu-head">
              <div>
                <p className="eyebrow">Schnellaktionen</p>
                <strong>{resident ? resident.name : `Kein ${terms.one} gewählt`}</strong>
              </div>
              <button type="button" aria-label="Schnellaktionen schliessen" onClick={() => setActionsOpen(false)}>
                <ModuleIcon name="close" />
              </button>
            </div>
            <section className="mobile-nav-section">
              <div className="mobile-nav-quick">
                {actions.map((item) => (
                  <button type="button" key={item.id} onClick={() => act(item)}>
                    <ModuleIcon name={item.icon} />
                    <span>{L(item.label)}</span>
                  </button>
                ))}
              </div>
            </section>
            <section className="mobile-nav-section">
              <div className="mobile-nav-groups">
                <button
                  type="button"
                  onClick={() => {
                    setActionsOpen(false);
                    openResidentPicker();
                  }}
                >
                  <span className="mobile-nav-group-icon">
                    <ModuleIcon name="residents" />
                  </span>
                  <span>
                    <strong>{resident ? `Anderen ${terms.oneOblique} wählen` : `${terms.oneOblique} wählen`}</strong>
                    <small>Die Erfassung gilt für den {terms.oneOblique} aus der Kopfzeile.</small>
                  </span>
                  <ModuleIcon name="chevron" />
                </button>
              </div>
            </section>
          </div>
        </>
      )}
      {/* Auf der Startseite bleibt deren eigener Knopf „Notiz erstellen“; im Messenger läge er über dem Eingabefeld. */}
      {actions.length > 0 && activeModule !== "home" && activeModule !== "messenger" && (
        <button
          className="floating-action"
          type="button"
          aria-label="Schnellaktionen"
          aria-haspopup="dialog"
          aria-expanded={actionsOpen}
          onClick={() => setActionsOpen((value) => !value)}
        >
          <ModuleIcon name={actionsOpen ? "close" : "plus"} />
        </button>
      )}
      <nav className="bottom-nav careos-bottom-dock" aria-label="Mobile Navigation">
        <button
          className={activeModule === "home" ? "active" : ""}
          type="button"
          aria-current={activeModule === "home" ? "page" : undefined}
          onClick={() => go("/c")}
        >
          <span
            className="careos-app-icon careos-app-icon-sm careos-app-icon-plain"
            style={{ ["--app-hue" as string]: 214 }}
          >
            <ModuleIcon name="home" />
          </span>
          <span>Start</span>
        </button>
        {bar.map((module) => {
          const value = module.id === "med" ? count(["medRound"]) : 0;
          const active = activeModule === module.id;
          const label = L(module.shortLabel ?? module.label);
          return (
            <button
              className={active ? "active" : ""}
              type="button"
              key={module.id}
              aria-current={active ? "page" : undefined}
              onClick={() => go(appHref(module))}
            >
              <AppIcon module={module} size="sm" />
              <span>{label}</span>
              {value > 0 && (
                <em className="bottom-nav-badge" aria-hidden="true">
                  {value > 99 ? "99+" : value}
                </em>
              )}
              {value > 0 && <span className="sr-only"> ({value} überfällig)</span>}
            </button>
          );
        })}
        <button
          className={!inBar && activeModule !== "settings" ? "active" : ""}
          type="button"
          aria-haspopup="dialog"
          onClick={() => {
            setActionsOpen(false);
            openAppLauncher();
          }}
        >
          <span
            className="careos-app-icon careos-app-icon-sm careos-app-icon-plain"
            style={{ ["--app-hue" as string]: 214 }}
          >
            <ModuleIcon name="apps" />
          </span>
          <span>Alle Apps</span>
          {otherCount > 0 && (
            <em className="bottom-nav-badge" aria-hidden="true">
              {otherCount > 99 ? "99+" : otherCount}
            </em>
          )}
        </button>
      </nav>
    </>
  );
}
