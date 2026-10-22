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
- Systemtitel sind Schlüssel (`medication.slot`, `assessment.<key>[:Name]`, `evaluation.<domain>[:Name]`, `rule.<regel>`, `incident.<step>`): Anzeige immer über `taskTitle(t, task)`.
- Weitere Quellen in `ensureTasksForDay`: fällige Evaluationen der Pflegeplanung (`source: 'careplan'`, `sourceId: eval:<residentId>:<domain>`, 14:00, werden nicht automatisch eskaliert und mit der Evaluation erledigt) und wiederkehrende Aufgaben aus `TaskTemplate` (`source: 'recurring'`, Rhythmus in `src/lib/recurrence.ts`; Pflege in Aufgaben → «Wiederholen» bzw. Admin → Klinische Konfiguration).
- Smart Workflows (`src/lib/workflow-rules.ts` rein, `src/lib/workflows.ts` Ausführung): auffälliger Vitalwert → Nachkontrolle, Gewichtsverlust → MNA-SF, Braden ≤ Grenze → Lagerungsplan prüfen, Wunde ohne Fortschritt → Wundevaluation. Konfiguration `Organization.settings.workflows`; läuft im Eskalationsjob und beim Aufbau der Aufgaben, idempotent, mit `auditSystem()`.
- «Jetzt fällig» (`taskView` = `due`, 30 Min. vor bis 15 Min. nach Fälligkeit) entspricht dem PRD-Zustand «bereit»; der gespeicherte Status `ready` wird nicht gesetzt und wie `planned` behandelt.
- Aufgaben, die sich durch Dokumentation schliessen (Medikamente, Assessments, Evaluationen, Nachkontrollen), zeigen einen Link statt des Häkchens. Ereignis-Massnahmen folgen ihrer Aufgabe (`syncIncidentActions`, Abgleich im Eskalationsjob) – nie beim Rendern schreiben.

### Visite
- `/tasks/visit` (`src/lib/visit.ts`, `src/lib/visit-data.ts`): Pflege merkt Fragen vor (`VisitQuestion`, Akte → Übersicht), die Visite (`Visit`) beantwortet sie und erfasst Anordnungen (`VisitOrder`). Jede Anordnung wird eine Aufgabe (`source: 'order'`), die Zusammenfassung ein Verlaufseintrag (Kategorie `physician`). Medikamente werden in der Visite nie verordnet, nur als Aufgabe «Verordnung anpassen» mit Link in die Medikation. Berechtigung `resident.visit.conduct`.

### Schicht, Zuteilung, Startseite
- Bewohnerzuordnung pro Dienst (`ShiftAssignment`, Schicht = Code + Startdatum wie bei `Handover`): Daten `src/lib/assignment.ts`, reine Logik (Vorschlag, Unterschied) `src/lib/assignment-plan.ts`, Speichern `saveAssignmentsAction` in `app/(app)/_home/actions.ts` (Berechtigung `task.manage`), Dialog `components/handover/Assignment.tsx` (Home und Übergabe).
- Filter «Meine» in anderen Modulen: `const mine = await myResidentIds(ctx)` → `string[] | null`. `null` = der Person ist in der massgeblichen Schicht (eigener Dienst im Bereich, sonst laufende Stationsschicht) niemand zugeteilt → alle zeigen, nicht leer filtern. Beispiel Aufgaben: `OR: [{ assigneeId: ctx.user.id }, { residentId: { in: mine } }]`.
- Startseite nach Rolle (`src/lib/home-view.ts`): `care` (Station), `lead` (Bereiche, ab 2 Bereichen mit Akte + Aufgaben und `schedule.manage`/`insights.view`), `quality`, `office` (HR/Admin). Im Dienst immer `care`; Umschaltung `/?view=…`.
- Auffällige Vitalwerte «gesehen / Massnahme eingeleitet» (`VitalSign.reviewedAt/ById/Kind/Note`, `reviewVitalAction`): nicht mehr «Kritisch» auf Home und kein «!» am Register der Akte; die Massnahme wird zusätzlich ein Verlaufseintrag (`structured.kind = 'vital-review'`).
- Änderungen an Verordnungen und Pflegeplanung für Übergabe und Home: `app/(app)/handover/changes.ts` (Logik `src/lib/shift-changes.ts`).

### Zeit
- Server läuft mit `TZ=Europe/Zurich`. Hilfen in `src/lib/time.ts`. `@db.Date`-Felder mit `dbDate()` schreiben und `fromDbDate()` lesen.

