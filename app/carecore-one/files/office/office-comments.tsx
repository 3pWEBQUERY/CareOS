"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowCounterClockwise, Check, ChatCircleText, Trash, X } from "@phosphor-icons/react";
import { initials, type CommentReply, type CommentThread } from "@/lib/office/comments";
import { newId } from "@/lib/office/model";

// Seitenleiste „Kommentare“ für Dokument, Tabelle und Präsentation: neuer Kommentar zur Auswahl, Antworten,
// erledigt/wieder öffnen und Löschen. Die Editoren liefern Ort und Bezeichnung (Textstelle, Zelle, Folie).

export type PanelThread = { thread: CommentThread; label: string; missing?: boolean };

const formatDate = (iso: string) =>
  iso ? new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "";

export const newComment = (author: string, text: string): CommentThread => ({
  id: newId(),
  author,
  date: new Date().toISOString(),
  text,
  replies: [],
});
export const newReply = (author: string, text: string): CommentReply => ({
  id: newId(),
  author,
  date: new Date().toISOString(),
  text,
});

function Entry({
  entry,
  user,
  readOnly,
  onDelete,
}: {
  entry: CommentReply;
  user: string;
  readOnly: boolean;
  onDelete?: () => void;
}) {
  return (
    <div className="office-comment-entry">
      <span className="office-comment-avatar" aria-hidden="true">
        {initials(entry.author)}
      </span>
      <div className="office-comment-body">
        <p className="office-comment-meta">
          <strong>{entry.author || "Unbekannt"}</strong>
          {entry.date && <time dateTime={entry.date}>{formatDate(entry.date)}</time>}
        </p>
        <p className="office-comment-text">{entry.text}</p>
      </div>
      {!readOnly && onDelete && entry.author === user && (
        <button
          type="button"
          className="office-comment-icon danger"
          aria-label={`Kommentar von ${entry.author} löschen`}
          data-tip="Löschen"
          onClick={onDelete}
        >
          <Trash aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function ReplyBox({ onSend, onCancel }: { onSend: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => field.current?.focus(), []);
  const send = () => {
    if (text.trim()) onSend(text.trim());
  };
  return (
    <div className="office-comment-reply">
      <textarea
        ref={field}
        rows={2}
        value={text}
        maxLength={2000}
        aria-label="Antwort"
        placeholder="Antworten …"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            send();
          }
          if (event.key === "Escape") onCancel();
        }}
      />
      <div className="office-comment-actions">
        <button type="button" onClick={onCancel}>
          Abbrechen
        </button>
        <button type="button" className="primary" disabled={!text.trim()} onClick={send}>
          Antworten
        </button>
      </div>
    </div>
  );
}

export function CommentsPanel({
  threads,
  user,
  readOnly,
  draft,
  active,
  onCreate,
  onCancelDraft,
  onChange,
  onDelete,
  onSelect,
  onClose,
}: {
  threads: PanelThread[];
  user: string;
  readOnly: boolean;
  // Neuer Kommentar zu dieser Stelle (z. B. „Zelle B2“), null wenn keiner angelegt wird.
  draft: string | null;
  active: string | null;
  onCreate: (text: string) => void;
  onCancelDraft: () => void;
  onChange: (thread: CommentThread) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const draftField = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (draft !== null) draftField.current?.focus();
  }, [draft]);
  useEffect(() => {
    if (!active) return;
    list.current
      ?.querySelector<HTMLElement>(`[data-thread="${CSS.escape(active)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const resolvedCount = threads.filter((item) => item.thread.resolved).length;
  const shown = threads.filter((item) => showResolved || !item.thread.resolved || item.thread.id === active);
  const create = () => {
    if (!text.trim()) return;
    onCreate(text.trim());
    setText("");
  };
  return (
    <aside className="office-comments" aria-label="Kommentare">
      <header>
        <h2>
          <ChatCircleText aria-hidden="true" /> Kommentare
          <span className="office-comments-count">{threads.length - resolvedCount}</span>
        </h2>
        <button type="button" className="office-comment-icon" aria-label="Kommentare schliessen" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </header>
      {draft !== null && !readOnly && (
        <div className="office-comment-draft">
          <p className="office-comment-anchor">{draft}</p>
          <textarea
            ref={draftField}
            rows={3}
            value={text}
            maxLength={2000}
            aria-label="Neuer Kommentar"
            placeholder="Kommentar schreiben … (Ctrl+Enter sendet)"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                create();
              }
              if (event.key === "Escape") {
                setText("");
                onCancelDraft();
              }
            }}
          />
          <div className="office-comment-actions">
            <button
              type="button"
              onClick={() => {
                setText("");
                onCancelDraft();
              }}
            >
              Abbrechen
            </button>
            <button type="button" className="primary" disabled={!text.trim()} onClick={create}>
              Kommentar senden
            </button>
          </div>
        </div>
      )}
      {resolvedCount > 0 && (
        <button
          type="button"
          className={`office-toggle office-comments-filter ${showResolved ? "active" : ""}`}
          aria-pressed={showResolved}
          onClick={() => setShowResolved((value) => !value)}
        >
          Erledigte anzeigen ({resolvedCount})
        </button>
      )}
      <div ref={list} className="office-comments-list">
        {shown.length === 0 && draft === null && (
          <p className="office-comments-empty">
            {threads.length ? "Alle Kommentare sind erledigt." : "Noch keine Kommentare."}
          </p>
        )}
        {shown.map(({ thread, label, missing }) => (
          <article
            key={thread.id}
            data-thread={thread.id}
            className={`office-comment ${thread.id === active ? "active" : ""} ${thread.resolved ? "resolved" : ""}`}
            aria-label={`Kommentar von ${thread.author || "Unbekannt"}`}
          >
            <button type="button" className="office-comment-anchor" onClick={() => onSelect(thread.id)}>
              {missing ? `${label} (Textstelle gelöscht)` : label}
            </button>
            <Entry entry={thread} user={user} readOnly={readOnly} onDelete={() => onDelete(thread.id)} />
            {thread.replies.map((reply) => (
              <Entry
                key={reply.id}
                entry={reply}
                user={user}
                readOnly={readOnly}
                onDelete={() => onChange({ ...thread, replies: thread.replies.filter((item) => item.id !== reply.id) })}
              />
            ))}
            {thread.resolved && <p className="office-comment-status">Erledigt</p>}
            {!readOnly &&
              (replyTo === thread.id ? (
                <ReplyBox
                  onCancel={() => setReplyTo(null)}
                  onSend={(value) => {
                    onChange({ ...thread, replies: [...thread.replies, newReply(user, value)] });
                    setReplyTo(null);
                  }}
                />
              ) : (
                <div className="office-comment-actions">
                  {!thread.resolved && (
                    <button type="button" onClick={() => setReplyTo(thread.id)}>
                      Antworten
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const { resolved, ...rest } = thread;
                      onChange(resolved ? rest : { ...thread, resolved: true });
                    }}
                  >
                    {thread.resolved ? (
                      <>
                        <ArrowCounterClockwise aria-hidden="true" /> Wieder öffnen
                      </>
                    ) : (
                      <>
                        <Check aria-hidden="true" /> Erledigt
                      </>
                    )}
                  </button>
                </div>
              ))}
          </article>
        ))}
      </div>
    </aside>
  );
}
