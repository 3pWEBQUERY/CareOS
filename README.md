# CareOS

Die Arbeitsplattform für Pflegeorganisationen: Pflege, Schichtarbeit, Team und Qualität in einer Oberfläche.
Umsetzung der Product Requirements (CareCore PRD v1.0) im Design des Stationsarbeitsplatz-Entwurfs („Clinical Calm“).
Hell ist Standard, Dunkel ist optional (Topbar oder Profil → Darstellung).

## Module

| Bereich | Inhalt |
|---|---|
| **Home** | Persönliche Startseite: Schicht, Prioritäten (kritisch / wichtig / Routine), „Seit deinem letzten Dienst“, Schicht-Timeline, Bestätigungen, Schulungen, nächste Dienste |
| **Bewohnende** | Liste mit überfälligen/offenen Massnahmen, Aufnahme, Akte mit Übersicht (Resident 360), Timeline, Tagesplan, Verlauf (Korrekturen ohne Überschreiben, Diktat, KI-Entwurf), Pflegeplanung, Medikation, Vitalwerte, Assessments, Wunden, Ernährung, Termine, Dokumente, Kontakte, Historie |
| **Pflegeplanung** | Pflegebereiche, geführter Planungsfluss (Situation → Evaluation), Vorschläge aus Assessments, Versionierung mit Freigabe |
| **Medikation** | Abgabeliste, Reserve mit Tageshöchstdosis und Wirkungskontrolle, Vier-Augen-Prinzip, Verordnungen mit Historie, Bestand, Medikamentenrunde |
| **Aufgaben** | Stationsübersicht, Erstellen / Zuweisen / Quittieren / Teilweise / Überspringen / Eskalieren |
| **Übergabe** | Automatisch aus Verlauf, Vitalwerten, Medikation, Ereignissen und Aufgaben; Ergänzungen, Kenntnisnahme pro Person |
| **Dienstplan** | Meine Dienste (Woche/Monat), Teamplanung, Besetzung und Qualifikationsabdeckung, offene Dienste, Abwesenheiten, Schichttausch |
| **Team & Chat** | Channels, Mitteilungen mit Lesebestätigung („47 von 52 bestätigt“), Kommentare, Direkt- und Gruppenchats, Erwähnungen, klinische Kommunikation mit Protokollierung |
| **Dokumente** | Weisungen, Standards, Formulare mit Versionen, Freigabe, Gültigkeit, erneuter Kenntnisnahme bei kritischen Änderungen, Suche |
| **Lernen** | Kurse mit Text, Video, Dokument, Quiz, praktischem Nachweis; Zertifikate mit Ablauf, Compliance-Matrix |
| **Qualität** | Ereignismeldung mit Smart Workflow (z. B. Sturz → Vitalwerte, Assessment, Arztinformation, Planung prüfen), Bewertung, Analyse, Abschluss |
| **Kennzahlen** | Pflege, Management, Workforce – nur aggregiert, keine Leistungsüberwachung einzelner Personen |
| **Admin** | Organisation, Terminologie (Bewohner/Patient/Klient), Branding, Standorte/Bereiche/Zimmer/Teams, Benutzer und Einladungen, Rollen-Matrix, klinische Konfiguration (inkl. Eskalationsregeln und Bestätigungspflichten), Formulare für die Fokusdokumentation, Channels, Audit-Protokoll, API-Tokens, Webhooks, Datenschutz (Aufbewahrungsfristen, Anonymisierung, Löschprotokoll), Datenexport |
| **Profil** | Darstellung, Sprache, MFA (TOTP), Passkeys, Push-Benachrichtigungen, Sitzungen und Geräte, Passwort, Zertifikate |

Plattform: globale Suche (Ctrl/⌘ K), priorisierte und gebündelte Benachrichtigungen, Echtzeit-Aktualisierung (Server-Sent Events über Postgres LISTEN/NOTIFY), Mobile-Navigation mit zentraler Schnellaktion, Sprachen DE / FR / IT / EN, REST-API und HL7 FHIR R4 (lesend) – siehe [`docs/API.md`](docs/API.md).

## Technik

