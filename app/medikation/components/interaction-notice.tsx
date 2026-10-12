"use client";

import { INTERACTION_SEVERITIES, type InteractionFinding } from "@/lib/medication-interactions-shared";

// Hinweise zu Wechselwirkungen in den laufenden Verordnungen; erscheint nur, wenn ein Hinweis zutrifft.
export function InteractionNotice({ findings }: { findings: InteractionFinding[] | undefined }) {
  if (!findings?.length) return null;
  return (
    <section className="card med-interaction-card" aria-labelledby="med-interaction-title">
      <div className="card-header">
        <div>
          <p className="eyebrow">Hinweise der Einrichtung</p>
          <h2 className="card-title" id="med-interaction-title">
            Wechselwirkungen ({findings.length})
          </h2>
        </div>
      </div>
      <ul className="med-interaction-list">
        {findings.map((finding) => (
          <li key={`${finding.ruleId}:${finding.orderA.id}:${finding.orderB.id}`} className={finding.severity}>
            <span
              className={`status-badge ${finding.severity === "minor" ? "info" : finding.severity === "moderate" ? "attention" : "critical"}`}
            >
              {INTERACTION_SEVERITIES[finding.severity]}
            </span>
            <div>
              <strong>
                {finding.orderA.name} + {finding.orderB.name}
              </strong>
              <p>{finding.description}</p>
              {finding.recommendation && <p>Empfehlung: {finding.recommendation}</p>}
              <small>
                {finding.substanceA} / {finding.substanceB} · Quelle: {finding.source}
              </small>
            </div>
          </li>
        ))}
      </ul>
      <p className="med-reserve-note">
        Geprüft nur gegen die Hinweise, die die Einrichtung erfasst hat. Eine lizenzierte Arzneimitteldatenbank ist
        nicht angebunden – fehlende Hinweise bedeuten keine Unbedenklichkeit.
      </p>
    </section>
  );
}
