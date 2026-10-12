import { TERMINOLOGIES, navigationLabel, type Terms } from "@/lib/terminology";

export type ModuleIconName =
  | "home"
  | "residents"
  | "tasks"
  | "handover"
  | "calendar"
  | "team"
  | "learn"
  | "docs"
  | "chart"
  | "quality"
  | "settings"
  | "search"
  | "bell"
  | "building"
  | "chevron"
  | "caretDown"
  | "alert"
  | "check"
  | "plus"
  | "pulse"
  | "note"
  | "vitals"
  | "plan"
  | "med"
  | "wounds"
  | "nutrition"
  | "assess"
  | "shift"
  | "ai"
  | "sparkle"
  | "sidebar"
  | "filter"
  | "logout"
  | "close"
  | "activity"
  | "compass"
  | "eye"
  | "walk"
  | "moon"
  | "drop"
  | "shower"
  | "toilet"
  | "care"
  | "news"
  | "book"
  | "message"
  | "cloud"
  | "staff"
  | "apps"
  | "help";

export type NavModule = {
  id: string;
  label: string;
  icon: ModuleIconName;
  // Farbton der App (0–360): Symbol, Kachel und Kopfzeile tragen überall dieselbe Farbe – wiedererkennen statt lesen.
  hue: number;
  // Kurzer Name für die schmale Leiste (sonst der Name).
  shortLabel?: string;
  // Ein kurzer Satz in einfacher Sprache: wofür die App da ist (Startbildschirm und „Alle Apps“).
  hint: string;
  // Pages of the module, shown as tabs at the top of the page (the sidebar links the module only).
  children: string[];
  badge?: number;
  href?: string;
  // Permission needed to see the module (all signed-in staff when omitted).
  permission?: string;
  // Tabs that need an additional permission.
  childPermissions?: Record<string, string>;
  // Reached elsewhere (e.g. the header), so not listed in the sidebar.
  hiddenInSidebar?: boolean;
};

export type NavGroup = { id: string; label: string; modules: NavModule[] };

