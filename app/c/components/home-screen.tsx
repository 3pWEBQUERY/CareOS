"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { AppIcon, OsAppGrid, useAppSearch, useApps } from "@/app/components/app-launcher";
import { useNavigationBadges, useWorkContext, type NavigationBadges } from "@/app/components/care-context";
import { ModuleIcon } from "@/app/components/module-icon";
import { moduleById, routeFor } from "@/app/components/navigation";
import { ZONE, formatTime, useClock } from "@/app/components/top-navigation";
import type { ShiftOverview, TimelineItem } from "@/lib/shift-shared";

// Startbildschirm von CareOS wie auf einem Tablet: links die Uhr und zwei Widgets für den eigenen Dienst
// („Mein Dienst“ und „Als Nächstes“), rechts alle Apps, die die Person nutzen darf, mit Suche wie im Launchpad.

export function HomeScreen() {
  const context = useWorkContext();
  const badges = useNavigationBadges();
  const overview = useShiftOverview(Boolean(context?.profile.permissions.includes("residents.read")));
  const firstName = context?.profile.displayName.split(" ")[0] ?? "";
  return (
    <main className="workspace os-home">
      <section className="os-home-today" aria-label="Heute">
        <HomeClock firstName={firstName} />
        {overview !== null && <ShiftWidget overview={overview} badges={badges} />}
        {overview !== null && <UpNextWidget items={overview === "loading" ? null : overview.timeline} />}
      </section>
      <AppSpringboard badges={badges} />
    </main>
  );
}

// null: kein Zugriff auf den Dienst (Widgets entfallen); "loading": Daten kommen noch.
function useShiftOverview(allowed: boolean) {
  const [overview, setOverview] = useState<ShiftOverview | "loading" | null>("loading");
  useEffect(() => {
    if (!allowed) return;
    let live = true;
    const load = () =>
      fetch("/api/shift?range=shift", { cache: "no-store" })
        .then((response) => (response.ok ? (response.json() as Promise<ShiftOverview>) : null))
        .then((data) => live && setOverview(data))
        .catch(() => live && setOverview(null));
    void load();
    const timer = window.setInterval(load, 120_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [allowed]);
  return allowed ? overview : null;
}

function HomeClock({ firstName }: { firstName: string }) {
  const now = useClock();
  const hour = now
    ? Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: ZONE }).format(now))
    : 8;
  const greeting = hour < 5 ? "Gute Nacht" : hour < 11 ? "Guten Morgen" : hour < 17 ? "Guten Tag" : "Guten Abend";
  const date = now
    ? new Intl.DateTimeFormat("de-CH", { weekday: "long", day: "numeric", month: "long", timeZone: ZONE }).format(now)
    : "";
  return (
    <div className="os-clock">
      <p className="os-clock-date">{date}</p>
      <p className="os-clock-time" role="timer" aria-label={now ? `${formatTime(now)} Uhr` : undefined}>
        {now ? formatTime(now) : " "}
      </p>
      <h1 id="page-title" className="os-clock-greeting">
        {greeting}
        {firstName ? `, ${firstName}` : ""}
      </h1>
    </div>
  );
}

const shiftHref = routeFor("shift", "Heute") ?? "/c";

