"use client";

import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  ViewTransition,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import AppHeader from "./app-header";
import { FrameContext, type FrameApi } from "./app-frame";
import { AppLauncher } from "./app-launcher";
import { GlobalSearchDialog } from "./global-search-dialog";
import { MobileNavigation } from "./mobile-navigation";
import { ModuleIcon } from "./module-icon";
import { activePage } from "./navigation";
import { PageTabs } from "./page-tabs";

type ShellProps = {
  activeModule?: string;
  activeChild?: string;
  pageClass: string;
  locationPrimary?: string;
  locationSecondary?: string;
  // Eigene Suche der Seite (Kopfzeile und ⌘K) statt der globalen Suche.
  onSearch?: () => void;
  children: (showToast: (message: string) => void) => ReactNode;
};

// Seite im Arbeitsplatz. Im festen Rahmen (app-frame) liefert sie nur ihren Inhalt mit Übergang; ausserhalb davon
// baut sie den Rahmen wie bisher selbst auf.
export default function ModulePageShell(props: ShellProps) {
  const frame = useContext(FrameContext);
  return frame ? <FramedPage frame={frame} {...props} /> : <StandaloneShell {...props} />;
}

// Übergänge: Der Inhalt gleitet weich herein; mit Richtung (App-Leiste, Reiter), sonst steigt er leicht auf.
const ENTER = {
  "nav-tab-forward": "page-tab-in-forward",
  "nav-tab-back": "page-tab-in-back",
  "nav-tab": "page-tab-in",
  "nav-forward": "page-in-forward",
  "nav-back": "page-in-back",
  default: "page-in",
};
const EXIT = {
  "nav-tab-forward": "page-tab-out-forward",
  "nav-tab-back": "page-tab-out-back",
  "nav-tab": "page-tab-out",
  "nav-forward": "page-out-forward",
  "nav-back": "page-out-back",
  default: "page-out",
};

function FramedPage({
  frame,
  activeModule,
  activeChild,
  pageClass,
  locationPrimary,
  locationSecondary,
  onSearch,
  children,
}: ShellProps & { frame: FrameApi }) {
  const searchRef = useRef(onSearch);
  useEffect(() => {
    searchRef.current = onSearch;
  }, [onSearch]);
  const hasSearch = Boolean(onSearch);
  useLayoutEffect(() => {
    frame.setPage({
      activeModule,
      activeChild,
      locationPrimary,
      locationSecondary,
      onSearch: hasSearch ? () => searchRef.current?.() : undefined,
    });
    return () => frame.setPage(null);
  }, [frame, activeModule, activeChild, locationPrimary, locationSecondary, hasSearch]);
  return (
    <ViewTransition enter={ENTER} exit={EXIT} default="none">
      <div className={`page-view ${pageClass}`}>{children(frame.showToast)}</div>
    </ViewTransition>
  );
}

// Page frame for pages outside the fixed frame: header with app bar, mobile navigation, global search and toast.
function StandaloneShell({
  activeModule,
  activeChild,
  pageClass,
  locationPrimary,
  locationSecondary,
  onSearch,
  children,
}: ShellProps) {
  // The address decides module and tab; the props remain for pages outside the navigation.
  const pathname = usePathname();
  const page = activePage(pathname);
  const moduleId = page?.moduleId ?? activeModule;
  const child = page?.child ?? activeChild;
  const [searchOpen, setSearchOpen] = useState(false);
  const [toast, setToast] = useState("");
  const openSearch = useCallback(() => (onSearch ? onSearch() : setSearchOpen(true)), [onSearch]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
      }
      if (event.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSearch]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <div className={`app-shell ${pageClass}`}>
      <div className="main-column">
        <AppHeader
          activeModule={moduleId}
          activeChild={child}
          appBar={page && <PageTabs moduleId={page.moduleId} child={page.child} />}
          locationPrimary={locationPrimary}
          locationSecondary={locationSecondary}
          searchOpen={searchOpen}
          onSearch={openSearch}
          onToast={setToast}
        />
        {children(setToast)}
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
  );
}
