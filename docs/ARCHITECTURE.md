# CareOS – Architektur und Konventionen

Dieses Dokument beschreibt, wie der Code aufgebaut ist und welche Regeln für neue Module gelten.

## Stack

- **Next.js 16** (App Router, React 19, Server Components, Server Actions). Achtung: `params`, `searchParams`, `cookies()`, `headers()` sind **async**. Middleware heisst `src/proxy.ts`. `refresh()` aus `next/cache` lädt den Client-Router aus einer Server Action neu. Doku liegt lokal unter `node_modules/next/dist/docs/`.
- **Prisma 6 + PostgreSQL** (Railway Postgres). Schema: `prisma/schema.prisma`.
- **Railway Bucket** (S3-kompatibel) für Dateien: `src/lib/storage.ts`, `src/lib/files.ts`, Auslieferung über `/api/files/[id]`.
- Kein CSS-Framework. Das Design-System liegt vollständig in `src/app/globals.css` (Tokens + Komponentenklassen aus dem Entwurf „Stationsarbeitsplatz“).

## Verzeichnisse

```
src/app/(app)/          Geschützte App (Layout = Shell mit Topbar, Rail, Bottom-Nav)
src/app/(app)/residents Bewohnerliste (layout.tsx) und Akte ([id]/layout.tsx mit Banner + Registern)
src/app/login           Anmeldung, MFA
src/app/api             Route Handler: auth, events (SSE), search, files, health, v1 (REST), fhir
src/lib                 Domänenlogik ohne UI (server-only, ausser time/vitals/permissions/clinical-config)
src/components          UI-Bausteine (shell/, ui/, residents/ …)
src/i18n                Übersetzungen (messages/<namespace>.ts) und Kern
prisma/seed.ts          Demodaten „Haus Lindenhof“
```

## Regeln

### Kontext, Berechtigungen, Mandanten
- Jede Seite und jede Server Action beginnt mit `const ctx = await getCtx()` (`src/lib/context.ts`).
- Berechtigungen: `ctx.can('resident.chart.write', { unitId, locationId })`, im gewählten Bereich `ctx.canHere(perm)`. Schlüssel in `src/lib/permissions.ts`. Fehlt sie: Seite rendert `<Forbidden text={t('common.notAllowed')} />`, Action wirft `assertCan(...)` (wird von `run()` abgefangen).
- **Jede DB-Abfrage ist auf `ctx.org.id` bzw. `ctx.unitIds` beschränkt.** Bewohner immer über `residentInScope(ctx, id, perm?)` laden.
- `ctx.unit` = aktuell gewählter Bereich (Wohngruppe/Station) aus der Topbar.

### Server Actions
- Datei `actions.ts` neben der Seite, `'use server'`.
- Rückgabe immer `ActionResult` über `run(async () => { ... })` aus `src/lib/action.ts`. Fehlermeldungen als i18n-Schlüssel (`'chart.errors.empty'`).
- Validierung mit `zod` (v4) oder den Helfern `fd`, `fdNum`, `fdBool`.
- Nach Änderungen: `audit(ctx, {...})` (Pflicht bei klinischen und sicherheitsrelevanten Daten, mit before/after), `emit({...})` für Echtzeit, dann `refresh()` oder `revalidatePath()`.
- Klinische Einträge werden **nie überschrieben**: Korrektur = neuer Eintrag mit `supersedesId` (PRD §35).
- Client-Formulare: `<ActionForm action={...} success="chart.saved">` aus `src/components/ui/ActionForm.tsx`. Dialoge: `src/components/ui/Dialog.tsx` (mit `context` für Patientenzuordnung bei kritischen Aktionen). Toast: `toast()` aus `src/components/toast.tsx` (mit `undo` für ungefährliche Aktionen).

