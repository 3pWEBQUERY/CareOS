"use client";

import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import { useAppRouter } from "./app-navigation";
import { ModuleIcon } from "./module-icon";
import { useNavigationBadges, useWorkContext, type NavigationBadges } from "./care-context";
import { useEscapeClose } from "./use-escape-close";
import { openHelp } from "./help-panel";
import {
  appHref,
  moduleBadges,
  moduleLabel,
  readRecentPages,
  routeFor,
  sidebarNavigation,
  type NavGroup,
  type NavModule,
  type RecentPage,
} from "./navigation";
import { navigationLabel, termsFor, type Terms } from "@/lib/terminology";

// CareOS: jeder Bereich ist eine App mit eigenem Symbol und eigener Farbe. Dieselben Kacheln stehen auf dem
// Startbildschirm, unter „Alle Apps“ (Leiste links bzw. unten) und als Symbol über jeder Seite – wer eine App einmal
// gesehen hat, erkennt sie überall wieder.

const APPS_EVENT = "careos:apps";

// Öffnet „Alle Apps“ von überall (Leiste, Startseite, Tastatur).
export const openAppLauncher = () => window.dispatchEvent(new Event(APPS_EVENT));

export const appStyle = (hue: number) => ({ "--app-hue": hue }) as CSSProperties;

// Farbiges App-Symbol (weisses Zeichen auf der Farbe der App). Kompass trägt sein eigenes Logo.
export function AppIcon({
  module,
  size = "md",
}: {
  module: Pick<NavModule, "id" | "icon" | "hue">;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span className={`careos-app-icon careos-app-icon-${size}`} style={appStyle(module.hue)} aria-hidden="true">
      {module.id === "rai" ? <span className="sidebar-kompass-icon" /> : <ModuleIcon name={module.icon} />}
    </span>
  );
}

const countOf = (badges: NavigationBadges | null, moduleId: string) =>
  badges ? moduleBadges(moduleId).reduce((sum, key) => sum + (badges[key] ?? 0), 0) : 0;

// Apps, die die angemeldete Person nutzen darf, in ihren Gruppen; Beschriftung mit der Bezeichnung der Einrichtung.
export function useApps() {
  const context = useWorkContext();
  const terms = termsFor(context?.terminology);
  const permissions = context?.profile.permissions;
  const groups = useMemo(() => sidebarNavigation(permissions), [permissions]);
  return { groups, terms, ready: Boolean(context) };
}

type GridProps = {
  groups: NavGroup[];
  terms: Terms;
  badges: NavigationBadges | null;
  // Mit kurzer Beschreibung unter dem Namen („Alle Apps“); auf dem Startbildschirm nur der Name.
  withHints?: boolean;
  onOpen: (href: string) => void;
};

