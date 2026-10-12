"use client";

import { useState } from "react";
import type { PortalThread } from "@/lib/portal-shared";

const when = (value: string) =>
  new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", dateStyle: "short", timeStyle: "short" }).format(
    new Date(value),
  );

// Verlauf einer Unterhaltung zwischen Portal und Pflege mit Antwortfeld (Portal und Pflege verwenden dieselbe
// Ansicht; `own` ist die eigene Seite, deren Nachrichten rechts erscheinen).
export function PortalConversation({
  thread,
  own,
  onReply,
}: {
  thread: PortalThread;
  own: "portal" | "staff";
  onReply: (body: string) => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="portal-conversation" aria-label={`Unterhaltung ${thread.subject}`}>
      <header>
        <strong>{thread.subject}</strong>
        <small>
          {[thread.residentName, own === "staff" ? thread.accountName : null].filter(Boolean).join(" · ") ||
            "Allgemein"}
        </small>
      </header>
      <ol className="portal-conversation-messages">
        {(thread.messages ?? []).map((message) => (
          <li key={message.id} className={message.sender === own ? "own" : ""}>
            <small>
              {message.senderName} · {when(message.createdAt)}
            </small>
            <p translate="no">{message.body}</p>
          </li>
        ))}
      </ol>
      <form
        className="portal-conversation-reply"
        onSubmit={async (event) => {
          event.preventDefault();
          setSending(true);
          setError("");
          try {
            await onReply(body);
            setBody("");
          } catch (cause) {
            setError((cause as Error).message);
          } finally {
            setSending(false);
          }
        }}
      >
        <label>
          <span>Antwort</span>
          <textarea rows={3} value={body} maxLength={4000} onChange={(event) => setBody(event.target.value)} />
        </label>
        {error && <p className="portal-error">{error}</p>}
        <button className="primary-button" type="submit" disabled={sending || !body.trim()}>
          {sending ? "Wird gesendet …" : "Senden"}
        </button>
      </form>
    </section>
  );
}
