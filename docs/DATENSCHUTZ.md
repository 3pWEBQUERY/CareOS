# Lösch- und Aufbewahrungskonzept

CareOS legt keine Fristen fest. Die Einrichtung bestimmt die Aufbewahrungsfrist selbst (Leitung › Konfiguration ›
„Aufbewahrungsfrist Akten“, 1–30 Jahre). Ohne festgelegte Frist wird nichts zur Löschung vorgeschlagen.

## Wann eine Akte zur Löschung ansteht

- Nur Akten mit Status _ausgetreten_, _verstorben_ oder _archiviert_ – aktive, geplante und verlegte Personen nie.
- Stichtag ist der Todestag, sonst das Austrittsdatum, sonst das Ende des letzten Aufenthalts.
- Die Akte steht zur Löschung an, sobald Stichtag + Frist erreicht ist (Datum in der Zeitzone der Einrichtung).

## Wie gelöscht wird

- Nie automatisch. Die Karte „Löschfristen“ in Leitung › Konfiguration listet fällige Akten; die Administration
  (`administration.manage`) löscht einzeln und bestätigt mit dem vollständigen Namen.
- Der Server prüft Recht, Frist und Namen erneut; alles geschieht in einer Transaktion.

## Was gelöscht wird

- Die Akte mit allen direkt verknüpften Einträgen (Stammdaten, Bild, Aufenthalte, Kontakte, Biografie, Pflegedokumentation,
  Medikation, Wunden samt Fotos, Vitalwerte, Ernährung, Einschätzungen, Pflegeplanung, RAI, Termine, Körperbefunde,
  Pflegebedarf).
- Dokumente der Akte samt Dateien, Aufgaben, Übergaben und KI-Entwürfe zur Person.
- Benachrichtigungen, die auf die Akte verweisen oder den vollständigen Namen enthalten.

## Was bleibt

- **Qualitätsereignisse** bleiben für die Statistik, ohne Personenbezug und mit ersetzter Beschreibung.
- **Protokoll**: Einträge zur Akte bleiben als Nachweis stehen, ihre Inhalte (vorher/nachher) werden geleert. Die Löschung
  selbst wird mit Austrittsdatum und Frist protokolliert, ohne Namen.

## Hinweis zur Frist

Mit der Akte werden auch Medikationsdaten gelöscht, darunter bewohnereigene Betäubungsmittel-Bestände und ihre
Buchungen. Für solche Unterlagen können gesetzliche Aufbewahrungspflichten gelten. Die Einrichtung wählt die Frist so,
dass sie alle für sie geltenden Pflichten erfüllt; CareOS gibt dafür keinen Wert vor.

## Warteliste

- Eigene Frist: Leitung › Konfiguration › „Aufbewahrungsfrist Warteliste“ (1–120 Monate). Ohne Frist wird nichts
  vorgeschlagen.
- Zur Löschung stehen nur abgeschlossene Anfragen an (zurückgezogen oder Platz vergeben); Stichtag ist der Abschluss.
  Anfragen, deren Eintritt noch geplant ist, und wartende Anfragen nie.
- Die Karte „Löschfristen Warteliste“ listet fällige Anfragen; die Administration löscht einzeln oder gesammelt nach
  Bestätigung. Der Server prüft Recht und Frist erneut, alles in einer Transaktion.
- Gelöscht werden Name, Geburtsdatum, Kontakt, Bedarf und Status der Anfrage. Die Akte einer eingetretenen Person bleibt
  unverändert. Protokolleinträge zur Anfrage bleiben ohne Inhalte stehen; die Löschung wird mit Abschlussdatum und Frist
  protokolliert, ohne Namen.

## Grenzen

- Freitext ausserhalb der Akte (z. B. Messenger-Nachrichten, Dokumente ohne Aktenbezug) wird nicht durchsucht.
- Datensicherungen der Datenbank unterliegen dem Betriebskonzept des Hostings und werden von CareOS nicht verändert.
