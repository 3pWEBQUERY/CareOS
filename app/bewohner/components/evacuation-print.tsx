"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Printer, X } from "@phosphor-icons/react";
import { useApiData } from "@/app/components/workspace-ui";
import { EVACUATION_MOBILITY, EVACUATION_MOBILITY_KEYS, type EvacuationList } from "@/lib/evacuation-shared";
import { RESUSCITATION_STATUSES } from "@/lib/resident-record-shared";

const stamp = (iso: string) =>
  new Intl.DateTimeFormat("de-CH", {
    timeZone: "Europe/Zurich",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

// Evakuierungs- und Notfallliste je Wohnbereich (A4 hoch, ein Wohnbereich pro Seite): Zimmer, Name, Mobilität im
// Notfall wie dokumentiert, Hinweise und ein leeres Feld zum Abhaken auf Papier. Stand mit Datum und Uhrzeit.
export default function EvacuationPrint() {
  const params = useSearchParams();
  const unitId = params.get("unit") ?? "";
  const { data, error } = useApiData<EvacuationList>(`/api/evacuation${unitId ? `?unit=${unitId}` : ""}`);
  const printed = useRef(false);
  useEffect(() => {
    if (!data || printed.current || params.get("dialog") === "0") return;
    printed.current = true;
    const timer = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(timer);
  }, [data, params]);

  return (
    <main className="transfer-print">
      <style>{"@page { size: A4 portrait; margin: 10mm; }"}</style>
      <div className="roster-print-bar">
        <strong>Evakuierungsliste</strong>
        <span>A4 hoch · ein Wohnbereich pro Seite · im Druckdialog „Als PDF speichern“ wählen</span>
        <button className="primary-button" type="button" disabled={!data} onClick={() => window.print()}>
          <Printer className="button-icon" /> Drucken / PDF
        </button>
        <button className="secondary-button" type="button" onClick={() => window.close()}>
          <X className="button-icon" /> Schliessen
        </button>
      </div>
      {(error || !data) && <h1 className="print-hidden-heading">Evakuierungsliste</h1>}
      {error ? (
        <p className="roster-print-message" role="alert">
          Die Liste konnte nicht erstellt werden: {error}
        </p>
      ) : !data ? (
        <p className="roster-print-message">Liste wird erstellt …</p>
      ) : (
        <>
          {!data.units.length && <h1 className="print-hidden-heading">Evakuierungsliste</h1>}
          {!data.units.length && <p className="roster-print-message">Keine aktiven Wohnbereiche erfasst.</p>}
          {data.units.map((unit) => {
            const total = unit.rooms.reduce((sum, room) => sum + room.people.length, 0);
            return (
              <article key={unit.id} className="evacuation-sheet" aria-label={`Evakuierungsliste ${unit.name}`}>
                <header>
                  <h1>
                    Evakuierungsliste · {unit.name}
                    <span>{data.organization}</span>
                  </h1>
                  <p>
                    <strong>Stand: {stamp(data.generatedAt)}</strong> · {total} {total === 1 ? "Person" : "Personen"}:{" "}
                    {[
                      ...EVACUATION_MOBILITY_KEYS.map(
                        (key) => unit.counts[key] && `${unit.counts[key]} ${EVACUATION_MOBILITY[key].count}`,
                      ),
                      unit.counts.unknown && `${unit.counts.unknown} nicht erfasst`,
                      unit.counts.absent && `${unit.counts.absent} abwesend`,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "keine"}
                  </p>
                </header>
                {total === 0 ? (
                  <p className="roster-print-message">Zurzeit keine Personen in diesem Wohnbereich.</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Zimmer</th>
                        <th scope="col">Name</th>
                        <th scope="col">Mobilität im Notfall</th>
                        <th scope="col">Hinweise</th>
                        <th scope="col" className="evacuation-check">
                          In Sicherheit
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {unit.rooms.flatMap((room) =>
                        room.people.map((person, index) => (
                          <tr key={person.id} className={person.absent ? "absent" : ""}>
                            <td>{index === 0 ? room.name : ""}</td>
                            <td>
                              <strong>{person.name}</strong>
                            </td>
                            <td className={person.mobility ? `mobility-${person.mobility}` : "mobility-unknown"}>
                              {person.absent
                                ? "Abwesend (extern verlegt)"
                                : person.mobility
                                  ? EVACUATION_MOBILITY[person.mobility].label
                                  : "Nicht erfasst"}
                            </td>
                            <td>
                              {[
                                person.resuscitation
                                  ? RESUSCITATION_STATUSES[person.resuscitation].short
                                  : "REA: nicht erfasst",
                                person.isolation,
                                person.note,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </td>
                            <td className="evacuation-check" aria-label="Zum Abhaken">
                              <span />
                            </td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                )}
              </article>
            );
          })}
        </>
      )}
    </main>
  );
}
