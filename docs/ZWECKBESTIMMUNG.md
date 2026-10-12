# Zweckbestimmung von CareOS (Entwurf)

Stand: 03.10.2026. Entwurf zur Prüfung durch eine Fachperson für Medizinprodukte-Regulierung; keine Rechtsberatung.

## Zweck

CareOS ist Software für **Pflegedokumentation, Organisation und Kommunikation** in Pflegeheimen und ähnlichen
Einrichtungen (Schweiz, Deutschland, Österreich). Sie dient dazu,

- Angaben zu betreuten Personen zu erfassen, zu speichern, anzuzeigen, zu suchen, zu drucken und zu exportieren;
- Arbeitsabläufe zu organisieren (Aufgaben, Übergaben, Dienstplan, Termine, Erinnerungen nach Vorgaben der
  Einrichtung);
- zwischen Mitarbeitenden, Ärztinnen und Ärzten, Apotheken und Angehörigen zu kommunizieren;
- gesetzliche und organisatorische Pflichten der Einrichtung zu unterstützen (Protokolle, Auskunft, Aufbewahrung).

## Nicht Zweck

CareOS ist **nicht** dafür bestimmt, für einzelne Personen

- Diagnosen zu stellen oder vorzuschlagen;
- Dosierungen zu berechnen oder Therapien bzw. Behandlungen zu empfehlen;
- Krankheiten, Risiken oder Vitalfunktionen selbständig zu überwachen, vorherzusagen oder zu bewerten;
- Wechselwirkungen von Arzneimitteln aus einer Wirkstoffdatenbank automatisch zu beurteilen.

Alle Beurteilungen und Entscheide treffen Fachpersonen. CareOS enthält keine eigenen klinischen Grenzwerte,
Intervalle oder Regeln; wo Hinweise erscheinen, beruhen sie auf Vorgaben, die die Einrichtung selbst festlegt.

## Grundlage der Abgrenzung

Software ist ein Medizinprodukt, wenn der Hersteller sie für einen medizinischen Zweck bei einzelnen Personen bestimmt
(EU: Verordnung (EU) 2017/745, Art. 2 Nr. 1 und Anhang VIII Regel 11; Schweiz: Medizinprodukteverordnung MepV, die
sich daran anlehnt). Software, die Daten nur speichert, archiviert, überträgt, einfach sucht oder unverändert anzeigt,
ist nach der Leitlinie MDCG 2019-11 kein Medizinprodukt. Die genannten Fundstellen sind vor einer Veröffentlichung
dieser Zweckbestimmung an der Quelle zu prüfen.

## Funktionen nahe an der Grenze

Diese Funktionen sind so gebaut, dass sie nur zählen, anzeigen oder an Vorgaben der Einrichtung erinnern. Sie sollten
mit der Zweckbestimmung zusammen fachlich geprüft werden.

| Funktion                        | Wie CareOS sie umsetzt                                                                                                                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hinweise zu Wechselwirkungen    | Nur Hinweise, die die Einrichtung selbst mit Quelle erfasst; keine Wirkstoffdatenbank.                                                                                                                |
| Einschätzungsinstrumente        | Erfassung nach veröffentlichter Methode bzw. Vorgabe der Einrichtung; CareOS zählt Punkte und zeigt die von der Quelle bzw. Einrichtung festgelegten Bereiche; die Beurteilung trifft die Fachperson. |
| Vitalwerte, Gewicht, Trinkmenge | Grenzen und Zeiträume legt die Einrichtung bzw. die Ärztin oder der Arzt fest; ohne Vorgabe kein Hinweis.                                                                                             |
| CareOS Kompass                  | Eigenes Instrument zur Bedarfsabklärung: beschreibende Antworten, keine Punktzahl, keine Pflegestufe, kein Risiko; Handlungsbedarf entscheidet die Fachperson je Bereich (siehe unten).               |
| CareOS KI                       | Erstellt nur Entwürfe (z. B. für die Pflegeplanung), die eine Fachperson prüft und übernimmt; keine Diagnosen, keine Medikation.                                                                      |

## CareOS Kompass (Bedarfsabklärung)

Zweck, wörtlich: „CareOS ermöglicht Pflegefachpersonen, das Assessment mit dem CareOS Kompass digital
durchzuführen, Ergebnisse zu dokumentieren und die daraus resultierende Pflegeplanung zu verwalten.“

Nicht Zweck: „CareOS analysiert die Gesundheitsdaten automatisch und bestimmt den medizinischen Pflegebedarf bzw.
diagnostiziert Risiken.“

Umsetzung:

- Die Fragen und Antwortstufen sind eigenständig für CareOS verfasst und beschreiben Beobachtungen und
  Unterstützung im Alltag (z. B. „Teilweise Hilfe“, „Häufig beobachtet“). Es gibt keine Punkte, Summen, Stufen oder
  Ampeln, die aus den Antworten errechnet werden.
- Ob in einem Bereich Handlungsbedarf besteht, entscheidet die Fachperson und beschreibt ihn selbst; ohne diesen
  Entscheid lässt sich die Abklärung nicht abschliessen.
- „Aus der Akte“ zeigt nur Fakten aus anderen Bereichen (z. B. dokumentierte Stürze, laufende Wunden, Hilfsmittel),
  ohne sie zu bewerten.
- Der Vergleich mit der letzten Abklärung zählt nur, bei wie vielen Fragen mehr oder weniger Unterstützung bzw.
  Beobachtung angegeben wurde.
- Fristen für Abklärungen legt die Einrichtung fest; ohne Einstellung wird nichts automatisch fällig.
- Die Auswertung je Wohnbereich zählt nur, wie viele Personen welche Antwort erhalten haben und bei wie vielen die
  Fachperson Handlungsbedarf festgehalten hat; sie bildet keine Kennzahl und keine Rangfolge.
- Der Entwurf der CareOS KI für das Gesamtbild fasst nur die Antworten, Notizen und Entscheide der Fachperson in
  Worte (ohne Namen); er bewertet den Bedarf nicht und wird erst übernommen, wenn die Fachperson es bestätigt.
- Der Kompass ersetzt kein vom Kanton bzw. Land anerkanntes Instrument für die Einstufung zur Finanzierung
  (z. B. nach KVG in der Schweiz).

## Offen

- Prüfung dieser Zweckbestimmung und der Funktionen oben durch eine Fachperson für Medizinprodukte-Regulierung.
- Danach: Zweckbestimmung in Vertrag, Website und Hilfe von CareOS gleichlautend verwenden.
