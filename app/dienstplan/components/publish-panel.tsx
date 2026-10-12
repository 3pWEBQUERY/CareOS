"use client";

import { useState } from "react";
import { monthLabel } from "@/lib/roster/time";
import type { RuleCode, Violation } from "@/lib/roster/types";
import type { SchedulePayload } from "@/lib/roster/view-types";
import { RosterRequestError, rosterRequest } from "./roster-api";
import { SidePanel } from "./side-panel";
import { ViolationList } from "./violation-dialog";

// Analyse eines Monats und Veröffentlichen (Spec 8.4): Blocker verhindern, Warnungen mit Begründung.
export function PublishPanel({
  data,
  mode,
  onClose,
  onDone,
}: {
  data: SchedulePayload;
  mode: "analyze" | "publish";
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [violations, setViolations] = useState<Violation[]>(data.violations);
  const blocking = violations.filter((v) => v.severity === "BLOCK");
  const warnings = violations.filter((v) => v.severity === "WARN");
  const infos = violations.filter((v) => v.severity === "INFO");
  const period = data.period;
  const label = monthLabel(data.year, data.month);
  const published = period?.status === "PUBLISHED";

  const run = async (action: "publish" | "revert") => {
    if (!period) return;
    if (action === "publish" && warnings.length && !reason.trim()) {
      setError("Bitte begründen, warum trotz der Warnungen veröffentlicht wird.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await rosterRequest(`/api/dienstplan/periods/${period.id}`, {
        method: "POST",
        body: {
          action,
          expectedVersion: period.version,
          ...(action === "publish" && warnings.length
            ? {
                acknowledgedWarnings: [...new Set(warnings.map((w) => w.code))] as RuleCode[],
                overrideReason: reason.trim(),
              }
            : {}),
        },
      });
      onDone(
        action === "publish"
          ? `${label} veröffentlicht – das Team wurde benachrichtigt.`
          : `${label} ist wieder ein Entwurf.`,
      );
    } catch (cause) {
      if (cause instanceof RosterRequestError && cause.violations.length) setViolations(cause.violations);
      setError(cause instanceof Error ? cause.message : "Aktion fehlgeschlagen.");
      setBusy(false);
    }
  };

  return (
    <SidePanel
      id="roster-publish"
      eyebrow={`Dienstplan · ${data.unit.name}`}
      title={
        mode === "publish"
          ? published
            ? `${label} ist veröffentlicht`
            : `${label} veröffentlichen`
          : `Analyse ${label}`
      }
      description={
        mode === "publish"
          ? published
            ? "Änderungen wirken sofort und benachrichtigen die betroffenen Personen. Zurück zum Entwurf geht nur ohne Zeiteinträge."
            : "Nach dem Veröffentlichen sehen alle Mitarbeitenden den Plan und werden benachrichtigt."
          : "Alle Befunde der Regelprüfung für diesen Monat, berechnet aus den aktuellen Daten."
      }
      onClose={onClose}
      actions={
        <>
          <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>
            Schliessen
          </button>
          {mode === "publish" && published && (
            <button className="secondary-button" type="button" onClick={() => void run("revert")} disabled={busy}>
              Zurück zum Entwurf
            </button>
          )}
          {mode === "publish" && !published && (
            <button
              className="primary-button"
              type="button"
              onClick={() => void run("publish")}
              disabled={busy || blocking.length > 0}
            >
              {busy ? "Veröffentlichen…" : "Veröffentlichen"}
            </button>
          )}
        </>
      }
    >
      <div className="roster-analysis-summary">
        <span className={blocking.length ? "critical" : "ok"}>
          <strong>{blocking.length}</strong> Blocker
        </span>
        <span className={warnings.length ? "attention" : "ok"}>
          <strong>{warnings.length}</strong> Warnungen
        </span>
        <span>
          <strong>{infos.length}</strong> Hinweise
        </span>
      </div>
      {blocking.length > 0 && mode === "publish" && (
        <p className="roster-alert">
          Blocker müssen zuerst im Raster behoben werden – sie lassen sich nicht übersteuern.
        </p>
      )}
      <ViolationList violations={violations} />
      {mode === "publish" && !published && warnings.length > 0 && blocking.length === 0 && (
        <label className="roster-reason">
          <span>Begründung für das Veröffentlichen trotz Warnungen (wird protokolliert)</span>
          <textarea rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
      )}
      {error && (
        <p className="appointment-editor-error" role="alert">
          {error}
        </p>
      )}
    </SidePanel>
  );
}
