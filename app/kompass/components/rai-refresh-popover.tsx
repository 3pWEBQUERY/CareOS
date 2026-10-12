"use client";

import { useEffect, useState } from "react";
import { ModuleIcon } from "@/app/components/module-icon";
import { CareSelect } from "@/app/components/care-form-controls";
import { useWorkContext, useTerms } from "@/app/components/care-context";
import { requestJson, todayInZurich } from "@/app/components/workspace-ui";
import type { RaiWorkplace } from "@/lib/rai-shared";

const SCOPES = { all: "Alle offenen Abklärungen", overdue: "Nur überfällige Abklärungen", new: "Nur neue Bewohner" };
const PERIODS = { 30: "Nächste 30 Tage", 7: "Nächste 7 Tage", 90: "Nächste 90 Tage" };
type Scope = keyof typeof SCOPES;

// Plant die fälligen Abklärungen der gewählten Wohnbereiche (siehe refreshRaiDue).
export function RaiRefreshPopover({
  workplace,
  onClose,
  onDone,
  showToast,
}: {
  workplace: RaiWorkplace;
  onClose: () => void;
  onDone: () => void;
  showToast: (message: string) => void;
}) {
  const t = useTerms();
  const scopes: Record<Scope, string> = { ...SCOPES, new: `Nur neue ${t.many}` };
  const context = useWorkContext();
  const careUnits = context?.careUnits ?? [];
  const [scope, setScope] = useState<Scope>("all");
  const [days, setDays] = useState(30);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [notify, setNotify] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const unitIds = careUnits.map((unit) => unit.id).filter((id) => !excluded.includes(id));
  const toggleUnit = (id: string) =>
    setExcluded((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  const limit = (() => {
    const date = new Date(`${todayInZurich()}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  })();
  const preview = workplace.residents.filter(
    (row) =>
      row.state !== "current" &&
      row.state !== "in_progress" &&
      (row.dueOn ?? "9999") <= limit &&
      row.careUnitId !== null &&
      unitIds.includes(row.careUnitId) &&
      (scope === "overdue" ? row.state === "overdue" : scope === "new" ? !row.lastCompletedOn : true),
  ).length;

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      const result = await requestJson<{ due: number; planned: number; notified: number }>("/api/rai/refresh", {
        method: "POST",
        body: { scope, days, unitIds, notify },
      });
      onDone();
      onClose();
      showToast(
        `${result.due} Fälligkeit${result.due === 1 ? "" : "en"} · ${result.planned} neu geplant${
          result.notified ? ` · ${result.notified} Verantwortliche informiert` : ""
        }`,
      );
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div
      className="area-editor-overlay rai-refresh-overlay"
      role="presentation"
      onMouseDown={(event) => event.currentTarget === event.target && onClose()}
    >
      <section
        className="area-editor-panel rai-refresh-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rai-refresh-title"
      >
        <header className="area-editor-header">
          <div>
            <p className="eyebrow">CareOS Kompass · Arbeitskorb</p>
            <h2 id="rai-refresh-title">Fälligkeiten aktualisieren</h2>
            <p>Gleiche die Fälligkeiten mit dem aktuellen {t.prefix}bestand und informiere die Verantwortlichen.</p>
          </div>
          <button className="area-editor-close" type="button" onClick={onClose} aria-label="Aktualisierung schliessen">
            ×
          </button>
        </header>
        <form
          className="area-editor-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="area-editor-intro">
            <span className="area-editor-icon">
              <ModuleIcon name="calendar" />
            </span>
            <div>
              <strong>Neue Aktualisierung</strong>
              <p>Erste Abklärungen nach Eintritt und Folgeabklärungen werden geplant, überfällige markiert.</p>
            </div>
            <span className="duty-assignment-status">
              <i />
              Bereit zur Synchronisierung
            </span>
          </div>
          <div className="area-editor-grid rai-refresh-grid">
            <label>
              Aktualisierungsumfang
              <CareSelect
                label="Aktualisierungsumfang"
                value={scopes[scope]}
                options={Object.values(scopes)}
                onChange={(label) =>
                  setScope((Object.keys(SCOPES) as Scope[]).find((key) => scopes[key] === label) ?? "all")
                }
              />
            </label>
            <label>
              Zeitraum
              <CareSelect
                label="Zeitraum"
                value={PERIODS[days as keyof typeof PERIODS]}
                options={Object.values(PERIODS)}
                onChange={(label) =>
                  setDays(Number(Object.entries(PERIODS).find(([, value]) => value === label)?.[0] ?? 30))
                }
              />
            </label>
            <fieldset className="area-editor-wide rai-refresh-units">
              <legend>Wohnbereiche einbeziehen</legend>
              <div className="area-service-options">
                {careUnits.map((unit) => (
                  <label className={unitIds.includes(unit.id) ? "selected" : ""} key={unit.id}>
                    <input type="checkbox" checked={unitIds.includes(unit.id)} onChange={() => toggleUnit(unit.id)} />
                    <span>{unit.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="area-editor-wide rai-refresh-options">
              <legend>Zusätzliche Optionen</legend>
              <div className="area-service-options">
                <label className={notify ? "selected" : ""}>
                  <input type="checkbox" checked={notify} onChange={() => setNotify((value) => !value)} />
                  <span>Verantwortliche benachrichtigen</span>
                </label>
              </div>
            </fieldset>
            <section className="rai-refresh-preview area-editor-wide" aria-label="Vorschau der Aktualisierung">
              <div>
                <span className="rai-refresh-preview-icon">
                  <ModuleIcon name="check" />
                </span>
                <span>
                  <strong>Vorschau</strong>
                  <small>
                    {scopes[scope]} · {PERIODS[days as keyof typeof PERIODS]}
                  </small>
                </span>
              </div>
              <span>
                <strong>{unitIds.length}</strong>
                <small>Wohnbereiche</small>
              </span>
              <span>
                <strong>{preview}</strong>
                <small>mögliche Fälligkeiten</small>
              </span>
            </section>
          </div>
          <footer className="area-editor-actions">
            <button className="secondary-button" type="button" onClick={onClose}>
              Abbrechen
            </button>
            {error && (
              <p className="appointment-editor-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary-button" type="submit" disabled={unitIds.length === 0 || saving}>
              <ModuleIcon name="check" /> {saving ? "Wird aktualisiert …" : "Fälligkeiten aktualisieren"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
