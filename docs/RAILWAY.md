# CareOS auf Railway einrichten

Ziel: ein Railway-Projekt mit drei Diensten – **CareOS** (diese App), **Postgres** und **Bucket** – plus öffentlicher Domain.
Dauer: etwa 10 Minuten. `railway.json` und `scripts/start.mjs` regeln Build, Migration, Erstbefüllung, Start und Health Check automatisch.

## 1. Projekt und Dienste

1. railway.com → **New Project** → **Deploy from GitHub repo** → dieses Repository wählen.
   Branch unter *Settings → Source* auf `main` (oder den gewünschten Branch) setzen.
2. Im Projekt **+ Create → Database → PostgreSQL**. Dienstname `Postgres` lassen.
3. **+ Create → Bucket**. Dienstname `Bucket` vergeben (sonst die Variablen in Schritt 2 anpassen).
   Region möglichst in der EU wählen (Datenstandort, PRD §36).
4. Projekt-Region für den App-Dienst ebenfalls in der EU wählen (*Settings → Deploy → Region*).

## 2. Variablen

Lokal ausführen und die Ausgabe im CareOS-Dienst unter **Variables → Raw Editor** einfügen:

```bash
npm run railway:env -- --admin=it@ihre-organisation.ch --org="Alterszentrum Muster"
# mit Namen der Administration und zufälliger Erstbefüllung (siehe Abschnitt 4):
npm run railway:env -- --admin=it@ihre-organisation.ch --org="Alterszentrum Muster" --first=Martina --last=Keller --units=4 --staff=15 --residents=100
# oder für eine Testumgebung mit Demodaten:
npm run railway:env -- --demo
```

Das Skript erzeugt frische Geheimnisse (`APP_SECRET`, VAPID-Schlüssel für Push, ein Startpasswort) und setzt die
Referenzen auf Postgres (`${{Postgres.DATABASE_URL}}`) und Bucket (`${{Bucket.BUCKET}}` usw.).
Heisst der Bucket-Dienst nicht `Bucket`, den Namen mit `--bucket=<Name>` mitgeben (Gross-/Kleinschreibung zählt). Im Tab **Credentials** des Buckets steht die URL-Art: neue Railway Buckets nutzen «virtual-hosted» → `S3_FORCE_PATH_STYLE=false` (Standard des Skripts); nur bei «path-style» auf `true` setzen.

Ausgabe sicher aufbewahren (Passwortmanager) und nicht ins Repository übernehmen.

## 3. Domain

CareOS-Dienst → **Settings → Networking → Generate Domain** (oder eigene Domain mit CNAME).
`APP_URL` zeigt über `${{RAILWAY_PUBLIC_DOMAIN}}` automatisch darauf; bei eigener Domain `APP_URL=https://care.ihre-organisation.ch` setzen –
Passkeys und Single Sign-on hängen an genau dieser Adresse.

## 4. Deploy und erster Login

- Railway baut und startet automatisch. Beim Start führt `scripts/start.mjs` zuerst `prisma migrate deploy` aus
  (zusätzlich als `preDeployCommand` in `railway.json`; idempotent, mit Advisory Lock). Schlägt die Migration fehl,
  startet die App nicht – der Fehler steht im Deploy-Log. Danach prüft Railway `/api/health`.
- **Demo:** `SEED_DEMO=true` → `anna.muster@lindenhof.ch` / `careos-demo` (weitere Konten im README).

### Erststart einer echten Organisation

Auf einer **leeren** Datenbank legt `prisma/bootstrap.ts` (Logik in `src/lib/org-setup.ts`, eine Transaktion –
bei Abbruch bleibt die Datenbank leer und der nächste Start versucht es erneut) Folgendes an:

