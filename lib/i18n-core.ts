import type { Dictionary } from "@/lib/i18n-shared";

// Übersetzen eines angezeigten Textes anhand des Wörterbuchs (läuft im Browser). Gesucht wird der ganze Text ohne
// Leerraum am Rand; Leerraum bleibt erhalten. Muster (`Stand {0}`) passen mit beliebigem Inhalt an den Platzhaltern,
// der Inhalt wird – wenn er selbst ein bekannter Text ist – ebenfalls übersetzt.

export type CompiledDictionary = {
  strings: Map<string, string>;
  patterns: Array<{ regex: RegExp; target: string }>;
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function compileDictionary(dictionary: Dictionary): CompiledDictionary {
  const patterns = Object.entries(dictionary.patterns)
    .filter(([source, target]) => source && target)
    // Längere feste Teile zuerst: das genauere Muster gewinnt.
    .sort(([a], [b]) => b.replace(/\{\d+\}/g, "").length - a.replace(/\{\d+\}/g, "").length)
    .map(([source, target]) => {
      const order: number[] = [];
      const body = source
        .split(/(\{\d+\})/)
        .map((part) => {
          const slot = /^\{(\d+)\}$/.exec(part);
          if (!slot) return escape(part);
          order.push(Number(slot[1]));
          return "(.+?)";
        })
        .join("");
      const regex = new RegExp(`^${body}$`, "s");
      return {
        regex,
        target: target.replace(/\{(\d+)\}/g, (_, index: string) => `{${order.indexOf(Number(index))}}`),
      };
    });
  return { strings: new Map(Object.entries(dictionary.strings).filter(([, target]) => target)), patterns };
}

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

function lookup(text: string, dictionary: CompiledDictionary, depth = 0): string | null {
  const exact = dictionary.strings.get(text);
  if (exact !== undefined) return exact;
  if (depth > 1) return null;
  for (const pattern of dictionary.patterns) {
    const match = pattern.regex.exec(text);
    if (!match) continue;
    return pattern.target.replace(/\{(\d+)\}/g, (_, index: string) => {
      const value = match[Number(index) + 1] ?? "";
      return lookup(value.trim(), dictionary, depth + 1) ?? value;
    });
  }
  return null;
}

// Übersetzung oder null, wenn der Text unbekannt ist.
export function translateText(text: string, dictionary: CompiledDictionary): string | null {
  const core = normalize(text);
  if (!core || !/\p{L}/u.test(core)) return null;
  const translated = lookup(core, dictionary);
  if (translated === null || translated === core) return null;
  const leading = /^\s*/.exec(text)?.[0] ?? "";
  const trailing = /\s*$/.exec(text)?.[0] ?? "";
  return `${leading}${translated}${trailing}`;
}
