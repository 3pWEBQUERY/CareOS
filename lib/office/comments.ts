import type { OfficeModel } from "./model";

// Kommentare in Dokument, Tabelle und Präsentation: ein Kommentar mit Antworten (wie in Word, Excel, PowerPoint).
// Sie liegen in der Datei selbst; Name und Zeit setzt beim Speichern der Server (nicht der Browser).

export type CommentReply = { id: string; author: string; date: string; text: string };
export type CommentThread = CommentReply & { resolved?: boolean; replies: CommentReply[] };

export const COMMENT_LIMITS = { text: 2000, replies: 50, threads: 300 };

const clip = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;

function cleanReply(input: unknown): CommentReply | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const text = clip(raw.text, COMMENT_LIMITS.text).trim();
  if (typeof raw.id !== "string" || !ID.test(raw.id) || !text) return null;
  return {
    id: raw.id,
    author: clip(raw.author, 120),
    date: typeof raw.date === "string" && DATE.test(raw.date) ? raw.date : "",
    text,
  };
}

export function cleanThread(input: unknown): CommentThread | null {
  const head = cleanReply(input);
  if (!head) return null;
  const raw = input as Record<string, unknown>;
  const seen = new Set([head.id]);
  const replies = (Array.isArray(raw.replies) ? raw.replies : [])
    .slice(0, COMMENT_LIMITS.replies)
    .map(cleanReply)
    .filter((reply): reply is CommentReply => {
      if (!reply || seen.has(reply.id)) return false;
      seen.add(reply.id);
      return true;
    });
  return { ...head, ...(raw.resolved === true ? { resolved: true } : {}), replies };
}

export const cleanThreads = (input: unknown) =>
  (Array.isArray(input) ? input : [])
    .slice(0, COMMENT_LIMITS.threads)
    .map(cleanThread)
    .filter((thread): thread is CommentThread => thread !== null);

// Neue Einträge bekommen Name und Zeit der Person, die speichert; bestehende behalten Name, Zeit und – wenn sie
// von jemand anderem stammen – auch ihren Text. Erledigt-Markierung und Löschen sind für alle erlaubt.
export function stampThreads(
  previous: CommentThread[],
  next: CommentThread[],
  author: string,
  now: string,
): CommentThread[] {
  const known = new Map<string, CommentReply>();
  for (const thread of previous) {
    known.set(thread.id, thread);
    for (const reply of thread.replies) known.set(reply.id, reply);
  }
  const stamp = (entry: CommentReply): CommentReply => {
    const before = known.get(entry.id);
    if (!before) return { id: entry.id, author, date: now, text: entry.text };
    return {
      id: entry.id,
      author: before.author,
      date: before.date,
      text: before.author === author ? entry.text : before.text,
    };
  };
  return next.map((thread) => ({
    ...stamp(thread),
    ...(thread.resolved ? { resolved: true } : {}),
    replies: thread.replies.map(stamp),
  }));
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

// Alle Kommentare einer Datei, egal wo sie hängen (für den Abgleich beim Speichern).
function threadsOf(model: OfficeModel | null): CommentThread[] {
  if (!model) return [];
  if (model.kind === "document") return model.comments ?? [];
  if (model.kind === "sheet") return model.sheets.flatMap((sheet) => Object.values(sheet.comments ?? {}));
  return model.slides.flatMap((slide) => slide.comments ?? []);
}

// Beim Speichern auf dem Server: Name und Zeit neuer Kommentare setzen, fremde Kommentare unverändert lassen.
export function stampModelComments<T extends OfficeModel>(
  previous: OfficeModel | null,
  next: T,
  author: string,
  now: string,
): T {
  const before = threadsOf(previous);
  const stamp = (threads: CommentThread[]) => stampThreads(before, threads, author, now);
  if (next.kind === "document") return next.comments ? { ...next, comments: stamp(next.comments) } : next;
  if (next.kind === "sheet")
    return {
      ...next,
      sheets: next.sheets.map((sheet) =>
        sheet.comments
          ? {
              ...sheet,
              comments: Object.fromEntries(
                Object.entries(sheet.comments).map(([key, thread]) => [key, stamp([thread])[0]]),
              ),
            }
          : sheet,
      ),
    };
  return {
    ...next,
    slides: next.slides.map((slide) => (slide.comments ? { ...slide, comments: stamp(slide.comments) } : slide)),
  };
}
