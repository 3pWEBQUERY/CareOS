"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useNavigationBadges, useWorkContext } from "./care-context";
import { ModuleIcon } from "./module-icon";
import { openAppLauncher } from "./app-launcher";
import { DOCK_APPS, appHref, moduleBadges, rememberPage, sidebarNavigation } from "./navigation";
import { navigationLabel, termsFor } from "@/lib/terminology";

// Oberste Ebene von CareOS: runder Start-Knopf links, in der Mitte die Leiste der meistgenutzten Apps als eine
// Glas-Pille (die gewählte App hell hinterlegt, die Markierung gleitet beim Wechsel mit), rechts Suche und Profil.

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

type Item = { id: string; label: string; href: string | null; count: number };

export function AppSwitcher({ activeModule, activeChild }: { activeModule?: string; activeChild?: string }) {
  const context = useWorkContext();
  const terms = termsFor(context?.terminology);
  const badges = useNavigationBadges();
  const modules = sidebarNavigation(context?.profile.permissions).flatMap((group) => group.modules);
  const count = (moduleId: string) =>
    badges ? moduleBadges(moduleId).reduce((sum, key) => sum + (badges[key] ?? 0), 0) : 0;
  const items: Item[] = [
    { id: "home", label: "Start", href: "/c", count: 0 },
    ...DOCK_APPS.map((id) => modules.find((module) => module.id === id))
      .filter((module) => !!module)
      .map((module) => ({
        id: module.id,
        label: navigationLabel(module.shortLabel ?? module.label, terms),
        href: appHref(module),
        count: count(module.id),
      })),
  ];
  const inBar = items.some((item) => item.id === activeModule);
  const activeId = inBar ? activeModule : activeModule && activeModule !== "settings" ? "apps" : undefined;
  // Richtung des Übergangs: Apps rechts der gewählten gleiten von rechts herein, links davon von links.
  const activeIndex = activeId === "apps" ? items.length : items.findIndex((item) => item.id === activeId);

  // Jede besuchte Seite für „Zuletzt geöffnet“ unter „Alle Apps“ merken.
  useEffect(() => {
    if (activeModule && activeChild) rememberPage(activeModule, activeChild);
  }, [activeModule, activeChild]);

  // Gleitende Markierung unter der gewählten App.
  const navRef = useRef<HTMLElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const active = nav.querySelector<HTMLElement>("[data-active='true']");
      setThumb(active ? { left: active.offsetLeft, width: active.offsetWidth } : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [activeId, items.length]);

  return (
    <nav ref={navRef} className="careos-switcher" aria-label="Apps">
      {thumb && (
        <span
          className="careos-switcher-thumb"
          aria-hidden="true"
          style={{ "--thumb-x": `${thumb.left}px`, "--thumb-w": `${thumb.width}px` } as CSSProperties}
        />
      )}
      {items.map((item, index) =>
        item.href ? (
          <Link
            key={item.id}
            href={item.href}
            className="careos-switcher-item"
            data-active={activeId === item.id}
            aria-current={activeId === item.id ? "page" : undefined}
            transitionTypes={[index < activeIndex ? "nav-back" : "nav-forward"]}
          >
            {item.label}
            {item.count > 0 && (
              <em className="careos-switcher-count" aria-label={`${item.count} offen`}>
                {item.count > 99 ? "99+" : item.count}
              </em>
            )}
          </Link>
        ) : null,
      )}
      <button
        type="button"
        className="careos-switcher-item"
        data-active={activeId === "apps"}
        aria-haspopup="dialog"
        onClick={openAppLauncher}
      >
        Alle Apps
      </button>
    </nav>
  );
}

// Uhrzeit, genau auf den Minutenwechsel; erst im Browser gesetzt (keine abweichende Zeit aus dem Server-Rendern).
function useClock() {
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
const ZONE = "Europe/Zurich";

// Grosse Uhr wie auf einem Sperrbildschirm: Wochentag, Datum, Uhrzeit untereinander.
export function SideClock({ className = "" }: { className?: string }) {
  const now = useClock();
  if (!now) return <div className={`careos-clock ${className}`} aria-hidden="true" />;
  const weekday = new Intl.DateTimeFormat("de-CH", { weekday: "short", timeZone: ZONE }).format(now).replace(".", "");
  const date = new Intl.DateTimeFormat("de-CH", { day: "numeric", month: "short", timeZone: ZONE }).format(now);
  const time = new Intl.DateTimeFormat("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: ZONE }).format(now);
  return (
    <div className={`careos-clock ${className}`} role="timer" aria-label={`${weekday}, ${date}, ${time} Uhr`}>
      <span>{weekday}</span>
      <span>{date}</span>
      <strong>{time}</strong>
    </div>
  );
}
