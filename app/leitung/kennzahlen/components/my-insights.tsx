"use client";

import { useTerms } from "@/app/components/care-context";
import Link from "next/link";
import { useState } from "react";
import ModulePageShell from "@/app/components/module-page-shell";
import { EditorDialog, LoadError, requestJson, useApiData } from "@/app/components/workspace-ui";
import type { Kpi } from "@/lib/insights-shared";
import { navigationLabel } from "@/lib/terminology";
import {
  INSIGHT_PINS_MAX,
  INSIGHT_VIEWS,
  insightPin,
  type InsightViewId,
  type UserPreferences,
  type UserSettings,
} from "@/lib/user-settings-shared";
import { LeadershipHeading, LeadershipKpis } from "../../components/leadership-page-parts";
import { PageBoard, PageBoardCustomizer, usePageBoard, type BoardWidget } from "@/app/components/page-board";

const VIEWS = Object.keys(INSIGHT_VIEWS) as InsightViewId[];
const VIEW_PATHS: Record<InsightViewId, string> = {
  care: "/leitung/kennzahlen",
  residents: "/leitung/kennzahlen/bewohner",
  leadership: "/leitung/kennzahlen/leitung",
  workforce: "/leitung/kennzahlen/personal",
};

// Auswahl der Kennzahlen im Seitenpanel; gespeichert in den persönlichen Einstellungen.
function PinPicker({
  kpis,
  pins,
  onClose,
  onSaved,
}: {
  kpis: Record<InsightViewId, Kpi[] | null>;
  pins: string[];
  onClose: () => void;
  onSaved: (pins: string[]) => void;
}) {
  const t = useTerms();
  const [selected, setSelected] = useState<string[]>(pins);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const toggle = (pin: string) =>
    setSelected((current) => (current.includes(pin) ? current.filter((item) => item !== pin) : [...current, pin]));
  return (
    <EditorDialog
      id="my-insights"
      eyebrow="Kennzahlen · Meine Kennzahlen"
      title="Kennzahlen auswählen"
      description={`Die gewählten Kennzahlen erscheinen auf „Meine Kennzahlen“ – höchstens ${INSIGHT_PINS_MAX}.`}
      onClose={onClose}
      onSubmit={async () => {
        setSaving(true);
        setError("");
        try {
          const result = await requestJson<{ preferences: UserPreferences }>("/api/me/settings", {
            method: "PATCH",
            body: { insightPins: selected },
          });
          onSaved(result.preferences.insightPins);
        } catch (cause) {
          setError((cause as Error).message);
          setSaving(false);
        }
      }}
      saving={saving}
      error={error}
      submitLabel="Auswahl speichern"
    >
      {VIEWS.map((view) => (
        <fieldset className="my-insights-group" key={view}>
          <legend>{navigationLabel(INSIGHT_VIEWS[view], t)}</legend>
          {!kpis[view] && <p className="list-hint">Wird geladen …</p>}
          {kpis[view]?.map((kpi) => {
            const pin = insightPin(view, kpi.id ?? kpi.label);
            return (
              <label className="my-insights-option" key={pin}>
                <input type="checkbox" checked={selected.includes(pin)} onChange={() => toggle(pin)} />
                <span>
                  <strong>{kpi.label}</strong>
                  <small>
                    {kpi.value} · {kpi.note}
                  </small>
                </span>
              </label>
            );
          })}
        </fieldset>
      ))}
      <p className="my-insights-count">
        {selected.length} von höchstens {INSIGHT_PINS_MAX} gewählt
      </p>
    </EditorDialog>
  );
}

