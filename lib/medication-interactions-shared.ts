// Wechselwirkungen: Schweregrade und Datentypen für Server und Oberfläche.

export const INTERACTION_SEVERITIES = {
  contraindicated: "Kontraindiziert",
  major: "Schwerwiegend",
  moderate: "Mittel",
  minor: "Gering",
} as const;
export type InteractionSeverity = keyof typeof INTERACTION_SEVERITIES;
export const INTERACTION_SEVERITY_KEYS = Object.keys(INTERACTION_SEVERITIES) as InteractionSeverity[];

// Ein Hinweis, wie ihn die Einrichtung erfasst hat.
export type InteractionRule = {
  id: string;
  substanceA: string;
  substanceB: string;
  severity: InteractionSeverity;
  description: string;
  recommendation: string;
  source: string;
  updatedAt: string;
  updatedBy: string | null;
};

// Treffer in den Verordnungen einer Person: zwei Verordnungen, auf die ein Hinweis zutrifft.
export type InteractionFinding = {
  ruleId: string;
  severity: InteractionSeverity;
  orderA: { id: string; name: string };
  orderB: { id: string; name: string };
  substanceA: string;
  substanceB: string;
  description: string;
  recommendation: string;
  source: string;
  // Woher der Hinweis stammt: „facility“ = von der Einrichtung erfasst.
  origin: "facility";
};

// Stand der Prüfung: welche Quellen angebunden sind.
export type InteractionStatus = { facilityRules: number; licensedDatabase: null };

const SEVERITY_ORDER: InteractionSeverity[] = ["contraindicated", "major", "moderate", "minor"];
export const severityRank = (severity: InteractionSeverity) => SEVERITY_ORDER.indexOf(severity);

// Sucht einen Wirkstoff- oder Präparatnamen als ganzes Wort (ohne Gross-/Kleinschreibung) im Namen bzw. Wirkstoff.
export function mentions(haystack: string, term: string) {
  const needle = term.trim().toLocaleLowerCase("de-CH");
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(haystack.toLocaleLowerCase("de-CH"));
}

// Paare von Verordnungen, auf die eine Regel zutrifft (A in der einen, B in einer anderen Verordnung).
export function findInteractions(
  orders: Array<{ id: string; name: string; text: string }>,
  rules: InteractionRule[],
): InteractionFinding[] {
  const findings: InteractionFinding[] = [];
  const seen = new Set<string>();
  for (const rule of rules)
    for (const a of orders)
      for (const b of orders) {
        if (a.id === b.id || !mentions(a.text, rule.substanceA) || !mentions(b.text, rule.substanceB)) continue;
        const key = `${rule.id}:${[a.id, b.id].sort().join(":")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          ruleId: rule.id,
          severity: rule.severity,
          orderA: { id: a.id, name: a.name },
          orderB: { id: b.id, name: b.name },
          substanceA: rule.substanceA,
          substanceB: rule.substanceB,
          description: rule.description,
          recommendation: rule.recommendation,
          source: rule.source,
          origin: "facility",
        });
      }
  return findings.sort((x, y) => severityRank(x.severity) - severityRank(y.severity));
}
