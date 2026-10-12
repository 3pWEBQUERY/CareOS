// Wünsche für die letzte Lebensphase und Ablauf nach einem Todesfall (Server und Oberfläche). CareOS hält fest, was die
// Person bzw. ihre Vertretung wünscht; die Punkte der Checkliste nach einem Todesfall legt die Einrichtung selbst fest.

export const END_OF_LIFE_FIELDS = [
  { key: "place", label: "Ort", hint: "z. B. im eigenen Zimmer" },
  { key: "companionship", label: "Begleitung", hint: "z. B. wer dabei sein soll, Musik, Licht" },
  { key: "spiritual", label: "Religiöse oder spirituelle Wünsche", hint: "z. B. Seelsorge, Rituale, Gebete" },
  { key: "funeral", label: "Bestattung", hint: "z. B. Bestattungsart, beauftragtes Unternehmen, Kleidung" },
  { key: "notify", label: "Wer informiert werden soll", hint: "z. B. Tochter, auch nachts; Freundin aus dem Chor" },
  { key: "otherWishes", label: "Weitere Wünsche", hint: "" },
] as const;

export type EndOfLifeFieldKey = (typeof END_OF_LIFE_FIELDS)[number]["key"];

export type EndOfLifeWishes = Record<EndOfLifeFieldKey, string> & {
  discussedWith: string;
  discussedOn: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type DeathChecklistItem = {
  id: string;
  label: string;
  doneAt: string | null;
  doneBy: string | null;
  note: string;
};

export type EndOfLifeView = {
  residentId: string;
  canWrite: boolean;
  wishes: EndOfLifeWishes;
  // Nur bei verstorbenen Personen: Todestag und die bei der Erfassung übernommene Checkliste der Einrichtung.
  deceasedOn: string | null;
  checklist: DeathChecklistItem[];
};

export const DEATH_CHECKLIST_MAX_ITEMS = 30;
export const DEATH_CHECKLIST_MAX_LENGTH = 200;