// CareOS ist wie das Betriebssystem eines Tablets aufgebaut: jeder Bereich ist eine „App“ mit eigenem Namen, Symbol und
// eigener Farbe. Alle Apps stehen auf dem Startbildschirm und unter „Alle Apps“, gegliedert entlang des Arbeitstags:
// mein Dienst, Bewohner und Pflege, CareOS Kompass, Team und Wissen, Kommunikation, dann die Leitung. Eine App öffnet
// sich mit einem Klick; ihre Seiten sind Reiter oben auf der Seite – es gibt keine verschachtelten Menüs.
export const navigation: NavGroup[] = [
  {
    id: "operations",
    label: "Mein Dienst",
    modules: [
      {
        id: "shift",
        label: "Mein Dienst",
        icon: "shift",
        hue: 24,
        hint: "Mein Tag, Übergabe und was seit dem letzten Dienst passiert ist",
        children: ["Heute", "Übergabe", "Seit letztem Dienst", "Verlauf"],
      },
      {
        id: "tasks",
        label: "Aufgaben",
        icon: "tasks",
        hue: 40,
        hint: "Was ich heute erledigen muss",
        children: ["Meine Aufgaben", "Team"],
      },
      {
        id: "schedule",
        label: "Mein Dienstplan",
        icon: "calendar",
        hue: 228,
        hint: "Wann ich arbeite, Wünsche und Zeiten",
        children: ["Meine Dienste", "Teamplan", "Anträge", "Zeiten"],
      },
    ],
  },
  {
    id: "clinical",
    label: "Bewohner & Pflege",
    modules: [
      {
        id: "residents",
        label: "Bewohner",
        icon: "residents",
        hue: 212,
        hint: "Alle Bewohner und ihre Pflegeakte",
        children: [
          "Übersicht",
          "Pflegeakten",
          "Belegung",
          "Verlauf & Archiv",
          "Isolation & Ausbruch",
          "Einwilligungen",
          "Bewohnergelder",
          "Abrechnung",
        ],
        childPermissions: { Bewohnergelder: "funds.manage", Abrechnung: "billing.manage" },
      },
      {
        id: "chart",
        label: "Dokumentation",
        shortLabel: "Doku",
        icon: "note",
        hue: 150,
        hint: "Pflegebericht schreiben und nachlesen",
        children: ["Schnelldokumentation", "Nachweis", "Verlauf", "Lagerung", "Ausscheidung", "Visite", "Leistungen"],
      },
      {
        id: "med",
        label: "Medikamente",
        icon: "med",
        hue: 330,
        hint: "Medikamente richten, geben und kontrollieren",
        children: [
          "Medikamentenrunde",
          "Medikamentenplan",
          "Reserven",
          "Bestände",
          "BtM-Kontrolle",
          "Bestellungen",
          "eMediplan",
          "Kühlschrank",
        ],
        childPermissions: { Bestellungen: "medication.manage", eMediplan: "medication.manage" },
      },
      {
        id: "vitals",
        label: "Vitalwerte",
        icon: "vitals",
        hue: 356,
        hint: "Blutdruck, Puls, Gewicht und mehr messen",
        children: ["Vitalwerte", "Entwicklung", "Grenzwerte"],
      },
      {
        id: "nutrition",
        label: "Essen & Trinken",
        icon: "nutrition",
        hue: 88,
        hint: "Trinkmenge und Ernährung festhalten",
        children: ["Trinkprotokoll", "Ernährungsplan"],
      },
      {
        id: "wounds",
        label: "Wunden",
        icon: "wounds",
        hue: 14,
        hint: "Wunden beschreiben, fotografieren, verfolgen",
        children: ["Wundübersicht", "Dokumentation"],
      },
      {
        id: "plan",
        label: "Pflegeplanung",
        icon: "plan",
        hue: 262,
        hint: "Ziele, Massnahmen und Einschätzungen",
        children: ["Pflegeplanung", "Ziele & Massnahmen", "Auswertung", "Vorlagen", "Einschätzungen", "Fälligkeiten"],
        childPermissions: { Vorlagen: "quality.manage" },
      },
      {
        id: "activities",
        label: "Aktivitäten",
        icon: "activity",
        hue: 300,
        hint: "Angebote im Alltag und wer teilnimmt",
        children: ["Angebote", "Teilnahme je Person"],
      },
    ],
  },
  {
    // Eigener Hauptbereich, gleich nach Bewohner & Pflege.
    id: "kompass",
    label: "CareOS Kompass",
    modules: [
      {
        id: "rai",
        label: "Kompass",
        icon: "compass",
        hue: 180,
        hint: "Pflegebedarf abklären und Berichte",
        permission: "rai.manage",
        children: ["Übersicht", "Abklärung", "Fälligkeiten", "Berichte"],
      },
    ],
  },
  {
    id: "workforce",
    label: "Team & Wissen",
    modules: [
      {
        id: "team",
        label: "Neuigkeiten",
        icon: "news",
        hue: 196,
        hint: "Mitteilungen für das ganze Team",
        children: ["Neuigkeiten"],
      },
      {
        id: "learn",
        label: "Schulungen",
        icon: "learn",
        hue: 280,
        hint: "Kurse besuchen und Nachweise",
        children: ["Meine Schulungen", "Pflichtnachweise"],
      },
      {
        id: "docs",
        label: "Dokumente",
        icon: "book",
        hue: 238,
        hint: "Standards, Weisungen und Formulare",
        children: ["Standards & Weisungen", "Dokumente"],
      },
    ],
  },
  {
    // Werkzeuge für das ganze Haus: Kalender, Nachrichten und Dateien.
    id: "carecore-one",
    label: "Kommunikation",
    modules: [
      {
        id: "messenger",
        label: "Nachrichten",
        icon: "message",
        hue: 165,
        hint: "Mit Kolleginnen, Kollegen und Angehörigen schreiben",
        children: ["Nachrichten", "Portal-Nachrichten"],
      },
      {
        id: "one-calendar",
        label: "Kalender",
        icon: "calendar",
        hue: 250,
        hint: "Termine im Haus und Fahrdienst",
        children: ["Kalender", "Fahrdienst"],
      },
      {
        id: "cloud",
        label: "Dateien",
        icon: "cloud",
        hue: 204,
        hint: "Gemeinsame und eigene Dateien",
        children: ["Gemeinsame Ablage", "Meine Dateien"],
      },
    ],
  },
  {
    id: "management",
    label: "Leitung",
    modules: [
      {
        id: "quality",
        label: "Qualität & Kennzahlen",
        icon: "quality",
        hue: 140,
        hint: "Ereignisse, Massnahmen und Zahlen",
        children: [
          "Ereignisse",
          "Massnahmen",
          "Meine Kennzahlen",
          "Kennzahlen Pflege",
          "Kennzahlen Bewohner",
          "Kennzahlen Leitung",
          "Kennzahlen Personal",
          "Qualitätsindikatoren",
          "Leistungsauswertung",
          "Geräte & Prüfungen",
          "Rückmeldungen",
        ],
        childPermissions: {
          Massnahmen: "quality.manage",
          "Meine Kennzahlen": "insights.read",
          "Kennzahlen Pflege": "insights.read",
          "Kennzahlen Bewohner": "insights.read",
          "Kennzahlen Leitung": "insights.read",
          "Kennzahlen Personal": "insights.read",
          Qualitätsindikatoren: "insights.read",
          Leistungsauswertung: "insights.read",
          "Geräte & Prüfungen": "quality.manage",
          Rückmeldungen: "quality.manage",
        },
      },
      {
        id: "roster",
        label: "Dienstplanung",
        icon: "calendar",
        hue: 232,
        hint: "Dienstplan für das Team erstellen",
        permission: "schedule.manage",
        children: ["Planung", "Anträge", "Arbeitszeit", "Einstellungen", "Protokoll"],
      },
      {
        id: "staff",
        label: "Mitarbeitende",
        icon: "staff",
        hue: 190,
        hint: "Team, Einarbeitung und Rollen",
        children: ["Mitarbeitende", "Aufgaben", "Einarbeitung", "Profile & Rollen"],
        childPermissions: {
          Mitarbeitende: "team.manage",
          Aufgaben: "team.manage",
          Einarbeitung: "team.manage",
          "Profile & Rollen": "administration.manage",
        },
      },
      {
        id: "admin",
        label: "Administration",
        icon: "settings",
        hue: 215,
        hint: "Einrichtung, Portal, Sprachen und Daten",
        permission: "administration.manage",
        children: [
          "Organisation",
          "Pflegebedarf",
          "Leistungskatalog",
          "Konfiguration",
          "Portal",
          "Sprachen",
          "Datenübernahme",
        ],
      },
    ],
  },
  {
    id: "intelligence",
    label: "CareOS KI",
    modules: [
      {
        id: "ai",
        label: "CareOS KI",
        icon: "ai",
        hue: 270,
        hint: "Fragen stellen und Texte entwerfen lassen",
        permission: "ai.use",
        hiddenInSidebar: true,
        children: ["Assistenz", "KI-Entwürfe"],
      },
    ],
  },
];

