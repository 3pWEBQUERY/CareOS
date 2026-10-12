"use client";

import { LoadError, ReasonDialog, requestJson, type ShowToast } from "@/app/components/workspace-ui";
import { type TeamNewsPayload } from "@/lib/team-news-shared";
import { Dialog } from "./news-utils";
import { PostEditor } from "./post-editor";
import { ChannelEditor } from "./channel-editor";
import { useNewsView } from "./use-news-view";
import { NewsSummary } from "./news-summary";
import { NewsFeed } from "./news-feed";
import { NewsSidebar } from "./news-sidebar";

export function NewsView(props: {
  showToast: ShowToast;
  dialog: Dialog | null;
  setDialog: (dialog: Dialog | null) => void;
  onData: (data: TeamNewsPayload | undefined, channelId: string | null) => void;
}) {
  const r = useNewsView(props);
  const { showToast, dialog, setDialog, channelId, setChannelId, news, reload, data } = r;
  return (
    <>
      <NewsSummary r={r} />
      {news.error && <LoadError message={news.error} onRetry={reload} />}
      <div className="team-layout team-news-layout">
        <NewsFeed r={r} />
        <NewsSidebar r={r} />
      </div>
      {data && dialog?.kind === "post" && (
        <PostEditor
          data={data}
          post={dialog.post}
          channelId={channelId}
          onClose={() => setDialog(null)}
          onSaved={(message) => {
            setDialog(null);
            showToast(message);
            reload();
          }}
        />
      )}
      {data && dialog?.kind === "channel" && (
        <ChannelEditor
          data={data}
          onClose={() => setDialog(null)}
          onSaved={(message, id) => {
            setDialog(null);
            showToast(message);
            setChannelId(id);
          }}
        />
      )}
      {dialog?.kind === "archive" && (
        <ReasonDialog
          eyebrow="Team · Neuigkeiten"
          title="Beitrag archivieren"
          description={`„${dialog.post.title}“ wird aus dem Feed entfernt, bleibt aber im Protokoll nachvollziehbar.`}
          label="Grund"
          placeholder="z. B. veraltet, versehentlich veröffentlicht"
          submitLabel="Archivieren"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await requestJson(`/api/team-news/posts/${dialog.post.id}`, {
              method: "POST",
              body: { action: "archive", reason },
            });
            setDialog(null);
            showToast("Beitrag archiviert");
            reload();
          }}
        />
      )}
    </>
  );
}
