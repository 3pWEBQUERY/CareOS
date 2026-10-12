"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionResult, Violation } from "@/lib/roster/types";

// Client für die Dienstplan-Endpunkte (Ergebnisformat { ok, data } / { ok, error }).
export class RosterRequestError extends Error {
  code: string;
  violations: Violation[];
  constructor(code: string, message: string, violations: Violation[] = []) {
    super(message);
    this.code = code;
    this.violations = violations;
  }
}

export async function rosterRequest<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init?.method ?? "GET",
      cache: "no-store",
      headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new RosterRequestError("NETWORK", "Keine Verbindung. Bitte Netzwerk prüfen und erneut versuchen.");
  }
  const payload = (await response.json().catch(() => null)) as ActionResult<T> | null;
  if (!payload) throw new RosterRequestError("INTERNAL", "Die Antwort des Servers war ungültig.");
  if (!payload.ok) throw new RosterRequestError(payload.error.code, payload.error.message, payload.error.violations);
  return payload.data;
}

// Loads `url`; polls `changesUrl` every 25 s (paused while the tab is hidden) and reloads on change.
export function useRosterData<T extends object>(url: string | null, changesUrlFor?: (data: T) => string | null) {
  const [state, setState] = useState<{ url: string; data?: T; error?: RosterRequestError } | null>(null);
  const [version, setVersion] = useState(0);
  const token = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    rosterRequest<T>(url).then(
      (data) => {
        if (cancelled) return;
        token.current = (data as { changeToken?: string }).changeToken;
        setState({ url, data });
      },
      (error: RosterRequestError) =>
        !cancelled && setState((current) => ({ url, data: current?.url === url ? current.data : undefined, error })),
    );
    return () => {
      cancelled = true;
    };
  }, [url, version]);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const loaded = state?.data;
  const changesUrl = loaded && changesUrlFor ? changesUrlFor(loaded) : null;
  useEffect(() => {
    if (!changesUrl) return;
    let timer: number | undefined;
    const check = async () => {
      if (document.visibilityState === "visible") {
        const result = await rosterRequest<{ token: string }>(changesUrl).catch(() => null);
        if (result && token.current && result.token !== token.current) reload();
      }
      timer = window.setTimeout(check, 25_000);
    };
    timer = window.setTimeout(check, 25_000);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      window.clearTimeout(timer);
      void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [changesUrl, reload]);
  const current = state && state.url === url ? state : null;
  return {
    data: current?.data ?? (state?.data as T | undefined),
    error: current?.error,
    loading: !current || (!current.data && !current.error),
    reload,
    setData: (update: (data: T) => T) => setState((s) => (s?.data ? { ...s, data: update(s.data) } : s)),
  };
}