### Echtzeit
- `emit({ orgId, type, unitId, residentId, actorId, userIds?, payload? })` aus `src/lib/events.ts`. Clients laden bei Events automatisch neu (`LiveUpdates`). Webhooks werden daraus zugestellt.
- Benachrichtigungen: `notify({...})` aus `src/lib/notify.ts`, Prioritäten `critical | action | info | social`, `groupKey` bündelt.
- Web Push (`src/lib/push.ts`, VAPID-Variablen): `notify()` sendet zusätzlich an Geräte der Personen, deren `User.pushPriorities` die Priorität enthält. Push-Inhalte enthalten **nie Gesundheitsdaten**: klinische Arten (alles ausser Dienstplan, Lernen, Dokumente, Team, Chat; immer bei Links auf `/residents`, `/quality`, `/tasks`, `/handover`) nur als allgemeiner Hinweis «Kritische Meldung in Wohngruppe 2» plus Link (`src/lib/push-shared.ts`). Neue Benachrichtigungsarten ohne klinischen Bezug dort eintragen.

### Offline (PRD §39)
- Service Worker `public/sw.js`: speichert `/offline` samt Assets vorab, Navigation ohne Verbindung → `/offline` (dann `/offline.html`). Angemeldete HTML-Seiten und API-Antworten werden nie gecacht. Nach Änderungen an `sw.js` `VERSION` erhöhen. In der Entwicklung nur mit `?sw=1` aktiv (`?sw=0` schaltet ab).
- Outbox `src/lib/offline/` (Client): IndexedDB, AES-GCM mit nicht exportierbarem Geräteschlüssel, max. 24 h, beim Abmelden gelöscht (`SignOutForm`). In Client-Komponenten: `orQueue(() => serverAction(...), { kind, residentId, data }, { who })` – ohne Verbindung wird vorgemerkt (`isQueued(r)`).
- Synchronisation `POST /api/offline/sync` → `src/lib/offline/apply.ts`: gleiche Prüfungen wie die Server Actions, idempotent über `OfflineOp.id`, dokumentierter Zeitpunkt bleibt erhalten, Einträge als «offline erfasst» markiert, Konflikte (`src/lib/offline/validate.ts`) gehen an das Panel «Synchronisation» in der Shell. Neue Offline-Arten: Typ in `types.ts`, Schema in `validate.ts`, Anwendung in `apply.ts`.
- Lesestand für `/offline`: `<ShiftSnapshot />` (Home, Bewohnerliste) speichert verschlüsselt Personen (Zimmer, Allergien, REA, Risiken) und offene Aufgaben von heute, max. 12 h – keine Verlaufseinträge, keine Vitalwerte.

### Aufgaben
- `src/lib/tasks.ts`: `ensureTasksForDay(unitId, day)` erzeugt Aufgaben aus Interventionen (Pflegeplanung), Medikamenten-Zeitpunkten und fälligen Assessments. Nach Änderungen an diesen Quellen `invalidateTaskGeneration(unitId)` aufrufen.
- `taskView(task)` → `done | partial | skipped | escalated | in_progress | over | due | up`.
- Systemtitel sind Schlüssel (`medication.slot`, `assessment.<key>`, `incident.<step>`): Anzeige immer über `taskTitle(t, task)`.

### Visite
- `/tasks/visit` (`src/lib/visit.ts`, `src/lib/visit-data.ts`): Pflege merkt Fragen vor (`VisitQuestion`, Akte → Übersicht), die Visite (`Visit`) beantwortet sie und erfasst Anordnungen (`VisitOrder`). Jede Anordnung wird eine Aufgabe (`source: 'order'`), die Zusammenfassung ein Verlaufseintrag (Kategorie `physician`). Medikamente werden in der Visite nie verordnet, nur als Aufgabe «Verordnung anpassen» mit Link in die Medikation. Berechtigung `resident.visit.conduct`.

### Zeit
- Server läuft mit `TZ=Europe/Zurich`. Hilfen in `src/lib/time.ts`. `@db.Date`-Felder mit `dbDate()` schreiben und `fromDbDate()` lesen.

