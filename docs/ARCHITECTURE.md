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

### Module, Plattform, Notfallzugriff (PRD §69, §42, §34)
- **Module** je Organisation in `Organization.modules` (`src/lib/modules.ts`: `MODULES`, `moduleOfPermission()`, `orgHasModule(org, key)` – auch §69-Paketnamen wie `clinical_plus`). `getCtx()` entfernt die Berechtigungen abgeschalteter Module aus den Grants (`stripDisabled`), dadurch folgen Navigation, Seiten, Actions und Suche ohne eigene Prüfung; `assertCan` meldet dann `common.moduleOff`. Seitenpfade eines Moduls (`paths`) zeigen über `ModuleGate` (Shell) «Modul nicht aktiv», API-Pfade (`api`) antworten in `apiAuth()` mit `403 module_inactive`. Neue Module: Eintrag in `MODULES` (Berechtigungs-Präfix, Pfade), Texte in `tenancy.modules.items`, Migration ergänzt den Schlüssel bei bestehenden Organisationen. Jobs und Kontexte ohne `getCtx()` (Portale, Hintergrundjobs) prüfen `orgHasModule()` selbst. Ein-/Ausschalten: Admin → Klinische Konfiguration → Module oder `/platform` (beide über `setOrgModules()`).
- **Plattform-Betrieb** `/platform` (eigenes Layout ausserhalb `(app)`): nur `User.platformRole = 'operator'` (aus `PLATFORM_ADMIN_EMAILS`) mit zweitem Faktor; nur Zählwerte, nie Personen- oder Gesundheitsdaten anderer Organisationen; Audit mit `platformAudit()`. `Organization.suspendedAt` sperrt Anmeldung (`orgLoginBlock()`), Sitzungen (`getSession()`) und API-Tokens; `suspendedReason = 'pending'` = Antrag aus `ORG_SIGNUP`.
- **Systemadministration ohne klinische Rechte** (`SYSADMIN_PERMISSIONS`). Klinischer Lesezugriff nur über den **Notfallzugriff** (`src/lib/emergency.ts`, Admin → Notfallzugriff, Berechtigung `admin.emergency`): `getCtx()` ergänzt während der Laufzeit einen organisationsweiten Lese-Grant und protokolliert jeden Seitenaufruf (`emergency.view`); `ctx.roleGrants` enthält die Grants ohne Notfallzugriff (für persönliche API-Tokens).

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

### Sicherheit und Betrieb (PRD §37, §38, §66)
- **Content-Security-Policy** setzt `src/proxy.ts` mit neuer Nonce pro Anfrage (`src/lib/csp.ts`): Skripte nur mit Nonce (`'strict-dynamic'`, kein `'unsafe-eval'` in Produktion), `<style>` nur mit Nonce, `style`-Attribute erlaubt. Keine Inline-Skripte oder `<style>`-Blöcke schreiben; Branding kommt als Stylesheet von `/api/brand`. Neue Fremdquellen über `CSP_*`-Variablen, nie im Code verstreuen. zod läuft im Browser `jitless` (`src/instrumentation-client.ts`), weil der eval-Test sonst einen Verstoss meldet. `/api/*` erhält eine eigene strenge CSP (`next.config.ts`).
- **Rate-Limit**: `await rateLimit(key, limit, windowMs)` aus `src/lib/rate-limit.ts` (Postgres, über alle Instanzen; Schlüssel werden gehasht). Bei Fehlversuchen nur Fehler zählen (`peekRateLimit` vor der Prüfung, `rateLimit` nach dem Fehlschlag) – Stationsgeräte teilen sich oft eine IP.
- **Audit-Überwachung**: Job `security` (alle 5 Min.) wertet das Audit-Protokoll mit `src/lib/security-rules.ts` aus (Fehlanmeldungen, Zweitfaktor-Fehler, Massenzugriffe auf Akten, Exporte, Rechteänderungen, API-Fehler), speichert `SecurityAlert` und benachrichtigt Personen mit `admin.audit`. Neue sicherheitsrelevante Audit-Aktionen bei Bedarf dort und in `WATCHED` (`src/lib/security-alerts.ts`) ergänzen. Admin → Sicherheit: Alarme, Vorfallregister (`SecurityIncident`, Meldefrist 72 h), Betrieb.
- **Logging**: `log.info|warn|error(msg, fields)` aus `src/lib/log.ts` statt `console.*` – JSON-Zeilen in Produktion, sensible Felder (E-Mail, Token, Passwort) werden maskiert. Nie Gesundheitsdaten loggen.
- **Fehler**: `onRequestError` in `src/instrumentation.ts` und `run()` (abgefangene Action-Fehler) melden an `captureError()` (`src/lib/errors.ts`): Log, Zähler je Tag in `ErrorEvent` (ohne Meldung), optional `ERROR_WEBHOOK_URL`. Zähler mit `count()` aus `src/lib/metrics.ts` (Labels ohne Kennungen, Routen über `routeLabel()`).
- **Health/Metriken**: `/api/health` (öffentlich, ohne Details), `/api/metrics` (Prometheus, `METRICS_TOKEN`). Neue Jobs in `JOB_EXPECT_MS` (`src/lib/health-core.ts`) eintragen, sonst erscheinen sie nicht im Betriebszustand.
- **CI**: `.github/workflows/ci.yml` (Migrationen, Abgleich Schema↔Migrationen, Typecheck, Tests mit Postgres, Build), Dependabot `.github/dependabot.yml`.