function ShiftWidget({ overview, badges }: { overview: ShiftOverview | "loading"; badges: NavigationBadges | null }) {
  const shiftApp = moduleById("shift");
  const data = overview === "loading" ? null : overview;
  const shift = data?.current ?? null;
  const done = data?.stats.done ?? 0;
  const total = data?.stats.total ?? 0;
  const counters: Array<{ label: string; value: number | undefined; href: string | null }> = [
    { label: "Aufgaben", value: badges?.tasks, href: routeFor("tasks", "Meine Aufgaben") },
    { label: "Übergaben", value: badges?.handover, href: routeFor("shift", "Übergabe") },
    { label: "Nachrichten", value: badges?.messages, href: routeFor("messenger", "Nachrichten") },
  ];
  return (
    <article className="os-widget os-widget-shift" aria-busy={!data}>
      <Link className="os-widget-head" href={shiftHref}>
        {shiftApp && <AppIcon module={shiftApp} size="sm" />}
        <span>Mein Dienst</span>
        <ModuleIcon name="chevron" className="os-widget-chevron" />
      </Link>
      <div className="os-shift-body">
        {!data ? (
          <p className="os-shift-title os-skeleton">&nbsp;</p>
        ) : shift ? (
          <>
            <p className="os-shift-title">{shift.name}</p>
            <p className="os-shift-meta">
              {formatTime(new Date(shift.startsAt))} – {formatTime(new Date(shift.endsAt))}
              {shift.careUnit ? ` · ${shift.careUnit}` : ""}
              <span className={`os-shift-state ${shift.checkedInAt ? "on" : ""}`}>
                {shift.checkedInAt ? "Eingecheckt" : "Geplant"}
              </span>
            </p>
          </>
        ) : data.next ? (
          <>
            <p className="os-shift-title">Heute frei</p>
            <p className="os-shift-meta">
              Nächster Dienst: {data.next.name},{" "}
              {new Intl.DateTimeFormat("de-CH", {
                weekday: "short",
                day: "numeric",
                month: "short",
                timeZone: ZONE,
              }).format(new Date(data.next.startsAt))}{" "}
              {formatTime(new Date(data.next.startsAt))}
            </p>
          </>
        ) : (
          <>
            <p className="os-shift-title">Kein Dienst geplant</p>
            <p className="os-shift-meta">{data.careUnit.name}</p>
          </>
        )}
        {data && total > 0 && (
          <div className="os-progress" role="img" aria-label={`${done} von ${total} erledigt`}>
            <span style={{ "--progress": `${Math.round((done / total) * 100)}%` } as CSSProperties} />
            <small>
              {done} von {total} erledigt
            </small>
          </div>
        )}
      </div>
      <div className="os-counters">
        {counters.map((counter) =>
          counter.href ? (
            <Link key={counter.label} href={counter.href} data-alert={(counter.value ?? 0) > 0}>
              <strong>{counter.value ?? "–"}</strong>
              <span>{counter.label}</span>
            </Link>
          ) : null,
        )}
      </div>
    </article>
  );
}

function UpNextWidget({ items }: { items: TimelineItem[] | null }) {
  const upcoming = (items ?? [])
    .filter((item) => !item.done)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, 4);
  return (
    <article className="os-widget os-widget-next" aria-busy={!items}>
      <Link className="os-widget-head" href={routeFor("shift", "Tagesliste") ?? shiftHref}>
        <span>Als Nächstes</span>
        <ModuleIcon name="chevron" className="os-widget-chevron" />
      </Link>
      {items && !upcoming.length ? (
        <p className="os-next-empty">Nichts mehr offen in diesem Dienst.</p>
      ) : (
        <ol className="os-next-list">
          {(items ? upcoming : [null, null, null]).map((item, index) =>
            item ? (
              <li key={item.id}>
                <Link href={item.href} data-tone={item.overdue ? "critical" : item.tone}>
                  <time dateTime={item.at}>{formatTime(new Date(item.at))}</time>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </span>
                </Link>
              </li>
            ) : (
              <li key={index} className="os-skeleton" aria-hidden="true" />
            ),
          )}
        </ol>
      )}
    </article>
  );
}

function AppSpringboard({ badges }: { badges: NavigationBadges | null }) {
  const { groups, terms, ready } = useApps();
  const [query, setQuery] = useState("");
  const shown = useAppSearch(groups, terms, query);
  return (
    <section className="os-springboard" aria-label="Apps">
      <label className="os-search">
        <ModuleIcon name="search" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Suchen"
          aria-label="App suchen"
        />
      </label>
      {ready && !shown.length ? (
        <p className="os-springboard-empty">Keine App gefunden.</p>
      ) : (
        <OsAppGrid entries={shown} terms={terms} badges={badges} />
      )}
    </section>
  );
}
