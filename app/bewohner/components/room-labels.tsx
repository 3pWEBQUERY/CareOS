"use client";

import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Printer, X } from "@phosphor-icons/react";
import { useTerms, useWorkContext } from "@/app/components/care-context";
import { useApiData } from "@/app/components/workspace-ui";
import type { OccupancyOverview } from "@/lib/occupancy-shared";

// QR-Etiketten je Zimmer (A4, 3 × 7): der Code führt zu /c/bewohner/zimmer/<id>. Er enthält nur die Adresse des
// Zimmers, keine Personendaten; geöffnet wird die Akte erst nach der Anmeldung.
export default function RoomLabels() {
  const t = useTerms();
  const context = useWorkContext();
  const params = useSearchParams();
  const unitId = params.get("unit") ?? "";
  const { data, error } = useApiData<OccupancyOverview>("/api/occupancy");
  const units = (data?.units ?? []).filter((unit) => !unitId || unit.id === unitId);
  const rooms = units.flatMap((unit) =>
    unit.rooms.filter((room) => room.active).map((room) => ({ ...room, unit: unit.name })),
  );
  const [codes, setCodes] = useState<Record<string, string>>({});
  const roomKey = rooms.map((room) => room.id).join(",");
  useEffect(() => {
    if (!roomKey) return;
    let live = true;
    const ids = roomKey.split(",");
    void Promise.all(
      ids.map(async (id) => {
        const url = `${window.location.origin}/c/bewohner/zimmer/${id}`;
        return [id, await QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M" })] as const;
      }),
    ).then((entries) => {
      if (live) setCodes(Object.fromEntries(entries));
    });
    return () => {
      live = false;
    };
  }, [roomKey]);
  const ready = Boolean(data) && rooms.every((room) => codes[room.id]);
  const printed = useRef(false);
  useEffect(() => {
    if (!ready || !rooms.length || printed.current || params.get("dialog") === "0") return;
    printed.current = true;
    const timer = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(timer);
  }, [ready, rooms.length, params]);

  const title = unitId ? (units[0]?.name ?? "Wohnbereich") : "Alle Wohnbereiche";

  return (
    <main className="transfer-print">
      <style>{"@page { size: A4 portrait; margin: 10mm; }"}</style>
      <div className="roster-print-bar">
        <strong>QR-Etiketten Zimmer</strong>
        <span>A4 hoch · 3 × 7 Etiketten · im Druckdialog „Als PDF speichern“ wählen</span>
        <button className="primary-button" type="button" disabled={!ready} onClick={() => window.print()}>
          <Printer className="button-icon" /> Drucken / PDF
        </button>
        <button className="secondary-button" type="button" onClick={() => window.close()}>
          <X className="button-icon" /> Schliessen
        </button>
      </div>
      {(error || !ready) && <h1 className="print-hidden-heading">QR-Etiketten Zimmer</h1>}
      {error ? (
        <p className="roster-print-message" role="alert">
          Die Etiketten konnten nicht erstellt werden: {error}
        </p>
      ) : !ready ? (
        <p className="roster-print-message">Etiketten werden erstellt …</p>
      ) : (
        <article className="room-labels-sheet">
          <h1 className="room-labels-title">
            QR-Etiketten · {title}
            {context?.profile.organizationName && <span>{context.profile.organizationName}</span>}
          </h1>
          {!rooms.length && <p className="roster-print-message">Keine aktiven Zimmer erfasst.</p>}
          <ul className="room-labels">
            {rooms.map((room) => (
              <li key={room.id} aria-label={`Etikett ${room.name}`}>
                <span className="room-label-code" dangerouslySetInnerHTML={{ __html: codes[room.id] }} />
                <span className="room-label-text">
                  <strong>{room.name}</strong>
                  <small>{room.unit}</small>
                  <small>Scannen öffnet die {t.prefix}akte (nach Anmeldung)</small>
                </span>
              </li>
            ))}
          </ul>
        </article>
      )}
    </main>
  );
}
