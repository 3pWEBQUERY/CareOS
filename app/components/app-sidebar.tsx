"use client";

import { useAppRouter } from "./app-navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigationBadges, useWorkContext } from "./care-context";
import { BrandIcon } from "./brand-icon";
import { openHelp } from "./help-panel";
import { ModuleIcon } from "./module-icon";
import { AppIcon, appStyle, openAppLauncher } from "./app-launcher";
import { DOCK_APPS, appHref, moduleBadges, rememberPage, sidebarNavigation, type ModuleIconName } from "./navigation";
import { navigationLabel, termsFor } from "@/lib/terminology";

type AppSidebarProps = {
  activeModule?: string;
  activeChild?: string;
  onToast?: (message: string) => void;
};

export function SidebarTooltip({
  label,
  shortcut,
  placement = "right",
}: {
  label: string;
  // Tastaturkürzel, als Taste dargestellt (wie unter „Tastaturkürzel“ in der Kopfzeile).
  shortcut?: string;
  placement?: "right" | "top";
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const anchor = anchorRef.current;
    const trigger = anchor?.parentElement;
    if (!trigger) return;
    const updatePosition = () => {
      const rect = trigger.getBoundingClientRect();
      setPosition(
        placement === "top"
          ? { top: rect.top - 8, left: rect.left + rect.width / 2 }
          : { top: rect.top + rect.height / 2, left: rect.right + 12 },
      );
    };
    const show = () => {
      updatePosition();
      setOpen(true);
    };
    const hide = () => setOpen(false);
    trigger.addEventListener("mouseenter", show);
    trigger.addEventListener("mouseleave", hide);
    trigger.addEventListener("focus", show);
    trigger.addEventListener("blur", hide);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      trigger.removeEventListener("mouseenter", show);
      trigger.removeEventListener("mouseleave", hide);
      trigger.removeEventListener("focus", show);
      trigger.removeEventListener("blur", hide);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [placement]);

  return (
    <>
      <span ref={anchorRef} className="sidebar-tooltip-anchor" aria-hidden="true" />
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            className={`sidebar-tooltip sidebar-tooltip-portal ${placement === "top" ? "sidebar-tooltip-top" : ""}`}
            role="tooltip"
            style={{ top: position.top, left: position.left }}
          >
            {label}
            {shortcut && (
              <kbd className="sidebar-tooltip-key" aria-label={`Taste ${shortcut}`}>
                {shortcut}
              </kbd>
            )}
          </span>,
          document.body,
        )}
    </>
  );
}

export default function AppSidebar({ activeModule, activeChild }: AppSidebarProps) {
  const router = useAppRouter();
  const context = useWorkContext();
  const terms = termsFor(context?.terminology);
  const L = (label: string) => navigationLabel(label, terms);
  const badges = useNavigationBadges();
  const modules = sidebarNavigation(context?.profile.permissions).flatMap((group) => group.modules);
  const dock = DOCK_APPS.map((id) => modules.find((module) => module.id === id)).filter((module) => !!module);
  const count = (moduleId: string) =>
    badges ? moduleBadges(moduleId).reduce((sum, key) => sum + (badges[key] ?? 0), 0) : 0;
  // Eine App ausserhalb der Leiste ist offen: „Alle Apps“ zeigt das an.
  const otherApp =
    !!activeModule &&
    activeModule !== "home" &&
    activeModule !== "settings" &&
    !dock.some((m) => m.id === activeModule);

  // Every visited page is remembered for "Zuletzt geöffnet".
  useEffect(() => {
    if (activeModule && activeChild) rememberPage(activeModule, activeChild);
  }, [activeModule, activeChild]);

  function go(href: string | null) {
    if (href) router.push(href);
  }

  return (
    <aside className="sidebar sidebar-rail careos-dock" aria-label="Hauptnavigation">
      <div className="sidebar-rail-head">
        <BrandIcon size={32} />
        <span className="careos-dock-brand">CareOS</span>
      </div>
      <nav className="sidebar-rail-scroll careos-dock-scroll">
        <DockButton
          label="Start"
          icon="home"
          hue={214}
          active={activeModule === "home"}
          onPointerEnter={() => router.prefetch("/c")}
          onClick={() => go("/c")}
        />
        {dock.map((module) => {
          const href = appHref(module);
          const value = count(module.id);
          return (
            <DockButton
              key={module.id}
              label={L(module.shortLabel ?? module.label)}
              module={module}
              hue={module.hue}
              count={value}
              active={activeModule === module.id}
              onPointerEnter={() => href && router.prefetch(href)}
              onClick={() => go(href)}
            />
          );
        })}
        <span className="sidebar-rail-divider" aria-hidden="true" />
        <DockButton label="Alle Apps" icon="apps" hue={214} active={otherApp} onClick={openAppLauncher} haspopup />
      </nav>
      <div className="sidebar-rail-footer careos-dock-footer">
        <DockButton
          label="Einstellungen"
          icon="settings"
          hue={215}
          active={activeModule === "settings"}
          onPointerEnter={() => router.prefetch("/c/einstellungen")}
          onClick={() => go("/c/einstellungen")}
        />
        <DockButton label="Hilfe" icon="help" hue={215} onClick={openHelp} haspopup />
      </div>
    </aside>
  );
}

// Ein Knopf der Leiste: farbiges Symbol und darunter immer der Name (keine Bedeutung nur über ein Symbol).
function DockButton({
  label,
  icon,
  module,
  hue,
  count = 0,
  active = false,
  haspopup = false,
  onClick,
  onPointerEnter,
}: {
  label: string;
  icon?: ModuleIconName;
  module?: Parameters<typeof AppIcon>[0]["module"];
  hue: number;
  count?: number;
  active?: boolean;
  haspopup?: boolean;
  onClick: () => void;
  onPointerEnter?: () => void;
}) {
  return (
    <button
      className={`sidebar-rail-button careos-dock-button ${active ? "active" : ""}`}
      type="button"
      style={appStyle(hue)}
      aria-current={active && !haspopup ? "page" : undefined}
      aria-haspopup={haspopup ? "dialog" : undefined}
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      onFocus={onPointerEnter}
    >
      {/* Name aus dem sichtbaren Text (übersetzbar), die Zahl nur für Screenreader dahinter. */}
      <span className="careos-dock-icon" aria-hidden="true">
        {module ? (
          <AppIcon module={module} size="sm" />
        ) : (
          <span className="careos-app-icon careos-app-icon-sm careos-app-icon-plain">
            <ModuleIcon name={icon ?? "home"} />
          </span>
        )}
        {count > 0 && <em className="careos-badge">{count > 99 ? "99+" : count}</em>}
      </span>
      <span className="careos-dock-label">{label}</span>
      {count > 0 && <span className="sr-only"> ({count})</span>}
    </button>
  );
}