### Benachrichtigungen dienstbewusst (PRD §25)
- `notify()` filtert klinische Meldungen an mehrere Personen nach Dienst (`src/lib/notify-prefs.ts` → `selectRecipients`, Daten aus `src/lib/duty.ts`): im Dienstplan geführte Personen nur während ihres Dienstes im Bereich (±15 Min.), nicht geplante Personen (Leitung) immer, Abwesende nie; ist niemand im Dienst → Stellvertretung (Dienst im selben Standort, dann Bereichsleitung, dann alle). Bereich über `unitId` mitgeben (sonst aus dem Link abgeleitet); `dutyAware: false` für ausdrücklich adressierte Personen.
- Einstellungen je Art (`User.notificationPrefs`, Profil → Benachrichtigungen): In-App für nicht klinische Arten abschaltbar, Push je Art, «keine Push-Nachrichten ausserhalb meiner Dienste». Klinische Meldungen, Aufgaben und Sicherheit bleiben in der App immer an; `critical` wird immer zugestellt.
- Ist ein Anlass erledigt (z. B. auffälliger Vitalwert «gesehen»), `settleNotifications(orgId, groupKey)` aufrufen – markiert die gebündelte Meldung bei allen Empfangenden als gelesen.

### Integrationen (PRD §40/§41)
- Adapter je `Integration.kind` in `src/lib/integrations/registry.ts` (`test`, optional `import`), jede Ausführung in `IntegrationRun` (nur Zählwerte). «prepared» = Schnittstelle vorbereitet. Labor: Format `src/lib/integrations/lab.ts`, Eingang `POST /api/v1/labs` (Scope `labs:write`) oder Admin-Import; Anzeige `<LabResults residentId />` (`src/components/labs/LabResults.tsx`).