const routes: Record<string, Record<string, string>> = {
  shift: {
    Heute: "/betrieb/schicht",
    Übergabe: "/betrieb/uebergabe",
    "Seit letztem Dienst": "/betrieb/uebergabe/letzter-dienst",
    Verlauf: "/betrieb/schicht/verlauf",
  },
  tasks: { "Meine Aufgaben": "/betrieb/aufgaben", Team: "/betrieb/aufgaben/team" },
  schedule: {
    "Meine Dienste": "/mein-dienstplan",
    Teamplan: "/mein-dienstplan/team",
    Anträge: "/mein-dienstplan/antraege",
    Zeiten: "/mein-dienstplan/zeiten",
  },
  roster: {
    Planung: "/dienstplan",
    Anträge: "/dienstplan/antraege",
    Arbeitszeit: "/dienstplan/arbeitszeit",
    Einstellungen: "/dienstplan/einstellungen",
    Protokoll: "/dienstplan/protokoll",
  },
  residents: {
    Übersicht: "/bewohner",
    Pflegeakten: "/bewohner/pflegeakte",
    Belegung: "/bewohner/belegung",
    "Verlauf & Archiv": "/bewohner/verlauf",
    "Isolation & Ausbruch": "/bewohner/hygiene",
    Einwilligungen: "/bewohner/einwilligungen",
    Bewohnergelder: "/bewohner/gelder",
    Abrechnung: "/bewohner/abrechnung",
  },
  chart: {
    Schnelldokumentation: "/pflegedokumentation",
    Nachweis: "/pflegedokumentation/nachweis",
    Verlauf: "/pflegedokumentation/verlauf",
    Lagerung: "/pflegedokumentation/lagerung",
    Ausscheidung: "/pflegedokumentation/ausscheidung",
    Visite: "/pflegedokumentation/visite",
    Leistungen: "/pflegedokumentation/leistungen",
  },
  med: {
    Medikamentenrunde: "/medikation/runde",
    Medikamentenplan: "/medikation",
    Reserven: "/medikation/reserven",
    Bestände: "/medikation/bestaende",
    "BtM-Kontrolle": "/medikation/btm",
    Bestellungen: "/medikation/bestellungen",
    eMediplan: "/medikation/emediplan",
    Kühlschrank: "/medikation/kuehlschrank",
  },
  vitals: {
    Vitalwerte: "/vitalwerte",
    Entwicklung: "/vitalwerte/entwicklung",
    Grenzwerte: "/vitalwerte/grenzwerte",
  },
  nutrition: { Trinkprotokoll: "/ernaehrung/trinkprotokoll", Ernährungsplan: "/ernaehrung" },
  wounds: { Wundübersicht: "/wundmanagement", Dokumentation: "/wundmanagement/dokumentation" },
  plan: {
    Pflegeplanung: "/pflegeplanung",
    "Ziele & Massnahmen": "/pflegeplanung/ziele-massnahmen",
    Auswertung: "/pflegeplanung/auswertung",
    Vorlagen: "/pflegeplanung/vorlagen",
    Einschätzungen: "/einschaetzungen",
    Fälligkeiten: "/einschaetzungen/faelligkeiten",
  },
  activities: { Angebote: "/alltag", "Teilnahme je Person": "/alltag/teilnahme" },
  rai: {
    Übersicht: "/kompass",
    Abklärung: "/kompass/abklaerung",
    Fälligkeiten: "/kompass/faelligkeiten",
    Berichte: "/kompass/berichte",
  },
  team: { Neuigkeiten: "/personal/team" },
  learn: { "Meine Schulungen": "/personal/schulungen", Pflichtnachweise: "/personal/schulungen/pflichtnachweise" },
  docs: {
    "Standards & Weisungen": "/personal/dokumente/standards",
    Dokumente: "/personal/dokumente",
  },
  "one-calendar": { Kalender: "/carecore-one/kalender", Fahrdienst: "/carecore-one/kalender/fahrdienst" },
  messenger: { Nachrichten: "/carecore-one/messenger", "Portal-Nachrichten": "/carecore-one/portal-nachrichten" },
  cloud: { "Gemeinsame Ablage": "/carecore-one/ablage", "Meine Dateien": "/carecore-one/cloud" },
  quality: {
    Ereignisse: "/leitung/qualitaet",
    Massnahmen: "/leitung/qualitaet/massnahmen",
    "Meine Kennzahlen": "/leitung/kennzahlen/meine",
    "Kennzahlen Pflege": "/leitung/kennzahlen",
    "Kennzahlen Bewohner": "/leitung/kennzahlen/bewohner",
    "Kennzahlen Leitung": "/leitung/kennzahlen/leitung",
    "Kennzahlen Personal": "/leitung/kennzahlen/personal",
    Qualitätsindikatoren: "/leitung/kennzahlen/qualitaetsindikatoren",
    Leistungsauswertung: "/leitung/kennzahlen/leistungen",
    "Geräte & Prüfungen": "/leitung/qualitaet/geraete",
    Rückmeldungen: "/leitung/qualitaet/rueckmeldungen",
  },
  staff: {
    Mitarbeitende: "/leitung/teamleitung/mitarbeiter",
    Aufgaben: "/leitung/teamleitung/aufgaben",
    Einarbeitung: "/leitung/teamleitung/einarbeitung",
    "Profile & Rollen": "/leitung/administration/mitarbeiter",
  },
  admin: {
    Organisation: "/leitung/administration",
    Pflegebedarf: "/leitung/administration/pflegebedarf",
    Leistungskatalog: "/leitung/administration/leistungskatalog",
    Konfiguration: "/leitung/administration/konfiguration",
    Portal: "/leitung/administration/portal",
    Sprachen: "/leitung/administration/sprachen",
    Datenübernahme: "/leitung/administration/import",
  },
  ai: { Assistenz: "/intelligenz", "KI-Entwürfe": "/intelligenz/entwuerfe" },
};

