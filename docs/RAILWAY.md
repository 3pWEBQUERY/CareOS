# CareOS auf Railway einrichten

Ziel: ein Railway-Projekt mit drei Diensten – **CareOS** (diese App), **Postgres** und **Bucket** – plus öffentlicher Domain.
Dauer: etwa 10 Minuten. `railway.json` im Repository regelt Build, Migration, Start und Health Check automatisch.

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
# oder für eine Testumgebung mit Demodaten:
npm run railway:env -- --demo
```

Das Skript erzeugt frische Geheimnisse (`APP_SECRET`, VAPID-Schlüssel für Push, ein Startpasswort) und setzt die
Referenzen auf Postgres (`${{Postgres.DATABASE_URL}}`) und Bucket (`${{Bucket.BUCKET}}` usw.).
Die Bucket-Variablennamen mit dem Tab **Credentials** des Buckets abgleichen.

Ausgabe sicher aufbewahren (Passwortmanager) und nicht ins Repository übernehmen.

## 3. Domain

CareOS-Dienst → **Settings → Networking → Generate Domain** (oder eigene Domain mit CNAME).
`APP_URL` zeigt über `${{RAILWAY_PUBLIC_DOMAIN}}` automatisch darauf; bei eigener Domain `APP_URL=https://care.ihre-organisation.ch` setzen –
Passkeys und Single Sign-on hängen an genau dieser Adresse.

## 4. Deploy und erster Login

- Railway baut und startet automatisch. Vor jedem Deploy laufen die Migrationen (`prisma migrate deploy`), danach prüft Railway `/api/health`.
- **Produktiv:** Mit `INIT_ADMIN_EMAIL` / `INIT_ADMIN_PASSWORD` anmelden, sofort unter Profil → Sicherheit MFA oder Passkey einrichten,
  dann `INIT_ADMIN_PASSWORD` in Railway löschen. Weitere Personen unter Admin → Benutzer einladen.
- **Demo:** `anna.muster@lindenhof.ch` / `careos-demo` (weitere Konten im README).

## 5. Betrieb

| Thema | Empfehlung |
|---|---|
| Backups | Postgres-Dienst → *Backups* aktivieren (täglich, Aufbewahrung nach Organisationsvorgabe) |
| Skalierung | Mehrere Replikas möglich: Hintergrundjobs sind über Advisory Locks abgesichert. Login-Rate-Limit ist pro Instanz. |
| Jobs abschalten | `JOBS_DISABLED=true` in einer Instanz |
| Updates | Push auf den verbundenen Branch → automatischer Deploy; der Service Worker meldet Nutzenden «Neue Version – Neu laden» |
| Monitoring | Railway *Observability* (Logs, Metriken); Health Check `/api/health` meldet DB und Speicher |

## 6. App auf Geräten installieren (PWA)

- **Android / Chrome / Edge:** In CareOS unter *Mehr* oder *Profil* auf **App installieren** tippen.
- **iPhone / iPad:** In Safari *Teilen → Zum Home-Bildschirm*. Push-Benachrichtigungen funktionieren auf iOS nur in der installierten App.
- **Stationsrechner (Windows/macOS):** In Chrome/Edge über das Installationssymbol in der Adressleiste.
