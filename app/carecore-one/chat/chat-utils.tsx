"use client";

import { Fragment, type ReactNode } from "react";

export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

const zurich = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", ...options });
const dayKey = (value: string | Date) =>
  zurich({ year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));

export const time = (value: string) => zurich({ hour: "2-digit", minute: "2-digit" }).format(new Date(value));

// „Heute“, „Gestern“, Wochentag (letzte Woche) oder Datum – wie in einem Chat üblich.
export function dayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  if (dayKey(date) === dayKey(today)) return "Heute";
  if (dayKey(date) === dayKey(new Date(today.getTime() - 86_400_000))) return "Gestern";
  if (today.getTime() - date.getTime() < 6 * 86_400_000) return zurich({ weekday: "long" }).format(date);
  return zurich({ weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export const sameDay = (a: string, b: string) => dayKey(a) === dayKey(b);

// Kurze Zeit in der Chatliste: Uhrzeit heute, sonst Datum.
export function listTime(value: string) {
  if (sameDay(value, new Date().toISOString())) return time(value);
  const date = new Date(value);
  if (Date.now() - date.getTime() < 6 * 86_400_000) return zurich({ weekday: "short" }).format(date);
  return zurich({ day: "2-digit", month: "2-digit" }).format(date);
}

const URL_PATTERN = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?"'])/;

// Text einer Nachricht: **fett**, _kursiv_, Aufzählungen („- “), Links und @Erwähnungen von Mitgliedern.
export function RichText({ text, names }: { text: string; names: string[] }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = (key: number) => {
    if (!list.length) return;
    blocks.push(
      <ul key={`list-${key}`}>
        {list.map((item, index) => (
          <li key={index}>{inline(item, names)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  lines.forEach((line, index) => {
    const bullet = /^\s*[-•*]\s+(.*)$/.exec(line);
    if (bullet) {
      list.push(bullet[1]);
      return;
    }
    flush(index);
    blocks.push(<p key={index}>{line ? inline(line, names) : " "}</p>);
  });
  flush(lines.length);
  return <>{blocks}</>;
}

function inline(text: string, names: string[]) {
  const sorted = [...names, "alle"].sort((a, b) => b.length - a.length);
  const escaped = sorted.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(
    `(@(?:${escaped.join("|")})(?![\\p{L}\\p{N}-]))|(\\*\\*[^*\\n]+\\*\\*)|(_[^_\\n]+_)|${URL_PATTERN.source}`,
    "giu",
  );
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(<Fragment key={`t${last}`}>{text.slice(last, index)}</Fragment>);
    const [token, mention, bold, italic, url] = match;
    if (mention)
      parts.push(
        <strong className="chat-mention" key={index}>
          {token}
        </strong>,
      );
    else if (bold) parts.push(<strong key={index}>{bold.slice(2, -2)}</strong>);
    else if (italic) parts.push(<em key={index}>{italic.slice(1, -1)}</em>);
    else if (url)
      parts.push(
        <a key={index} href={url} target="_blank" rel="noreferrer noopener">
          {url}
        </a>,
      );
    last = index + token.length;
  }
  if (last < text.length) parts.push(<Fragment key={`t${last}`}>{text.slice(last)}</Fragment>);
  return parts;
}

// Markierung im Eingabefeld umschliessen (Fett, Kursiv) bzw. Zeilen als Aufzählung.
export function wrapSelection(
  area: HTMLTextAreaElement,
  value: string,
  kind: "bold" | "italic" | "list",
): { value: string; start: number; end: number } {
  const start = area.selectionStart;
  const end = area.selectionEnd;
  const selected = value.slice(start, end);
  if (kind === "list") {
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const block = value.slice(lineStart, end) || "";
    const listed = (block || "")
      .split("\n")
      .map((line) => (line.startsWith("- ") ? line : `- ${line}`))
      .join("\n");
    const next = value.slice(0, lineStart) + listed + value.slice(end);
    return { value: next, start: lineStart + listed.length, end: lineStart + listed.length };
  }
  const marker = kind === "bold" ? "**" : "_";
  const inner = selected || (kind === "bold" ? "fett" : "kursiv");
  const next = `${value.slice(0, start)}${marker}${inner}${marker}${value.slice(end)}`;
  return { value: next, start: start + marker.length, end: start + marker.length + inner.length };
}
