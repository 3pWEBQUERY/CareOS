CareOS ist eine Next.js-Anwendung mit geschütztem Pflegearbeitsplatz unter `/c` und einer Neon-Postgres-basierten Anmeldung.

## Bedienkonzept: CareOS

CareOS (früher CareCore) wird wie ein Pflege-Betriebssystem bedient: Jeder Bereich ist eine App mit eigenem Namen,
Symbol und eigener Farbe. Der Startbildschirm zeigt alle Apps der Person, die beschriftete Leiste (Computer links,
Handy unten) immer dieselben Apps, „Alle Apps“ alle Apps mit einem erklärenden Satz und Suche. Über jeder Seite stehen
Symbol und Name der App und ihre Seiten als Reiter – ohne Untermenüs. Die Apps sind in
`app/components/navigation.ts` beschrieben (Name, Farbe, Satz, Reiter, Berechtigung); Analyse, Regeln und nächste
Schritte: `docs/CAREOS-UX.md`. Technische Kennungen (Tabellen `carecore_…`, Variablen `CARECORE_…`, Webhook-Kopfzeilen
`X-CareCore-…`) behalten den alten Namen, damit bestehende Installationen unverändert weiterlaufen.

## Lokale Einrichtung

1. `.env.example` als `.env.local` kopieren.
2. `DATABASE_URL` mit der gepoolten Neon-Verbindungsadresse und `CARECORE_ADMIN_PASSWORD` (mindestens 12 Zeichen) befüllen.
3. `npm install`, dann `npm run db:migrate` und anschließend `npm run dev` ausführen.

Beim ersten Anmeldeversuch wird der Administrator `Admin` mit dem Passwort aus `CARECORE_ADMIN_PASSWORD` angelegt.

## Offline-Betrieb und App-Installation

CareOS lässt sich auf Tablet und Handy zum Startbildschirm hinzufügen (`app/manifest.ts`, Symbole in `public/icons`). Ein Service Worker (`public/sw.js`, nur im Produktivbetrieb) hält die App ohne Verbindung nutzbar:

- **Anzeigen:** Programmdateien bleiben auf dem Gerät. Seiten und Daten kommen aus dem Netz; ohne Verbindung erscheint die zuletzt geladene Fassung. Die Statusanzeige unten links nennt „Offline · Stand der Daten HH:MM“. Die wichtigsten Seiten (Start, Schicht, Übergabe, Aufgaben, Bewohner, Dokumentation, Medikation, Vitalwerte, Ernährung, Wunden, Mein Dienstplan) werden nach der Anmeldung einmal täglich vorab geladen. Anmeldung, Dateien, Fotos, Exporte und KI werden nie zwischengespeichert.
- **Erfassen:** Dokumentation, Vitalwerte, Trinkmenge, Mahlzeiten, Übergabenotizen, Wundverlauf und der Abschluss von Aufgaben (✓ △ ✕) lassen sich offline erfassen. Sie werden auf dem Gerät vorgemerkt (IndexedDB, `app/components/offline-queue.ts`) und nach der Rückkehr der Verbindung mit dem erfassten Zeitpunkt der Reihe nach gesendet. Jede Anfrage trägt eine Kennung; der Server quittiert sie in derselben Transaktion wie den Eintrag (`carecore_request_receipts`, Migration `0028`), sodass kein Eintrag doppelt entsteht. Gesendet wird nur mit der Sitzung der Person, die den Eintrag erfasst hat; ist die Anmeldung abgelaufen, bittet die Statusanzeige um erneute Anmeldung. Vom Server abgelehnte Einträge bleiben mit Grund sichtbar, bis sie verworfen werden. Den Text eines vorgemerkten oder abgelehnten Eintrags (Dokumentation, Bemerkung, Übergabenotiz) kann die Person in der Statusanzeige unter „Bearbeiten“ vor dem Senden korrigieren. Nachgereicht werden Einträge bis drei Tage rückwirkend; die Quittungen werden nach 30 Tagen gelöscht.
- **Meine Notizen (Startseite):** Anlegen, Bearbeiten, Archivieren, Wiederherstellen und Löschen funktionieren auch ohne Verbindung. Die Änderung ist sofort sichtbar, wird vorgemerkt („Nicht gesendet“) und später der Reihe nach gesendet (auch PATCH und DELETE). Neue Notizen tragen eine vom Gerät erzeugte Kennung; alle Änderungen sind wiederholbar, sodass nichts doppelt entsteht (`lib/staff-notes.ts`, Migration `0031`). Archivierte Notizen stehen unter „Archiv“ und lassen sich wiederherstellen.
- **Konflikte:** Wird eine offline bearbeitete Notiz inzwischen auf einem anderen Gerät geändert, lehnt der Server die ältere Fassung ab (HTTP 409, Vergleich über `baseUpdatedAt`). Die Statusanzeige nennt den Eintrag „Konflikt“ und bietet „Meine Fassung übernehmen“ (ohne Vergleich erneut senden) oder „Verwerfen“ (Stand des anderen Geräts behalten).
- **Bewusst nur online:** Medikamentengaben, BtM-Buchungen, das Wiedereröffnen von Aufgaben und alle anderen Änderungen – so entstehen keine doppelten Gaben oder Bestandsbuchungen.
- **Push-Nachrichten:** siehe unten; der Service Worker zeigt sie an und öffnet beim Antippen die zugehörige Seite.
- **Datenschutz:** Beim Abmelden und bei jeder Anmeldung werden zwischengespeicherte Seiten und Daten auf dem Gerät gelöscht; vorgemerkte Einträge bleiben der erfassenden Person zugeordnet.