- Next.js 16 (App Router, Server Components, Server Actions), React 19, TypeScript
- PostgreSQL mit Prisma 6, Migrationen unter `prisma/migrations`
- Dateien im **Railway Bucket** (S3-kompatibel), ausgeliefert nur über kurzlebige, berechtigungsgeprüfte Links
- Anmeldung: Passwort (Argon2id), TOTP-MFA, Passkeys (WebAuthn), optional Single Sign-on (OpenID Connect)
- Unveränderbares Audit-Protokoll (Datenbank-Trigger verhindert UPDATE/DELETE; einzige Ausnahme: Löschung nach 10 Jahren durch den Aufbewahrungsjob)
- Hintergrundjobs (Eskalationen, Aufbewahrung/Löschkonzept, Bereinigung) laufen in der App-Instanz und sind über Postgres-Advisory-Locks gegen Mehrfachausführung geschützt
- CareOS AI (optional): Formulierungs-, Übergabe-, Zusammenfassungs- und Suchassistent mit Claude; Ergebnisse sind immer gekennzeichnete Entwürfe und werden nie automatisch gespeichert

Architektur und Konventionen: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Deployment auf Railway

Schritt-für-Schritt-Anleitung mit Variablen-Generator: [`docs/RAILWAY.md`](docs/RAILWAY.md) (`npm run railway:env`).


1. **Projekt anlegen:** In Railway „New Project → Deploy from GitHub repo“ und dieses Repository wählen. `railway.json` setzt Build, Migration vor dem Deploy (`prisma migrate deploy`), Start und Health Check (`/api/health`).
2. **Postgres hinzufügen:** „+ New → Database → PostgreSQL“.
3. **Bucket hinzufügen:** „+ New → Bucket“ (Railway Storage Bucket). Den Dienst z. B. `Bucket` nennen.
4. **Variablen im App-Service setzen:**

   | Variable | Wert |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
   | `BUCKET` | `${{Bucket.BUCKET}}` |
   | `ENDPOINT` | `${{Bucket.ENDPOINT}}` |
   | `REGION` | `${{Bucket.REGION}}` |
   | `ACCESS_KEY_ID` | `${{Bucket.ACCESS_KEY_ID}}` |
   | `SECRET_ACCESS_KEY` | `${{Bucket.SECRET_ACCESS_KEY}}` |
   | `APP_SECRET` | zufällig, mindestens 32 Zeichen (`openssl rand -hex 32`) – verschlüsselt MFA-Geheimnisse |
   | `APP_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` (oder eigene Domain) – nötig für Passkeys und SSO |
   | `TZ` | `Europe/Zurich` |
   | `SEED_DEMO` | `true` nur für Test-/Pilotumgebungen: legt beim ersten Start die Demodaten an |

   Die Bucket-Variablennamen bitte mit dem Tab „Credentials“ des Buckets abgleichen. Alternativ werden auch `AWS_S3_BUCKET_NAME`, `AWS_ENDPOINT_URL`, `AWS_DEFAULT_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` gelesen. Railway Buckets verwenden Path-Style-Adressierung (`S3_FORCE_PATH_STYLE=true`, Standard).

