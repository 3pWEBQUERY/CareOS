"use client";

import { type Terms } from "@/lib/terminology";
import { LANGUAGES, type Language } from "@/lib/i18n-shared";
import { type ModuleIconName } from "@/app/components/module-icon";
import { SETTING_DEFINITIONS, SETTING_KEYS, type AppSettings, type SettingKey } from "@/lib/settings-shared";
import { PERMISSION_LABELS } from "@/lib/permission-labels";
import {
  AUTO_LOGOUT_MINUTES,
  CONTRASTS,
  MOTIONS,
  THEMES,
  NOTIFY_CATEGORIES,
  START_PAGES,
  TEXT_SIZES,
  autoLogoutLabel,
  type AutoLogout,
  type NotifyCategory,
  type QuietHours,
  type StartPage,
  type TextSize,
  type UserPreferences,
  type UserSettings,
} from "@/lib/user-settings-shared";

export type SettingsView =
  "overview" | "profile" | "notifications" | "security" | "appearance" | "privacy" | "organization";

export type Item = {
  id: string;
  title: string;
  description: string;
  value: string;
  icon: ModuleIconName;
  // What the detail card shows for the item.
  detail:
    | { kind: "open"; view: SettingsView; text: string }
    | { kind: "profile"; text: string }
    | { kind: "info"; text: string; lines?: string[] }
    | { kind: "notify"; category: NotifyCategory; text: string }
    | { kind: "password"; text: string }
    | { kind: "sessions"; text: string }
    | { kind: "push"; text: string }
    | { kind: "mfa"; text: string }
    | { kind: "passkeys"; text: string }
    | { kind: "toggle"; text: string; label: string; checked: boolean; note?: string; save: (value: boolean) => void }
    | { kind: "quiet"; text: string; value: QuietHours; save: (value: QuietHours) => Promise<boolean> }
    | { kind: "action"; text: string; label: string; danger?: boolean; run: () => void }
    | { kind: "link"; text: string; label: string; href: string }
    | {
        kind: "organization";
        text: string;
        setting: SettingKey;
        value: AppSettings[SettingKey];
        save: (change: { enabled?: boolean; value?: number }) => Promise<boolean>;
      }
    | { kind: "select"; text: string; label: string; value: string; options: string[]; save: (value: string) => void };
};

export const VIEWS: Record<SettingsView, { title: string; eyebrow: string; description: string }> = {
  overview: {
    eyebrow: "Einstellungen",
    title: "Einstellungen",
    description:
      "Profil, Benachrichtigungen, Sicherheit, Darstellung und Datenschutz – und für die Administration die Einstellungen der Einrichtung.",
  },
  profile: {
    eyebrow: "Einstellungen · Profil",
    title: "Profil & Präferenzen",
    description: "So erscheinst du in Übergaben, Nachrichten und Verantwortlichkeiten.",
  },
  notifications: {
    eyebrow: "Einstellungen · Benachrichtigungen",
    title: "Benachrichtigungen",
    description: "Lege fest, welche Hinweise dich erreichen. Kritische Hinweise erhältst du immer.",
  },
  security: {
    eyebrow: "Einstellungen · Sicherheit",
    title: "Sicherheit & Zugriff",
    description: "Passwort, Zwei-Faktor-Anmeldung und angemeldete Geräte.",
  },
  appearance: {
    eyebrow: "Einstellungen · Darstellung",
    title: "Darstellung & Bedienung",
    description: "Passe CareOS an deine Arbeitsweise an. Gilt auf allen deinen Geräten.",
  },
  privacy: {
    eyebrow: "Einstellungen · Datenschutz",
    title: "Datenschutz & Daten",
    description: "Deine Daten herunterladen, dieses Gerät aufräumen und Einstellungen zurücksetzen.",
  },
  organization: {
    eyebrow: "Einstellungen · Einrichtung",
    title: "Einrichtung",
    description: "Einstellungen für alle Mitarbeitenden der Organisation. Jede Änderung wird protokolliert.",
  },
};

export const NAV: Array<[SettingsView, string, ModuleIconName]> = [
  ["overview", "Übersicht", "settings"],
  ["profile", "Profil & Präferenzen", "team"],
  ["notifications", "Benachrichtigungen", "bell"],
  ["security", "Sicherheit & Zugriff", "quality"],
  ["appearance", "Darstellung & Bedienung", "pulse"],
  ["privacy", "Datenschutz & Daten", "docs"],
  ["organization", "Einrichtung", "building"],
];