## Einstellungen

Unter `/c/einstellungen` stellt jede Person CareOS für sich ein. Die Werte liegen in der Datenbank (`carecore_user_profiles.preferences`, `lib/user-settings.ts`), gelten auf allen Geräten und wirken sofort:

- **Profil & Präferenzen:** Name, Funktion, Telefon, fester Wohnbereich; Rolle und Berechtigungen zur Ansicht.
- **Benachrichtigungen:** Kategorien ein/aus (kritische immer), Push-Nachrichten je Gerät, **Ruhezeit** (in dieser Zeit nur kritische Push-Nachrichten, Uhrzeit der Einrichtung, auch über Mitternacht), **Hinweiston** bei neuen Benachrichtigungen (die Liste aktualisiert sich jede Minute).
- **Sicherheit & Zugriff:** Passwort, angemeldete Geräte, **automatische Abmeldung** nach 15 Minuten bis 4 Stunden ohne Bedienung (über alle Tabs des Browsers; offline vorgemerkte Einträge bleiben).
- **Darstellung & Bedienung:** Schriftgrösse (Standard, Gross, Sehr gross), Kontrast, **Animationen reduzieren**, Startseite (zehn Seiten zur Wahl), **Tastaturkürzel** persönlich ein/aus (gelten nur, wenn die Einrichtung sie erlaubt).
- **Datenschutz & Daten:** eigene Daten als JSON herunterladen (`/api/me/export`: Profil, Einstellungen, Qualifikationen, Geräte, Push-Abonnements, eigene Aktionen der letzten 12 Monate, ohne Passwort und Schlüssel), zwischengespeicherte Seiten und Daten auf diesem Gerät löschen, Push auf allen Geräten beenden, alle persönlichen Einstellungen zurücksetzen.
- **Einrichtung** (nur `administration.manage`): alle Einstellungen der Organisation (Erinnerungen, überfällige Gaben, BtM-Kontrollintervall, BtM-Zweitunterschrift, Zähler, Tastaturkürzel) direkt ein- und ausschalten und Werte ändern, protokolliert wie unter Leitung › Konfiguration; dazu Verweise auf Organisation, Rollen, Mitarbeitende, Dienstplan-Einstellungen, Pflegebedarf und Systemstatus.

Ungültige Werte lehnt der Server ab (400), statt sie stillschweigend zu ersetzen.

## Push-Benachrichtigungen (Web Push)

Benachrichtigungen (fällige Aufgaben, BtM-Kontrollen, Dienstplan, Schulungen, kritische Qualitätsereignisse …) erscheinen auf Wunsch als Mitteilung auf dem Gerät, auch wenn CareOS geschlossen ist (`lib/push.ts`, Migration `0030_push_subscriptions.sql`).

- **Einrichten:** Schlüsselpaar einmalig mit `npx web-push generate-vapid-keys` erzeugen und als `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` sowie `VAPID_SUBJECT` (`mailto:…` oder `https://…`) in den Umgebungsvariablen setzen. Fehlt ein Wert, ist Push ausgeschaltet und die Einstellungen sagen das.
- **Einschalten:** Jede Person unter Einstellungen › Benachrichtigungen › „Push-Nachrichten“, je Gerät. Auf dem iPhone nur in der zum Home-Bildschirm hinzugefügten App.
- **Versand:** Neue Benachrichtigungen gehen nach jeder Anfrage an die App hinaus, jede höchstens einmal und nur, solange sie frisch ist (60 Minuten). Es gelten die Kategorien und die Ruhezeit der persönlichen Einstellungen. Kritische Hinweise kommen auch in der Ruhezeit, solange „Kritische Hinweise auch in der Ruhezeit“ eingeschaltet ist (Standard). Auf dem Sperrbildschirm steht nur der Titel, nie der Text.
- **Erinnerungen bei geschlossener App:** Ein Zeitplan (z. B. Vercel Cron oder ein externer Dienst, alle 5–15 Minuten) ruft `GET /api/push/dispatch` mit `Authorization: Bearer <CRON_SECRET>` auf. Dabei entstehen die fälligen Erinnerungen für alle Personen mit Push-Abonnement und werden versendet. Ohne `CRON_SECRET` antwortet der Endpunkt mit 503.
- **Klassen und Bündelung:** Der Posteingang ordnet jeden Hinweis einer Klasse zu (`lib/notification-classes.ts`): Kritisch (Priorität „critical“), Handlung nötig (z. B. fällige Aufgaben, Wirkungskontrollen, Tauschanfragen, Erwähnungen), Sozial (Direktnachrichten, Team-Neuigkeiten) und Information. Jede Klasse ist ein Filter mit Zähler der ungelesenen Hinweise. Ab drei gleichartigen Hinweisen am selben Tag erscheint eine gebündelte Zeile („3 × Aufgabe fällig“), die sich aufklappen und gesamt als gelesen markieren lässt; kritische Hinweise werden nie gebündelt.
- **Datenschutz:** Ein Abonnement gehört zu einer Anmeldung. Abmelden, „Gerät abmelden“ oder eine abgelaufene Sitzung beendet auch die Push-Nachrichten; erloschene Abonnements werden entfernt.

