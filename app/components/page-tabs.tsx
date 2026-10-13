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
  // Reichen die Reiter nicht in die Breite, wird nur so weit geblättert, dass der gewählte ganz sichtbar ist.
  useEffect(() => {
    const nav = ref.current;
    const active = nav?.querySelector<HTMLElement>("a.active");
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    const start = active.offsetLeft - nav.offsetLeft;
    const end = start + active.offsetWidth;
    if (end > nav.scrollLeft + nav.clientWidth - 28) nav.scrollLeft = end - nav.clientWidth + 36;
    else if (start < nav.scrollLeft) nav.scrollLeft = Math.max(0, start - 8);
  }, [child, tabs.length]);
  const app = entry ?? moduleById(moduleId);
  if (!app) return null;
  const name = L(app.label);
  // Richtung des Übergangs: Reiter rechts vom gewählten gleiten von rechts herein, links davon von links.
  const activeIndex = tabs.indexOf(child);
  return (
    <div className="careos-app-bar" style={appStyle(app.hue)}>
      <span className="careos-app-bar-name">
        <AppIcon module={app} size="sm" />
        <strong>{name}</strong>
      </span>
      {tabs.length > 1 && (
        <nav ref={ref} className="page-tabs" aria-label={`${name}: Seiten`}>
          {tabs.map((tab, index) => {
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
                transitionTypes={[index < activeIndex ? "nav-tab-back" : "nav-tab-forward"]}
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