export const ADMIN_VIEWS: SettingsView[] = ["organization"];
const pick = <K extends string>(labels: Record<K, string>, label: string, fallback: K) =>
  (Object.keys(labels) as K[]).find((key) => labels[key] === label) ?? fallback;

function daysAgo(value: string | null) {
  if (!value) return null;
  return Math.floor((Date.now() - Date.parse(value)) / 86_400_000);
}

export type Actions = { exportData: () => void; clearDevice: () => void; endPushAll: () => void; reset: () => void };
type Extras = {
  isAdmin: boolean;
  organization: AppSettings | null;
  organizationError: string | null;
  organizationShortcuts: boolean;
  saveOrganization: (key: SettingKey, change: { enabled?: boolean; value?: number }) => Promise<boolean>;
  actions: Actions;
  terms: Terms;
  // Wählbare Sprachen (freigegebene; für die Administration zum Prüfen alle).
  languages: Language[];
};

export function itemsFor(
  view: SettingsView,
  data: UserSettings,
  save: (change: Partial<UserPreferences>, message: string) => void,
  extras: Extras,
): Item[] {
  const { profile, preferences, security } = data;
  const passwordAge = daysAgo(security.passwordChangedAt);
  const passwordValue =
    passwordAge === null
      ? "noch nie geändert"
      : passwordAge === 0
        ? "heute geändert"
        : `vor ${passwordAge} Tagen geändert`;
  const enabled = Object.values(preferences.notify).filter(Boolean).length;
  const total = Object.keys(NOTIFY_CATEGORIES).length;
  const appearance = [
    TEXT_SIZES[preferences.textSize],
    CONTRASTS[preferences.contrast],
    THEMES[preferences.theme],
  ].join(" · ");
  const onOff = (value: boolean) => (value ? "Ein" : "Aus");
  const startLabel = (key: StartPage) => (key === "residents" ? extras.terms.many : START_PAGES[key].label);
  const quiet = preferences.quietHours;
  const quietValue = quiet.enabled ? `${quiet.from}–${quiet.to} Uhr` : "Aus";

  if (view === "overview")
    return [
      {
        id: "profile",
        title: "Profil & Präferenzen",
        description: "Name, Funktion, Telefon und fester Wohnbereich",
        value: profile.displayName,
        icon: "team",
        detail: {
          kind: "open",
          view: "profile",
          text: `${profile.jobTitle || "Funktion nicht angegeben"} · ${profile.roleName}`,
        },
      },
      {
        id: "notifications",
        title: "Benachrichtigungen",
        description: "Aufgaben, Dienste, Schulungen, Team und mehr",
        value: `${enabled} von ${total} aktiv`,
        icon: "bell",
        detail: { kind: "open", view: "notifications", text: "Kritische Hinweise erhältst du immer." },
      },
      {
        id: "security",
        title: "Sicherheit & Zugriff",
        description: "Passwort, Geräte und automatische Abmeldung",
        value: `${security.sessions.length} Gerät${security.sessions.length === 1 ? "" : "e"}`,
        icon: "quality",
        detail: { kind: "open", view: "security", text: `Passwort ${passwordValue}.` },
      },
      {
        id: "appearance",
        title: "Darstellung & Bedienung",
        description: "Schrift, Kontrast, Animationen, Startseite, Kürzel",
        value: appearance,
        icon: "pulse",
        detail: { kind: "open", view: "appearance", text: `Startseite: ${startLabel(preferences.startPage)}.` },
      },
      {
        id: "privacy",
        title: "Datenschutz & Daten",
        description: "Daten herunterladen, Gerät aufräumen, zurücksetzen",
        value: "Deine Daten",
        icon: "docs",
        detail: {
          kind: "open",
          view: "privacy",
          text: "Lade alle Daten herunter, die CareOS zu deinem Konto speichert, oder räume dieses Gerät auf.",
        },
      },
      ...(extras.isAdmin
        ? [
            {
              id: "organization",
              title: "Einrichtung",
              description: "Einstellungen für alle Mitarbeitenden",
              value: "Administration",
              icon: "building",
              detail: {
                kind: "open",
                view: "organization",
                text: "Erinnerungen, Medikation, BtM, Navigation und Tastaturkürzel für die ganze Organisation.",
              },
            } satisfies Item,
          ]
        : []),
    ];

  if (view === "profile")
    return [
      {
        id: "profile-name",
        title: profile.displayName,
        description: `Benutzername ${profile.username}`,
        value: profile.jobTitle || "Funktion offen",
        icon: "team",
        detail: {
          kind: "profile",
          text: "Dein Name wird in Übergaben, Nachrichten und Verantwortlichkeiten angezeigt.",
        },
      },
      {
        id: "profile-unit",
        title: "Fester Wohnbereich",
        description: "Voreinstellung für Kopfzeile, Tagesliste und Übergaben",
        value: profile.careUnit ?? "Nicht festgelegt",
        icon: "building",
        detail: { kind: "profile", text: "Der feste Wohnbereich wird beim Öffnen von CareOS vorausgewählt." },
      },
      {
        id: "profile-phone",
        title: "Telefon",
        description: "Für Rückfragen im Team",
        value: profile.phone || "–",
        icon: "handover",
        detail: { kind: "profile", text: "Deine Telefonnummer sehen Kolleginnen und Kollegen deines Hauses." },
      },
      {
        id: "profile-role",
        title: "Rolle & Berechtigungen",
        description: "Wird von der Administration vergeben",
        value: profile.roleName,
        icon: "quality",
        detail: {
          kind: "info",
          text: "Deine Rolle bestimmt, welche Bereiche du siehst und bearbeiten darfst.",
          lines: profile.permissions.map((permission) =>
            permission.startsWith("residents.")
              ? PERMISSION_LABELS[permission].replace("Bewohner", extras.terms.prefix)
              : (PERMISSION_LABELS[permission] ?? permission),
          ),
        },
      },
    ];

  if (view === "notifications")
    return [
      ...(Object.keys(NOTIFY_CATEGORIES) as NotifyCategory[]).map((category): Item => ({
        id: `notify-${category}`,
        title: NOTIFY_CATEGORIES[category].label,
        description: NOTIFY_CATEGORIES[category].detail,
        value: preferences.notify[category] ? "Aktiv" : "Aus",
        icon: "bell",
        detail: {
          kind: "notify",
          category,
          text: `${NOTIFY_CATEGORIES[category].detail}. Ausgeschaltete Hinweise werden nicht angezeigt; kritische Hinweise erhältst du immer.`,
        },
      })),
      {
        id: "push",
        title: "Push-Nachrichten",
        description: "Hinweise auch bei geschlossener App",
        value: "Dieses Gerät",
        icon: "bell",
        detail: {
          kind: "push",
          text: "Neue Benachrichtigungen erscheinen als Mitteilung auf diesem Gerät, auch wenn CareOS geschlossen ist. Angezeigt wird nur der Titel; es gelten die Kategorien oben.",
        },
      },
      {
        id: "quiet",
        title: "Ruhezeit",
        description: "Keine Push-Nachrichten in dieser Zeit",
        value: quietValue,
        icon: "shift",
        detail: {
          kind: "quiet",
          text: "In der Ruhezeit kommen keine Push-Nachrichten; die Hinweise bleiben in CareOS sichtbar. Kritische Hinweise kommen immer. Es gilt die Uhrzeit der Einrichtung, über Mitternacht (z. B. 22:00–06:00) ist möglich.",
          value: quiet,
          save: async (value) => {
            await save(
              { quietHours: value },
              value.enabled ? `Ruhezeit ${value.from}–${value.to} Uhr` : "Ruhezeit ausgeschaltet",
            );
            return true;
          },
        },
      },
      {
        id: "sound",
        title: "Hinweiston",
        description: "Kurzer Ton bei neuen Benachrichtigungen",
        value: onOff(preferences.sound),
        icon: "bell",
        detail: {
          kind: "toggle",
          text: "Ist CareOS geöffnet, erklingt ein kurzer, leiser Ton, sobald eine neue Benachrichtigung eintrifft. Die Liste aktualisiert sich jede Minute.",
          label: "Ton abspielen",
          checked: preferences.sound,
          save: (value) => save({ sound: value }, `Hinweiston ${value ? "eingeschaltet" : "ausgeschaltet"}`),
        },
      },
    ];

  if (view === "security")
    return [
      {
        id: "sec-password",
        title: "Passwort",
        description: "Ein neues Passwort meldet alle anderen Geräte ab",
        value: passwordValue,
        icon: "quality",
        detail: {
          kind: "password",
          text: "Wähle ein Passwort mit mindestens 10 Zeichen, das du nirgends sonst verwendest.",
        },
      },
      {
        id: "sec-mfa",
        title: "Zwei-Faktor-Anmeldung",
        description: "Zusätzlicher Code aus einer Authenticator-App",
        value: security.mfa ? "Ein" : "Aus",
        icon: "quality",
        detail: {
          kind: "mfa",
          text: "Nach dem Passwort fragt CareOS nach einem 6-stelligen Code aus der App auf deinem Handy. Das schützt dein Konto, auch wenn jemand dein Passwort kennt.",
        },
      },
      {
        id: "sec-passkeys",
        title: "Passkeys",
        description: "Anmelden mit Fingerabdruck, Gesicht oder PIN des Geräts",
        value: security.passkeys ? `${security.passkeys} gespeichert` : "Keine",
        icon: "quality",
        detail: {
          kind: "passkeys",
          text: "Ein Passkey ersetzt Passwort und Code: Bei der Anmeldung bestätigst du mit Fingerabdruck, Gesicht oder der PIN deines Geräts. Der Browser schlägt ihn im Feld „Benutzername“ vor.",
        },
      },
      {
        id: "sec-sessions",
        title: "Angemeldete Geräte",
        description: "Beende Sitzungen auf Geräten, die du nicht mehr verwendest",
        value: `${security.sessions.length} aktiv`,
        icon: "pulse",
        detail: { kind: "sessions", text: "Hier siehst du, wo du bei CareOS angemeldet bist." },
      },
      {
        id: "sec-idle",
        title: "Automatische Abmeldung",
        description: "Abmelden, wenn CareOS nicht bedient wird",
        value: autoLogoutLabel(preferences.autoLogout),
        icon: "logout",
        detail: {
          kind: "select",
          text: "Empfohlen auf gemeinsam genutzten Geräten im Stationszimmer. Gezählt wird die Zeit ohne Bedienung in allen Tabs dieses Browsers; offline vorgemerkte Einträge bleiben erhalten.",
          label: "Automatische Abmeldung",
          value: autoLogoutLabel(preferences.autoLogout),
          options: AUTO_LOGOUT_MINUTES.map(autoLogoutLabel),
          save: (label) =>
            save(
              {
                autoLogout: (AUTO_LOGOUT_MINUTES.find((minutes) => autoLogoutLabel(minutes) === label) ??
                  0) as AutoLogout,
              },
              `Automatische Abmeldung: ${label}`,
            ),
        },
      },
    ];

  if (view === "privacy")
    return [
      {
        id: "privacy-export",
        title: "Meine Daten herunterladen",
        description: "Profil, Einstellungen, Qualifikationen, Geräte, Aktivität",
        value: "JSON-Datei",
        icon: "docs",
        detail: {
          kind: "action",
          text: `Enthält alles, was CareOS zu deinem Konto speichert: Profil, Einstellungen, Qualifikationen, angemeldete Geräte, Push-Abonnements und deine protokollierten Aktionen der letzten 12 Monate (ohne Inhalte von ${extras.terms.prefix}akten).`,
          label: "Herunterladen",
          run: extras.actions.exportData,
        },
      },
      {
        id: "privacy-device",
        title: "Dieses Gerät aufräumen",
        description: "Zwischengespeicherte Seiten und Daten löschen",
        value: "Dieses Gerät",
        icon: "pulse",
        detail: {
          kind: "action",
          text: "Löscht die für den Offline-Betrieb gespeicherten Seiten und Daten auf diesem Gerät. Offline vorgemerkte Einträge, die noch nicht gesendet sind, bleiben erhalten. Beim Abmelden geschieht das automatisch.",
          label: "Jetzt löschen",
          run: extras.actions.clearDevice,
        },
      },
      {
        id: "privacy-push",
        title: "Push auf allen Geräten beenden",
        description: "Alle Push-Abonnements deines Kontos entfernen",
        value: "Alle Geräte",
        icon: "bell",
        detail: {
          kind: "action",
          text: "Beendet die Push-Nachrichten auf allen Geräten, auf denen du sie eingeschaltet hast. Einschalten kannst du sie unter Benachrichtigungen jederzeit wieder.",
          label: "Beenden",
          danger: true,
          run: extras.actions.endPushAll,
        },
      },
      {
        id: "privacy-reset",
        title: "Einstellungen zurücksetzen",
        description: "Alle persönlichen Einstellungen auf Standard",
        value: "Standard",
        icon: "settings",
        detail: {
          kind: "action",
          text: "Benachrichtigungen, Darstellung, Startseite, Ruhezeit und automatische Abmeldung kehren zu den Standardwerten zurück. Profil, Passwort und Geräte bleiben unverändert.",
          label: "Zurücksetzen",
          danger: true,
          run: extras.actions.reset,
        },
      },
    ];

  if (view === "organization") {
    if (!extras.isAdmin)
      return [
        {
          id: "org-denied",
          title: "Nur für die Administration",
          description: "Einstellungen der Einrichtung",
          value: "Kein Zugriff",
          icon: "building",
          detail: { kind: "info", text: "Die Einstellungen der Einrichtung ändert die Administration." },
        },
      ];
    const links: Item[] = [
      [
        "org-structure",
        "Organisation & Wohnbereiche",
        "Standorte, Wohnbereiche, Zimmer",
        "/c/leitung/administration",
        "building",
      ],
      [
        "org-roles",
        "Profile & Rollen",
        "Rollen, Rechte, Medikationsrecht",
        "/c/leitung/administration/mitarbeiter",
        "team",
      ],
      ["org-staff", "Mitarbeitende", "Konten, Qualifikationen, Sperren", "/c/leitung/teamleitung/mitarbeiter", "team"],
      [
        "org-roster",
        "Dienstplan",
        "Diensttypen, Regelwerk, Qualifikationen, Feiertage",
        "/c/dienstplan/einstellungen",
        "shift",
      ],
      ["org-supply", "Pflegebedarf", "Produkte und Mindestbestände", "/c/leitung/administration/pflegebedarf", "plan"],
      [
        "org-system",
        "Systemstatus",
        "Datenbank, Migrationen, Protokoll",
        "/c/leitung/administration/konfiguration",
        "pulse",
      ],
    ].map(([id, title, description, href, icon]) => ({
      id,
      title,
      description,
      value: "Öffnen",
      icon: icon as ModuleIconName,
      detail: { kind: "link", text: `${description}.`, label: "Öffnen", href },
    }));
    const organization = extras.organization;
    if (!organization)
      return [
        {
          id: "org-loading",
          title: extras.organizationError ? "Nicht geladen" : "Wird geladen …",
          description: "Einstellungen der Einrichtung",
          value: "–",
          icon: "settings",
          detail: { kind: "info", text: extras.organizationError ?? "Die Einstellungen werden geladen." },
        },
        ...links,
      ];
    return [
      ...SETTING_KEYS.map((key): Item => {
        const definition = SETTING_DEFINITIONS[key];
        const setting = organization[key];
        return {
          id: `org-${key}`,
          title: definition.title,
          description: definition.area,
          value: setting.enabled
            ? definition.unit && setting.value !== null
              ? `${setting.value} ${definition.unit}`
              : "Ein"
            : "Aus",
          icon: definition.icon,
          detail: {
            kind: "organization",
            text: `${definition.describe(setting.value)}. Gilt für alle Mitarbeitenden.`,
            setting: key,
            value: setting,
            save: (change) => extras.saveOrganization(key, change),
          },
        };
      }),
      ...links,
    ];
  }

  return [
    {
      id: "app-text",
      title: "Schriftgrösse",
      description: "Grössere Schrift und Bedienelemente",
      value: TEXT_SIZES[preferences.textSize],
      icon: "note",
      detail: {
        kind: "select",
        text: "„Gross“ vergrössert alle Seiten um rund 12 %, „Sehr gross“ um rund 24 %.",
        label: "Schriftgrösse",
        value: TEXT_SIZES[preferences.textSize],
        options: Object.values(TEXT_SIZES),
        save: (label) => save({ textSize: pick<TextSize>(TEXT_SIZES, label, "standard") }, `Schriftgrösse: ${label}`),
      },
    },
    {
      id: "app-contrast",
      title: "Kontrast",
      description: "Dunklere Texte und Linien",
      value: CONTRASTS[preferences.contrast],
      icon: "quality",
      detail: {
        kind: "select",
        text: "Hoher Kontrast verbessert die Lesbarkeit von Nebentexten und Linien.",
        label: "Kontrast",
        value: CONTRASTS[preferences.contrast],
        options: Object.values(CONTRASTS),
        save: (label) => save({ contrast: pick(CONTRASTS, label, "standard") }, `Kontrast: ${label}`),
      },
    },
    {
      id: "app-theme",
      title: "Erscheinungsbild",
      description: "Hell oder dunkel",
      value: THEMES[preferences.theme],
      icon: "settings",
      detail: {
        kind: "select",
        text: "„Dunkel“ zeigt alle Seiten mit dunklem Hintergrund – angenehmer im Nachtdienst. Fotos bleiben farbecht.",
        label: "Erscheinungsbild",
        value: THEMES[preferences.theme],
        options: Object.values(THEMES),
        save: (label) => save({ theme: pick(THEMES, label, "light") }, `Erscheinungsbild: ${label}`),
      },
    },
    // Nur sichtbar, wenn neben Deutsch eine Sprache freigegeben ist (oder für die Administration zum Prüfen).
    ...(extras.languages.length > 1 || preferences.language !== "de"
      ? [
          {
            id: "app-language",
            title: "Sprache",
            description: "Sprache der Oberfläche",
            value: LANGUAGES[preferences.language].label,
            icon: "settings" as ModuleIconName,
            detail: {
              kind: "select" as const,
              text: "Texte der Oberfläche erscheinen in dieser Sprache, soweit sie übersetzt und geprüft sind; Einträge und Namen bleiben, wie sie erfasst wurden.",
              label: "Sprache",
              value: LANGUAGES[preferences.language].label,
              options: [...new Set<Language>([...extras.languages, preferences.language])].map(
                (key) => LANGUAGES[key].label,
              ),
              save: (label: string) =>
                save(
                  {
                    language:
                      (Object.keys(LANGUAGES) as Language[]).find((key) => LANGUAGES[key].label === label) ?? "de",
                  },
                  `Sprache: ${label}`,
                ),
            },
          },
        ]
      : []),
    {
      id: "app-motion",
      title: "Animationen",
      description: "Übergänge und Bewegungen",
      value: MOTIONS[preferences.motion],
      icon: "pulse",
      detail: {
        kind: "select",
        text: "„Reduziert“ schaltet Übergänge und Animationen aus – ruhiger und schneller auf älteren Geräten.",
        label: "Animationen",
        value: MOTIONS[preferences.motion],
        options: Object.values(MOTIONS),
        save: (label) => save({ motion: pick(MOTIONS, label, "standard") }, `Animationen: ${label}`),
      },
    },
    {
      id: "app-start",
      title: "Startseite",
      description: "Seite nach der Anmeldung",
      value: startLabel(preferences.startPage),
      icon: "home",
      detail: {
        kind: "select",
        text: "Diese Seite öffnet sich nach der Anmeldung.",
        label: "Startseite",
        value: startLabel(preferences.startPage),
        options: (Object.keys(START_PAGES) as StartPage[]).map(startLabel),
        save: (label) =>
          save(
            {
              startPage: (Object.keys(START_PAGES) as StartPage[]).find((key) => startLabel(key) === label) ?? "home",
            },
            `Startseite: ${label}`,
          ),
      },
    },
    {
      id: "app-shortcuts",
      title: "Tastaturkürzel",
      description: "Einzeltasten wie J/K oder D",
      value: extras.organizationShortcuts ? onOff(preferences.shortcuts) : "Von der Einrichtung aus",
      icon: "settings",
      detail: {
        kind: "toggle",
        text: "Mit Einzeltasten navigierst du schneller (Übersicht mit „?“). Ausschalten, wenn du Tasten versehentlich auslöst.",
        label: "Tastaturkürzel verwenden",
        checked: preferences.shortcuts,
        note: extras.organizationShortcuts
          ? undefined
          : "Die Einrichtung hat Tastaturkürzel für alle ausgeschaltet; deine Einstellung gilt, sobald sie wieder erlaubt sind.",
        save: (value) => save({ shortcuts: value }, `Tastaturkürzel ${value ? "eingeschaltet" : "ausgeschaltet"}`),
      },
    },
    {
      id: "app-dictation",
      title: "Spracheingabe",
      description: "Diktieren mit Erkennung auf diesem Gerät",
      value: onOff(preferences.dictation),
      icon: "note",
      detail: {
        kind: "toggle",
        text: "Bei Dokumentation und Übergabe erscheint „Diktieren“, wenn der Browser die Sprache auf dem Gerät erkennt. Die Aufnahme verlässt das Gerät nicht; ohne Erkennung auf dem Gerät gibt es keine Spracheingabe.",
        label: "Spracheingabe verwenden",
        checked: preferences.dictation,
        save: (value) => save({ dictation: value }, `Spracheingabe ${value ? "eingeschaltet" : "ausgeschaltet"}`),
      },
    },
  ];
}
