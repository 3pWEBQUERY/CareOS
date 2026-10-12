"use client";

import { useState } from "react";
import { EditorDialog } from "@/app/components/workspace-ui";
import type { RuleCode, Violation } from "@/lib/roster/types";

const SEVERITY_LABEL = { BLOCK: "Nicht möglich", WARN: "Warnung", INFO: "Hinweis" } as const;

export type ViolationPrompt = {
  title: string;
  message: string;
  violations: Violation[];
  // Present when warnings may be overridden with a reason.
  confirm?: (acknowledged: RuleCode[], reason: string) => Promise<void>;
};

export function ViolationList({ violations }: { violations: Violation[] }) {
  const ordered = [...violations].sort(
    (a, b) => ["BLOCK", "WARN", "INFO"].indexOf(a.severity) - ["BLOCK", "WARN", "INFO"].indexOf(b.severity),
  );
  if (!ordered.length) return <p className="roster-muted">Keine Auffälligkeiten.</p>;
  return (
    <ul className="roster-violations">
      {ordered.map((violation, index) => (
        <li className={`roster-violation ${violation.severity.toLowerCase()}`} key={`${violation.code}-${index}`}>
          <span className="roster-violation-badge">{SEVERITY_LABEL[violation.severity]}</span>
          <span>{violation.message}</span>
        </li>
      ))}
    </ul>
  );
}

// Zeigt Blocker (nicht übersteuerbar) oder Warnungen, die mit Begründung bestätigt werden können.
export function ViolationDialog({ prompt, onClose }: { prompt: ViolationPrompt; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const blocking = prompt.violations.some((v) => v.severity === "BLOCK");
  const warnings = [...new Set(prompt.violations.filter((v) => v.severity === "WARN").map((v) => v.code))];
  const canConfirm = !blocking && !!prompt.confirm && warnings.length > 0;
  const submit = async () => {
    if (!canConfirm) {
      onClose();
      return;
    }
    if (!reason.trim()) {
      setError("Bitte begründen, warum die Warnungen übersteuert werden.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await prompt.confirm!(warnings, reason.trim());
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  };
  return (
    <EditorDialog
      id="roster-violations"
      eyebrow="Dienstplan · Regelprüfung"
      title={prompt.title}
      description={prompt.message}
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel={canConfirm ? "Trotzdem speichern" : "Verstanden"}
    >
      <div className="area-editor-wide">
        <ViolationList violations={prompt.violations} />
      </div>
      {canConfirm && (
        <label className="area-editor-wide">
          <span>Begründung (wird protokolliert)</span>
          <textarea
            autoFocus
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="z. B. Aushilfe ist organisiert, Besetzung wird am Vortag geprüft"
          />
        </label>
      )}
    </EditorDialog>
  );
}