export function routeFor(moduleId: string, child: string) {
  const route = routes[moduleId]?.[child];
  return route ? `/c${route}` : null;
}

// The module and tab of a page, found by its address (longest matching route, so
// detail pages below a tab keep it active). Pages outside the navigation give null.
export function activePage(pathname: string | null): { moduleId: string; child: string } | null {
  if (!pathname) return null;
  const path = (pathname.replace(/^\/c(?=\/|$)/, "") || "/").replace(/\/$/, "") || "/";
  let best: { moduleId: string; child: string; length: number } | null = null;
  for (const [moduleId, children] of Object.entries(routes))
    for (const [child, route] of Object.entries(children))
      if ((path === route || path.startsWith(`${route}/`)) && (!best || route.length > best.length))
        best = { moduleId, child, length: route.length };
  return best && { moduleId: best.moduleId, child: best.child };
}

// Berechtigungen, die eine Seite verlangt (Modul und Reiter, wie in der Navigation); leer, wenn alle sie sehen.
export function pagePermissions(pathname: string): string[] {
  const page = activePage(pathname);
  const navModule = page && moduleById(page.moduleId);
  if (!page || !navModule) return [];
  return [navModule.permission, navModule.childPermissions?.[page.child]].filter((value): value is string => !!value);
}

export function moduleById(moduleId: string) {
  return navigation.flatMap((group) => group.modules).find((module) => module.id === moduleId) ?? null;
}

