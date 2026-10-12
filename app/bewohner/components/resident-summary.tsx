"use client";

import { useTerms } from "@/app/components/care-context";
import { Icon } from "./residents-utils";
import type { ResidentsPageState } from "./use-residents-page";

export function ResidentSummary({ r }: { r: ResidentsPageState }) {
  const t = useTerms();
  const { residents, admissionsThisWeek } = r;
  return (
    <section className="resident-summary" aria-label={`${t.prefix}übersicht`}>
      <div>
        <span className="summary-icon">
          <Icon name="residents" />
        </span>
        <span>
          <strong>{residents.length}</strong>
          <small>{t.many} gesamt</small>
        </span>
      </div>
      <div>
        <span className="summary-icon attention">
          <Icon name="alert" />
        </span>
        <span>
          <strong>
            {residents.filter((item) => item.status === "critical" || item.status === "attention").length}
          </strong>
          <small>mit aktuellen Hinweisen</small>
        </span>
      </div>
      <div>
        <span className="summary-icon info">
          <Icon name="note" />
        </span>
        <span>
          <strong>{admissionsThisWeek}</strong>
          <small>Aufnahmen diese Woche</small>
        </span>
      </div>
      <div>
        <span className="summary-icon">
          <Icon name="check" />
        </span>
        <span>
          <strong>
            {residents.length
              ? Math.round(
                  (residents.filter((item) => item.careLevel !== "Noch offen").length / residents.length) * 100,
                )
              : 0}
            %
          </strong>
          <small>Pflegeplanung vorhanden</small>
        </span>
      </div>
    </section>
  );
}
