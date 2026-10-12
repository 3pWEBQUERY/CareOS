import type { Collaborator, OfficePlace } from "@/lib/office/presence";

// Gemeinsame Schnittstelle der drei Editoren (Dokument, Tabelle, Präsentation).
export type EditorProps<T> = {
  model: T;
  onChange: (model: T) => void;
  readOnly: boolean;
  title: string;
  // Name der angemeldeten Person (für neue Kommentare).
  user: string;
  // Vom Editor gesetzt: übernimmt eine noch offene Eingabe (vor Speichern, Herunterladen, Schliessen).
  flushRef?: { current: (() => boolean) | null };
  // Gleichzeitiges Bearbeiten: vom Editor gesetzt, übernimmt einen zusammengeführten Stand (eigene und fremde
  // Änderungen), ohne die laufende Eingabe zu verlieren.
  remoteRef?: { current: ((model: T) => void) | null };
  // Andere Personen in der Datei und wo sie gerade sind; der Editor meldet die eigene Stelle.
  people?: Collaborator[];
  onPlace?: (place: OfficePlace) => void;
};
