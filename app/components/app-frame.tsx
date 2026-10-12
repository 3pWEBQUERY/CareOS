"use client";

import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import AppHeader from "./app-header";
import AppSidebar from "./app-sidebar";
import { AppLauncher } from "./app-launcher";
import { beginNavigation, NavigationProgress, settleNavigation, useNavigationTarget } from "./app-navigation";
import { GlobalSearchDialog } from "./global-search-dialog";
import { MobileNavigation } from "./mobile-navigation";
import { ModuleIcon } from "./module-icon";
import { activePage } from "./navigation";
import { PageTabs } from "./page-tabs";
import { isFramedRoute } from "./shell-routes";

// Fester Rahmen des Arbeitsplatzes im Hauptlayout: Seitenleiste, Kopfzeile, Reiter, mobile Navigation, Suche,
// Hinweise und Ladebalken werden einmal aufgebaut und bleiben beim Seitenwechsel stehen (Zustand, Zähler, offene
// Menüs, kein erneutes Laden). Die Seiten liefern über ModulePageShell nur ihren Inhalt und melden Bereich,
// Ortsangaben und eine eigene Suche an.

export type FramePage = {
  activeModule?: string;
  activeChild?: string;
  locationPrimary?: string;
  locationSecondary?: string;
  // Eigene Suche der Seite (z. B. Bewohnersuche) statt der globalen Suche.
  onSearch?: () => void;
};

export type FrameApi = {
  showToast: (message: string) => void;
  setPage: (page: FramePage | null) => void;
};

export const FrameContext = createContext<FrameApi | null>(null);

export default function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return isFramedRoute(pathname) ? <FramedShell pathname={pathname}>{children}</FramedShell> : <>{children}</>;
}

// Interner Link (gleiche Herkunft, unter /c, normaler Klick): Navigation anmelden, bis die neue Adresse da ist.
function internalTarget(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return null;
  const anchor = (event.target as Element | null)?.closest?.("a[href]");
  if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download"))
    return null;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin || !url.pathname.startsWith("/c")) return null;
  return url.pathname === window.location.pathname ? null : url.pathname;
}

function FramedShell({ pathname, children }: { pathname: string; children: ReactNode }) {
  const router = useRouter();
  const [page, setPage] = useState<FramePage | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [toast, setToast] = useState("");
  const pageRef = useRef(page);
  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  // Während des Wechsels zeigt die Navigation schon das Ziel an.
  const target = useNavigationTarget();
  const shown = activePage(target ?? pathname);
  const moduleId = shown?.moduleId ?? (pathname === "/c" && !target ? "home" : page?.activeModule);
  const child = shown?.child ?? page?.activeChild;

  const openSearch = useCallback(() => {
    if (pageRef.current?.onSearch) pageRef.current.onSearch();
    else setSearchOpen(true);
  }, []);

  // Neue Adresse: laufende Navigation abgeschlossen, Suche zu.
  useEffect(() => {
    settleNavigation();
    const close = window.setTimeout(() => setSearchOpen(false), 0);
    return () => window.clearTimeout(close);
  }, [pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
      }
      if (event.key === "Escape") setSearchOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      const href = internalTarget(event);
      if (!href) return;
      router.prefetch(href);
      beginNavigation(href);
    };
    // Einfache Links (<a href>) ohne eigene Behandlung: ebenfalls ohne Neuladen der ganzen Anwendung.
    const onPlainLink = (event: MouseEvent) => {
      const href = internalTarget(event);
      if (!href) return;
      const anchor = (event.target as Element).closest("a") as HTMLAnchorElement;
      event.preventDefault();
      const url = new URL(anchor.href);
      router.push(`${url.pathname}${url.search}${url.hash}`);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick, true);
    document.addEventListener("click", onPlainLink);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("click", onPlainLink);
    };
  }, [openSearch, router]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const api = useMemo<FrameApi>(() => ({ showToast: setToast, setPage }), []);

  return (
    <FrameContext.Provider value={api}>
      <div className="app-shell">
        <AppSidebar activeModule={moduleId} activeChild={child} onToast={setToast} />
        <div className="main-column">
          <AppHeader
            locationPrimary={page?.locationPrimary}
            locationSecondary={page?.locationSecondary}
            searchOpen={searchOpen}
            onSearch={openSearch}
            onToast={setToast}
          />
          {shown && <PageTabs moduleId={shown.moduleId} child={shown.child} />}
          {children}
        </div>
        <MobileNavigation activeModule={moduleId} />
        <AppLauncher />
        {searchOpen && <GlobalSearchDialog onClose={() => setSearchOpen(false)} />}
        {toast && (
          <div className="toast" role="status">
            <ModuleIcon name="check" />
            {toast}
          </div>
        )}
      </div>
      <NavigationProgress />
    </FrameContext.Provider>
  );
}
