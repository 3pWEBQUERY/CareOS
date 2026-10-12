"use client";

import { useState } from "react";
import { EditorDialog, requestJson } from "@/app/components/workspace-ui";
import { POST_IMPORTANCE, type Post, type PostImportance, type TeamNewsPayload } from "@/lib/team-news-shared";
import { ScheduleSelect } from "@/app/betrieb/components/operations-ui";

export function PostEditor({
  data,
  post,
  channelId,
  onClose,
  onSaved,
}: {
  data: TeamNewsPayload;
  post: Post | null;
  channelId: string | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const writable = data.channels.filter((channel) => channel.canPost);
  const [channel, setChannel] = useState(
    post?.channelId ?? writable.find((c) => c.id === channelId)?.id ?? writable[0]?.id ?? "",
  );
  const [title, setTitle] = useState(post?.title ?? "");
  const [body, setBody] = useState(post?.body ?? "");
  const [importance, setImportance] = useState<PostImportance>(post?.importance ?? "normal");
  const [requiresAck, setRequiresAck] = useState(post?.requiresAck ?? false);
  const [pinned, setPinned] = useState(post?.pinned ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const channelName = data.channels.find((c) => c.id === channel)?.name ?? "Kanal wählen";
  return (
    <EditorDialog
      id="post-editor"
      eyebrow="Team · Neuigkeiten"
      title={post ? "Beitrag bearbeiten" : "Beitrag erstellen"}
      description="Teile eine Information mit deinem Arbeitsbereich. Dringende Beiträge und Lesebestätigungen benachrichtigen alle Mitglieder des Kanals."
      onClose={onClose}
      onSubmit={async () => {
        setSaving(true);
        setError("");
        try {
          if (post)
            await requestJson(`/api/team-news/posts/${post.id}`, {
              method: "POST",
              body: { action: "edit", title, body, importance, requiresAck },
            });
          else
            await requestJson("/api/team-news", {
              method: "POST",
              body: { channelId: channel, title, body, importance, requiresAck, pinned },
            });
          onSaved(post ? "Beitrag gespeichert" : `Beitrag in „${channelName}“ veröffentlicht`);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
          setSaving(false);
        }
      }}
      saving={saving}
      error={error}
      submitLabel={post ? "Speichern" : "Veröffentlichen"}
    >
      {!post && (
        <label>
          <span>Kanal</span>
          <ScheduleSelect
            label="Kanal"
            value={channelName}
            options={writable.map((c) => c.name)}
            onChange={(name) => setChannel(writable.find((c) => c.name === name)?.id ?? "")}
          />
        </label>
      )}
      <label>
        <span>Einordnung</span>
        <ScheduleSelect
          label="Einordnung"
          value={POST_IMPORTANCE[importance].label}
          options={Object.values(POST_IMPORTANCE).map((i) => i.label)}
          onChange={(label) =>
            setImportance(
              (Object.keys(POST_IMPORTANCE) as PostImportance[]).find((key) => POST_IMPORTANCE[key].label === label) ??
                "normal",
            )
          }
        />
      </label>
      <label className="area-editor-wide">
        <span>Titel</span>
        <input value={title} maxLength={180} required autoFocus onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="area-editor-wide">
        <span>Beitrag</span>
        <textarea
          rows={7}
          maxLength={10000}
          required
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Was sollen alle wissen? Was ändert sich, ab wann, was ist zu tun?"
        />
      </label>
      <fieldset className="area-editor-wide duty-assignment-options">
        <legend>Optionen</legend>
        <div className="area-service-options">
          <label className={requiresAck ? "selected" : ""}>
            <input type="checkbox" checked={requiresAck} onChange={(event) => setRequiresAck(event.target.checked)} />
            <span>Lesebestätigung verlangen</span>
          </label>
          {data.canManage && !post && (
            <label className={pinned ? "selected" : ""}>
              <input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />
              <span>Oben anheften</span>
            </label>
          )}
        </div>
      </fieldset>
    </EditorDialog>
  );
}
