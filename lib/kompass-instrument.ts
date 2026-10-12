// CareOS Kompass: eigenes Instrument zur strukturierten Bedarfsabklärung (Server und Oberfläche).
//
// Zweck (Zweckbestimmung): Pflegefachpersonen führen die Abklärung digital durch, dokumentieren die Ergebnisse und
// verwalten die daraus folgende Pflegeplanung. Der Kompass beschreibt, was beobachtet und erfragt wurde, in einer
// einheitlichen Sprache. Er berechnet keine Punktzahl, keine Pflegestufe und kein Risiko und stellt keine Diagnose:
// Ob und welcher Handlungsbedarf besteht, entscheidet und begründet die Fachperson je Bereich selbst.
//
// Inhalte und Formulierungen sind eigenständig für CareOS verfasst (keine Items, Codes oder Algorithmen anderer
// Instrumente). Für die Einstufung zur Finanzierung bleibt das vom Kanton bzw. Land anerkannte Instrument massgebend.

import type { ModuleIconName } from "@/app/components/navigation";
import type { GOAL_CATEGORIES } from "@/lib/care-planning-shared";

export const KOMPASS_NAME = "CareOS Kompass";
// Gespeicherte Kennung der Abklärungen (Datenbank), bleibt beim Namenswechsel zu CareOS unverändert.
export const KOMPASS_INSTRUMENT = "CareCore Kompass 1";
export const KOMPASS_VERSION = 1;

export type ScaleKey = "support" | "ability" | "frequency" | "care" | "presence";

// Antwortskalen: beschreibend, in steigender Reihenfolge (für den Vergleich mit der letzten Abklärung).
export const SCALES: Record<
  ScaleKey,
  { name: string; options: Array<{ value: string; label: string; hint: string }> }
> = {
  support: {
    name: "Unterstützung",
    options: [
      { value: "0", label: "Selbständig", hint: "Erledigt es ohne Hilfe, gegebenenfalls mit eigenen Hilfsmitteln." },
      { value: "1", label: "Mit Anleitung", hint: "Braucht Erinnern, Bereitstellen, Anleiten oder Dabeisein." },
      {
        value: "2",
        label: "Teilweise Hilfe",
        hint: "Macht einen Teil selbst, die Pflege übernimmt einzelne Schritte.",
      },
      {
        value: "3",
        label: "Überwiegend Hilfe",
        hint: "Die Pflege übernimmt den grösseren Teil, die Person wirkt mit.",
      },
      { value: "4", label: "Vollständige Übernahme", hint: "Die Pflege übernimmt die Tätigkeit ganz." },
    ],
  },
  ability: {
    name: "Fähigkeit",
    options: [
      { value: "0", label: "Ohne Einschränkung", hint: "Im Alltag keine Einschränkung erkennbar." },
      { value: "1", label: "Leicht eingeschränkt", hint: "Einschränkung erkennbar, der Alltag gelingt weitgehend." },
      { value: "2", label: "Deutlich eingeschränkt", hint: "Die Einschränkung prägt den Alltag spürbar." },
      { value: "3", label: "Kaum oder nicht möglich", hint: "Nur noch in Ansätzen oder gar nicht möglich." },
    ],
  },
  frequency: {
    name: "Beobachtung",
    options: [
      { value: "0", label: "Nicht beobachtet", hint: "Ist nicht aufgefallen und wurde nicht berichtet." },
      { value: "1", label: "Selten", hint: "Einzelne Male aufgefallen oder berichtet." },
      { value: "2", label: "Häufig", hint: "Wiederholt aufgefallen oder berichtet." },
      { value: "3", label: "Täglich", hint: "Fällt täglich oder fast ständig auf." },
    ],
  },
  care: {
    name: "Durchführung",
    options: [
      { value: "none", label: "Nicht nötig", hint: "Diese Massnahme ist derzeit nicht verordnet oder nicht nötig." },
      { value: "self", label: "Macht es selbst", hint: "Die Person führt die Massnahme selbständig durch." },
      { value: "support", label: "Mit Unterstützung", hint: "Die Person macht es mit Unterstützung der Pflege." },
      { value: "nurse", label: "Durch die Pflege", hint: "Die Pflege führt die Massnahme durch." },
    ],
  },
  presence: {
    name: "Vorhanden",
    options: [
      { value: "no", label: "Nein", hint: "Trifft derzeit nicht zu." },
      { value: "yes", label: "Ja", hint: "Trifft derzeit zu; bitte unten beschreiben." },
    ],
  },
};

