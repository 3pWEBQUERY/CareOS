"use client";

import { useMemo, useState } from "react";
import ModulePageShell from "@/app/components/module-page-shell";
import type { AuditEntry } from "@/lib/roster/audit-service";
import type { SettingsPayload } from "@/lib/roster/settings-service";
import { formatDate } from "@/lib/roster/time";
import { useRosterData } from "./roster-api";
import { CareDatePicker, CareOptionSelect } from "@/app/components/care-form-controls";

const ACTIONS: Record<string, string> = {
  created: "angelegt",
  updated: "geändert",
  moved: "verschoben",
  deleted: "gelöscht",
  swapped: "getauscht",
  published: "veröffentlicht",
  reverted_to_draft: "zum Entwurf zurückgesetzt",
  locked: "Monat abgeschlossen",
  reopened: "Monat wieder geöffnet",
  confirmed: "bestätigt",
  saved: "gespeichert",
  imported: "übernommen",
  override_removed: "Überschreibung entfernt",
  requested: "beantragt",
  approved: "genehmigt",
  rejected: "abgelehnt",
  withdrawn: "zurückgezogen",
  declined: "abgelehnt",
  accepted: "angenommen",
  executed: "ausgeführt",
  failed: "fehlgeschlagen",
  expired: "abgelaufen",
  clock_in: "eingestempelt",
  clock_out: "ausgestempelt",
  corrected: "korrigiert",
  ai_applied: "KI-Vorschlag übernommen",
  reported: "gemeldet",
  incomplete: "unvollständig",
  open_shift_interest: "Interesse gemeldet",
  open_shift_assigned: "zugeteilt",
  open_shift_declined: "abgelehnt",
  open_shift_withdrawn: "Interesse zurückgezogen",
};
const ENTITIES: Record<string, string> = {
  shift: "Dienst",
  period: "Monat",
  shift_type: "Diensttyp",
  staffing: "Mindestbesetzung",
  rule_set: "Regelwerk",
  holiday: "Feiertag",
  employee_profile: "Personal",
  qualification: "Qualifikation",
  wage_type: "Lohnart",
  time_off: "Wunschfrei",
  preference: "Dienstwunsch",
  swap: "Tausch",
  time_entry: "Zeiteintrag",
  time_correction: "Korrektur",
  ai_run: "KI",
  absence: "Abwesenheit",
  open_shift_interest: "Offener Dienst",
};
const STATUS: Record<string, string> = {
  PUBLISHED: "veröffentlicht",
  DRAFT: "Entwurf",
  OPEN: "offen",
  APPROVED: "genehmigt",
  REJECTED: "abgelehnt",
  WITHDRAWN: "zurückgezogen",
  EXECUTED: "ausgeführt",
  PENDING_TARGET: "wartet auf Antwort",
  PENDING_APPROVAL: "wartet auf Genehmigung",
  DECLINED: "abgelehnt",
  EXPIRED: "abgelaufen",
  FAILED: "fehlgeschlagen",
  COMPLETE: "erfasst",
  INCOMPLETE: "unvollständig",
  ASSIGNED: "zugeteilt",
  PENDING: "offen",
};
const SOURCES: Record<string, string> = {
  UI: "Oberfläche",
  SWAP: "Tausch",
  AI: "KI",
  SYSTEM: "System",
  SEED: "Demo",
  IMPORT: "Übernahme",
  MANUAL: "Manuell",
  CORRECTION: "Korrektur",
};

