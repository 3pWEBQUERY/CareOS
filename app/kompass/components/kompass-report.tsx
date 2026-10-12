"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Printer, X } from "@phosphor-icons/react";
import { useWorkContext } from "@/app/components/care-context";
import { formatDate, useApiData } from "@/app/components/workspace-ui";
import {
  KOMPASS_DOMAINS,
  KOMPASS_NAME,
  OCCASIONS,
  answerRank,
  optionLabel,
  type KompassData,
} from "@/lib/kompass-instrument";
import type { KompassReport } from "@/lib/kompass-shared";

// Veränderung gegenüber der letzten Abklärung, beschreibend (höher heisst mehr Unterstützung bzw. häufiger).
function change(before: number | null, now: number | null) {
  if (before === null || now === null || before === now) return "";
  return now > before ? "mehr als zuvor" : "weniger als zuvor";
}

const GOAL_STATUS: Record<string, string> = {
  active: "läuft",
  achieved: "erreicht",
  not_achieved: "nicht erreicht",
  cancelled: "abgebrochen",
};

// Bericht einer Abklärung mit dem CareOS Kompass (A4 hoch): alle Antworten, Vergleich mit der letzten Abklärung,
// Ressourcen, Wünsche, Handlungsbedarf mit übernommenem Ziel und Gesamtbild; mit Feldern für die Unterschriften.
export default function KompassReportView() {
  const context = useWorkContext();
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const { data, error } = useApiData<KompassReport>(id ? `/api/rai/assessments/${encodeURIComponent(id)}` : null);
  const printed = useRef(false);
  useEffect(() => {
    if (!data || printed.current || params.get("dialog") === "0") return;
    printed.current = true;
    const timer = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(timer);
  }, [data, params]);
  const kompass = data?.assessment.kompass ?? null;
  const previous: KompassData | null = data?.previous?.kompass ?? null;

  return (
    <main className="transfer-print">
      <style>{"@page { size: A4 portrait; margin: 12mm; }"}</style>
      <div className="roster-print-bar">
        <strong>Bericht Kompass</strong>
        <span>A4 hoch · im Druckdialog „Als PDF speichern“ wählen</span>
        <button className="primary-button" type="button" disabled={!data} onClick={() => window.print()}>
          <Printer className="button-icon" /> Drucken / PDF
        </button>
        <button className="secondary-button" type="button" onClick={() => window.close()}>
          <X className="button-icon" /> Schliessen
        </button>
      </div>
      {(error || !data) && <h1 className="print-hidden-heading">Bericht Kompass</h1>}
      {error || !id ? (
        <p className="roster-print-message" role="alert">
          Der Bericht konnte nicht erstellt werden{error ? `: ${error}` : "."}
        </p>
      ) : !data || !kompass ? (
        <p className="roster-print-message">Bericht wird erstellt …</p>
      ) : (
        <article className="transfer-sheet kompass-sheet">
          <header className="transfer-head">
            <div>
              <p>{`${KOMPASS_NAME} · ${OCCASIONS[kompass.occasion]}`}</p>
              <h1>{data.resident.name}</h1>
              <span>
                {[
                  data.resident.birthDate ? `geb. ${formatDate(data.resident.birthDate)}` : "",
                  data.resident.room,
                  data.resident.unit,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
            <div className="transfer-facility">
              {context?.profile.organizationName && <strong>{context.profile.organizationName}</strong>}
              <span>Abklärung vom {formatDate(kompass.assessedOn)}</span>
              <span>
                {/* Auf Papier ein festes Datum statt „Heute“. */}
                Abgeschlossen
                {data.assessment.completedAt
                  ? ` am ${new Intl.DateTimeFormat("de-CH", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Europe/Zurich",
                    }).format(new Date(data.assessment.completedAt))}`
                  : ""}
                {data.assessment.completedBy ? ` von ${data.assessment.completedBy}` : ""}
              </span>
              {kompass.participants.length > 0 && <span>Beteiligt: {kompass.participants.join(", ")}</span>}
            </div>
          </header>
          <p className="kompass-sheet-note">
            Beschreibung dessen, was beobachtet und erfragt wurde. Der Kompass berechnet keine Punktzahl, keine
            Pflegestufe und kein Risiko; den Handlungsbedarf hat die Fachperson je Bereich festgehalten.
            {previous ? ` Verglichen mit der Abklärung vom ${formatDate(previous.assessedOn)}.` : ""}
          </p>
          {KOMPASS_DOMAINS.map((domain) => {
            const notes = kompass.domains[domain.id] ?? {};
            const goal = notes.goalId ? data.goals[notes.goalId] : null;
            return (
              <section key={domain.id} className="kompass-sheet-domain">
                <h2>{domain.title}</h2>
                <table>
                  <thead>
                    <tr>
                      <th>Frage</th>
                      <th>Antwort</th>
                      {previous && <th>Letzte Abklärung</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {domain.items.map((item) => {
                      const key = `${domain.id}.${item.id}`;
                      const now = kompass.answers[key];
                      const before = previous?.answers[key];
                      const moved = change(answerRank(item, before), answerRank(item, now));
                      return (
                        <tr key={item.id}>
                          <td>{item.label}</td>
                          <td>
                            {optionLabel(item, now) ?? "–"}
                            {moved && <small>{moved}</small>}
                          </td>
                          {previous && <td>{optionLabel(item, before) ?? "–"}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <dl>
                  {notes.resources && (
                    <>
                      <dt>Ressourcen</dt>
                      <dd>{notes.resources}</dd>
                    </>
                  )}
                  {notes.wishes && (
                    <>
                      <dt>Wünsche und Gewohnheiten</dt>
                      <dd>{notes.wishes}</dd>
                    </>
                  )}
                  {notes.notes && (
                    <>
                      <dt>Beobachtungen</dt>
                      <dd>{notes.notes}</dd>
                    </>
                  )}
                  <dt>Handlungsbedarf</dt>
                  <dd>
                    {notes.need ? notes.needText : "Kein Handlungsbedarf"}
                    {goal && (
                      <small>
                        {`Ziel in der Pflegeplanung: ${goal.statement} (${GOAL_STATUS[goal.status] ?? goal.status}${goal.targetDate ? `, Überprüfung am ${formatDate(goal.targetDate)}` : ""})`}
                      </small>
                    )}
                  </dd>
                </dl>
              </section>
            );
          })}
          <section className="kompass-sheet-domain">
            <h2>Gesamtbild aus Sicht der Fachperson</h2>
            <p>{kompass.summary || "Kein Gesamtbild erfasst."}</p>
          </section>
          <div className="transfer-foot">
            <div className="transfer-signature">
              <span>Ort, Datum, Unterschrift Fachperson</span>
            </div>
            <div className="transfer-signature">
              <span>Gesehen: Person bzw. Vertretung</span>
            </div>
          </div>
        </article>
      )}
    </main>
  );
}
