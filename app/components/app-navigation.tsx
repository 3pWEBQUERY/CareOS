"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { activePage } from "./navigation";

// Navigation innerhalb des Arbeitsplatzes wie in einer einzigen Anwendung: Der Rahmen (Seitenleiste, Kopfzeile)
// bleibt stehen, nur der Inhalt wechselt. Dieses Modul kennt das laufende Ziel (für die sofortige Markierung in der
// Navigation und den Ladebalken) und wählt die Art des Übergangs: anderer Bereich oder anderer Reiter im Bereich.

type NavigationState = { target: string | null; running: number };
let state: NavigationState = { target: null, running: 0 };
const listeners = new Set<() => void>();

function update(next: Partial<NavigationState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const IDLE: NavigationState = { target: null, running: 0 };
const useNavigationState = () =>
  useSyncExternalStore(
    subscribe,
    () => state,
    () => IDLE,
  );

// Laufende Navigation anmelden; die Rückgabe meldet sie wieder ab (höchstens 15 s, falls sie nie ankommt).
export function beginNavigation(target: string | null) {
  update({ target: target ?? state.target, running: state.running + 1 });
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    window.clearTimeout(timer);
    update({ running: Math.max(0, state.running - 1), target: state.running <= 1 ? null : state.target });
  };
  const timer = window.setTimeout(finish, 15_000);
  return finish;
}

// Am Ziel angekommen (neue Adresse): alles Laufende ist erledigt.
export function settleNavigation() {
  if (state.running || state.target) update(IDLE);
}

export const useNavigationPending = () => useNavigationState().running > 0;
export const useNavigationTarget = () => useNavigationState().target;

const pathOf = (href: string) => href.split(/[?#]/)[0] || "/";

// Übergangsart: Reiter im selben Bereich (leises Überblenden) oder anderer Bereich (Inhalt steigt auf).
export function transitionTypeFor(from: string, href: string) {
  const current = activePage(from);
  const next = activePage(pathOf(href));
  return current && next && current.moduleId === next.moduleId ? "nav-tab" : "nav-module";
}

// Wie useRouter, aber push/replace melden die Navigation an (Ladebalken, Markierung) und geben die Übergangsart mit.
export function useAppRouter() {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    if (!pending) return;
    return beginNavigation(target);
  }, [pending, target]);
  return useMemo(() => {
    const go = (method: "push" | "replace") => (href: string, options?: { scroll?: boolean }) => {
      // Nur der Suchteil ändert sich (z. B. Filter): kein Seitenwechsel, kein Übergang.
      if (pathOf(href) === pathname) return router[method](href, options);
      setTarget(pathOf(href));
      startTransition(() => router[method](href, { ...options, transitionTypes: [transitionTypeFor(pathname, href)] }));
    };
    return { ...router, push: go("push"), replace: go("replace") };
  }, [router, pathname]);
}

// Dünner Ladebalken oben, sobald ein Seitenwechsel länger als einen Augenblick dauert; am Ziel läuft er voll und
// blendet aus.
export function NavigationProgress() {
  const pending = useNavigationPending();
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  useEffect(() => {
    if (pending) {
      const show = window.setTimeout(() => setPhase("running"), 120);
      return () => window.clearTimeout(show);
    }
    const finish = window.setTimeout(() => setPhase((current) => (current === "running" ? "done" : "idle")), 0);
    const hide = window.setTimeout(() => setPhase("idle"), 420);
    return () => {
      window.clearTimeout(finish);
      window.clearTimeout(hide);
    };
  }, [pending]);
  return <div className={`navigation-progress ${phase}`} aria-hidden="true" />;
}