export function navigationFor(permissions?: string[] | null): NavGroup[] {
  const allowed = (permission?: string) => !permission || !!permissions?.includes(permission);
  return navigation
    .map((group) => ({
      ...group,
      modules: group.modules
        .filter((module) => allowed(module.permission))
        .map((module) => ({
          ...module,
          children: module.children.filter((child) => allowed(module.childPermissions?.[child])),
        }))
        .filter((module) => module.children.length),
    }))
    .filter((group) => group.modules.length);
}

// Navigation of the sidebar and the mobile menu: without modules reached elsewhere.
export const sidebarNavigation = (permissions?: string[] | null) =>
  navigationFor(permissions)
    .map((group) => ({ ...group, modules: group.modules.filter((module) => !module.hiddenInSidebar) }))
    .filter((group) => group.modules.length);

export type BadgeKey = "tasks" | "handover" | "medRound" | "messages";

// Most used functions of a shift: keyboard shortcuts and live counts on their tabs.
export type QuickLink = {
  moduleId: string;
  child: string;
  label: string;
  icon: ModuleIconName;
  badge?: "tasks" | "handover" | "medRound";
  shortcut: string;
};

export const quickLinks: QuickLink[] = [
  { moduleId: "shift", child: "Heute", label: "Mein Dienst", icon: "shift", shortcut: "S" },
  { moduleId: "shift", child: "Übergabe", label: "Übergabe", icon: "handover", badge: "handover", shortcut: "Ü" },
  {
    moduleId: "tasks",
    child: "Meine Aufgaben",
    label: "Meine Aufgaben",
    icon: "tasks",
    badge: "tasks",
    shortcut: "A",
  },
  { moduleId: "chart", child: "Schnelldokumentation", label: "Dokumentieren", icon: "note", shortcut: "D" },
  {
    moduleId: "med",
    child: "Medikamentenrunde",
    // Soft hyphen: breaks as "Medikamenten-runde" where space is short (mobile menu).
    label: "Medikamenten\u00adrunde",
    icon: "med",
    badge: "medRound",
    shortcut: "R",
  },
];

// Badge per tab derived from the quick links, and all badges of a module (sidebar).
export const badgeFor = (moduleId: string, child: string) =>
  quickLinks.find((link) => link.moduleId === moduleId && link.child === child)?.badge;
// Counts of modules without a quick link; shown on the module and its sidebar group.
const moduleOnlyBadges: Record<string, BadgeKey[]> = { messenger: ["messages"] };
export const moduleBadges = (moduleId: string): BadgeKey[] => [
  ...quickLinks.filter((link) => link.moduleId === moduleId && link.badge).map((link) => link.badge!),
  ...(moduleOnlyBadges[moduleId] ?? []),
];

// Die Leiste von CareOS (am Computer links, auf dem Handy unten): immer dieselben Apps an derselben Stelle, jede mit
// Symbol und Namen. Alles Weitere öffnet „Alle Apps“. Gezeigt wird nur, was die Person nutzen darf.
export const DOCK_APPS = ["shift", "residents", "chart", "med", "tasks", "messenger"] as const;
export const MOBILE_DOCK_APPS = ["residents", "chart", "med"] as const;

// Seite, die eine App beim Öffnen zeigt (ihr erster erlaubter Reiter).
export const appHref = (module: NavModule) => routeFor(module.id, module.children[0]);

// Recently used pages of this browser, most recent first.
const RECENT_KEY = "carecore.recent-pages";
export type RecentPage = { moduleId: string; child: string };

export function readRecentPages(): RecentPage[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(value) ? (value as RecentPage[]).filter((item) => routeFor(item.moduleId, item.child)) : [];
  } catch {
    return [];
  }
}

export function rememberPage(moduleId: string, child: string) {
  if (!routeFor(moduleId, child)) return;
  try {
    const next = [
      { moduleId, child },
      ...readRecentPages().filter((item) => item.moduleId !== moduleId || item.child !== child),
    ].slice(0, 6);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Without storage there is simply no history.
  }
}

export function moduleLabel(moduleId: string, child: string, terms: Terms = TERMINOLOGIES.resident) {
  const entry = navigation.flatMap((group) => group.modules).find((item) => item.id === moduleId);
  const label = (text: string) => navigationLabel(text, terms);
  if (!entry) return label(child);
  return entry.children.length === 1 || entry.label === child
    ? label(entry.label)
    : `${label(entry.label)} · ${label(child)}`;
}