## Schnellaktionen auf dem Handy

Auf dem Handy (bis 960 px Breite) sitzt rechts über der unteren Leiste ein „+“-Knopf. Er öffnet die Schnellaktionen für den Bewohner aus der Kopfzeile: Dokumentation, Vitalwerte, Trinkmenge, Reservegabe, Wundverlauf und Übergabenotiz – jeweils nur, wenn die Person das Modul nutzen darf. Ist kein Bewohner gewählt, führt „Bewohner wählen“ zur Auswahl der Kopfzeile. Auf der Startseite bleibt an dieser Stelle der Knopf „Notiz erstellen“, im Messenger entfällt der Knopf (Eingabefeld). In der Desktop-Ansicht erscheint er nicht.

## Barrierefreiheit

- **Seitenpanels und Dialoge** (`app/components/dialog-focus.tsx`): Beim Öffnen springt der Fokus ins Panel, Tab bleibt im Panel, Escape schliesst, danach steht der Fokus wieder auf dem auslösenden Element.
- **Auswahllisten** (`CareSelect`, `CareOptionSelect`): Pfeiltasten, Pos1/Ende, Enter/Leertaste wählen, Escape und Tab schliessen die Liste (nicht das Panel).
- **Kontraste:** Die Statusfarben (kritisch, Achtung, Info, stabil) erreichen auf ihren Hintergründen mindestens 5:1 (WCAG AA).

## Tests

- `npm test`: Unit-Tests ohne Datenbank.
- `npm run test:db`: Integrationstests gegen eine echte Postgres (`TEST_DATABASE_URL`, vorher `npm run test:db:setup` auf einer leeren Datenbank).
- `npm run test:e2e`: Klicktests mit Playwright gegen die gebaute App (`npx next build`). Vorher auf einer **leeren** Datenbank `npm run test:e2e:setup` (Migrationen, Dienstplan- und Demodaten); die Tests verändern die Demodaten. Die App beantwortet ihre Datenbankanfragen dabei aus `TEST_DATABASE_URL` (`tests/support/neon-pg.mjs`), der Administrator erhält ein festes Testpasswort (`playwright.config.ts`). Geprüft werden alle Seiten der Navigation (ohne Skript-, Server- und API-Fehler) sowie Anmeldung, Offline-Erfassung mit späterem Senden, BtM mit Zweitunterschrift, Medikationsrecht nach Qualifikation, Änderungsprotokoll nur für die Leitung, das Bearbeiten von Qualitätsmassnahmen, Dienstplan (Kürzel planen, veröffentlichen, Tausch annehmen, Tausch gegen die Ruhezeit wird abgewiesen), Wunde anlegen und dokumentieren, Pflegeplan mit Ziel und Evaluation, RAI-Erfassung (auch per Tastatur), Tastaturbedienung der Seitenpanels, die Einstellungen (Darstellung sofort wirksam, Ruhezeit, Datenexport, Einrichtung) sowie die Handy-Ansicht (390 px, keine Seite breiter als der Bildschirm, „Alle Apps“).

Alle drei laufen in der CI bei jedem Pull Request.

## Zustand (Health-Check)

`GET /api/health` braucht keine Anmeldung und eignet sich für Überwachung und Load-Balancer (`lib/health.ts`). Die Antwort nennt `status` (`ok`, `degraded` bei ausstehenden Migrationen, `down` ohne Datenbank), die Erreichbarkeit und Antwortzeit der Datenbank sowie die zuletzt angewendete und die noch ausstehenden Migrationen. HTTP 200 bei `ok` und `degraded`, 503 bei `down`. Sie enthält keine Geheimnisse, keine Personendaten und keine Fehlermeldungen der Datenbank und wird weder vom Browser noch vom Service Worker zwischengespeichert.