// Audit-Log für die Leitung (Spec 8.12): unveränderlich, filterbar nach Person, Zeitraum, Aktion.
export default function AuditWorkspace() {
  const [person, setPerson] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [action, setAction] = useState("");
  const settings = useRosterData<SettingsPayload>("/api/dienstplan/settings");
  const unitId = settings.data?.unitId;
  const query = new URLSearchParams({
    ...(unitId ? { einheit: unitId } : {}),
    ...(person ? { person } : {}),
    ...(from ? { von: from } : {}),
    ...(to ? { bis: to } : {}),
    ...(action ? { aktion: action } : {}),
  });
  const { data, error, loading } = useRosterData<AuditEntry[]>(unitId ? `/api/dienstplan/audit?${query}` : null);
  const names = useMemo(() => new Map((settings.data?.employees ?? []).map((e) => [e.id, e.name])), [settings.data]);
  const typeNames = useMemo(
    () => new Map((settings.data?.shiftTypes ?? []).map((t) => [t.id, t.name])),
    [settings.data],
  );
  const summary = (value: unknown) => {
    if (!value || typeof value !== "object") return "";
    const v = value as Record<string, unknown>;
    const parts = [
      typeof v.date === "string" ? formatDate(v.date) : "",
      typeof v.employeeId === "string" ? (names.get(v.employeeId) ?? "") : "",
      typeof v.shiftTypeId === "string" ? (typeNames.get(v.shiftTypeId) ?? "") : "",
      typeof v.status === "string" ? (STATUS[v.status] ?? "") : "",
    ].filter(Boolean);
    return parts.join(" · ");
  };
  return (
    <ModulePageShell pageClass="roster-page">
      {() => (
        <main className="workspace roster-workspace">
          <header className="page-heading roster-heading">
            <div className="heading-copy">
              <p className="eyebrow">Leitung · Dienstplan</p>
              <h1>Protokoll</h1>
              <p>
                Jede Änderung am Dienstplan mit Vorher/Nachher, Person, Quelle und Begründung. Einträge können nicht
                verändert werden.
              </p>
            </div>
          </header>
          <section className="roster-toolbar">
            <div className="roster-filters">
              <CareOptionSelect
                label="Person"
                value={person}
                onChange={(value) => setPerson(value)}
                options={[
                  { value: "", label: "Alle Personen" },
                  ...(settings.data?.employees ?? []).map((e) => ({ value: String(e.id), label: String(e.name) })),
                ]}
              />
              <label className="roster-month">
                <span className="sr-only">Von</span>
                <CareDatePicker
                  label="Von"
                  placeholder="Von"
                  value={from}
                  max={to || undefined}
                  clearable
                  onChange={(value) => setFrom(value)}
                />
              </label>
              <label className="roster-month">
                <span className="sr-only">Bis</span>
                <CareDatePicker
                  label="Bis"
                  placeholder="Bis"
                  value={to}
                  min={from || undefined}
                  clearable
                  onChange={(value) => setTo(value)}
                />
              </label>
              <CareOptionSelect
                label="Aktion"
                value={action}
                onChange={(value) => setAction(value)}
                options={[
                  { value: "", label: "Alle Aktionen" },
                  ...Object.entries(ACTIONS).map(([key, label]) => ({ value: String(key), label: String(label) })),
                ]}
              />
            </div>
          </section>
          <section className="card roster-card">
            {(error ?? settings.error) && (
              <p className="roster-alert" style={{ margin: 16 }}>
                {(error ?? settings.error)?.message}
              </p>
            )}
            {loading && !data ? (
              <div className="roster-skeleton">
                {Array.from({ length: 6 }, (_, i) => (
                  <span key={i} />
                ))}
              </div>
            ) : (
              <div className="roster-table-wrap">
                <table className="roster-table">
                  <thead>
                    <tr>
                      <th>Zeitpunkt</th>
                      <th>Bereich</th>
                      <th>Aktion</th>
                      <th>Vorher</th>
                      <th>Nachher</th>
                      <th>Durch</th>
                      <th>Quelle</th>
                      <th>Begründung</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data ?? []).map((entry) => (
                      <tr key={entry.id}>
                        <td>{new Date(entry.createdAt).toLocaleString("de-CH", { timeZone: "Europe/Zurich" })}</td>
                        <td>{ENTITIES[entry.entityType] ?? "Dienstplan"}</td>
                        <td>{ACTIONS[entry.action] ?? "geändert"}</td>
                        <td>{summary(entry.before)}</td>
                        <td>{summary(entry.after)}</td>
                        <td>{entry.actor}</td>
                        <td>{SOURCES[entry.source] ?? "System"}</td>
                        <td>{entry.reason ?? ""}</td>
                      </tr>
                    ))}
                    {data && !data.length && (
                      <tr>
                        <td colSpan={8} className="roster-muted">
                          Keine Einträge für diese Filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </main>
      )}
    </ModulePageShell>
  );
}
