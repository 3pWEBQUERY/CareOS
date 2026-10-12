"use client";

import { useEffect, useState } from "react";
import { DashboardChange, ResidentNews } from "./dashboard-shared";

export function useDashboardNews() {
  const [changes, setChanges] = useState<DashboardChange[]>([]);
  const [residentNews, setResidentNews] = useState<ResidentNews[]>([]);
  const [newsScope, setNewsScope] = useState("Alle Wohnbereiche");
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsError, setNewsError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/dashboard/changes", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as {
          error?: string;
          scope?: string;
          residents?: ResidentNews[];
          changes?: Array<{
            id: string;
            first_name: string;
            last_name: string;
            title: string | null;
            body: string;
            importance: string;
            occurred_at: string;
          }>;
        };
        if (!response.ok) throw new Error(data.error || "Neuigkeiten konnten nicht geladen werden.");
        return data;
      })
      .then((data) => {
        if (!active) return;
        setResidentNews(data.residents ?? []);
        setNewsScope(data.scope ?? "Alle Wohnbereiche");
        setChanges(
          (data.changes ?? []).map((item) => ({
            id: item.id,
            initials: `${item.first_name[0]}${item.last_name[0]}`,
            name: `${item.first_name} ${item.last_name}`,
            note: item.body,
            time: new Date(item.occurred_at).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }),
            type: ["critical", "important"].includes(item.importance)
              ? "critical"
              : item.importance === "observation"
                ? "attention"
                : "info",
            status: item.title || "Dokumentiert",
          })),
        );
        setNewsError("");
      })
      .catch((error) => {
        if (active) setNewsError(error instanceof Error ? error.message : "Neuigkeiten konnten nicht geladen werden.");
      })
      .finally(() => {
        if (active) setNewsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  return {
    changes,
    setChanges,
    residentNews,
    setResidentNews,
    newsScope,
    setNewsScope,
    newsLoading,
    setNewsLoading,
    newsError,
    setNewsError,
  };
}