// „Meine Kennzahlen“: persönliches Dashboard aus den Kennzahlen aller Auswertungen.
export default function MyInsights() {
  const t = useTerms();
  const settings = useApiData<UserSettings>("/api/me/settings");
  const [pinsOverride, setPinsOverride] = useState<string[] | null>(null);
  const [picking, setPicking] = useState(false);
  const pins = pinsOverride ?? settings.data?.preferences.insightPins ?? [];
  const wanted = (view: InsightViewId) =>
    settings.data && (picking || pins.some((pin) => pin.startsWith(`${view}:`))) ? `/api/insights?view=${view}` : null;
  const views = {
    care: useApiData<{ kpis: Kpi[] }>(wanted("care")),
    residents: useApiData<{ kpis: Kpi[] }>(wanted("residents")),
    leadership: useApiData<{ kpis: Kpi[] }>(wanted("leadership")),
    workforce: useApiData<{ kpis: Kpi[] }>(wanted("workforce")),
  };
  const kpis = Object.fromEntries(VIEWS.map((view) => [view, views[view].data?.kpis ?? null])) as Record<
    InsightViewId,
    Kpi[] | null
  >;
  const groups = VIEWS.map((view) => ({
    view,
    items: pins
      .filter((pin) => pin.startsWith(`${view}:`))
      .map((pin) => kpis[view]?.find((kpi) => insightPin(view, kpi.id ?? kpi.label) === pin))
      .filter((kpi): kpi is Kpi => Boolean(kpi)),
    pinned: pins.some((pin) => pin.startsWith(`${view}:`)),
    error: views[view].error,
    reload: views[view].reload,
  })).filter((group) => group.pinned);

  const board = usePageBoard("insights-mine");
  const widgets: BoardWidget[] = groups.map((group) => ({
    id: group.view,
    label: navigationLabel(INSIGHT_VIEWS[group.view], t),
    fraction: 1,
    content: (
      <section className="my-insights-section" aria-label={navigationLabel(INSIGHT_VIEWS[group.view], t)}>
        <div className="my-insights-section-head">
          <p className="eyebrow">{navigationLabel(INSIGHT_VIEWS[group.view], t)}</p>
          <Link href={VIEW_PATHS[group.view]}>Alle anzeigen</Link>
        </div>
        {group.error && <LoadError message={group.error} onRetry={group.reload} />}
        {!group.error && !kpis[group.view] && <p className="list-hint">Wird geladen …</p>}
        {kpis[group.view] && group.items.length > 0 && <LeadershipKpis kpis={group.items} />}
        {kpis[group.view] && !group.items.length && (
          <p className="list-hint">Die gewählten Kennzahlen gibt es in dieser Auswertung nicht mehr.</p>
        )}
      </section>
    ),
  }));

  return (
    <ModulePageShell
      activeModule="insights"
      activeChild="Meine Kennzahlen"
      pageClass="leadership-page leadership-myInsights"
      locationSecondary="Persönliche Auswahl"
    >
      {(showToast) => (
        <main className="workspace leadership-workspace">
          <LeadershipHeading
            eyebrow="Kennzahlen"
            title="Meine Kennzahlen"
            description={`Dein persönliches Dashboard: die Kennzahlen aus Pflege, ${t.manyDative}, Leitung und Personal, die du im Blick behalten willst.`}
            action={{ label: "Kennzahlen auswählen", icon: "plus", onClick: () => setPicking(true) }}
            customize={
              groups.length > 0
                ? { editing: board.editing, onToggle: () => board.setEditing((value) => !value) }
                : undefined
            }
          />
          {settings.error && <LoadError message={settings.error} onRetry={settings.reload} />}
          {settings.data && !groups.length && (
            <section className="card my-insights-empty">
              <h2 className="card-title">Noch keine Kennzahlen gewählt</h2>
              <p>Wähle aus allen Auswertungen die Kennzahlen aus, die hier erscheinen sollen.</p>
              <button className="primary-button" type="button" onClick={() => setPicking(true)}>
                Kennzahlen auswählen
              </button>
            </section>
          )}
          {board.editing && groups.length > 0 && <PageBoardCustomizer board={board} widgets={widgets} />}
          {groups.length > 0 && <PageBoard board={board} widgets={widgets} />}
          {picking && (
            <PinPicker
              kpis={kpis}
              pins={pins}
              onClose={() => setPicking(false)}
              onSaved={(next) => {
                setPinsOverride(next);
                setPicking(false);
                showToast("Meine Kennzahlen gespeichert");
              }}
            />
          )}
        </main>
      )}
    </ModulePageShell>
  );
}
