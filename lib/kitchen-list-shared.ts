// Küchenliste je Wohnbereich (Server und Druckansicht): Angaben aus dem Ernährungsplan für die Küche, mit Stand.

export type KitchenPerson = {
  id: string;
  name: string;
  room: string;
  diet: string;
  texture: string;
  allergies: string;
  preferences: string;
  assistance: string;
  mealRhythm: string;
  instructions: string;
  fluidLimitMl: number | null;
  planUpdatedAt: string | null;
};

export type KitchenList = {
  generatedAt: string;
  organization: string;
  units: Array<{ id: string; name: string; people: KitchenPerson[] }>;
};
