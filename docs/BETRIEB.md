# Betrieb: Überwachung und Backups

Gilt für jede Installation (je Einrichtung ein Railway-Projekt, siehe `docs/INSTALLATION.md`). Die Schritte unter
„Einmal einrichten“ gehören zur Übergabe einer neuen Installation.

## Einmal einrichten

### 1. Backups der Datenbank (Railway)

Railway › Projekt › Dienst **Postgres** › **Backups**:

- **Geplante Backups** einschalten: **Daily** (6 Tage aufbewahrt), **Weekly** (1 Monat) und **Monthly** (3 Monate).
- Empfohlen zusätzlich **Point-in-Time Recovery** (PITR): Railway sichert jede Änderung laufend in einen eigenen
  Bucket (`Postgres-PITR`) und kann die Datenbank auf jeden Zeitpunkt der letzten rund vier Wochen zurücksetzen.
  Das Einschalten startet Postgres einmal neu; am besten ausserhalb der Dienstwechsel.

Ziele, an denen sich die Einstellungen messen (mit der Einrichtung im Vertrag festhalten):

- **RPO** (wie viele Daten höchstens verloren gehen): mit PITR Minuten, nur mit täglichen Backups bis 24 Stunden.
- **RTO** (wie lange die Wiederherstellung dauert): Wiederherstellen und Neustart dauern üblicherweise unter einer
  Stunde; nach jeder Probe-Wiederherstellung die tatsächliche Dauer notieren.

### 2. Dateien (Bucket)

Fotos, Wundfotos, Dokumente und das Logo liegen im Bucket der Installation; die Datenbank enthält nur die
Verweise. Mindestens monatlich und vor grösseren Änderungen die Bucket-Inhalte sichern (Railway › Bucket ›
Zugangsdaten, dann mit einem S3-Werkzeug wie `rclone sync` in einen zweiten Speicher kopieren). Den zweiten Speicher
mit der Einrichtung vereinbaren (Region, Anbieter).

### 3. Benachrichtigungen bei Ausfall

- Railway › **Account Settings** › **Notifications**: E-Mail bei **Deploy failed**, **Crashed** und
  **Restarted** einschalten (gilt für alle Projekte des Kontos).
- Railway › Projekt › **Monitors** (optional): Warnung bei hoher CPU- oder Speicherauslastung.
- Externer Verfügbarkeitstest, der auch meldet, wenn Railway selbst nicht erreichbar ist: z. B. UptimeRobot oder
  Better Stack (Gratisplan), Prüfung von `https://<Domain>/api/health` alle 5 Minuten, Alarm per E-Mail oder SMS.
  `/api/health` antwortet nur mit `200`, wenn die Datenbank erreichbar ist und keine Migration fehlt.

### 4. Alarm bei vielen Serverfehlern (CareOS)

CareOS hält jeden Serverfehler (HTTP 500) kurz fest: Zeitpunkt, Herkunft und erste Zeile der Fehlermeldung, nie
Anfragedaten; Einträge werden nach 30 Tagen gelöscht. Die Administration sieht die Zahl der letzten 24 Stunden
unter Leitung › Konfiguration › Systemstatus.

Mit eingerichtetem E-Mail-Versand (`docs/EMAIL.md`) und diesen Variablen schickt CareOS einen Alarm:

| Variable                | Inhalt                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `ALERT_EMAIL`           | Empfänger des Alarms (z. B. euer Support-Postfach)                                    |
| `ALERT_ERROR_THRESHOLD` | optional: ab so vielen Serverfehlern in 15 Minuten (technische Schwelle, Standard 10) |

Geprüft wird mit dem Zeitplan (`push-dispatch`, alle 5 Minuten); höchstens ein Alarm je Stunde.

## Wiederherstellung üben

Mindestens zweimal im Jahr und nach jeder Änderung an den Backups:

1. In Railway eine **Kopie** des Projekts bzw. eine eigene Umgebung (z. B. „restore-test“) anlegen, nie die
   produktive Installation überschreiben.
2. Das letzte Backup (oder einen PITR-Zeitpunkt) dort wiederherstellen und die App mit derselben Version starten.
3. Prüfen: `/api/health` meldet `ok`; Anmeldung funktioniert; die letzten Einträge in Dokumentation und Medikation
   sind vorhanden; Fotos aus dem gesicherten Bucket öffnen sich.
4. Datum, Dauer (RTO), Stand der Daten (RPO) und Auffälligkeiten festhalten; die Testumgebung danach löschen.

## Ernstfall

1. Ursache eingrenzen (Railway › Deployments und Logs, Systemstatus in CareOS).
2. Bei fehlerhaftem Deploy: in Railway das letzte funktionierende Deployment mit **Rollback** zurückholen.
   Migrationen laufen nur vorwärts; ein Rollback der App mit einer bereits neueren Datenbank vorher prüfen.
3. Bei verlorenen oder beschädigten Daten: Backup bzw. PITR-Zeitpunkt in Railway wiederherstellen (Railway legt
   dafür ein neues Volume an und behält das alte, bis die Änderung bestätigt ist).
4. Die Einrichtung informieren: was betroffen war, welcher Zeitraum fehlt, was nachzuerfassen ist. Meldepflichten
   nach Datenschutzrecht prüfen.
