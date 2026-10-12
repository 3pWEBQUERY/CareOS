"use client";

import { type ModuleIconName } from "@/app/components/module-icon";
import { type Post } from "@/lib/team-news-shared";

export const FILTERS = ["Alle", "Ungelesen", "Wichtig", "Bestätigung offen", "Angeheftet"] as const;

export type Filter = (typeof FILTERS)[number];

export function postIcon(post: Post): ModuleIconName {
  if (post.importance === "critical") return "alert";
  if (post.requiresAck) return "check";
  if (post.pinned) return "sparkle";
  return "note";
}

export type Dialog = { kind: "post"; post: Post | null } | { kind: "channel" } | { kind: "archive"; post: Post };
