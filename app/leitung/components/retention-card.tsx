"use client";

import { useState } from "react";
import { EditorDialog, formatDate, requestJson, useApiData } from "@/app/components/workspace-ui";
import { useTerms } from "@/app/components/care-context";
import type { RetentionCase, WaitlistRetentionCase } from "@/lib/retention";

const STATUS: Record<RetentionCase["status"], string> = {
  discharged: "Ausgetreten",
  deceased: "Verstorben",
  archived: "Archiviert",
};

// Datenschutz: Akten mit abgelaufener Aufbewahrungsfrist; gelöscht wird nur auf ausdrückliche Bestätigung.
export function RetentionCard({ showToast }: { showToast: (message: string) => void }) {
  const t = useTerms();
  const data = useApiData<{ years: number | null; cases: RetentionCase[] }>("/api/admin/retention");
  const [pending, setPending] = useState<RetentionCase | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const cases = data.data?.cases ?? [];
  return (
    <section className="card admin-terminology-card admin-retention-card" aria-labelledby="admin-retention-title">
      <div className="card-header">
        <div>
          <p className="eyebrow">Datenschutz</p>
          <h2 className="card-title" id="admin-retention-title">
            Löschfristen
          </h2>
          <p className="card-subtitle">
            {data.data?.years
              ? `${t.prefix}akten ${data.data.years} Jahre nach dem Austritt · gelöscht wird nur auf Bestätigung`
              : "Aufbewahrungsfrist ist noch nicht festgelegt (Einstellung „Aufbewahrungsfrist Akten“)"}
          </p>
        </div>
        {cases.length > 0 && <span className="status-badge attention">{cases.length}</span>}
      </div>
      <div className="admin-retention-list">
        {data.error && <p className="list-hint">{data.error}</p>}
        {cases.map((item) => (
          <div className="admin-retention-row" key={item.id}>
            <span>
              <strong>{item.name}</strong>
              <small>
                {STATUS[item.status]} {formatDate(item.exitedOn)} · Frist abgelaufen {formatDate(item.dueOn)}
              </small>
            </span>
            <button
              className="quiet-button"
              type="button"
              onClick={() => {
                setPending(item);
                setConfirmation("");
                setError("");
              }}
            >
              Endgültig löschen
            </button>
          </div>
        ))}
        {data.data?.years && !cases.length && <p className="list-hint">Keine Akte mit abgelaufener Frist.</p>}
      </div>
      {pending && (
        <EditorDialog
          id="retention-delete"
          eyebrow="Datenschutz · Endgültige Löschung"
          title={`${pending.name} löschen`}
          description={`Die ${t.prefix}akte wird mit Dokumentation, Medikation, Wunden, Vitalwerten, Dokumenten, Aufgaben und Übergaben endgültig gelöscht. Das lässt sich nicht rückgängig machen. Qualitätsereignisse bleiben ohne Personenbezug für die Statistik. Gelöscht werden auch Betäubungsmittel-Bestände und -Buchungen der Person – bitte gesetzliche Aufbewahrungspflichten beachten.`}
          onClose={() => setPending(null)}
          onSubmit={async () => {
            setSaving(true);
            setError("");
            try {
              await requestJson("/api/admin/retention", {
                method: "DELETE",
                body: { residentId: pending.id, confirmation },
              });
              setPending(null);
              data.reload();
              showToast(`${pending.name} endgültig gelöscht`);
            } catch (cause) {
              setError((cause as Error).message);
            } finally {
              setSaving(false);
            }
          }}
          saving={saving}
          error={error}
          submitLabel="Endgültig löschen"
          danger
        >
          <label className="area-editor-wide">
            <span>Zur Bestätigung den vollständigen Namen eingeben</span>
            <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
          </label>
        </EditorDialog>
      )}
    </section>
  );
}

const WAITLIST_STATUS: Record<WaitlistRetentionCase["status"], string> = {
  admitted: "Platz vergeben",
  withdrawn: "Zurückgezogen",
};

// Datenschutz: abgeschlossene Anfragen der Warteliste nach Ablauf der Frist; gelöscht wird nur auf Bestätigung.
export function WaitlistRetentionCard({ showToast }: { showToast: (message: string) => void }) {
  const data = useApiData<{ months: number | null; cases: WaitlistRetentionCase[] }>("/api/admin/retention/waitlist");
  const [pending, setPending] = useState<WaitlistRetentionCase[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const cases = data.data?.cases ?? [];
  const ask = (items: WaitlistRetentionCase[]) => {
    setPending(items);
    setError("");
  };
  return (
    <section
      className="card admin-terminology-card admin-retention-card"
      aria-labelledby="admin-waitlist-retention-title"
    >
      <div className="card-header">
        <div>
          <p className="eyebrow">Datenschutz</p>
          <h2 className="card-title" id="admin-waitlist-retention-title">
            Löschfristen Warteliste
          </h2>
          <p className="card-subtitle">
            {data.data?.months
              ? `Abgeschlossene Anfragen ${data.data.months} Monate nach dem Abschluss · gelöscht wird nur auf Bestätigung`
              : "Aufbewahrungsfrist ist noch nicht festgelegt (Einstellung „Aufbewahrungsfrist Warteliste“)"}
          </p>
        </div>
        {cases.length > 0 && <span className="status-badge attention">{cases.length}</span>}
      </div>
      <div className="admin-retention-list">
        {data.error && <p className="list-hint">{data.error}</p>}
        {cases.map((item) => (
          <div className="admin-retention-row" key={item.id}>
            <span>
              <strong>{item.name}</strong>
              <small>
                {WAITLIST_STATUS[item.status]} {formatDate(item.closedOn)} · Frist abgelaufen {formatDate(item.dueOn)}
              </small>
            </span>
            <button className="quiet-button" type="button" onClick={() => ask([item])}>
              Endgültig löschen
            </button>
          </div>
        ))}
        {cases.length > 1 && (
          <button className="secondary-button" type="button" onClick={() => ask(cases)}>
            Alle {cases.length} endgültig löschen
          </button>
        )}
        {data.data?.months && !cases.length && <p className="list-hint">Keine Anfrage mit abgelaufener Frist.</p>}
      </div>
      {pending && (
        <EditorDialog
          id="waitlist-retention-delete"
          eyebrow="Datenschutz · Endgültige Löschung"
          title={pending.length === 1 ? `Anfrage von ${pending[0].name} löschen` : `${pending.length} Anfragen löschen`}
          description="Gelöscht werden die Angaben der Anfrage (Name, Geburtsdatum, Kontakt, Bedarf, Status). Das lässt sich nicht rückgängig machen. Die Akte einer eingetretenen Person bleibt unverändert."
          onClose={() => setPending(null)}
          onSubmit={async () => {
            setSaving(true);
            setError("");
            try {
              await requestJson("/api/admin/retention/waitlist", {
                method: "DELETE",
                body: { ids: pending.map((item) => item.id) },
              });
              setPending(null);
              data.reload();
              showToast(
                pending.length === 1 ? "Anfrage endgültig gelöscht" : `${pending.length} Anfragen endgültig gelöscht`,
              );
            } catch (cause) {
              setError((cause as Error).message);
            } finally {
              setSaving(false);
            }
          }}
          saving={saving}
          error={error}
          submitLabel="Endgültig löschen"
          danger
        >
          <ul className="area-editor-wide">
            {pending.map((item) => (
              <li key={item.id}>
                {item.name} · {WAITLIST_STATUS[item.status]} {formatDate(item.closedOn)}
              </li>
            ))}
          </ul>
        </EditorDialog>
      )}
    </section>
  );
}
