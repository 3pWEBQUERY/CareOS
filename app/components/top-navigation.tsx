"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useNavigationBadges, useWorkContext } from "./care-context";
import { ModuleIcon } from "./module-icon";
import { AppIcon, openAppLauncher } from "./app-launcher";
import {
  DOCK_APPS,
  appHref,
  moduleBadges,
  rememberPage,
  sidebarNavigation,
  type ModuleIconName,
  type NavModule,
} from "./navigation";
import { navigationLabel, termsFor } from "@/lib/terminology";

// Oberste Ebene von CareOS wie bei einem Betriebssystem: oben die Menüleiste (App, Seiten, Status, Uhr), unten das
// Dock mit den meistgenutzten Apps – Symbol mit Vergrösserung beim Darüberfahren, Punkt unter der geöffneten App,
// Zähler für Offenes. Auf dem Handy führt der Start-Knopf oben zurück und die untere Leiste ersetzt das Dock.

export function HomeButton({ active }: { active: boolean }) {
  return (
    <Link
      href="/c"
      className={`careos-home-button ${active ? "active" : ""}`}
      aria-label="Start"
      aria-current={active ? "page" : undefined}
      title="Start"
      transitionTypes={["nav-back"]}
    >
      <ModuleIcon name="home" />
    </Link>
  );
}

// Symbol einer Systemfunktion (Start, Alle Apps, Einstellungen) im selben Raster wie die App-Symbole.
export function SystemIcon({ name, size = "md" }: { name: ModuleIconName; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`careos-app-icon careos-app-icon-${size} careos-app-icon-system`} aria-hidden="true">
      <ModuleIcon name={name} weight="duotone" />
    </span>
  );
}

type DockEntry = { id: string; label: string; href: string; count: number; module?: NavModule; icon?: ModuleIconName };

export function Dock({ activeModule, activeChild }: { activeModule?: string; activeChild?: string }) {
  const context = useWorkContext();
  const terms = termsFor(context?.terminology);
  const badges = useNavigationBadges();
  const modules = sidebarNavigation(context?.profile.permissions).flatMap((group) => group.modules);
  const count = (moduleId: string) =>
    badges ? moduleBadges(moduleId).reduce((sum, key) => sum + (badges[key] ?? 0), 0) : 0;
  const apps: DockEntry[] = [
    { id: "home", label: "Start", href: "/c", count: 0, icon: "home" },
    ...DOCK_APPS.map((id) => modules.find((module) => module.id === id)).flatMap((module) => {
      const href = module && appHref(module);
      return module && href
        ? [{ id: module.id, label: navigationLabel(module.label, terms), href, count: count(module.id), module }]
        : [];
    }),
  ];
  const activeIndex = apps.findIndex((entry) => entry.id === activeModule);
  // Eine App ausserhalb des Docks ist offen: „Alle Apps“ trägt dann den Punkt.
  const otherApp = activeIndex < 0 && !!activeModule && activeModule !== "settings";

  // Jede besuchte Seite für „Zuletzt geöffnet“ unter „Alle Apps“ merken.
  useEffect(() => {
    if (activeModule && activeChild) rememberPage(activeModule, activeChild);
  }, [activeModule, activeChild]);

  return (
    <nav className="careos-dock" aria-label="Dock">
      <div className="careos-dock-shelf">
        {apps.map((entry, index) => (
          <Link
            key={entry.id}
            href={entry.href}
            className="careos-dock-item"
            data-running={entry.id === activeModule}
            aria-current={entry.id === activeModule ? "page" : undefined}
            transitionTypes={[index < activeIndex ? "nav-back" : "nav-forward"]}
          >
            <span className="careos-dock-tile">
              {entry.module ? <AppIcon module={entry.module} /> : <SystemIcon name={entry.icon ?? "home"} />}
              {entry.count > 0 && <em className="careos-badge">{entry.count > 99 ? "99+" : entry.count}</em>}
            </span>
            <span className="careos-dock-label">
              {entry.label}
              {entry.count > 0 && <span className="sr-only"> ({entry.count} offen)</span>}
            </span>
          </Link>
        ))}
        <span className="careos-dock-divider" aria-hidden="true" />
        <button
          type="button"
          className="careos-dock-item"
          data-running={otherApp}
          aria-haspopup="dialog"
          onClick={openAppLauncher}
        >
          <span className="careos-dock-tile">
            <SystemIcon name="apps" />
          </span>
          <span className="careos-dock-label">Alle Apps</span>
        </button>
        <Link
          href="/c/einstellungen"
          className="careos-dock-item"
          data-running={activeModule === "settings"}
          aria-current={activeModule === "settings" ? "page" : undefined}
          transitionTypes={["nav-forward"]}
        >
          <span className="careos-dock-tile">
            <SystemIcon name="settings" />
          </span>
          <span className="careos-dock-label">Einstellungen</span>
        </Link>
      </div>
    </nav>
  );
}

// Uhrzeit, genau auf den Minutenwechsel; erst im Browser gesetzt (keine abweichende Zeit aus dem Server-Rendern).
export function useClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const current = new Date();
      setNow(current);
      timer = setTimeout(tick, 60_000 - current.getSeconds() * 1000 - current.getMilliseconds() + 20);
    };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, []);
  return now;
}

// Zeitzone wie Begrüssung und Dienstzeiten der Startseite.
export const ZONE = "Europe/Zurich";

export const formatTime = (date: Date) =>
  new Intl.DateTimeFormat("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: ZONE }).format(date);

// Uhr in der Menüleiste: „Di 13. Okt.  10:15“.
export function MenubarClock() {
  const now = useClock();
  if (!now) return <span className="menubar-clock" aria-hidden="true" />;
  const day = new Intl.DateTimeFormat("de-CH", { weekday: "short", day: "numeric", month: "short", timeZone: ZONE })
    .format(now)
    .replace(",", "");
  return (
    <span className="menubar-clock" role="timer" aria-label={`${day}, ${formatTime(now)} Uhr`}>
      <span>{day}</span>
      <strong>{formatTime(now)}</strong>
    </span>
  );
}

// Grosse Uhr wie auf einem Sperrbildschirm: Wochentag, Datum, Uhrzeit untereinander.
export function SideClock({ className = "" }: { className?: string }) {
  const now = useClock();
  if (!now) return <div className={`careos-clock ${className}`} aria-hidden="true" />;
  const weekday = new Intl.DateTimeFormat("de-CH", { weekday: "short", timeZone: ZONE }).format(now).replace(".", "");
  const date = new Intl.DateTimeFormat("de-CH", { day: "numeric", month: "short", timeZone: ZONE }).format(now);
  const time = formatTime(now);
  return (
    <div className={`careos-clock ${className}`} role="timer" aria-label={`${weekday}, ${date}, ${time} Uhr`}>
      <span>{weekday}</span>
      <span>{date}</span>
      <strong>{time}</strong>
    </div>
  );
}
