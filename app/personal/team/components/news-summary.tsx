"use client";

import { PersonalSummary } from "../../components/personal-ui";
import type { NewsViewState } from "./use-news-view";

export function NewsSummary({ r }: { r: NewsViewState }) {
  const { data } = r;
  return (
    <PersonalSummary
      items={[
        { icon: "note", value: String(data?.stats.postsThisWeek ?? "–"), label: "Beiträge diese Woche" },
        { icon: "team", value: String(data?.stats.joinedChannels ?? "–"), label: "aktive Kanäle", tone: "info" },
        { icon: "alert", value: String(data?.stats.unread ?? "–"), label: "ungelesen", tone: "attention" },
        {
          icon: "check",
          value: data?.stats.reach === null || !data ? "–" : `${data.stats.reach} %`,
          label: "Team erreicht (30 Tage)",
        },
      ]}
    />
  );
}