// „Trifft nicht zu“ (z. B. Treppen im Haus nicht vorhanden) gilt als beantwortet.
export const NOT_APPLICABLE = "na";
export const NOT_APPLICABLE_LABEL = "Trifft nicht zu";

export type KompassItem = { id: string; label: string; hint: string; scale: ScaleKey; allowNa?: boolean };

// Hinweise aus der Akte, die beim Bereich angezeigt werden (nur Fakten aus anderen Modulen, keine Bewertung).
export type ContextKey =
  | "aids"
  | "falls"
  | "repositioning"
  | "nutrition"
  | "weight"
  | "elimination"
  | "medication"
  | "wounds"
  | "diagnoses"
  | "pain"
  | "restraints"
  | "activities";

export type KompassDomain = {
  id: string;
  title: string;
  icon: ModuleIconName;
  // Wozu der Bereich dient und worauf die Fachperson achtet (in eigenen Worten).
  focus: string;
  items: KompassItem[];
  context: ContextKey[];
  // Kategorie der Pflegeplanung für die Übernahme.
  planCategory: (typeof GOAL_CATEGORIES)[number];
};

export const KOMPASS_DOMAINS: KompassDomain[] = [
  {
    id: "communication",
    title: "Kommunikation & Sinne",
    icon: "eye",
    focus: "Wie die Person sieht, hört, sich mitteilt und andere versteht – mit ihren eigenen Hilfsmitteln.",
    planCategory: "Kognition & Kommunikation",
    context: ["aids"],
    items: [
      { id: "see", label: "Sehen", hint: "Mit Brille oder Lupe, falls vorhanden.", scale: "ability" },
      { id: "hear", label: "Hören", hint: "Mit Hörgerät, falls vorhanden.", scale: "ability" },
      {
        id: "speak",
        label: "Sich verständlich machen",
        hint: "In Worten, Gesten oder mit Hilfsmitteln.",
        scale: "ability",
      },
      { id: "understand", label: "Andere verstehen", hint: "Gespräche und kurze Mitteilungen.", scale: "ability" },
    ],
  },
  {
    id: "orientation",
    title: "Orientierung & Alltagsentscheidungen",
    icon: "compass",
    focus: "Wie sich die Person zurechtfindet und Entscheidungen im Alltag trifft – so, wie es im Alltag erlebt wird.",
    planCategory: "Kognition & Kommunikation",
    context: ["restraints"],
    items: [
      { id: "time", label: "Zurechtfinden in der Zeit", hint: "Tageszeit, Wochentag, Jahreszeit.", scale: "ability" },
      { id: "place", label: "Zurechtfinden in der Umgebung", hint: "Zimmer, Abteilung, Haus.", scale: "ability" },
      { id: "people", label: "Vertraute Personen erkennen", hint: "Angehörige, Mitarbeitende.", scale: "ability" },
      {
        id: "decide",
        label: "Alltagsentscheidungen treffen",
        hint: "Kleidung wählen, Tagesablauf, Essen.",
        scale: "support",
      },
      {
        id: "remember",
        label: "An Termine und Abläufe denken",
        hint: "Mahlzeiten, Termine, Medikamente.",
        scale: "support",
      },
    ],
  },
  {
    id: "mobility",
    title: "Bewegung & Mobilität",
    icon: "walk",
    focus: "Wie die Person sich bewegt, aufsteht und unterwegs ist – innen und aussen.",
    planCategory: "Mobilität",
    context: ["aids", "falls", "repositioning"],
    items: [
      { id: "bed", label: "Sich im Bett bewegen", hint: "Drehen, aufsetzen, Position verändern.", scale: "support" },
      {
        id: "transfer",
        label: "Aufstehen und Hinsetzen",
        hint: "Bett, Stuhl, Rollstuhl, Toilette.",
        scale: "support",
      },
      {
        id: "walk_in",
        label: "Unterwegs im Zimmer und auf der Abteilung",
        hint: "Gehen oder Rollstuhl.",
        scale: "support",
      },
      { id: "stairs", label: "Treppen", hint: "Hinauf und hinunter.", scale: "support", allowNa: true },
      { id: "walk_out", label: "Unterwegs ausser Haus", hint: "Garten, Quartier, Ausflüge.", scale: "support" },
    ],
  },
  {
    id: "care",
    title: "Körperpflege & Kleiden",
    icon: "shower",
    focus: "Wie die Person sich wäscht, pflegt und kleidet – mit ihren Gewohnheiten.",
    planCategory: "Körperpflege",
    context: ["aids"],
    items: [
      { id: "upper", label: "Oberkörper waschen", hint: "Gesicht, Arme, Brust, Rücken.", scale: "support" },
      { id: "lower", label: "Unterkörper waschen", hint: "Beine, Füsse, Intimbereich.", scale: "support" },
      { id: "shower", label: "Duschen oder Baden", hint: "", scale: "support" },
      { id: "mouth", label: "Mund- und Zahnpflege", hint: "Auch Zahnprothese.", scale: "support" },
      { id: "groom", label: "Haare, Rasur, Nägel", hint: "", scale: "support" },
      { id: "dress_up", label: "Oberkörper an- und auskleiden", hint: "", scale: "support" },
      {
        id: "dress_low",
        label: "Unterkörper an- und auskleiden",
        hint: "Inklusive Schuhe und Strümpfe.",
        scale: "support",
      },
    ],
  },
  {
    id: "nutrition",
    title: "Essen & Trinken",
    icon: "nutrition",
    focus: "Wie die Person isst und trinkt, was sie mag und was ihr dabei hilft.",
    planCategory: "Ernährung & Flüssigkeit",
    context: ["nutrition", "weight"],
    items: [
      {
        id: "prepare",
        label: "Mahlzeit vorbereiten",
        hint: "Schneiden, Öffnen, Streichen, Anrichten.",
        scale: "support",
      },
      { id: "eat", label: "Essen", hint: "Zum Mund führen, kauen.", scale: "support" },
      { id: "drink", label: "Trinken", hint: "Glas oder Becher führen, ans Trinken denken.", scale: "support" },
      {
        id: "swallow",
        label: "Verschlucken beim Essen oder Trinken",
        hint: "Husten, Räuspern während oder nach dem Schlucken.",
        scale: "frequency",
      },
    ],
  },
  {
    id: "elimination",
    title: "Ausscheidung",
    icon: "toilet",
    focus: "Wie die Person die Toilette nutzt und welche Versorgung sie dabei braucht.",
    planCategory: "Ausscheidung",
    context: ["elimination"],
    items: [
      { id: "toilet", label: "Toilettengang", hint: "Hingehen, Kleidung richten, Intimhygiene.", scale: "support" },
      { id: "urine", label: "Unfreiwilliger Urinverlust", hint: "Tag oder Nacht.", scale: "frequency" },
      { id: "stool", label: "Unfreiwilliger Stuhlverlust", hint: "", scale: "frequency" },
      {
        id: "products",
        label: "Versorgung mit Inkontinenzmaterial",
        hint: "Wechseln, Anlegen.",
        scale: "support",
        allowNa: true,
      },
      { id: "catheter", label: "Katheter oder Stoma versorgen", hint: "", scale: "care" },
    ],
  },
  {
    id: "rest",
    title: "Ruhen & Schlafen",
    icon: "moon",
    focus: "Wie die Person ruht und schläft und was ihr in der Nacht hilft.",
    planCategory: "Schlaf & Ruhe",
    context: [],
    items: [
      { id: "night_awake", label: "Wach oder unruhig in der Nacht", hint: "", scale: "frequency" },
      {
        id: "night_help",
        label: "Braucht in der Nacht Unterstützung",
        hint: "Toilette, Lagerung, Zuspruch.",
        scale: "frequency",
      },
      { id: "day_sleep", label: "Schläft tagsüber viel", hint: "", scale: "frequency" },
    ],
  },
  {
    id: "treatment",
    title: "Medizinisch-pflegerische Massnahmen",
    icon: "med",
    focus: "Welche ärztlich verordneten oder pflegerischen Massnahmen nötig sind und wer sie durchführt.",
    planCategory: "Atmung & Kreislauf",
    context: ["medication", "wounds", "diagnoses"],
    items: [
      { id: "meds_prepare", label: "Medikamente richten", hint: "Bereitstellen nach Verordnung.", scale: "care" },
      {
        id: "meds_take",
        label: "Medikamente einnehmen",
        hint: "Einnahme, Tropfen, Salben, Inhalation.",
        scale: "care",
      },
      { id: "injection", label: "Injektionen", hint: "Zum Beispiel Insulin.", scale: "care" },
      { id: "wound", label: "Wundversorgung", hint: "", scale: "care" },
      { id: "compression", label: "Kompressionsstrümpfe oder Verbände", hint: "", scale: "care" },
      { id: "measure", label: "Messungen", hint: "Blutzucker, Blutdruck, Gewicht nach Verordnung.", scale: "care" },
      { id: "breathing", label: "Sauerstoff oder Atemhilfen", hint: "", scale: "care" },
      { id: "tube", label: "Ernährung über Sonde", hint: "", scale: "care" },
    ],
  },
  {
    id: "wellbeing",
    title: "Befinden & Verhalten",
    icon: "pulse",
    focus: "Was im Befinden und Verhalten auffällt – beschrieben, nicht bewertet.",
    planCategory: "Psyche & Wohlbefinden",
    context: ["restraints"],
    items: [
      { id: "sad", label: "Wirkt traurig oder niedergeschlagen", hint: "", scale: "frequency" },
      { id: "anxious", label: "Wirkt ängstlich oder besorgt", hint: "", scale: "frequency" },
      { id: "restless", label: "Unruhe, Umhergehen", hint: "", scale: "frequency" },
      { id: "withdrawn", label: "Zieht sich zurück", hint: "", scale: "frequency" },
      { id: "refuses", label: "Lehnt Unterstützung ab", hint: "", scale: "frequency" },
      {
        id: "challenging",
        label: "Verhalten, das andere belastet",
        hint: "Laut, abwehrend, Grenzen überschreitend.",
        scale: "frequency",
      },
      { id: "leaves", label: "Verlässt unbemerkt die Abteilung", hint: "", scale: "frequency" },
    ],
  },
  {
    id: "pain",
    title: "Schmerz & Wohlbefinden",
    icon: "alert",
    focus: "Was die Person über Schmerzen sagt oder was dazu beobachtet wird, und was ihr hilft.",
    planCategory: "Schmerz",
    context: ["pain"],
    items: [
      {
        id: "pain_said",
        label: "Schmerzen nach eigener Angabe",
        hint: "Was die Person selbst sagt.",
        scale: "frequency",
        allowNa: true,
      },
      {
        id: "pain_seen",
        label: "Hinweise auf Schmerzen beobachtet",
        hint: "Mimik, Schonhaltung, Laute, Abwehr bei Berührung.",
        scale: "frequency",
      },
    ],
  },
  {
    id: "skin",
    title: "Haut",
    icon: "wounds",
    focus: "Was an der Haut auffällt und welche Versorgung bereits läuft.",
    planCategory: "Haut & Wunden",
    context: ["wounds", "repositioning"],
    items: [
      { id: "redness", label: "Rötungen, die nicht verschwinden", hint: "An belasteten Stellen.", scale: "presence" },
      { id: "open", label: "Offene Hautstellen oder Wunden", hint: "", scale: "presence" },
      { id: "dry", label: "Trockene, dünne oder juckende Haut", hint: "", scale: "presence" },
    ],
  },
  {
    id: "safety",
    title: "Sicherheit im Alltag",
    icon: "quality",
    focus: "Was die Person im Alltag sicher macht oder unsicher werden lässt – aus Beobachtung und Bericht.",
    planCategory: "Sicherheit & Sturz",
    context: ["falls", "aids", "restraints"],
    items: [
      { id: "unsteady", label: "Unsicherheit beim Gehen oder Stehen", hint: "", scale: "frequency" },
      { id: "dangers", label: "Gefahren im Alltag erkennen", hint: "Heisses, Strasse, Treppe.", scale: "support" },
      { id: "call", label: "Hilfe rufen", hint: "Glocke oder Rufsystem bedienen.", scale: "support" },
    ],
  },
  {
    id: "daily",
    title: "Alltag & Beziehungen",
    icon: "care",
    focus: "Wie die Person ihren Tag gestaltet, was sie gerne tut und mit wem sie in Kontakt ist.",
    planCategory: "Soziales & Beschäftigung",
    context: ["activities"],
    items: [
      { id: "structure", label: "Den Tag gestalten", hint: "Aufstehen, Ruhezeiten, Rituale.", scale: "support" },
      { id: "occupation", label: "Sich beschäftigen", hint: "Hobbys, Lesen, Musik, Handarbeit.", scale: "support" },
      { id: "contacts", label: "Kontakte pflegen", hint: "Besuch, Telefon, Mitbewohnende.", scale: "support" },
      { id: "outside", label: "Am Leben ausser Haus teilnehmen", hint: "Einkauf, Kirche, Vereine.", scale: "support" },
    ],
  },
];

