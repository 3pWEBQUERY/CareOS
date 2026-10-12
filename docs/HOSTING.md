# Hosting auf Railway

Neue Kundeninstallation (eigenes Projekt je Einrichtung): siehe `docs/INSTALLATION.md`. Überwachung und Backups:
`docs/BETRIEB.md`.

CareOS läuft auf Railway (Projekt „feisty-achievement“, Region Europa).

- **App** (Dienst `carecore`): Next.js aus diesem Repository, Branch `main`. Einstellungen am Dienst in Railway
  (Settings; `railway.json` liest Railway für neue Dienste nicht mehr):
  - Build `npm run build`, Start `npm run start`.
  - Pre-Deploy `node database/migrate.mjs` (Zeitlimit 600 s): vor jedem Deploy laufen die Migrationen.
  - Statusprüfung über `/api/health` (120 s), Neustart bei Fehler bis zu 5-mal.
- **Datenbank** (Dienst `Postgres`): Railway Postgres. Die App verbindet sich über das private Netz
  (`DATABASE_URL=${{Postgres.DATABASE_URL}}`). Der Neon-Treiber im Code bleibt; seine Anfragen beantwortet ein
  Verbindungspool (`database/pg-fetch.mjs`, Paket `pg`). Neon-Datenbanken (`*.neon.tech`) laufen weiter über HTTP.
- **Medien** (Bucket `sorted-lunchbox`): Fotos der Bewohner, Wundfotos, Dateien und Dokumente sowie das Logo
  (`lib/storage.ts`, S3-kompatibel).
  - Der Bucket ist privat; ausgeliefert wird nur über CareOS mit den jeweiligen Rechten.
  - Ohne Bucket (lokal, Tests) bleiben die Inhalte in der Datenbank.
  - Beim Löschen (Foto, Datei, Logo, Akte nach Ablauf der Frist) wird der Inhalt auch im Bucket entfernt.
- **Erinnerungen und Push** (Dienst `push-dispatch`): Railway Function mit Zeitplan `*/5 * * * *`, ruft
  `/api/push/dispatch` mit `CRON_SECRET` (Verweis `${{carecore.CRON_SECRET}}`) auf und schreibt den Stand von
  `/api/health` ins Log.

## Variablen des Dienstes `carecore`

| Variable                                                                            | Inhalt                                                                                              |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                      | `${{Postgres.DATABASE_URL}}`                                                                        |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Verweise auf den Bucket `sorted-lunchbox`                                                           |
| `S3_FORCE_PATH_STYLE`                                                               | `false` (Railway Buckets: virtuelle Hosts)                                                          |
| `CARECORE_MFA_KEY`                                                                  | Serverschlüssel (MFA, Webhooks, Offline-Verschlüsselung, SSO), zufällig erzeugt                     |
| `CRON_SECRET`                                                                       | Geheimnis für den Push-Auftrag, zufällig erzeugt                                                    |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`                            | Schlüssel für Web Push                                                                              |
| `CARECORE_ADMIN_PASSWORD`                                                           | **von der Betreiberin zu setzen**: Passwort des ersten Administrators (mindestens 12 Zeichen)       |
| `MISTRAL_API_KEY`                                                                   | **von der Betreiberin zu setzen**: Mistral für CareOS KI, Übersetzungsentwürfe und KI-Dienstplanung |
| `MISTRAL_MODEL`                                                                     | `mistral-small-latest`                                                                              |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, `APP_URL`      | optional: E-Mail-Versand (Passwort vergessen, Einladungen), siehe `docs/EMAIL.md`                   |
| `ALERT_EMAIL`, `ALERT_ERROR_THRESHOLD`                                              | optional: Alarm per E-Mail bei vielen Serverfehlern, siehe `docs/BETRIEB.md`                        |

Die Werte stehen nur in Railway, nie im Repository.

## Umzug der Daten

Die Railway-Datenbank startet leer; die Migrationen legen das Schema an. Bestehende Daten einer früheren Datenbank
werden nicht automatisch übernommen. Für einen Umzug die alte Datenbank mit `pg_dump` sichern und mit `pg_restore`
in Railway einspielen, bevor die App in Betrieb geht.