### Angehörigenportal (PRD §60, §36)
- Eigener Bereich `/portal` (`src/app/portal/**`) mit eigenen Konten (`PortalAccount`) und Sitzungen (`PortalSession`, Cookie `careos_portal` mit Pfad `/portal`, Hash mit eigenem Präfix, `src/lib/portal/auth.ts`). Portal-Code nutzt **nie** `getCtx()`/`getSession()` der Stationsapp; der einzige Bewohnerbezug entsteht in `getPortalCtx()` (`src/lib/portal/context.ts`) über angenommene, nicht widerrufene `PortalAccess`. Proxy-Regeln in `src/lib/portal/routing.ts` (öffentlich nur `/portal/login`, `/portal/invite`). Ein Test prüft, dass Portal-Code keine klinischen Tabellen liest (`src/lib/portal/policy.test.ts`).
- Was sichtbar ist, regelt `src/lib/portal/policy.ts`: Freigaben `appointments | updates | messages | visits | files`, immer innerhalb der erfassten Einwilligung (`consentScope`), Projektionen für Person (Name, Bereich, Zimmer), Termine (Titel nur bei `relatives`/`other`, nie Notizen) und Dateien (`ResidentFile.portalShared`, nur Kategorien `directive | consent | insurance | other`). Lesezugriffe nur über `src/lib/portal/data.ts`.
- Einladung in Akte → Kontakte (`portal.manage`): Einwilligung (wer, wann, Umfang), Einmal-Link 7 Tage (`src/lib/portal/invites.ts`), Versand über den vorbereiteten Adapter `src/lib/mail.ts` (`MAIL_WEBHOOK_URL`), sonst Link kopieren. Widerruf wirkt sofort.
- Team → Angehörige (`/team/family`, `portal.respond`): Posteingang je Bereich (zuweisen, antworten, erledigen, «in Verlauf übernehmen» als Kategorie `relatives`), Besuchsanfragen bestätigen (→ `Appointment kind: relatives`) oder ablehnen, Mitteilungen für Angehörige (`PortalUpdate`, eigene Kategorie), Zugänge (Freigaben, Dokumente, sperren, widerrufen). Benachrichtigung `portal.*` über `notifyFamilyInbox()` (dienstbewusst, Push ohne Inhalt).
- Modul: `portalEnabled(org)` (`src/lib/portal/module.ts`, Modul `portals` aus `src/lib/modules.ts`). Audit `portal.*` (Akteur im `context.portalAccountId`), Löschkonzept `src/lib/portal/retention.ts` (aus `src/lib/retention.ts`), Datenauskunft enthält `portal`. Bewohnerportal vorbereitet: `PortalAccess.role = self`.

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
  - `TextField`, `SearchField`, `Textarea`, `Checkbox`, `Switch`, `CheckboxGroup` sind server-kompatibel (kein `'use client'` nötig); die übrigen sind Client-Komponenten mit serialisierbaren Props.
  - `Select` ist eine eigene Auswahlliste (WAI-ARIA «Select-only Combobox», kein natives `<select>`): Kinder weiterhin als `<option value>`/`<optgroup label>` (auch aus Server-Seiten), `name` → verstecktes Feld mit nativem `change`, `onChange(e)` mit `e.target.value`, `required` blockiert das Absenden mit Meldung am Feld, `loading` zeigt einen Spinner (z. B. Bereichswechsel). Logik in `src/lib/select-options.ts`.
  - Fehler aus `ActionForm` (`r.field`) erscheinen direkt am Feld (`[data-err-slot]` im Rahmen) und werden fokussiert. Eigene Felder (NumberField, Combobox, RadioGroup, Datum/Zeit) schreiben den Wert in ein verstecktes Feld `name` (mit `data-for` auf das sichtbare Element) und lösen dort ein natives `change` aus – Formulare, die auf Änderungen reagieren, hören nativ (`addEventListener('change')`), nicht über React-`onChange` am `<form>`.
  - `NumberField`: Eingabe mit Komma oder Punkt, Anzeige im Format der Sprache, Formularwert immer mit Punkt (`src/lib/number-input.ts`); `min`/`max`/`step` (`step={1}` = ganze Zahlen) prüfen am Feld, `warn={{ lo, hi }}` zeigt «ungewöhnlich hoch/tief» ohne zu blockieren. Für Vitalwerte, Dosen, Mengen, Dauer.
  - `Combobox` für lange Listen (Personen, Mitarbeitende, Medikamente, Räume): Optionen `{ value, label, hint?, group?, keywords? }`, durchsuchbar (ohne Akzente, mehrere Wörter, `src/lib/combobox.ts`), `freeText` ersetzt `<input list>`. Kurze feste Listen bleiben `Select`, wenige kurze Optionen `SegmentedControl`, Ein/Aus-Einstellungen `Switch`.
  - `FileField`: Ablegen per Drag & Drop, Vorschau, Prüfung von Typ und Grösse vor dem Upload (`MAX_UPLOAD_BYTES` aus `src/lib/upload-limits.ts`).
- Häufige Aktionen optimistisch (`useOptimistic`, bei Fehler zurück mit Toast); sicherheitskritische Aktionen (Medikation, Begründungen, Löschungen) nur mit Pending-Zustand. Server-Actions prüfen den Status beim Speichern, damit Doppelklicks oder zwei Geräte nicht doppelt buchen.
- Mobile: Touch-Ziele ≥ 40 px, Einhandbedienung, keine horizontale Seitenscroll (Tabellen in `.tablewrap`).

### KI (CareOS AI)
- `src/lib/ai.ts`. KI-Ausgaben immer in `.ai-box` mit Badge `common.ai.badge` und Hinweis `common.ai.disclaimer`, nie automatisch gespeichert, jede Nutzung in `AiInteraction` protokolliert. Keine Diagnosen, Verordnungen oder Dosisänderungen (PRD §23.2).