export const KOMPASS_ITEMS = KOMPASS_DOMAINS.flatMap((domain) =>
  domain.items.map((item) => ({ ...item, key: `${domain.id}.${item.id}`, domain: domain.id })),
);
export const ITEM_BY_KEY = new Map(KOMPASS_ITEMS.map((item) => [item.key, item]));

// Anlass der Abklärung (frei wählbar; Fristen legt die Einrichtung fest).
export const OCCASIONS = {
  admission: "Eintritt",
  routine: "Regelmässige Abklärung",
  change: "Veränderung des Zustands",
  return: "Rückkehr aus dem Spital",
  request: "Auf Wunsch der Person oder Vertretung",
} as const;
export type Occasion = keyof typeof OCCASIONS;

// Wer an der Abklärung beteiligt war.
export const PARTICIPANTS = [
  "Person selbst",
  "Angehörige",
  "Vertretung",
  "Pflegeteam",
  "Ärztin / Arzt",
  "Therapie",
] as const;

// Je Bereich: Ressourcen, Wünsche und Gewohnheiten, Handlungsbedarf (Entscheid der Fachperson) mit Beschreibung.
export type DomainNotes = {
  resources?: string;
  wishes?: string;
  need?: boolean;
  needText?: string;
  notes?: string;
  // Ziel der Pflegeplanung, in das der Handlungsbedarf übernommen wurde (nur vom Server gesetzt).
  goalId?: string;
};

