"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
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

// App-Symbol: dunkle Kachel, darauf das Zeichen leuchtend in der Farbe der App. Kompass trägt sein eigenes Logo.
export function AppIcon({
  module,
  size = "md",
}: {
  module: Pick<NavModule, "id" | "icon" | "hue">;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span className={`careos-app-icon careos-app-icon-${size}`} style={appStyle(module.hue)} aria-hidden="true">
      {module.id === "rai" ? (
        <span className="sidebar-kompass-icon" />
      ) : (
        <ModuleIcon name={module.icon} weight="duotone" />
      )}
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

type GridEntry = { module: NavModule; group: NavGroup };

// Alle Apps als Symbol-Raster wie auf einem Tablet: Symbol, darunter der Name, Zähler für Offenes. Dasselbe Raster
// steht auf dem Startbildschirm und unter „Alle Apps“.
export function OsAppGrid({
  entries,
  terms,
  badges,
  onOpen,
}: {
  entries: GridEntry[];
  terms: Terms;
  badges: NavigationBadges | null;
  onOpen?: () => void;
}) {
  const L = (label: string) => navigationLabel(label, terms);
  return (
    <ul className="os-app-grid">
      {entries.map(({ module }, index) => {
        const href = appHref(module);
        if (!href) return null;
        const value = countOf(badges, module.id);
        return (
          <li key={module.id} style={{ "--i": index } as CSSProperties}>
            <Link
              href={href}
              className="os-app"
              title={L(module.hint)}
              transitionTypes={["nav-forward"]}
              onClick={onOpen}
            >
              <span className="os-app-icon">
                <AppIcon module={module} size="lg" />
                {value > 0 && <em className="careos-badge">{value > 99 ? "99+" : value}</em>}
              </span>
              <span className="os-app-name">
                {L(module.label)}
                {value > 0 && <span className="sr-only"> ({value} offen)</span>}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// Suche nach App-Namen, Beschreibung, Gruppe und Seiten (Reitern) der App.
export function useAppSearch(groups: NavGroup[], terms: Terms, query: string) {
  const entries = useMemo(
    () => groups.flatMap((group) => group.modules.map((module) => ({ module, group }))),
    [groups],
  );
  const L = (label: string) => navigationLabel(label, terms);
  const term = normalizeSearch(query.trim());
  return term
    ? entries.filter(({ module, group }) =>
        normalizeSearch([module.label, module.hint, group.label, ...module.children].map(L).join(" ")).includes(term),
      )
    : entries;
}

export const normalizeSearch = (value: string) =>
  value.toLocaleLowerCase("de-CH").normalize("NFD").replace(/\p{M}/gu, "");

// „Alle Apps“: alle Apps auf einen Blick wie im Launchpad, mit Suche und den zuletzt geöffneten Seiten.
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
  const shown = useAppSearch(groups, terms, query);

  useEffect(() => {
    document.body.classList.add("mobile-menu-open");
    return () => document.body.classList.remove("mobile-menu-open");
  }, []);

  const allowed = new Set(
    groups.flatMap((group) => group.modules.flatMap((m) => m.children.map((c) => `${m.id}:${c}`))),
  );
  const recentPages = query.trim()
    ? []
    : recent.filter((page) => allowed.has(`${page.moduleId}:${page.child}`)).slice(0, 4);
  const moduleOf = (id: string) => groups.flatMap((group) => group.modules).find((module) => module.id === id);

  function go(href: string) {
    onClose();
    router.push(href);
  }

  // Launchpad: Vollbild über allem, dahinter verschwommen; ein Klick auf eine freie Stelle schliesst.
  return (
    <div
      className="careos-launchpad"
      role="dialog"
      aria-modal="true"
      aria-label="Alle Apps"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="careos-launchpad-inner" onClick={(event) => event.target === event.currentTarget && onClose()}>
        <label className="os-search">
          <ModuleIcon name="search" />
          <input
            type="search"
            value={query}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Suchen"
            aria-label="App suchen"
          />
        </label>
        {recentPages.length > 0 && (
          <nav className="careos-launchpad-recent" aria-label="Zuletzt geöffnet">
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
          </nav>
        )}
        {shown.length ? (
          <OsAppGrid entries={shown} terms={terms} badges={badges} onOpen={onClose} />
        ) : (
          <p className="os-springboard-empty">Keine App gefunden.</p>
        )}
        <div className="careos-launchpad-system">
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
  );
}
