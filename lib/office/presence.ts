// Gleichzeitiges Bearbeiten: wo eine Person in der Datei ist (Zelle eines Blatts, Folie, Absatz des Dokuments).
export type OfficePlace = { sheet?: string; cell?: string; slide?: string; block?: number };
export type Collaborator = { session: string; name: string; self: boolean; place: OfficePlace | null };

// Gut unterscheidbare Farben für die Markierungen anderer Personen (Kontrast auf Weiss ≥ 3:1).
const COLORS = ["#d9480f", "#2b8a3e", "#7048e8", "#c2255c", "#1971c2", "#0b7285", "#a61e4d", "#5f3dc4"];

export function collaboratorColor(session: string) {
  let hash = 0;
  for (const char of session) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}
