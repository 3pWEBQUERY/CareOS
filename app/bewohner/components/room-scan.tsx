"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import ModulePageShell from "@/app/components/module-page-shell";
import { setCareResident, useTerms } from "@/app/components/care-context";
import { EmptyState, LoadError, PageHeading, useApiData } from "@/app/components/workspace-ui";
import { ResuscitationBadge } from "@/app/components/resuscitation-badge";

type RoomResidents = {
  room: { id: string; name: string; careUnit: string };
  residents: Array<{ id: string; name: string; status: "active" | "transferred" }>;
};

// Ziel des QR-Codes am Zimmer: wohnt genau eine Person anwesend im Zimmer, öffnet sich ihre Akte direkt; sonst Auswahl.
function RoomScanContent() {
  const t = useTerms();
  const router = useRouter();
  const { roomId } = useParams<{ roomId: string }>();
  const data = useApiData<RoomResidents>(`/api/occupancy/rooms/${encodeURIComponent(roomId)}`);
  const present = data.data?.residents.filter((resident) => resident.status === "active") ?? [];
  const only = present.length === 1 ? present[0].id : null;
  useEffect(() => {
    if (!only) return;
    setCareResident(only);
    router.replace(`/c/bewohner?resident=${only}`);
  }, [only, router]);

  return (
    <>
      <PageHeading
        eyebrow={`CareOS ${t.many}`}
        title={data.data ? `Zimmer ${data.data.room.name}` : "Zimmer"}
        description={data.data ? data.data.room.careUnit : "QR-Code am Zimmer"}
      />
      {data.error && <LoadError message={data.error} onRetry={data.reload} />}
      {data.data && only && <p className="list-hint">{t.prefix}akte wird geöffnet …</p>}
      {data.data && !only && !data.data.residents.length && (
        <EmptyState icon="residents" title="Zimmer frei" text={`In diesem Zimmer wohnt derzeit niemand.`} />
      )}
      {data.data && !only && data.data.residents.length > 0 && (
        <section className="card room-scan-list" aria-label={`${t.many} im Zimmer`}>
          <h2 className="card-title">Wessen Akte öffnen?</h2>
          <ul>
            {data.data.residents.map((resident) => (
              <li key={resident.id}>
                <Link href={`/c/bewohner?resident=${resident.id}`} onClick={() => setCareResident(resident.id)}>
                  {resident.name}
                </Link>
                <ResuscitationBadge residentId={resident.id} />
                {resident.status === "transferred" && <small>verlegt</small>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export default function RoomScan() {
  return (
    <ModulePageShell activeModule="residents" activeChild="Belegung" pageClass="occupancy-page">
      {() => (
        <main className="workspace module-workspace occupancy-workspace">
          <RoomScanContent />
        </main>
      )}
    </ModulePageShell>
  );
}
