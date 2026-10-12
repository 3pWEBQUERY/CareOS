"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Printer, X } from "@phosphor-icons/react";
import { formatDate, useApiData } from "@/app/components/workspace-ui";
import type { KitchenList } from "@/lib/kitchen-list-shared";

const stamp = (iso: string) =>
  new Intl.DateTimeFormat("de-CH", {
    timeZone: "Europe/Zurich",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

// Küchenliste je Wohnbereich (A4 quer, ein Wohnbereich pro Seite): Kostform, Konsistenz, Allergien und Vorlieben aus
// dem Ernährungsplan, Stand mit Datum und Uhrzeit.
export default function KitchenPrint() {
  const params = useSearchParams();
  const unitId = params.get("unit") ?? "";
  const { data, error } = useApiData<KitchenList>(`/api/nutrition/kitchen-list${unitId ? `?unit=${unitId}` : ""}`);
  const printed = useRef(false);
  useEffect(() => {
    if (!data || printed.current || params.get("dialog") === "0") return;
    printed.current = true;
    const timer = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(timer);
  }, [data, params]);

  return (
    <main className="transfer-print">
      <style>{"@page { size: A4 landscape; margin: 10mm; }"}</style>
      <div className="roster-print-bar">
        <strong>Küchenliste</strong>
        <span>A4 quer · ein Wohnbereich pro Seite · im Druckdialog „Als PDF speichern“ wählen</span>
        <button className="primary-button" type="button" disabled={!data} onClick={() => window.print()}>
          <Printer className="button-icon" /> Drucken / PDF
        </button>
        <button className="secondary-button" type="button" onClick={() => window.close()}>
          <X className="button-icon" /> Schliessen
        </button>
      </div>
      {(error || !data || !data.units.length) && <h1 className="print-hidden-heading">Küchenliste</h1>}
      {error ? (
        <p className="roster-print-message" role="alert">
          Die Küchenliste konnte nicht erstellt werden: {error}
        </p>
      ) : !data ? (
        <p className="roster-print-message">Liste wird erstellt …</p>
      ) : !data.units.length ? (
        <p className="roster-print-message">Keine aktiven Wohnbereiche erfasst.</p>
      ) : (
        data.units.map((unit) => (
          <article key={unit.id} className="evacuation-sheet kitchen-sheet" aria-label={`Küchenliste ${unit.name}`}>
            <header>
              <h1>
                Küchenliste · {unit.name}
                <span>{data.organization}</span>
              </h1>
              <p>
                <strong>Stand: {stamp(data.generatedAt)}</strong> · {unit.people.length}{" "}
                {unit.people.length === 1 ? "Person" : "Personen"} · Angaben aus dem Ernährungsplan
              </p>
            </header>
            {!unit.people.length ? (
              <p className="roster-print-message">Zurzeit keine Personen in diesem Wohnbereich.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th scope="col">Zimmer</th>
                    <th scope="col">Name</th>
                    <th scope="col">Kostform</th>
                    <th scope="col">Konsistenz</th>
                    <th scope="col">Allergien / Unverträglichkeiten</th>
                    <th scope="col">Vorlieben &amp; Hilfe beim Essen</th>
                  </tr>
                </thead>
                <tbody>
                  {unit.people.map((person) => (
                    <tr key={person.id}>
                      <td>{person.room}</td>
                      <td>
                        <strong>{person.name}</strong>
                        {person.planUpdatedAt ? (
                          <small>Plan vom {formatDate(person.planUpdatedAt.slice(0, 10))}</small>
                        ) : (
                          <small>kein Ernährungsplan</small>
                        )}
                      </td>
                      <td>{person.diet || "–"}</td>
                      <td>{person.texture || "–"}</td>
                      <td className={person.allergies ? "kitchen-allergies" : ""}>
                        {person.allergies || "keine erfasst"}
                      </td>
                      <td>
                        {[
                          person.preferences,
                          person.assistance && `Hilfe: ${person.assistance}`,
                          person.mealRhythm && `Rhythmus: ${person.mealRhythm}`,
                          person.fluidLimitMl !== null && `Trinkmenge begrenzt auf ${person.fluidLimitMl} ml`,
                          person.instructions,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "–"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>
        ))
      )}
    </main>
  );
}
