"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useNavigationBadges, useWorkContext } from "./care-context";
import { badgeFor, moduleById, navigationFor, routeFor } from "./navigation";
import { AppIcon, appStyle } from "./app-launcher";
import { navigationLabel, termsFor } from "@/lib/terminology";

// Kopf jeder App: farbiges Symbol und Name der App („Wo bin ich?“), daneben ihre Seiten als grosse Reiter,
// z. B. „Mein Dienst“: Heute · Übergabe · Seit letztem Dienst · Verlauf. Keine Untermenüs.
export function PageTabs({ moduleId, child }: { moduleId: string; child: string }) {
  const context = useWorkContext();
  const terms = termsFor(context?.terminology);
  const L = (label: string) => navigationLabel(label, terms);
  const badges = useNavigationBadges();
  const entry = navigationFor(context?.profile.permissions)
    .flatMap((group) => group.modules)
    .find((item) => item.id === moduleId);
  const tabs = entry?.children ?? moduleById(moduleId)?.children ?? [];
  const ref = useRef<HTMLElement>(null);
  // On narrow screens the active tab is scrolled into view.
  useEffect(() => {
    const nav = ref.current;
    const active = nav?.querySelector<HTMLElement>("a.active");
    if (nav && active && nav.scrollWidth > nav.clientWidth)
      nav.scrollLeft = active.offsetLeft - nav.clientWidth / 2 + active.offsetWidth / 2;
  }, [child, tabs.length]);
  const app = entry ?? moduleById(moduleId);
  if (!app) return null;
  const name = L(app.label);
  return (
    <div className="careos-app-bar" style={appStyle(app.hue)}>
      <span className="careos-app-bar-name">
        <AppIcon module={app} size="sm" />
        <strong>{name}</strong>
      </span>
      {tabs.length > 1 && (
        <nav ref={ref} className="page-tabs" aria-label={`${name}: Seiten`}>
          {tabs.map((tab) => {
            const href = routeFor(moduleId, tab);
            if (!href) return null;
            const badge = badgeFor(moduleId, tab);
            const count = badge && badges ? badges[badge] : 0;
            return (
              <Link
                key={tab}
                href={href}
                className={tab === child ? "active" : ""}
                aria-current={tab === child ? "page" : undefined}
                transitionTypes={["nav-tab"]}
              >
                {L(tab)}
                {count > 0 && <em>{count > 99 ? "99+" : count}</em>}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