### Hintergrundjobs, Eskalationen, Löschkonzept
- `src/instrumentation.ts` startet `src/lib/jobs.ts` (nur Node.js-Laufzeit; `JOBS_DISABLED=true` schaltet ab). Jeder Lauf hält `pg_try_advisory_xact_lock(hashtext(name))` in einer Transaktion, damit bei mehreren Instanzen nur eine arbeitet; jeder Lauf wird in `JobRun` protokolliert.
- `escalations` (alle 5 Min., `src/lib/escalations.ts`): Regeln aus `Organization.settings.escalation` (`src/lib/escalation-policy.ts`, Admin → Klinische Konfiguration → Eskalationen). Systemvorgänge mit `auditSystem()` protokollieren.
- `retention` (täglich 02:30 Europe/Zurich, `src/lib/retention.ts`): Fristen aus `Organization.settings.retention` (`src/lib/retention-policy.ts`, Admin → Datenschutz). Akten werden anonymisiert, nie gelöscht; jeder Lauf schreibt `retention.run` ins Audit-Protokoll. Audit-Einträge sind nur über `deleteAuditBefore()` löschbar (Trigger erlaubt DELETE nur mit `SET LOCAL careos.retention = 'on'` und älter als 10 Jahre).
- `cleanup` (stündlich): abgelaufene Anmelde-Challenges und Sitzungen.

### i18n (DE, FR, IT, EN)
- Jedes Modul hat einen Namespace in `src/i18n/messages/<ns>.ts`, alle vier Sprachen vollständig (`defineMessages` prüft das beim Typecheck).
- Server: `ctx.t('ns.key', vars)`. Client: `const t = useT()` aus `@/i18n/client`.
- Platzhalter `{name}`, Plural `{n, plural, one {# Eintrag} other {# Einträge}}`. Terminologie der Organisation über `{resident}`, `{residents}`, `{Resident}`, `{Residents}` – nie „Bewohner“ hart codieren.
- Stil: Schweizer Hochdeutsch (ss statt ß), knapp, fachlich, Sie-Form in Fehlermeldungen, Du nur in persönlichen Hinweisen der Startseite.

### Design („Clinical Calm“, kein AI-Slop)
- Nur vorhandene Klassen und Tokens aus `globals.css` verwenden. Keine Verläufe, keine Schatten ausser `--shadow-pop` für Popover, keine Emojis in der UI, keine verspielten Illustrationen, keine Marketing-Sprache.
- Seitenaufbau: `<main className="panel main">` → `.view-head` (Label + h1 + Aktionen) → `.scroll` → `.tabpanel`. In der Akte liefert das Layout Banner, Register und `.tabpanel`; Seiten rendern nur den Inhalt.
- Status nie nur über Farbe: immer Text/Symbol dazu (▲▼, „überfällig“, Tags).
- Zahlen in `.mono`, Labels in `.lbl`, Tabellen `.tablewrap > table.stable`, Kennzahlen `.metrics > .metric`, Listen `ul.list > li > .li`.
- Hell ist Standard; jede Komponente muss in Dunkel funktionieren (nur Tokens, keine festen Farben).
- Schriftgrössen nur in `rem` (Basis 16 px). Profil → Schriftgrösse setzt `html[data-text="l"|"xl"]` (112.5 % / 125 %, Cookie `careos_text`, pro Gerät); die Schriftgrösse des Browsers wirkt zusätzlich.
- Datum und Zeit nie als native `<input type="date|time">`: `DateField`, `TimeField`, `DateTimeField` aus `src/components/ui/` (Format der App-Sprache, Kalender und Zeitliste per Tastatur, Wert im versteckten Feld wie bisher `YYYY-MM-DD` / `HH:MM` / `YYYY-MM-DDTHH:MM`). Parsing in `src/lib/date-input.ts`.
- Häufige Aktionen optimistisch (`useOptimistic`, bei Fehler zurück mit Toast); sicherheitskritische Aktionen (Medikation, Begründungen, Löschungen) nur mit Pending-Zustand. Server-Actions prüfen den Status beim Speichern, damit Doppelklicks oder zwei Geräte nicht doppelt buchen.
- Mobile: Touch-Ziele ≥ 40 px, Einhandbedienung, keine horizontale Seitenscroll (Tabellen in `.tablewrap`).

### KI (CareOS AI)
- `src/lib/ai.ts`. KI-Ausgaben immer in `.ai-box` mit Badge `common.ai.badge` und Hinweis `common.ai.disclaimer`, nie automatisch gespeichert, jede Nutzung in `AiInteraction` protokolliert. Keine Diagnosen, Verordnungen oder Dosisänderungen (PRD §23.2).