5. **Domain erzeugen:** Settings → Networking → „Generate Domain“. Danach `APP_URL` prüfen.
6. **Optional:**
   - `ANTHROPIC_API_KEY` (und `AI_MODEL`, Standard `claude-opus-5-5`) aktiviert CareOS AI. Abschaltbar pro Organisation unter Admin → Klinische Konfiguration → Funktionen.
   - `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_LABEL` für Single Sign-on (z. B. Microsoft Entra ID). Redirect-URI: `<APP_URL>/api/auth/sso/callback`. Benutzer werden über die E-Mail zugeordnet, Konten werden nicht automatisch angelegt.
   - `SESSION_HOURS` (Standard 12) – gleitende Sitzungsdauer.
   - `JOBS_DISABLED=true` schaltet die Hintergrundjobs in dieser Instanz ab.
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:…`) aktivieren Web-Push-Benachrichtigungen (Profil → Push-Benachrichtigungen). Schlüsselpaar mit `npx web-push generate-vapid-keys` erzeugen. Push-Nachrichten enthalten nie Gesundheitsdaten, nur einen allgemeinen Hinweis und den Link. Auf iPhone/iPad nur in der installierten Web-App (Home-Bildschirm).

**Produktivstart ohne Demodaten:** `INIT_ADMIN_EMAIL`, `INIT_ADMIN_PASSWORD` (min. 12 Zeichen) und optional `INIT_ORG_NAME`, `INIT_LOCATION_NAME`, `INIT_UNIT_NAME` setzen. Beim ersten Start wird auf leerer Datenbank die Organisation mit Standardkonfiguration (Rollen, Schichten, Pflegebereiche, Assessments, Ereignistypen, Grenzwerte) und ein Systemadministrator angelegt. Danach `INIT_ADMIN_PASSWORD` wieder entfernen und weitere Personen unter Admin → Benutzer einladen.

### Demo-Zugänge (nur mit `SEED_DEMO=true`, Passwort `careos-demo`)

| E-Mail | Rolle |
|---|---|
| `anna.muster@lindenhof.ch` | Pflegefachperson, Wohngruppe 2 |
| `barbara.gerber@lindenhof.ch` | Stationsleitung, Haus Lindenhof |
| `claudia.widmer@lindenhof.ch` | Pflegedienstleitung |
| `admin@lindenhof.ch` | Systemadministration |

Alle Personen und Werte der Demodaten sind erfunden. Passwörter nach dem ersten Login ändern.

## Als App (PWA)

CareOS ist eine installierbare Web-App: Manifest mit Icons (inkl. maskable/monochrome), Verknüpfungen (Aufgaben, Übergabe, Dokumentieren, Medikamentenrunde), Screenshots für den Installationsdialog, Service Worker mit Offline-Ansicht, Push-Benachrichtigungen und Update-Hinweis. Installation über *Mehr* oder *Profil* → **App installieren**; auf iPhone/iPad über *Teilen → Zum Home-Bildschirm*. Voraussetzung ist HTTPS (auf Railway automatisch).

## Lokale Entwicklung

```bash
cp .env.example .env            # DATABASE_URL auf lokale Postgres-Instanz setzen
npm install
npx prisma migrate deploy
npm run db:seed                 # Demodaten (nur auf leerer Datenbank)
TZ=Europe/Zurich npm run dev
```

Prüfen: `npm run typecheck`, `npm test`, `npm run build`.

## Bewusste Grenzen

- **Medikation:** Interaktionsprüfung ist vorbereitet (Admin → Integrationen), aber ohne angebundene Datenquelle. Vor Produktivbetrieb ist eine klinische Validierung nötig (PRD §58).
- **Offline:** Verlaufseinträge, Vitalwerte, Aufgaben und Trinkmengen werden ohne Verbindung verschlüsselt auf dem Gerät vorgemerkt (max. 24 h) und danach synchronisiert; Konflikte erscheinen im Synchronisationsfenster. Der Lesestand der Schicht (`/offline`) enthält nur Name, Zimmer, Allergien, REA, Risiken und offene Aufgaben (max. 12 h). Weitere Bereiche (z. B. Medikation) sind bewusst nicht offline erfassbar. Geht eine Antwort nach erfolgreichem Speichern verloren, kann ein Verlaufseintrag doppelt ankommen (Aufgaben erkennen das).
- **Push:** Web-Push braucht die VAPID-Variablen; Zustellung über die Push-Dienste von Google/Apple wurde nur mit einem lokalen Test-Server geprüft. Beim Abmelden wird das Gerät abgemeldet (geteilte Stationsgeräte).
- **Löschkonzept:** Fristen sind Vorschläge – mit der Datenschutzberatung und den kantonalen Vorgaben festlegen (Admin → Datenschutz). Audit-Einträge vor einer Anonymisierung enthalten Namen bis zum Ablauf ihrer eigenen Frist.
- **MFA-Pflicht:** gilt für Seiten und Server Actions; die REST-API ist über eigene Tokens abgesichert.
- **Rate Limiting** läuft im Prozessspeicher – bei mehreren Instanzen auf Redis/Postgres umstellen.
- **Datenstandort** ist pro Organisation hinterlegt, die physische Region bestimmt das Railway-Projekt.
- **Integrationen** (Dienstplanung, Labor, Apotheke, HL7 v2) sind als Register vorbereitet; aktiv sind REST-API, Webhooks und FHIR (lesend).