| Variable | Standard | Wirkung |
|---|---|---|
| `INIT_ADMIN_EMAIL`, `INIT_ADMIN_PASSWORD` | – | Pflicht. Konto der Systemadministration (Passwort min. 12 Zeichen) |
| `INIT_ADMIN_FIRST_NAME`, `INIT_ADMIN_LAST_NAME` | System, Administration | Name der Systemadministration, Kürzel daraus |
| `INIT_ORG_NAME`, `INIT_LOCATION_NAME` | Meine Organisation, Hauptstandort | Organisation und Standort |
| `INIT_UNITS`, `INIT_UNIT_NAME` | 4, Wohngruppe | Anzahl Wohngruppen und Namenspräfix (Wohngruppe 1, 2 …) |
| `INIT_STAFF` | 0 | Zufällig erzeugte Mitarbeitende mit Rollen-Mix (siehe unten), **ohne Passwort** |
| `INIT_STAFF_DOMAIN` | example.ch | Platzhalter-Domain der Mitarbeiter-Adressen (`vorname.nachname@…`) |
| `INIT_RESIDENTS` | 0 | Zufällig erzeugte Bewohnende, gleichmässig auf die Wohngruppen verteilt |
| `INIT_SEED` | – | Gesetzt: reproduzierbare Zufallsdaten (gleicher Wert → gleiche Personen) |

Beispiel für eine Pilotumgebung mit 15 Mitarbeitenden und 100 Bewohnenden:

```
INIT_ORG_NAME=Alterszentrum Muster
INIT_ADMIN_EMAIL=it@alterszentrum-muster.ch
INIT_ADMIN_PASSWORD=<min. 12 Zeichen>
INIT_ADMIN_FIRST_NAME=Martina
INIT_ADMIN_LAST_NAME=Keller
INIT_UNITS=4
INIT_STAFF=15
INIT_RESIDENTS=100
```

- **Bewohnende:** realistische Schweizer Namen (keine Doppelungen), Geschlecht passend zum Vornamen, Jahrgang 1925–1952,
  Eintritt in den letzten fünf Jahren, Pflegestufe, Einzelzimmer (Wohngruppe 1: 101–125, Wohngruppe 2: 201–225 …),
  Aufenthalt «Eintritt». Es werden **keine klinischen Daten** erfunden: Diagnosen, Medikation, Vitalwerte, Verlauf,
  Pflegeplanung und Kontakte sind leer und werden in CareOS erfasst.
- **Mitarbeitende:** 1 Pflegedienstleitung (für den Standort), je Wohngruppe eine Stationsleitung (sofern genug Personal),
  dann etwa 40 % Pflegefachpersonen HF, 30 % FaGe, 30 % Pflegehelfer/innen SRK – jeweils mit Rolle in ihrer Wohngruppe,
  Stammbereich, Funktion und Team der Wohngruppe. Für 15 Personen und 4 Wohngruppen: 1 PDL, 4 Stationsleitungen,
  4 HF, 3 FaGe, 3 Pflegehilfe.
- Ohne `INIT_STAFF`/`INIT_RESIDENTS` entsteht nur die Struktur mit der Systemadministration.
- Ist bereits eine Organisation vorhanden, passiert nichts (auch nicht bei mehreren Instanzen gleichzeitig).

### Erster Login und Einladungen verteilen

1. Mit `INIT_ADMIN_EMAIL` / `INIT_ADMIN_PASSWORD` anmelden, sofort unter Profil → Sicherheit MFA oder Passkey einrichten,
   dann `INIT_ADMIN_PASSWORD` (und bei Bedarf die übrigen `INIT_*`-Variablen) in Railway löschen.
2. **Admin → Benutzer → Einladungen** listet alle Konten ohne Zugang. Die Adressen unter `INIT_STAFF_DOMAIN` sind
   Platzhalter (markiert): zuerst unter der Person die echte Adresse und den Namen eintragen.
3. «Links für alle erzeugen» zeigt je Person einen Einmal-Link (7 Tage gültig, «Alle kopieren» als Tabelle).
   Gespeichert wird nur ein Hash – deshalb erzeugt CareOS die Links erst auf Knopfdruck und zeigt sie nur einmal;
   ein neuer Link ersetzt den alten. Mit dem Link setzt die Person ihr Passwort.
   CareOS versendet keine E-Mails: Links über einen vertraulichen Kanal weitergeben.

### Registrierung von Personen (PRD §33)

- **Admin → Benutzer → Registrierung:** Registrierung aktivieren. CareOS erzeugt einen Registrierungscode
  (`XXXX-XXXX-XXXX`, nur für Personen mit Benutzerverwaltung sichtbar, verschlüsselt gespeichert, jederzeit erneuerbar).
  Code intern weitergeben, die Adresse lautet `<APP_URL>/register` (Link «Konto beantragen» auf der Anmeldeseite).
