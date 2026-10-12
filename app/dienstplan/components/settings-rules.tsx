"use client";

import { useState } from "react";
import { formatHours } from "@/lib/roster/time";
import { rosterRequest } from "./roster-api";
import { CareOptionSelect } from "@/app/components/care-form-controls";
import { act, type TabProps } from "./settings-tab-shared";

// --- Regelwerk -----------------------------------------------------------------------------------

const RULE_FIELDS = [
  ["weeklyNormMinutes", "Wochenarbeitszeit bei 100 %", "h"],
  ["minRestMinutes", "Mindest-Ruhezeit zwischen Diensten", "h"],
  ["maxDailyWorkMinutes", "Max. Netto-Arbeitszeit pro Dienst", "h"],
  ["maxWeeklyWorkMinutes", "Max. Netto-Arbeitszeit pro Woche", "h"],
  ["deviationThresholdMinutes", "Warnung ab Zeitabweichung", "min"],
  ["missingClockOutAfterMinutes", "Fehlendes Ausstempeln melden nach", "min"],
  ["clockInEarliestMinutes", "Einstempeln frühestens vor Dienstbeginn", "min"],
] as const;

export function RulesTab({ data, reload, showToast }: TabProps) {
  const [scope, setScope] = useState<"unit" | "org">(data.hasUnitOverride || !data.isAdmin ? "unit" : "org");
  const [rules, setRules] = useState(data.ruleSet);
  const [confirm, setConfirm] = useState(false);
  const toHours = (minutes: number) => String(Math.round((minutes / 60) * 100) / 100);
  const save = (extra: Record<string, unknown> = {}) =>
    act(
      () =>
        rosterRequest("/api/dienstplan/settings/rules", {
          method: "PUT",
          body: { ...rules, unitId: scope === "unit" ? data.unitId : null, confirmValues: confirm, ...extra },
        }),
      extra.action === "removeOverride"
        ? "Wohnbereich nutzt wieder das Regelwerk der Organisation"
        : "Regelwerk gespeichert",
      reload,
      showToast,
    );
  return (
    <section className="card roster-card">
      <div className="roster-section-head">
        <div>
          <h2>Regelwerk</h2>
          <p>
            Grenzwerte für Ruhezeit, Arbeitszeit, Pausen und Zeiterfassung. Keine Werte im Code – jede Änderung wird
            protokolliert.
          </p>
        </div>
        <CareOptionSelect
          label="Gültigkeit"
          value={scope}
          onChange={(value) => setScope(value as "unit" | "org")}
          options={[
            ...(data.isAdmin ? [{ value: "org", label: "Ganze Organisation" }] : []),
            ...(data.unitId
              ? [{ value: "unit", label: `Nur ${data.units.find((u) => u.id === data.unitId)?.name} (Überschreibung)` }]
              : []),
          ]}
        />
      </div>
      {!data.ruleSet.valuesConfirmed && (
        <p className="roster-alert" style={{ margin: 16 }}>
          Beispielwerte (Schweizer ArG) – rechtlich prüfen. Die Werte hängen von Arbeitsgesetz, Gesamtarbeitsvertrag und
          Betrieb ab.
        </p>
      )}
      <div className="roster-form-grid">
        {RULE_FIELDS.map(([key, label, unit]) => (
          <label key={key}>
            {label} ({unit})
            <input
              type="number"
              step={unit === "h" ? 0.25 : 1}
              value={unit === "h" ? toHours(rules[key]) : rules[key]}
              onChange={(e) =>
                setRules({
                  ...rules,
                  [key]: unit === "h" ? Math.round(Number(e.target.value) * 60) : Number(e.target.value),
                })
              }
            />
            {unit === "h" && <small>{formatHours(rules[key])}</small>}
          </label>
        ))}
        <label>
          Max. Arbeitstage am Stück
          <input
            type="number"
            min={1}
            max={31}
            value={rules.maxConsecutiveWorkDays}
            onChange={(e) => setRules({ ...rules, maxConsecutiveWorkDays: Number(e.target.value) })}
          />
        </label>
        <label>
          Nachtfenster ab
          <input
            type="time"
            value={rules.nightStart}
            onChange={(e) => setRules({ ...rules, nightStart: e.target.value })}
          />
        </label>
        <label>
          Nachtfenster bis
          <input
            type="time"
            value={rules.nightEnd}
            onChange={(e) => setRules({ ...rules, nightEnd: e.target.value })}
          />
        </label>
        <label>
          Zeitzone
          <input value={rules.timezone} onChange={(e) => setRules({ ...rules, timezone: e.target.value })} />
        </label>
        <label>
          KI-Läufe pro Stunde und Person
          <input
            type="number"
            min={0}
            max={100}
            value={rules.aiRunsPerHour}
            onChange={(e) => setRules({ ...rules, aiRunsPerHour: Number(e.target.value) })}
          />
        </label>
        <fieldset>
          <legend>Pausenstaffel (Arbeitszeit mehr als … → Pause)</legend>
          {rules.breakRules.map((rule, index) => (
            <div className="roster-row-actions" key={index}>
              <input
                className="roster-inline-input"
                type="number"
                aria-label="Arbeitszeit in Minuten"
                value={rule.minWorkMinutes}
                onChange={(e) =>
                  setRules({
                    ...rules,
                    breakRules: rules.breakRules.map((r, i) =>
                      i === index ? { ...r, minWorkMinutes: Number(e.target.value) } : r,
                    ),
                  })
                }
              />
              Min →
              <input
                className="roster-inline-input"
                type="number"
                aria-label="Pause in Minuten"
                value={rule.minBreakMinutes}
                onChange={(e) =>
                  setRules({
                    ...rules,
                    breakRules: rules.breakRules.map((r, i) =>
                      i === index ? { ...r, minBreakMinutes: Number(e.target.value) } : r,
                    ),
                  })
                }
              />
              Min Pause
            </div>
          ))}
        </fieldset>
        <label className="roster-checkbox">
          <input
            type="checkbox"
            checked={rules.autoSwapApproval}
            onChange={(e) => setRules({ ...rules, autoSwapApproval: e.target.checked })}
          />
          Diensttausch automatisch genehmigen
        </label>
        <label className="roster-checkbox">
          <input
            type="checkbox"
            checked={rules.allowShiftTakeover}
            onChange={(e) => setRules({ ...rules, allowShiftTakeover: e.target.checked })}
          />
          Dienstübernahme ohne Gegendienst erlauben
        </label>
        <label className="roster-checkbox">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          Werte sind rechtlich geprüft und bestätigt
        </label>
      </div>
      <div className="roster-form-actions">
        {scope === "unit" && data.hasUnitOverride && (
          <button className="secondary-button" type="button" onClick={() => void save({ action: "removeOverride" })}>
            Überschreibung entfernen
          </button>
        )}
        <button className="primary-button" type="button" onClick={() => void save()}>
          Regelwerk speichern
        </button>
      </div>
    </section>
  );
}
