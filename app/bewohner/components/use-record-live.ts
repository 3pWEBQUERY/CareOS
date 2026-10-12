"use client";

import { useMemo } from "react";
import { formatDateTime, useApiData } from "@/app/components/workspace-ui";
import type { AssessmentResult } from "@/lib/assessments";
import type { CareGoal } from "@/lib/care-planning-shared";
import type { CareRecordDetail } from "@/lib/care-records-shared";
import type { DocEntry } from "@/lib/documentation-shared";
import type { RecordSummary, ResidentFile, TimelineEntry } from "@/lib/resident-record-shared";
import type { CareDomain, DocumentationEntry, HistoryEntry, ResidentRecordData } from "./resident-record-data";

const dayLabel = (value: string) =>
  new Date(value).toLocaleDateString("de-CH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Zurich",
  });
const timeLabel = (value: string) =>
  new Date(value).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" });

export const toDocumentationEntry = (entry: DocEntry): DocumentationEntry => ({
  id: entry.id,
  time: formatDateTime(entry.occurredAt),
  title: entry.amendedFromId ? `${entry.category} · Nachtrag` : entry.category,
  text: entry.body,
  author: entry.author ?? "Unbekannt",
  category: entry.category,
});

// Care domains of the record are the active goals of the open care plan grouped by category.
function domainsOf(goals: CareGoal[]): CareDomain[] {
  const byCategory = new Map<string, CareGoal[]>();
  for (const goal of goals.filter((item) => item.status === "active"))
    byCategory.set(goal.category, [...(byCategory.get(goal.category) ?? []), goal]);
  return [...byCategory.entries()].map(([category, items]) => {
    const due = items.some((goal) => goal.reviewDue);
    return {
      id: category,
      label: category,
      status: due ? "attention" : "stable",
      statusLabel: due ? "Evaluation fällig" : "Aktiv",
      summary: items[0].problem ?? items[0].statement,
      goal: items.map((goal) => goal.statement).join(" · "),
      measures: items.flatMap((goal) =>
        goal.interventions
          .filter((item) => item.status === "active")
          .map((item) => `${item.title}${item.frequency ? ` · ${item.frequency}` : ""}`),
      ),
      targetDate:
        items
          .map((goal) => goal.targetDate)
          .filter(Boolean)
          .sort()[0] ?? null,
    };
  });
}

// Everything the resident record shows, loaded from the database.
export function useRecordLive(resident: ResidentRecordData) {
  const id = resident.id ?? null;
  const summary = useApiData<RecordSummary>(id ? `/api/residents/${id}/record` : null);
  const documentation = useApiData<{ entries: DocEntry[]; canWrite: boolean }>(
    id ? `/api/documentation?residentId=${id}&days=30` : null,
  );
  const care = useApiData<CareRecordDetail>(id ? `/api/care-records/${id}` : null);
  const timeline = useApiData<{ entries: TimelineEntry[] }>(id ? `/api/residents/${id}/timeline` : null);
  const files = useApiData<{ documents: ResidentFile[]; canWrite: boolean }>(
    id ? `/api/residents/${id}/documents` : null,
  );
  const assessments = useApiData<{ results: AssessmentResult[] }>(id ? `/api/assessments/residents/${id}` : null);

  const docEntries = useMemo(() => documentation.data?.entries ?? [], [documentation.data]);
  const entries = useMemo(() => docEntries.map(toDocumentationEntry), [docEntries]);
  const careDomains = useMemo(() => domainsOf(care.data?.plan?.goals ?? []), [care.data]);
  const historyEntries = useMemo(
    (): HistoryEntry[] =>
      (timeline.data?.entries ?? []).map((entry) => ({
        id: entry.id,
        date: dayLabel(entry.occurredAt),
        time: timeLabel(entry.occurredAt),
        occurredAt: entry.occurredAt,
        category: entry.category,
        title: entry.title,
        description: entry.description,
        author: entry.author ?? "",
        tone: entry.tone,
        documentationId: entry.documentationId ?? undefined,
      })),
    [timeline.data],
  );
  // Latest result per instrument.
  const latestAssessments = useMemo(() => {
    const seen = new Set<string>();
    return (assessments.data?.results ?? []).filter((result) => !seen.has(result.code) && seen.add(result.code));
  }, [assessments.data]);

  return {
    summary,
    documentation,
    docEntries,
    entries,
    care,
    careDomains,
    timeline,
    historyEntries,
    files,
    latestAssessments,
    reloadDocumentation: () => {
      documentation.reload();
      timeline.reload();
    },
  };
}
