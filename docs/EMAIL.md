# E-Mail-Versand

CareOS verschickt E-Mails über SMTP. Damit funktioniert jeder Anbieter, auch der Mailserver der Einrichtung.
Ohne Einrichtung bleibt alles wie bisher: kein „Passwort vergessen?“, Startpasswörter vergibt die Administration.

## Was CareOS verschickt

- **Passwort vergessen** (Anmeldeseite): Link an die hinterlegte E-Mail-Adresse, 60 Minuten gültig. Die Antwort ist
  immer gleich, damit sich nicht erraten lässt, welche Konten es gibt. Höchstens 3 Links je Person und Stunde, 5
  Anfragen je IP-Adresse und Minute.
- **Einladung** (Leitung › Administration › Mitarbeiter › Mitarbeiter erstellen): Mit E-Mail-Adresse lässt sich
  „Per E-Mail einladen“ statt eines Startpassworts wählen; die Person setzt ihr Passwort selbst (Link 7 Tage gültig).
- **Link zum Passwort setzen** (beim Mitarbeiter): sendet einen neuen Link, z. B. wenn eine Einladung abgelaufen ist.

Jeder Link gilt nur einmal; ein neuer Link macht ältere ungültig. Gespeichert wird nur ein Hash des Links. Nach dem
Setzen eines Passworts enden alle Sitzungen der Person. Anfrage, Versand und Einlösung stehen im Protokoll.

## Variablen (Railway › Dienst `carecore` › Variables)

| Variable        | Inhalt                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `SMTP_HOST`     | Mailserver des Anbieters                                                                            |
| `SMTP_PORT`     | `587` (STARTTLS, Standard) oder `465` (TLS von Anfang an)                                           |
| `SMTP_USER`     | Benutzername beim Anbieter                                                                          |
| `SMTP_PASSWORD` | Passwort bzw. SMTP-Schlüssel beim Anbieter                                                          |
| `MAIL_FROM`     | Absender, z. B. `CareOS Sonnengarten <noreply@sonnengarten.ch>` (Domain beim Anbieter bestätigen)   |
| `APP_URL`       | Adresse der App für Links, z. B. `https://carecore.sonnengarten.ch`; ohne Angabe die Railway-Domain |

Links bauen nie auf dem Host der Anfrage auf, sondern nur auf `APP_URL` bzw. der Railway-Domain
(`RAILWAY_PUBLIC_DOMAIN`, setzt Railway selbst). Eingeschaltet ist der Versand, sobald `SMTP_HOST`, `MAIL_FROM` und
eine Adresse der App vorhanden sind.

## Anbieter

Preise und Kontingente ändern sich; vor der Einrichtung beim Anbieter prüfen.

- **Brevo** (Frankreich, Server in der EU): Gratisplan mit einem täglichen Kontingent, das für Passwort-Links und
  Einladungen reicht. SMTP-Server `smtp-relay.brevo.com`, Port `587`; Benutzer und SMTP-Schlüssel unter
  „SMTP & API“. Absender-Domain mit SPF/DKIM bestätigen.
- **Infomaniak** (Schweiz, Server in der Schweiz): günstige Mail-Pakete; SMTP `mail.infomaniak.com`, Port `465` oder
  `587`, Benutzer ist die E-Mail-Adresse. Passend, wenn Daten in der Schweiz bleiben sollen.
- **Mailserver der Einrichtung** (z. B. Microsoft 365 oder Exchange): SMTP-Zugang der IT der Einrichtung.

Inhalte der E-Mails: Name, Benutzername (nur bei der Einladung) und der Link. Keine Gesundheitsdaten.

## Prüfen

Nach dem Setzen der Variablen neu deployen, dann auf der Anmeldeseite „Passwort vergessen?“ mit einem Konto testen,
bei dem eine E-Mail-Adresse hinterlegt ist. Fehler beim Versand stehen im Log des Dienstes (`Password reset mail
failed` bzw. `Invite mail failed`).
