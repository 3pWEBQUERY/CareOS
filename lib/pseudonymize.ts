// Reine Funktion ohne Datenbank (auch in Unit-Tests).

// Namen von Bewohnenden und Mitarbeitenden der Einrichtung durch Platzhalter ersetzen ([Person 1] …), damit sie das
// Haus nicht verlassen; nach der Antwort werden die Platzhalter wieder durch den ursprünglichen Text ersetzt.
export function pseudonymize(input: string, names: string[]) {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const candidates = [...new Set(names.map((name) => name.trim()).filter((name) => name.length >= 3))].sort(
    (a, b) => b.length - a.length,
  );
  const found = new Map<string, string>();
  let text = input;
  for (const name of candidates) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, "giu");
    text = text.replace(pattern, (match) => {
      const key = [...found.entries()].find(([, original]) => original.toLowerCase() === match.toLowerCase())?.[0];
      if (key) return key;
      const placeholder = `[Person ${found.size + 1}]`;
      found.set(placeholder, match);
      return placeholder;
    });
  }
  const restore = (output: string) => output.replace(/\[Person (\d+)\]/g, (match: string) => found.get(match) ?? match);
  return { text, restore, count: found.size };
}