export type KompassData = {
  kompass: number;
  occasion: Occasion;
  assessedOn: string;
  participants: string[];
  answers: Record<string, string>;
  domains: Record<string, DomainNotes>;
  // Gesamtbild aus Sicht der Fachperson.
  summary: string;
};

export function emptyKompass(occasion: Occasion, assessedOn: string): KompassData {
  return { kompass: KOMPASS_VERSION, occasion, assessedOn, participants: [], answers: {}, domains: {}, summary: "" };
}

export const optionLabel = (item: KompassItem, value: string | undefined) =>
  value === undefined
    ? null
    : value === NOT_APPLICABLE
      ? NOT_APPLICABLE_LABEL
      : (SCALES[item.scale].options.find((option) => option.value === value)?.label ?? null);

export function validAnswer(item: KompassItem, value: unknown) {
  if (typeof value !== "string") return false;
  if (value === NOT_APPLICABLE) return Boolean(item.allowNa);
  return SCALES[item.scale].options.some((option) => option.value === value);
}

// Stand eines Bereichs: beantwortete Fragen und ob über den Handlungsbedarf entschieden ist.
export function domainProgress(domain: KompassDomain, data: Pick<KompassData, "answers" | "domains">) {
  const answered = domain.items.filter((item) => data.answers[`${domain.id}.${item.id}`] !== undefined).length;
  const need = data.domains[domain.id]?.need;
  const decided = need === false || (need === true && Boolean(data.domains[domain.id]?.needText?.trim()));
  return { answered, total: domain.items.length, decided, complete: answered === domain.items.length && decided };
}