## Installation je Einrichtung

Jede Einrichtung hat ihre eigene Installation (eigenes Railway-Projekt, eigene Datenbank und eigener Speicher).
Anleitung: `docs/INSTALLATION.md`; die Geheimnisse erzeugt `node scripts/new-installation.mjs`. Nach dem ersten
Anmelden führt die Checkliste „CareOS einrichten“ (Leitung › Administration) durch die Ersteinrichtung: Name der
Einrichtung (Leitung › Konfiguration), Standort mit Adresse, Wohnbereiche, Mitarbeitende, Bewohner, E-Mail-Versand und
Zwei-Faktor für das Administrationskonto. Sie verschwindet, sobald alles erledigt oder ausgeblendet ist.

## Datenübernahme (CSV)

Leitung › Administration › Datenübernahme (`administration.manage`): Bewohnerinnen/Bewohner und Mitarbeitende aus
einer CSV-Datei (Vorlage zum Herunterladen, Semikolon oder Komma, Datum TT.MM.JJJJ). CareOS prüft erst jede Zeile
(Pflichtfelder, Datum, Wohnbereich, Rolle, Dubletten in der Datei und in CareOS) und übernimmt nur, wenn alle
Zeilen stimmen; Bewohner in einer Transaktion, protokolliert als „imported“. Mitarbeitende mit E-Mail-Adresse werden
eingeladen (mit eingerichtetem E-Mail-Versand), die übrigen erhalten ein zufälliges Startpasswort, das nur einmal als
Liste zum Herunterladen erscheint (`lib/data-import.ts`, `lib/csv-import.ts`).

## E-Mail-Versand

