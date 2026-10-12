import type { CSSProperties } from "react";
import { suggestFunctions, type Area } from "@/lib/office/formula";
import type { SheetChart, SheetName } from "@/lib/office/model";
import type { Edges, RuleLook } from "@/lib/office/sheet-features";

// Gemeinsame Bausteine des Tabellen-Editors (Werkzeugleiste, Raster, Druck).
export type Dialog =
  | { kind: "rules" }
  | { kind: "validation" }
  | { kind: "chart"; chart: SheetChart | null }
  | { kind: "names" }
  | { kind: "page" }
  | { kind: "pivot"; editing: boolean }
  | null;

// Rahmenlinien als innere Schatten (sie verschieben das Raster nicht).
export function edgeShadow(edges: Edges | null) {
  if (!edges) return undefined;
  const parts: string[] = [];
  if (edges.top) parts.push(`inset 0 ${edges.top.width}px 0 ${edges.top.color}`);
  if (edges.bottom) parts.push(`inset 0 -${edges.bottom.width}px 0 ${edges.bottom.color}`);
  if (edges.left) parts.push(`inset ${edges.left.width}px 0 0 ${edges.left.color}`);
  if (edges.right) parts.push(`inset -${edges.right.width}px 0 0 ${edges.right.color}`);
  return parts.join(", ");
}

export const sameArea = (a: Area, b: Area) => a.c1 === b.c1 && a.r1 === b.r1 && a.c2 === b.c2 && a.r2 === b.r2;
export const OPERATOR_END = /[=(;,+\-*/^&<>:]$/;

export function lowerBound(tops: number[], y: number) {
  let lo = 0;
  let hi = tops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Aktuelle Funktion (für die Hilfe zur Schreibweise) und angefangener Funktionsname (für Vorschläge).
export function formulaContext(value: string) {
  if (!value.startsWith("=")) return { typing: null as string | null, inside: null as string | null };
  const typing = /(?:^=|[=(;,+\-*/^&<>:\s])([A-Za-zÄÖÜäöü][A-Za-zÄÖÜäöü0-9.]*)$/.exec(value)?.[1] ?? null;
  const stack: string[] = [];
  let quoted = false;
  let word = "";
  for (const char of value.slice(1)) {
    if (char === '"') quoted = !quoted;
    if (quoted) continue;
    if (/[A-Za-zÄÖÜäöü0-9.]/.test(char)) word += char;
    else {
      if (char === "(") stack.push(word.toUpperCase());
      else if (char === ")") stack.pop();
      word = "";
    }
  }
  return { typing, inside: stack[stack.length - 1] ?? null };
}

export function formulaSuggestions(names: SheetName[] | undefined, typed: string) {
  const upper = typed.toUpperCase();
  const named = (names ?? [])
    .filter((entry) => entry.name.toUpperCase().startsWith(upper))
    .slice(0, 4)
    .map((entry) => ({
      name: entry.name,
      text: `Benannter Bereich: ${entry.sheet}!${entry.range}`,
      english: undefined,
    }));
  return [...named, ...suggestFunctions(typed)].slice(0, 8);
}

// Datenbalken der bedingten Formatierung als Hintergrund der Zelle (wie in Excel, Text bleibt darüber lesbar).
export function barStyle(rule: RuleLook | undefined): CSSProperties {
  if (!rule?.bar) return {};
  const percent = Math.round(rule.bar.size * 1000) / 10;
  return {
    backgroundImage: `linear-gradient(to right, ${rule.bar.color} 0, ${rule.bar.color}99 ${percent}%, transparent ${percent}%)`,
    backgroundSize: "100% 72%",
    backgroundPosition: "left center",
    backgroundRepeat: "no-repeat",
  };
}
