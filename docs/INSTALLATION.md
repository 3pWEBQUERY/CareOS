# Neue Kundeninstallation

Jede Einrichtung bekommt ihre eigene CareOS-Installation: eigenes Railway-Projekt, eigene Datenbank, eigener
Speicher für Dateien, eigene Domain. Daten verschiedener Kunden liegen nie zusammen. Alle Installationen laufen mit
demselben Code aus diesem Repository (Branch `main`); ein Merge aktualisiert alle Installationen.

Dauer: etwa 30 Minuten. Danach richtet die Einrichtung den Rest selbst ein (oder ihr macht es für sie), geführt
von der Checkliste „CareOS einrichten“ unter Leitung › Administration.

## 1. Geheimnisse erzeugen

Lokal im Repository:

```bash
node scripts/new-installation.mjs --kontakt=support@eure-firma.ch --land=CH "Alterszentrum Sonnengarten"
```

`--land` ist das Land der Einrichtung: `CH` (Schweiz), `DE` (Deutschland) oder `AT` (Österreich). Es bestimmt
Pflegestufen (CH), Pflegegrade (DE) bzw. Pflegegeldstufen (AT), die Sozialversicherungsnummer, die Feiertage im
Dienstplan und die vorgeschlagenen Qualifikationen; die Administration kann es später unter Leitung › Konfiguration
ändern. Das Skript gibt die Variablen für Schritt 3 aus (Name und Land der Einrichtung, Passwort des ersten Administrators,
Schlüssel für Zwei-Faktor/Webhooks/Offline, Cron-Geheimnis, Web-Push-Schlüssel). Nichts wird gespeichert oder
gesendet. Die Ausgabe nur in Railway einfügen; das Admin-Passwort der Einrichtung auf einem sicheren Weg übergeben
(z. B. Telefon), nie per E-Mail zusammen mit dem Benutzernamen.

## 2. Railway-Projekt anlegen

1. Railway › **New Project** › **Deploy from GitHub repo** › dieses Repository, Branch `main`. Der Dienst heisst
   danach z. B. `carecore`.
2. Im Projekt **+ Create** › **Database** › **PostgreSQL**.
3. Im Projekt **+ Create** › **Bucket** (für Fotos, Dateien, Logo).
4. Region: Europa wählen (Projekt-Einstellungen); bei Wunsch der Einrichtung nach Daten in der Schweiz vorher klären,
   welche Region bzw. welcher Anbieter vertraglich vereinbart ist.

## 3. Variablen des Dienstes `carecore`

Unter **Variables** › **Raw Editor** einfügen:

- die Ausgabe aus Schritt 1,
- `DATABASE_URL=${{Postgres.DATABASE_URL}}`,
- die Bucket-Variablen über **Add Reference** (`S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`) und `S3_FORCE_PATH_STYLE=false`,
- optional `MISTRAL_API_KEY` und `MISTRAL_MODEL` für CareOS KI,
- optional die E-Mail-Variablen (`docs/EMAIL.md`).

## 4. Einstellungen des Dienstes

Unter **Settings** (Railway übernimmt diese Werte nicht aus einer Datei im Repository):

- Build: `npm run build`, Start: `node node_modules/next/dist/bin/next start` (direkt, ohne npm: beim Ersetzen eines
  Deployments beendet Railway den alten Container mit SIGTERM, und npm meldet das sonst als „npm error … SIGTERM“).
- **Pre-Deploy Command**: `node database/migrate.mjs` (legt das Schema an und bringt es bei jedem Deploy auf den
  neuesten Stand).
- **Healthcheck Path**: `/api/health`, Timeout 120 s; **Restart Policy**: On Failure, 5 Versuche.
- **Networking** › **Generate Domain** oder eigene Domain der Einrichtung (z. B. `carecore.sonnengarten.ch`) mit
  CNAME-Eintrag. Bei eigener Domain `APP_URL=https://carecore.sonnengarten.ch` setzen.

## 5. Erinnerungen und Push (Railway Function)

Im Projekt **+ Create** › **Function**, Name `push-dispatch`, Laufzeit Bun, Zeitplan `*/5 * * * *`, Variablen
`CRON_SECRET=${{carecore.CRON_SECRET}}` und `CARECORE_URL=https://<Domain der Installation>`. Code:

```ts
// Ruft alle 5 Minuten die fälligen Erinnerungen und Push-Nachrichten von CareOS ab.
const base = Bun.env.CARECORE_URL;
const secret = Bun.env.CRON_SECRET;
if (!base || !secret) {
  console.error("CARECORE_URL oder CRON_SECRET fehlt.");
  process.exit(1);
}

const health = await fetch(`${base}/api/health`);
const report = (await health.json().catch(() => null)) as { status?: string; migrations?: unknown } | null;
console.log(`health ${health.status} ${report?.status ?? "?"} ${JSON.stringify(report?.migrations ?? null)}`);

const response = await fetch(`${base}/api/push/dispatch`, { headers: { Authorization: `Bearer ${secret}` } });
console.log(`dispatch ${response.status} ${(await response.text()).slice(0, 300)}`);
if (!response.ok) process.exit(1);
```

## 6. Prüfen und übergeben

1. Deploy abwarten; `https://<Domain>/api/health` meldet `"status": "ok"` und keine offenen Migrationen.
2. Mit `Admin` und dem Passwort aus Schritt 1 anmelden. Die Einrichtung (Name aus `CARECORE_ORGANIZATION_NAME`), ein
   Standort und „Wohnbereich 1“ sind angelegt.
3. Leitung › Administration zeigt „CareOS einrichten“: Name, Land, Standort mit Adresse, Wohnbereiche, Mitarbeitende,
   Bewohner, E-Mail-Versand, Zwei-Faktor für das Administrationskonto. Diese Schritte erledigt die Einrichtung selbst
   oder ihr gemeinsam mit ihr. Bestehende Listen (Bewohner, Mitarbeitende) lassen sich unter Leitung ›
   Administration › Datenübernahme aus CSV übernehmen.
4. Backups, Benachrichtigungen und Verfügbarkeitstest einrichten: `docs/BETRIEB.md` › „Einmal einrichten“.
5. Das Administrationskonto sofort mit Zwei-Faktor-Anmeldung oder Passkey absichern
   (Einstellungen › Sicherheit).

## Aktualisieren

Ein Merge in `main` deployt alle Installationen, die an `main` hängen; die Migrationen laufen dabei automatisch.
Soll eine Installation erst später aktualisiert werden, in Railway › Settings › Source einen eigenen Branch wählen
(z. B. `stable`) und diesen nach der Freigabe nachziehen.

## Kündigung

Daten auf Wunsch der Einrichtung exportieren (Datenbank mit `pg_dump`, Bucket-Inhalte), übergeben und danach das
Railway-Projekt löschen. Löschung schriftlich bestätigen.