Optional über SMTP (jeder Anbieter, z. B. Brevo, Infomaniak oder der Mailserver der Einrichtung), eingerichtet mit
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` und `APP_URL` (`lib/mail.ts`, Migration
`0057_user_email_links.sql`). Damit gibt es „Passwort vergessen?“ auf der Anmeldeseite, Einladungen per
E-Mail statt Startpasswort und den Link zum Passwort setzen in der Mitarbeiterverwaltung. Links gelten einmal, nur der
Hash wird gespeichert, danach enden alle Sitzungen der Person. Einzelheiten: `docs/EMAIL.md`.

## Überwachung und Backups

Serverfehler (HTTP 500) hält CareOS kurz fest (`lib/error-log.ts`, Migration `0058_error_events.sql`, ohne
Anfragedaten, 30 Tage); die Administration sieht sie unter Leitung › Konfiguration › Systemstatus. Mit `ALERT_EMAIL`
und eingerichtetem E-Mail-Versand kommt ein Alarm bei vielen Fehlern. Backups (Railway), Benachrichtigungen,
Verfügbarkeitstest und Wiederherstellung: `docs/BETRIEB.md`.

## Zwei-Faktor-Anmeldung (TOTP)

Jede Person kann unter Einstellungen → Sicherheit eine Authenticator-App verbinden (`lib/mfa.ts`, Migration `0042_mfa.sql`). Nach dem Passwort fragt die Anmeldung dann nach dem 6-stelligen Code oder einem der zehn einmaligen Wiederherstellungscodes. Fehlversuche zählen zur Anmeldedrossel.

- **Einrichten:** Einen zufälligen Schlüssel mit 32 Bytes erzeugen (z. B. `openssl rand -base64 32`) und als `CARECORE_MFA_KEY` in den Umgebungsvariablen setzen. Damit wird das Geheimnis jeder Person verschlüsselt (AES-256-GCM) gespeichert; Wiederherstellungscodes nur als Hash. Fehlt der Schlüssel, lässt sich die Zwei-Faktor-Anmeldung nicht einschalten und die Einstellungen sagen das.
- **Schlüssel nicht wechseln:** Ein neuer Schlüssel macht bestehende Einrichtungen unlesbar; die Personen müssen dann neu einrichten.
- **Verlorenes Handy:** Die Administration setzt die Zwei-Faktor-Anmeldung in der Mitarbeiterverwaltung zurück (protokolliert).

## Drossel für schreibende Anfragen

Schreibende API-Anfragen (POST, PATCH, PUT, DELETE) werden in `proxy.ts` gezählt (`lib/rate-limit.ts`, Migration `0036_rate_limits.sql`): je Anmeldung, ohne Anmeldung je IP-Adresse, jeweils pro Minute. Gespeichert wird nur ein Hash, kein Token und keine Adresse im Klartext. Über der Grenze antwortet die API mit 429 und `Retry-After`; die Offline-Warteschlange wartet dann und sendet später erneut. Die Grenze von 240 Änderungen pro Minute ist ein technischer Schutz gegen Skripte und Fehlschleifen, kein fachlicher Grenzwert, und lässt sich mit `CARECORE_WRITE_LIMIT_PER_MINUTE` anpassen. Anmeldung (eigene Drossel) und der Push-Zeitplan sind ausgenommen; kann die Zählung nicht erfolgen, wird die Anfrage nicht blockiert.

## Datenbank-Migrationen

Das Schema wird ausschließlich über nummerierte SQL-Dateien in `database/migrations` verwaltet; die Anwendung legt zur Laufzeit keine Tabellen an. Das Schema deckt Organisationen, Wohnbereiche, Bewohner, Pflegeplanung, Dokumentation, Assessments, Vitalwerte, Medikation, Wunden, Ernährung, Dienste, Aufgaben, Übergaben, Kommunikation, Dokumente, Schulungen, Qualität, RAI, KI-Entwürfe, Benachrichtigungen und Auditierung ab.

```bash
npm run db:migrate            # ausstehende Migrationen anwenden
npm run db:migrate -- --dry-run   # nur anzeigen, was ausstehend ist
```

Angewendete Migrationen werden mit Prüfsumme in `carecore_schema_migrations` festgehalten. Eine bereits angewendete Datei darf nicht mehr verändert werden – Schemaänderungen kommen immer als neue Datei hinzu, z. B. `0002_medication_orders.sql`. Jede Migration läuft in einer Transaktion.

Auf Vercel führt das Skript `vercel-build` die Migrationen vor `next build` aus, allerdings nur für Production-Deployments: Preview-Deployments nutzen dieselbe Datenbank und dürfen das Schema nicht verändern.

Danach können leere Fach-Tabellen mit wiederholbar ausführbaren Beispieldaten befüllt werden:

```bash
npm run db:seed
```

Der Seed überspringt Tabellen, die bereits Daten enthalten. Vorhandene Bewohner-, Mitarbeiter- und Organisationsdaten werden nicht überschrieben. In der aktuellen Demo lesen und schreiben Bewohneraufnahme, Aufgaben, Pflegedokumentation und Benachrichtigungen über Neon. Die Startseite zeigt Bewohner, Aufgaben und dokumentierte Änderungen aus Neon. Andere Fachansichten enthalten teilweise noch lokale Demonstrationsdaten und sind noch keine vollständig persistierten Arbeitsabläufe.

Für Vercel müssen `DATABASE_URL` und `CARECORE_ADMIN_PASSWORD` in den Umgebungsvariablen des Projekts für Production, Preview und Development gesetzt sein. Die Anwendung benötigt den normalen Next.js-Serverbetrieb; ein statischer Export ist wegen Login, Sessions und Datenbankzugriff nicht möglich.

## Bewohnerakte

- **Änderungsprotokoll:** Jede Änderung an der Akte (Stammdaten, Kontakte, Biografie, Bewohnerbild, Körperbefunde, Pflegebedarf, Dokumente sowie Einträge aus Dokumentation, Medikation, Vitalwerten und Wunden) wird in `carecore_audit_log` festgehalten – in derselben Transaktion wie die Änderung (`lib/resident-audit.ts`). Unter Bewohnerakte › Verlauf › „Änderungsprotokoll“ sieht die Leitung (Rollen mit `team.manage` oder `administration.manage`), wer wann was geändert hat. Biografie-Inhalte, AHV- und Versichertennummer werden nicht im Klartext protokolliert.
- **Aufgaben abschliessen und eskalieren:** Beim Abschliessen wählt man das Ergebnis ✓ erledigt, △ teilweise oder ✕ nicht erledigt (Migration `0033_task_outcomes.sql`). „Teilweise“ und „nicht erledigt“ verlangen eine Begründung und werden bei Bewohneraufgaben als wichtiger Eintrag in der Pflegedokumentation festgehalten. Wiederkehrende Aufgaben laufen weiter. „Eskalieren“ (mit Grund) lässt die Aufgabe offen und benachrichtigt alle Personen mit dem Recht „team.manage“. Überfällig wird aus dem Fälligkeitstermin berechnet.
- **Sitzung und Gerät im Protokoll:** Jeder Protokolleintrag hält die Sitzung und die Browser-Kennung der handelnden Person fest (Migration `0037_audit_session_device.sql`, `lib/audit-origin.ts`); bleibt auch nach dem Abmelden erhalten. Das Änderungsprotokoll der Bewohnerakte zeigt das Gerät neben dem Namen (z. B. „Safari · iPhone“). Einträge aus Hintergrundläufen haben keine Sitzung.
- **Protokoll in allen Modulen:** Auch Schicht & Übergabe, Aufgaben, Nachträge, Schulungen, Team-Neuigkeiten, Organisation, Mitarbeitende/Rollen, Einstellungen und KI-Entwürfe schreiben ihren Protokolleintrag in derselben Transaktion wie die Änderung (`auditStatement`, `residentAudit`); ein KI-Entwurf lässt sich nur einmal übernehmen.
- **Hochgeladene Dateien:** Dokumente, Nachweise und Wundfotos werden am Inhalt geprüft, nicht nur am vom Browser gemeldeten Dateityp (`lib/file-signatures.ts`: PDF, JPEG, PNG, WebP, Text, Office). Passt der Inhalt nicht zum Typ, wird die Datei mit 415 abgelehnt. In der Bewohnerakte (Dokumente › „Dokument hochladen“) sind nur PDFs und Bilder (JPG, PNG, WebP) erlaubt; die Datei wird per Klick oder durch Hineinziehen gewählt und vor dem Hochladen mit Name, Typ und Grösse angezeigt.
- **Reanimationsstatus:** In den Stammdaten (Karte „Reanimationsstatus“) mit Entscheid, Grundlage (Pflicht, z. B. Patientenverfügung) und Datum. Ohne Eintrag gilt er als „nicht erfasst“, es gibt keinen Standardwert. Der Aktenkopf zeigt „REA: Ja / Nein / nicht erfasst“, der Überleitungsbogen den Entscheid mit Grundlage. Jede Änderung erhält einen eigenen Protokolleintrag.
- **Überleitungsbogen:** Im Kopf der Akte erzeugt „Überleitungsbogen“ eine A4-Druckansicht für Spitaleinweisung oder Verlegung (Stammdaten, Kontakte, Allergien, Risiken, aktuelle Medikation inkl. Reserve, Wunden/Befunde, Vitalwerte, Ernährung, Pflegeziele, Verlauf der letzten 72 Stunden). Das Erstellen wird protokolliert.

## Wundversorgung

- **Fälligkeit:** Aus dem Verbandwechsel-Intervall einer Wunde und ihrem letzten Verlaufseintrag (sonst dem Feststellungsdatum) berechnet die Datenbank, wann die nächste Versorgung fällig ist (`lib/wounds.ts`).
- **Überfällige Versorgungen:** Die Wundübersicht listet jede überfällige Versorgung mit Dauer („seit 2 Tagen“), Fälligkeitszeitpunkt und verantwortlicher Person. „Versorgung dokumentieren“ öffnet direkt den Verlaufseintrag; danach ist die Versorgung erledigt. „Nur überfällige zeigen“ filtert die Liste.
- **Erinnerung:** Die verantwortliche Person erhält je Versorgungszyklus eine Benachrichtigung (hohe Priorität, auch als Push). Ohne Verantwortliche erhalten sie alle mit Dokumentationsrecht, deren fester Wohnbereich der Wohnbereich der Bewohnerin ist. Abschaltbar unter Einstellungen › Benachrichtigungen › „Wundversorgung“.

## Medikationsrecht

Medikation (`medication.manage`: Gaben dokumentieren, Verordnungen, Bestände, BtM, Zweitunterschrift) dürfen Administration, Leitung und Ärztlicher Dienst. In der Rolle „Pflege“ gilt das Recht nur für Personen mit einer gültigen Qualifikation, die zur Medikation berechtigt – standardmäßig Pflegefachperson HF und Fachperson Gesundheit (FaGe), nicht Pflegehelfer:in SRK (Migration `0027_medication_qualification.sql`).

- Welche Qualifikationen berechtigen, legt die Leitung unter Dienstplan › Einstellungen › Qualifikationen fest (z. B. zusätzlich „FH“); Änderungen werden protokolliert.
- Qualifikationen werden je Person unter Mitarbeitende › Mitarbeitende (Bearbeiten, „Qualifikationen“) oder mit Gültigkeitszeitraum unter Dienstplan › Einstellungen › Personal hinterlegt. In der Mitarbeiterverwaltung gilt eine neue Qualifikation ab heute, eine entfernte endet gestern; der Verlauf bleibt erhalten und die Änderung wird protokolliert.
- Ob eine Rolle das Recht nur mit Qualifikation erhält, ist unter Mitarbeitende › Profile & Rollen einstellbar.
- Maßgeblich ist die Datenbankfunktion `carecore_effective_permissions`, die Anmeldung, Navigation und Zweitunterschrift gleichermaßen verwenden.

- **Verabreichen und verwalten getrennt** (Migration `0038_medication_administer.sql`): „Medikation verabreichen“ (`medication.administer`) erlaubt Gaben in Runde und Reserve, die Wirkungskontrolle und die Zweitunterschrift. „Medikation verwalten“ (`medication.manage`) erlaubt Verordnungen, Bestände und die BtM-Kontrolle. Jede Rolle mit dem bisherigen Medikationsrecht hat beide erhalten, damit sich nichts ändert. Wer nur verabreichen soll, bekommt unter Mitarbeitende › Profile & Rollen das Verwalten entzogen. Verlangt eine Rolle eine Qualifikation, gilt das für beide Rechte.

## Betäubungsmittel (BtM)

Unter Medikation › „BtM-Kontrolle“ (`/medikation/btm`) werden als BtM gekennzeichnete Präparate mit lückenlosem Bestandsbuch geführt (Migration `0026_btm.sql`, `lib/medication-btm.ts`). Welche Präparate als BtM gelten und in welchen Abständen kontrolliert wird, legt die Einrichtung fest; CareOS gibt dafür keine Regeln vor.

- **Kennzeichnung:** Personen mit `medication.manage` kennzeichnen Präparate als BtM. Das Aufheben verlangt eine Begründung; beides wird protokolliert.
- **Zweitunterschrift:** Eingang, Entsorgung, Bestandskorrektur und Bestandskontrolle eines BtM verlangen eine zweite Person. Sie bestätigt mit eigenem Benutzernamen und Passwort; sie muss aktiv, in derselben Organisation und für Medikation berechtigt sein. Fehlversuche werden wie bei der Anmeldung gedrosselt. Gaben aus der Medikamentenrunde und Reservegaben werden mit der verabreichenden Person gebucht. Verlangt die Einrichtung auch dort eine Zweitunterschrift, schaltet sie unter Leitung › Konfiguration › „Zweitunterschrift bei BtM-Gaben“ ein (anfangs aus); dann fragt „Gegeben“ bei BtM nach der zweiten Person, die im BtM-Buch erscheint (Migration `0029`).
- **Bestandskontrolle:** Gezählter und erwarteter Bestand werden gegenübergestellt. Eine Differenz muss begründet werden und wird als Korrekturbuchung im selben Schritt gebucht.
- **Unveränderlichkeit:** Buchungen von BtM und Bestandskontrollen können per Datenbank-Trigger weder geändert noch gelöscht werden; Fehler werden durch neue Buchungen korrigiert.
- **Kontrollintervall:** Unter Leitung › Konfiguration › „BtM-Bestandskontrolle“ legt die Einrichtung fest, nach wie vielen Tagen eine Kontrolle fällig ist (ohne Standardwert, anfangs ausgeschaltet). Fällige Bestände werden auf der BtM-Seite markiert; Personen mit Medikationsrecht erhalten je Bestand und Kontrollzyklus eine Benachrichtigung (mit Stammwohnbereich nur für dessen Bestände; abschaltbar unter Einstellungen › Benachrichtigungen › „BtM-Kontrolle“).
- **Gaben:** In Medikamentenrunde, Medikamentenplan, Reserven und im Überleitungsbogen sind BtM gekennzeichnet.

### Wirkungskontrolle nach Reservegabe

- **Zeitpunkt aus der Verordnung:** In der Reserveverordnung steht optional „Wirkungskontrolle nach (Minuten)“ (5 Minuten bis 24 Stunden). Es gibt keinen Vorgabewert; auch Maximaldosis und Mindestabstand einer neuen Reserve müssen aus der ärztlichen Verordnung eingetragen werden.
- **Termin und Erinnerung:** Jede Reservegabe mit dieser Angabe erhält einen Kontrolltermin (Migration `0034_prn_effect_check.sql`). Die Reserven-Seite zeigt offene Kontrollen des Bewohners. Wird der Termin erreicht, erhält die Person, die die Reserve gegeben hat, einmal eine Benachrichtigung (Kategorie „Wirkungskontrolle“, auch als Push).
- **Ergebnis:** „Wirksam“, „Teilweise wirksam“ oder „Nicht wirksam“; die beiden letzten verlangen eine Einschätzung. Das Ergebnis erscheint als Eintrag „Wirkungskontrolle“ in der Pflegedokumentation (Kategorie Medikation, bei fehlender Wirkung als wichtig) und im Protokoll.
- **BtM-Buch:** Pro Bestand alle Buchungen mit laufendem Bestand, Person und Zweitunterschrift, als Seitenpanel und als A4-Druckansicht (`/medikation/btm/buch?stock=…`, PDF über den Druckdialog).

## Messenger

- **Erwähnen:** „@“ im Eingabefeld schlägt Mitglieder der Unterhaltung vor; „@Vorname Nachname“ wird in der Nachricht hervorgehoben.
- **Reaktionen:** 👍 ❤️ ✅ 👀 🙏 (feste Auswahl, Migration `0035_message_reactions_mentions.sql`); ein zweiter Klick nimmt die eigene Reaktion zurück. Beim Überfahren steht, wer reagiert hat.
- **Benachrichtigung und Push:** Erwähnte Personen erhalten eine Benachrichtigung mit hoher Priorität, bei Direktnachrichten die andere Person. In Gruppen ohne Erwähnung bleibt es beim Zähler ungelesener Nachrichten. Die Kategorie „Nachrichten“ lässt sich in den persönlichen Einstellungen abschalten; der Link öffnet direkt die Unterhaltung.

## Dienstplan

Das Dienstplan-Modul (Spezifikation: `docs/specs/dienstplan.md`, Entscheidungen und Stand: `docs/dienstplan/`) ersetzt die frühere Dienstplanung. Es besteht aus:

- **Leitung › Dienstplan** (`/c/dienstplan`, Berechtigung `schedule.manage` und Leitung des Wohnbereichs): Monats-/Wochenraster mit Drag & Drop, Entwurf/Veröffentlichen, Analyse, KI-Planung, Anträge, Arbeitszeit (Soll/Ist, Korrekturen, Monatsabschluss), Einstellungen (Diensttypen, Mindestbesetzung, Regelwerk, Personal, Qualifikationen, Feiertage) und Protokoll.
- **Mein Dienst › Mein Dienstplan** (`/c/mein-dienstplan`): eigene veröffentlichte Dienste mit Stempeln und Pause, Teamplan der Wohngruppe (Abwesenheiten anderer nur als „Abwesend“), Anträge (Wunschfrei, Abwesenheit, Dienstwunsch, Tausch, Korrekturen) und Zeiten.
- „Dienst starten/beenden“ unter **Mein Dienst › Heute** stempelt in derselben Zeiterfassung.

Geplant wird wie im PEP: Kürzel direkt in die Zellen tippen, Bereiche markieren, kopieren und einfügen (auch aus Excel), mit der Dienst-Palette stempeln und Musterwochen übertragen; Strg+Z/Strg+Y macht Zellen-Änderungen rückgängig bzw. wiederholt sie.

Der Monatsplan (auch der Teamplan) lässt sich über „Drucken / PDF“ als A4-Querformat drucken oder als PDF speichern. Unter Arbeitszeit exportiert die Leitung „CSV Summen“ (je Person) und „CSV Einträge“ (alle Zeiteinträge) für die Lohnbuchhaltung (`/api/dienstplan/time/export`, Semikolon, Dezimalkomma, UTF-8 mit BOM für Excel).

Jede Änderung läuft serverseitig durch die Regel-Engine (`lib/roster/rules.ts`): Blocker verhindern das Speichern, Warnungen müssen mit Begründung bestätigt werden. Das Regelwerk enthält Beispielwerte nach Schweizer ArG und muss von der Leitung unter Einstellungen geprüft und bestätigt werden.

**Umgebungsvariablen**

| Variable          | Pflicht | Zweck                                                                                                                        |
| ----------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `MISTRAL_API_KEY` | nein    | Mistral für CareOS KI, KI-Dienstplanung und Übersetzungsentwürfe. Ohne Schlüssel sind diese deaktiviert, alles andere läuft. |
| `MISTRAL_MODEL`   | nein    | Modell, Standard `mistral-small-latest`.                                                                                     |

An die KI gehen nur pseudonymisierte Daten (E1, E2, …, Diensttyp-Codes, Zahlen) – keine Namen, Abwesenheitsgründe oder Freitexte. Jede vorgeschlagene Zuweisung wird von der Regel-Engine geprüft; übernommen wird nur in Entwürfe.

**Demo-Daten und Tests (nur Entwicklung)**

```bash
npm run db:seed:roster        # Wohngruppen Linde, Ahorn, Birke mit Personal, Plänen und Zeiten
npm test                      # Unit-Tests (Regeln, Zeitberechnung, Berechtigungen, KI-Kern)
TEST_DATABASE_URL=postgres://… npm run test:db:setup && npm run test:db   # Integrationstests
```

Demo-Logins nach dem Seed: `demo.leitung.linde`, `demo.leitung.ahorn`, `demo.leitung.birke` (Leitung) sowie `demo.linde.aline`, `demo.linde.elif` … (Mitarbeitende); Passwort `Dienstplan-Demo-2026` oder der Wert aus `ROSTER_DEMO_PASSWORD`. Der Seed bricht mit `NODE_ENV=production` ab. Die Integrationstests brauchen eine eigene, leere Postgres-Datenbank und laufen nie gegen die Produktionsdatenbank.

**Bekannte Grenzen**

- Aktualisierung per Polling (alle 25 s, pausiert im Hintergrund), kein Push in Echtzeit.
- Arbeitsrechtliche Werte sind Beispielwerte und ersetzen keine rechtliche Prüfung (GAV, Betriebsreglement).
- Der Saldo im laufenden Monat vergleicht das Ist mit dem Soll bis heute; Überträge aus Vormonaten werden nicht geführt.
- Die KI-Planung wurde mit einem Test-Double geprüft; mit einem echten Mistral-Schlüssel ist sie lokal zu verifizieren.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