- Die Person gibt Code, Name, E-Mail, Passwort (min. 12 Zeichen) und optional Funktion/Bereich an und bestätigt den
  Datenschutzhinweis. Das Konto ist danach **wartend** und kann sich nicht anmelden («Ihr Konto wartet auf Freigabe»).
- Personen mit Benutzerverwaltung erhalten eine Benachrichtigung. Unter **Admin → Benutzer → Anfragen**: *Freigeben*
  (Rolle und Bereich wählen) oder *Ablehnen* (das beantragte Konto wird gelöscht). Alles wird im Audit-Protokoll erfasst.
- Es gibt **keine E-Mail-Bestätigung** (kein Mailversand angebunden) – die Freigabe durch die Administration ersetzt sie.
  Name und Adresse vor der Freigabe prüfen. Die Antwort auf der Registrierungsseite ist gleich, ob die Adresse schon
  existiert oder nicht; Anfragen und falsche Codes sind je IP begrenzt.

### Neue Organisationen registrieren (optional)

`ORG_SIGNUP=true` zeigt auf `/register` zusätzlich «Neue Organisation»: Name der Organisation und Daten der
Systemadministration; angelegt wird die Standardkonfiguration mit einer Wohngruppe, ohne Personen. Gedacht für
Mehrmandanten-Instanzen; Standard ist aus. Je IP höchstens 3 pro Tag.

## 5. Betrieb

| Thema | Empfehlung |
|---|---|
| Backups | Postgres-Dienst → *Backups* aktivieren (täglich, Aufbewahrung nach Organisationsvorgabe) |
| Skalierung | Mehrere Replikas möglich: Hintergrundjobs sind über Advisory Locks abgesichert, Rate-Limits liegen in Postgres (Tabelle `RateLimit`) und gelten über alle Instanzen. |
| Jobs abschalten | `JOBS_DISABLED=true` in einer Instanz |
| Updates | Push auf den verbundenen Branch → automatischer Deploy; der Service Worker meldet Nutzenden «Neue Version – Neu laden» |
| Monitoring | Railway *Observability* (Logs, Metriken). Logs sind JSON-Zeilen (`level`, `msg`, Felder) – in Railway nach `level:error` oder `msg:security.alert` filtern. Health Check `/api/health` meldet Datenbank, Bucket, Jobs, Echtzeit und Push (`503` nur ohne Datenbank). Übersicht unter Admin → Sicherheit → Betrieb |
| Metriken | `METRICS_TOKEN` setzen, dann `GET /api/metrics` mit `Authorization: Bearer …` (Prometheus-Format, z. B. für Grafana Cloud oder Better Stack) |
| Fehlererfassung | Serverfehler werden geloggt, je Tag gezählt (Admin → Sicherheit → Betrieb) und optional an `ERROR_WEBHOOK_URL` gesendet (JSON ohne Anfragedaten, z. B. Slack-/Teams-Webhook oder Incident-Tool) |
| Sicherheit | Content-Security-Policy mit Nonce pro Anfrage. Neue Fremdquellen (z. B. eigenes CDN) über `CSP_IMG_SRC`, `CSP_CONNECT_SRC`, `CSP_FRAME_SRC`, `CSP_MEDIA_SRC` freigeben; für eine vorsichtige Einführung `CSP_REPORT_ONLY=true` (Verstösse erscheinen im Log als `csp.violation`). Audit-Überwachung meldet Auffälligkeiten an Personen mit Zugriff auf das Audit-Protokoll |
| Bucket-Verschlüsselung | Railway Buckets sind immer verschlüsselt (at rest) und unterstützen den SSE-Header nicht – `S3_SSE` leer lassen. Für andere S3-Anbieter `S3_SSE=AES256` |

## 6. App auf Geräten installieren (PWA)

- **Android / Chrome / Edge:** In CareOS unter *Mehr* oder *Profil* auf **App installieren** tippen.
- **iPhone / iPad:** In Safari *Teilen → Zum Home-Bildschirm*. Push-Benachrichtigungen funktionieren auf iOS nur in der installierten App.
- **Stationsrechner (Windows/macOS):** In Chrome/Edge über das Installationssymbol in der Adressleiste.
