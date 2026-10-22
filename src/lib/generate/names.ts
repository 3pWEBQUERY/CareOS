/**
 * Namens-Pools für die Erstbefüllung (prisma/bootstrap.ts → src/lib/org-setup.ts).
 * Häufige Schweizer Namen aus allen Sprachregionen; Vornamen getrennt nach Generation
 * (Bewohnende Jahrgänge 1925–1952, Mitarbeitende Jahrgänge 1965–2005).
 */

export type Sex = 'f' | 'm'

/** Vornamen der Jahrgänge 1925–1952 */
export const ELDER_FIRST: Record<Sex, readonly string[]> = {
  f: [
    'Ruth', 'Verena', 'Margrit', 'Elisabeth', 'Rosmarie', 'Heidi', 'Anna', 'Marie', 'Hedwig', 'Gertrud',
    'Elsa', 'Trudi', 'Erika', 'Ursula', 'Silvia', 'Annemarie', 'Marianne', 'Lotti', 'Klara', 'Frieda',
    'Martha', 'Lina', 'Ida', 'Emma', 'Bertha', 'Hanna', 'Doris', 'Esther', 'Margrith', 'Rosa',
    'Hildegard', 'Johanna', 'Irma', 'Alice', 'Agnes', 'Paula', 'Theresia', 'Elfriede', 'Liselotte', 'Käthi',
    'Marguerite', 'Jeanne', 'Madeleine', 'Simone', 'Odette', 'Yvonne', 'Giovanna', 'Lucia', 'Maria', 'Carla',
  ],
  m: [
    'Hans', 'Walter', 'Ernst', 'Fritz', 'Kurt', 'Werner', 'Paul', 'Max', 'Peter', 'Josef',
    'Karl', 'Otto', 'Rudolf', 'Heinz', 'Alfred', 'Robert', 'Willi', 'Emil', 'Jakob', 'Albert',
    'Arnold', 'Oskar', 'Bruno', 'Anton', 'Franz', 'Hermann', 'Gottfried', 'Eduard', 'Adolf', 'Alois',
    'Konrad', 'Gustav', 'Heinrich', 'Theodor', 'Ueli', 'Hansruedi', 'Edwin', 'Viktor', 'Armin', 'Erwin',
    'Jean', 'Pierre', 'André', 'Marcel', 'Roger', 'Georges', 'Giuseppe', 'Mario', 'Renato', 'Carlo',
  ],
}

/** Vornamen der Jahrgänge 1965–2005 */
export const STAFF_FIRST: Record<Sex, readonly string[]> = {
  f: [
    'Laura', 'Sarah', 'Nina', 'Lea', 'Julia', 'Sandra', 'Nicole', 'Simone', 'Andrea', 'Jasmin',
    'Melanie', 'Fabienne', 'Céline', 'Michelle', 'Selina', 'Elena', 'Aline', 'Chiara', 'Ana', 'Martina',
    'Corinne', 'Sabrina', 'Tamara', 'Vanessa', 'Manuela', 'Barbara', 'Claudia', 'Petra', 'Daniela', 'Mirjam',
    'Noémie', 'Giulia', 'Alessia', 'Sofia', 'Lara', 'Anja', 'Jessica', 'Natascha', 'Ivana', 'Fatima',
  ],
  m: [
    'Lukas', 'David', 'Marco', 'Daniel', 'Michael', 'Patrick', 'Simon', 'Thomas', 'Fabian', 'Luca',
    'Nico', 'Kevin', 'Stefan', 'Adrian', 'Raphael', 'Samuel', 'Jonas', 'Ivan', 'Dario', 'Matthias',
    'Reto', 'Beat', 'Urs', 'Christian', 'Pascal', 'Florian', 'Julien', 'Mathieu', 'Alessandro', 'Tim',
  ],
}

export const LAST_NAMES: readonly string[] = [
  'Müller', 'Meier', 'Schmid', 'Keller', 'Weber', 'Huber', 'Schneider', 'Meyer', 'Steiner', 'Fischer',
  'Gerber', 'Brunner', 'Baumann', 'Frei', 'Zimmermann', 'Moser', 'Widmer', 'Wyss', 'Graf', 'Roth',
  'Suter', 'Baumgartner', 'Bachmann', 'Studer', 'Bühler', 'Kälin', 'Lehmann', 'Hofmann', 'Marti', 'Kunz',
  'Arnold', 'Bieri', 'Sutter', 'Christen', 'Egli', 'Hess', 'Lüthi', 'Ammann', 'Wüthrich', 'Zürcher',
  'Kaufmann', 'Hug', 'Furrer', 'Zbinden', 'Bucher', 'Iseli', 'Rüegg', 'Imhof', 'Schürch', 'Stalder',
  'Wenger', 'Aebischer', 'Gasser', 'Kohler', 'Häfliger', 'Schwarz', 'Vogel', 'Frey', 'Hürlimann', 'Odermatt',
  'Bosshard', 'Rochat', 'Favre', 'Bernasconi', 'Rossi', 'Monnier', 'Perrin', 'Bianchi', 'Fontana', 'Ferrari',
  'Dubois', 'Mathys', 'Probst', 'Siegenthaler', 'Tanner', 'Wälti', 'Zaugg', 'Schär', 'Ryf', 'Blaser',
]