// Fortschritt in Prozent: jede Frage und jeder Entscheid über den Handlungsbedarf zählt gleich.
export function kompassProgress(data: Pick<KompassData, "answers" | "domains">) {
  let done = 0;
  let total = 0;
  for (const domain of KOMPASS_DOMAINS) {
    const state = domainProgress(domain, data);
    done += state.answered + (state.decided ? 1 : 0);
    total += state.total + 1;
  }
  return Math.round((done / total) * 100);
}

// Rang einer Antwort auf ihrer Skala (für „mehr“ oder „weniger“ Unterstützung im Vergleich); „Trifft nicht zu“ hat
// keinen Rang.
export function answerRank(item: KompassItem, value: string | undefined) {
  if (value === undefined || value === NOT_APPLICABLE) return null;
  const index = SCALES[item.scale].options.findIndex((option) => option.value === value);
  return index < 0 ? null : index;
}

// Beschreibende Zusammenfassung eines Bereichs (zählt Antworten, wertet nicht).
export function domainSummary(domain: KompassDomain, answers: Record<string, string>) {
  const ranked = domain.items
    .map((item) => answerRank(item, answers[`${domain.id}.${item.id}`]))
    .filter((rank): rank is number => rank !== null);
  return { answered: ranked.length, withSupport: ranked.filter((rank) => rank > 0).length };
}
