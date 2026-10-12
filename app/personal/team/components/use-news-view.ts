"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { requestJson, useApiData, type ShowToast } from "@/app/components/workspace-ui";
import { type Channel, type Post, type TeamNewsPayload } from "@/lib/team-news-shared";
import { Filter, Dialog } from "./news-utils";

export function useNewsView({
  showToast,
  dialog,
  setDialog,
  onData,
}: {
  showToast: ShowToast;
  dialog: Dialog | null;
  setDialog: (dialog: Dialog | null) => void;
  onData: (data: TeamNewsPayload | undefined, channelId: string | null) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const deepLink = params.get("post");
  const [channelId, setChannelId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("Alle");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(deepLink);
  const [now] = useState(() => Date.now());
  const news = useApiData<TeamNewsPayload>(`/api/team-news${channelId ? `?channelId=${channelId}` : ""}`);
  const { reload } = news;
  const data = news.data;
  useEffect(() => onData(data, channelId), [data, channelId, onData]);
  useEffect(() => {
    if (deepLink && data) document.getElementById(`post-${deepLink}`)?.scrollIntoView({ block: "center" });
  }, [deepLink, data]);
  useEffect(() => {
    const timer = window.setInterval(reload, 60_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  const run = async (url: string, body: unknown, message?: string) => {
    try {
      await requestJson(url, { method: "POST", body });
      if (message) showToast(message);
      reload();
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
    }
  };

  const select = (post: Post) => {
    const next = selectedId === post.id ? null : post.id;
    setSelectedId(next);
    if (deepLink) router.replace(pathname, { scroll: false });
    if (next && !post.readAt && !post.requiresAck) void run(`/api/team-news/posts/${post.id}`, { action: "read" });
  };

  const posts = data?.posts ?? [];
  const needle = query.trim().toLocaleLowerCase("de-CH");
  const filtered = posts.filter((post) => {
    if (filter === "Ungelesen" && post.readAt) return false;
    if (filter === "Wichtig" && post.importance === "normal") return false;
    if (filter === "Bestätigung offen" && !(post.requiresAck && !post.acknowledgedAt)) return false;
    if (filter === "Angeheftet" && !post.pinned) return false;
    return (
      !needle ||
      `${post.title} ${post.body} ${post.authorName ?? ""} ${post.channelName}`
        .toLocaleLowerCase("de-CH")
        .includes(needle)
    );
  });
  const channels = data?.channels ?? [];
  const joined = channels.filter((channel) => channel.joined);
  const active = channels.find((channel) => channel.id === channelId) ?? null;
  const tabs: Array<Channel | null> = [null, ...joined, ...(active && !active.joined ? [active] : [])];
  const unread = posts.filter((post) => !post.readAt).length;
  return {
    showToast,
    dialog,
    setDialog,
    onData,
    router,
    pathname,
    params,
    deepLink,
    channelId,
    setChannelId,
    filter,
    setFilter,
    query,
    setQuery,
    selectedId,
    setSelectedId,
    now,
    news,
    reload,
    data,
    run,
    select,
    posts,
    needle,
    filtered,
    channels,
    joined,
    active,
    tabs,
    unread,
  };
}

export type NewsViewState = ReturnType<typeof useNewsView>;