### Hintergrundjobs, Eskalationen, Löschkonzept
- `src/instrumentation.ts` startet `src/lib/jobs.ts` (nur Node.js-Laufzeit; `JOBS_DISABLED=true` schaltet ab). Jeder Lauf hält `pg_try_advisory_xact_lock(hashtext(name))` in einer Transaktion, damit bei mehreren Instanzen nur eine arbeitet; jeder Lauf wird in `JobRun` protokolliert.
- `escalations` (alle 5 Min., `src/lib/escalations.ts`): Regeln aus `Organization.settings.escalation` (`src/lib/escalation-policy.ts`, Admin → Klinische Konfiguration → Eskalationen). Systemvorgänge mit `auditSystem()` protokollieren.
- `retention` (täglich 02:30 Europe/Zurich, `src/lib/retention.ts`): Fristen aus `Organization.settings.retention` (`src/lib/retention-policy.ts`, Admin → Datenschutz). Akten werden anonymisiert, nie gelöscht; jeder Lauf schreibt `retention.run` ins Audit-Protokoll. Audit-Einträge sind nur über `deleteAuditBefore()` löschbar (Trigger erlaubt DELETE nur mit `SET LOCAL careos.retention = 'on'` und älter als 10 Jahre).
- `cleanup` (stündlich): abgelaufene Anmelde-Challenges und Sitzungen.
- `reminders` (täglich 06:30, `src/lib/reminders.ts`, Fristen in `src/lib/reminder-policy.ts`): ablaufende Zertifikate/Qualifikationen, Schulungsfristen, Dokument-Gültigkeit. Jede Stufe wird nur einmal gemeldet (Merker: Audit-Eintrag `reminder.*`).

### Zielgruppen
- `Post.audienceRoles` und `Document.audienceRoles` (Rollen-Schlüssel, leer = alle). Prüfen mit `inAudience(audience, roleKeys)` aus `src/lib/audience.ts` – überall, wo Mitteilungen/Dokumente angezeigt, bestätigt, gezählt oder benachrichtigt werden.

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
- **Formularfelder nur über `@/components/ui/fields`** (PRD §50): `TextField` (text/email/tel/url/password mit «Passwort anzeigen»/search), `NumberField`, `Textarea`, `Select`, `Combobox`, `Checkbox`, `CheckboxGroup`, `Switch`, `RadioGroup`, `SegmentedControl`, `FileField`, `ColorField`, `DateField`/`TimeField`/`DateTimeField`. Keine rohen `<input>`, `<select>`, `<textarea>` ausserhalb von `src/components/ui/` – Ausnahme `<input type="hidden">` und begründete Fälle mit Kommentar `raw-field-ok: <Grund>`; geprüft von `src/lib/raw-fields.test.ts` (`npm test`).
  - Gemeinsame Props: `label`, `hint`, `error`, `optional` («optional» am Label; Pflichtfelder tragen `required`), `unit` (Suffix, mit vorgelesen), `wrapClassName`/`wrapStyle` (Rahmen `.fld`, z. B. `span-all`), `hideLabel`. Ohne `label`/`hint`/`error`/`unit` wird nur das Steuerelement gerendert (Tabellenzellen, eigene Layouts – dann `aria-label`).
  - `TextField`, `SearchField`, `Select`, `Textarea`, `Checkbox`, `Switch`, `CheckboxGroup` sind server-kompatibel (kein `'use client'` nötig); die übrigen sind Client-Komponenten mit serialisierbaren Props.
  - Fehler aus `ActionForm` (`r.field`) erscheinen direkt am Feld (`[data-err-slot]` im Rahmen) und werden fokussiert. Eigene Felder (NumberField, Combobox, RadioGroup, Datum/Zeit) schreiben den Wert in ein verstecktes Feld `name` (mit `data-for` auf das sichtbare Element) und lösen dort ein natives `change` aus – Formulare, die auf Änderungen reagieren, hören nativ (`addEventListener('change')`), nicht über React-`onChange` am `<form>`.
  - `NumberField`: Eingabe mit Komma oder Punkt, Anzeige im Format der Sprache, Formularwert immer mit Punkt (`src/lib/number-input.ts`); `min`/`max`/`step` (`step={1}` = ganze Zahlen) prüfen am Feld, `warn={{ lo, hi }}` zeigt «ungewöhnlich hoch/tief» ohne zu blockieren. Für Vitalwerte, Dosen, Mengen, Dauer.
  - `Combobox` für lange Listen (Personen, Mitarbeitende, Medikamente, Räume): Optionen `{ value, label, hint?, group?, keywords? }`, durchsuchbar (ohne Akzente, mehrere Wörter, `src/lib/combobox.ts`), `freeText` ersetzt `<input list>`. Kurze feste Listen bleiben `Select`, wenige kurze Optionen `SegmentedControl`, Ein/Aus-Einstellungen `Switch`.
  - `FileField`: Ablegen per Drag & Drop, Vorschau, Prüfung von Typ und Grösse vor dem Upload (`MAX_UPLOAD_BYTES` aus `src/lib/upload-limits.ts`).
- Häufige Aktionen optimistisch (`useOptimistic`, bei Fehler zurück mit Toast); sicherheitskritische Aktionen (Medikation, Begründungen, Löschungen) nur mit Pending-Zustand. Server-Actions prüfen den Status beim Speichern, damit Doppelklicks oder zwei Geräte nicht doppelt buchen.
- Mobile: Touch-Ziele ≥ 40 px, Einhandbedienung, keine horizontale Seitenscroll (Tabellen in `.tablewrap`).

### KI (CareOS AI)
- `src/lib/ai.ts`. KI-Ausgaben immer in `.ai-box` mit Badge `common.ai.badge` und Hinweis `common.ai.disclaimer`, nie automatisch gespeichert, jede Nutzung in `AiInteraction` protokolliert. Keine Diagnosen, Verordnungen oder Dosisänderungen (PRD §23.2).