export function AppGrid({ groups, terms, badges, withHints = false, onOpen }: GridProps) {
  const L = (label: string) => navigationLabel(label, terms);
  const router = useAppRouter();
  // Die Kachel heisst wie die App (übersetzbar); die Beschreibung ist ihre Erläuterung.
  const hintId = useId();
  return (
    <div className="careos-app-groups">
      {groups.map((group) => (
        <section className="careos-app-group" key={group.id} aria-label={L(group.label)}>
          <h3>{L(group.label)}</h3>
          <div className={`careos-app-grid ${withHints ? "with-hints" : ""}`}>
            {group.modules.map((module) => {
              const href = appHref(module);
              if (!href) return null;
              const count = countOf(badges, module.id);
              const name = L(module.label);
              return (
                <button
                  className="careos-app-tile"
                  type="button"
                  key={module.id}
                  style={appStyle(module.hue)}
                  aria-describedby={withHints ? `${hintId}-${module.id}` : undefined}
                  onPointerEnter={() => router.prefetch(href)}
                  onFocus={() => router.prefetch(href)}
                  onClick={() => onOpen(href)}
                >
                  <span className="careos-app-tile-icon" aria-hidden="true">
                    <AppIcon module={module} size="lg" />
                    {count > 0 && <em className="careos-badge">{count > 99 ? "99+" : count}</em>}
                  </span>
                  <span className="careos-app-tile-copy">
                    <strong>{name}</strong>
                    {count > 0 && <span className="sr-only"> ({count})</span>}
                    {withHints && (
                      <small id={`${hintId}-${module.id}`} aria-hidden="true">
                        {L(module.hint)}
                      </small>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

const normalize = (value: string) => value.toLocaleLowerCase("de-CH").normalize("NFD").replace(/\p{M}/gu, "");

// „Alle Apps“: alle Apps auf einen Blick, mit Suche und den zuletzt geöffneten Seiten. Am Computer als grosses Fenster,
// auf dem Handy als Blatt über der unteren Leiste.
export function AppLauncher() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(APPS_EVENT, show);
    return () => window.removeEventListener(APPS_EVENT, show);
  }, []);
  if (!open) return null;
  return <LauncherSheet onClose={() => setOpen(false)} />;
}

function LauncherSheet({ onClose }: { onClose: () => void }) {
  const router = useAppRouter();
  const { groups, terms } = useApps();
  const badges = useNavigationBadges();
  const [query, setQuery] = useState("");
  const [recent] = useState<RecentPage[]>(() => readRecentPages());
  useEscapeClose(onClose);
  const L = (label: string) => navigationLabel(label, terms);

  useEffect(() => {
    document.body.classList.add("mobile-menu-open");
    return () => document.body.classList.remove("mobile-menu-open");
  }, []);

  // Suche nach App-Namen, Beschreibung und Seiten (Reitern) der App.
  const term = normalize(query.trim());
  const filtered = term
    ? groups
        .map((group) => ({
          ...group,
          modules: group.modules.filter((module) =>
            normalize([module.label, module.hint, group.label, ...module.children].map(L).join(" ")).includes(term),
          ),
        }))
        .filter((group) => group.modules.length)
    : groups;
  const allowed = new Set(
    groups.flatMap((group) => group.modules.flatMap((m) => m.children.map((c) => `${m.id}:${c}`))),
  );
  const recentPages = term ? [] : recent.filter((page) => allowed.has(`${page.moduleId}:${page.child}`)).slice(0, 4);
  const moduleOf = (id: string) => groups.flatMap((group) => group.modules).find((module) => module.id === id);

  function go(href: string) {
    onClose();
    router.push(href);
  }

  return (
    <>
      <div className="careos-launcher-backdrop" role="presentation" onClick={onClose} />
      <div className="careos-launcher" role="dialog" aria-modal="true" aria-label="Alle Apps">
        <div className="careos-launcher-head">
          <div>
            <p className="eyebrow">CareOS</p>
            <h2>Alle Apps</h2>
          </div>
          <button className="careos-launcher-close" type="button" aria-label="Alle Apps schliessen" onClick={onClose}>
            <ModuleIcon name="close" />
            <span>Schliessen</span>
          </button>
        </div>
        <label className="careos-launcher-search">
          <ModuleIcon name="search" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="App suchen, z. B. Wunden"
            aria-label="App suchen"
          />
        </label>
        <div className="careos-launcher-body">
          {recentPages.length > 0 && (
            <section className="careos-recent" aria-label="Zuletzt geöffnet">
              <h3>Zuletzt geöffnet</h3>
              <div>
                {recentPages.map((page) => {
                  const app = moduleOf(page.moduleId);
                  const href = routeFor(page.moduleId, page.child);
                  if (!app || !href) return null;
                  return (
                    <button type="button" key={`${page.moduleId}:${page.child}`} onClick={() => go(href)}>
                      <AppIcon module={app} size="sm" />
                      <span>{moduleLabel(page.moduleId, page.child, terms)}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          {filtered.length ? (
            <AppGrid groups={filtered} terms={terms} badges={badges} withHints onOpen={go} />
          ) : (
            <p className="careos-launcher-empty">Keine App gefunden. Anderes Wort versuchen.</p>
          )}
          <div className="careos-launcher-system">
            <button type="button" onClick={() => go("/c/einstellungen")}>
              <ModuleIcon name="settings" />
              Einstellungen
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                openHelp();
              }}
            >
              <ModuleIcon name="help" />
              Hilfe
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
