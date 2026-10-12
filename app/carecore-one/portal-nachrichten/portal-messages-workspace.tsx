"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import ModulePageShell from "@/app/components/module-page-shell";
import { ModuleIcon } from "@/app/components/module-icon";
import { CareOptionSelect } from "@/app/components/care-form-controls";
import { PortalConversation } from "@/app/components/portal-conversation";
import {
  EditorDialog,
  LoadError,
  formatDateTime,
  requestJson,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import { PORTAL_KINDS, type PortalKind, type PortalThread } from "@/lib/portal-shared";

type Payload = { threads: PortalThread[]; recipients: Array<{ id: string; name: string; kind: PortalKind }> };

// Kommunikation › Portal-Nachrichten: Unterhaltungen mit Angehörigen, Ärztinnen/Ärzten und der Apotheke.
export default function PortalMessagesWorkspace() {
  return (
    <ModulePageShell activeModule="messenger" activeChild="Portal-Nachrichten" pageClass="portal-messages-page">
      {(showToast) => <PortalMessagesBody showToast={showToast} />}
    </ModulePageShell>
  );
}

function PortalMessagesBody({ showToast }: { showToast: ShowToast }) {
  const initial = useSearchParams().get("thread");
  const data = useApiData<Payload>("/api/portal-messages");
  const [selectedId, setSelectedId] = useState<string | null>(initial);
  const threads = data.data?.threads ?? [];
  const selected = selectedId ?? threads[0]?.id ?? null;
  const thread = useApiData<PortalThread>(selected ? `/api/portal-messages/${selected}` : null);
  const [draft, setDraft] = useState<{ accountId: string; subject: string; body: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  return (
    <main className="workspace module-workspace portal-messages">
      <section className="page-heading">
        <div className="heading-copy">
          <p className="eyebrow">Nachrichten</p>
          <h1>Portal-Nachrichten</h1>
          <p>Nachrichten von Angehörigen, Ärztinnen/Ärzten und der Apotheke aus dem Portal beantworten.</p>
        </div>
        <button
          className="primary-button"
          type="button"
          disabled={!data.data?.recipients.length}
          onClick={() => {
            setDraft({ accountId: "", subject: "", body: "" });
            setError("");
          }}
        >
          <ModuleIcon name="plus" className="button-icon" />
          Neue Nachricht
        </button>
      </section>
      {data.error && <LoadError message={data.error} onRetry={data.reload} />}
      <div className="portal-messages-grid">
        <section className="card" aria-label="Unterhaltungen">
          <ul className="portal-thread-list">
            {threads.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className={entry.unread ? "unread" : ""}
                  aria-pressed={entry.id === selected}
                  onClick={() => setSelectedId(entry.id)}
                >
                  <strong>{entry.subject}</strong>
                  <small>
                    {entry.accountName} ({PORTAL_KINDS[entry.accountKind]})
                    {entry.residentName ? ` · ${entry.residentName}` : ""}
                  </small>
                  <small>
                    {formatDateTime(entry.lastMessageAt)} · {entry.lastMessage}
                  </small>
                </button>
              </li>
            ))}
            {data.data && !threads.length && <li className="list-hint">Noch keine Nachrichten aus dem Portal.</li>}
          </ul>
        </section>
        <section className="card">
          {thread.error && <LoadError message={thread.error} onRetry={thread.reload} />}
          {thread.data && (
            <PortalConversation
              thread={thread.data}
              own="staff"
              onReply={async (body) => {
                await requestJson("/api/portal-messages", {
                  method: "POST",
                  body: { threadId: thread.data!.id, body },
                });
                thread.reload();
                data.reload();
                showToast("Antwort gesendet");
              }}
            />
          )}
          {!selected && data.data && <p className="list-hint">Unterhaltung wählen.</p>}
        </section>
      </div>
      {draft && (
        <EditorDialog
          id="portal-message-new"
          eyebrow="Portal-Nachrichten"
          title="Neue Nachricht an einen Portal-Zugang"
          description="Die Nachricht erscheint im Portal unter „Nachrichten“."
          onClose={() => setDraft(null)}
          onSubmit={async () => {
            setSaving(true);
            setError("");
            try {
              const result = await requestJson<{ threadId: string }>("/api/portal-messages", {
                method: "POST",
                body: draft,
              });
              setDraft(null);
              setSelectedId(result.threadId);
              data.reload();
              showToast("Nachricht gesendet");
            } catch (cause) {
              setError((cause as Error).message);
            } finally {
              setSaving(false);
            }
          }}
          saving={saving}
          error={error}
          submitLabel="Senden"
        >
          <label className="area-editor-wide">
            <span>An</span>
            <CareOptionSelect
              label="Portal-Zugang"
              value={draft.accountId}
              options={(data.data?.recipients ?? []).map((entry) => ({
                value: entry.id,
                label: `${entry.name} (${PORTAL_KINDS[entry.kind]})`,
              }))}
              onChange={(value) => setDraft({ ...draft, accountId: value })}
            />
          </label>
          <label className="area-editor-wide">
            <span>Betreff</span>
            <input
              value={draft.subject}
              maxLength={160}
              onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
              required
            />
          </label>
          <label className="area-editor-wide">
            <span>Nachricht</span>
            <textarea
              rows={5}
              value={draft.body}
              maxLength={4000}
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
              required
            />
          </label>
        </EditorDialog>
      )}
    </main>
  );
}
