"use client";

import Link from "next/link";
import { useState } from "react";
import { CareSelect } from "@/app/components/care-form-controls";
import {
  EmptyState,
  LoadError,
  PageHeading,
  SummaryTiles,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import { GOAL_CATEGORIES, type GoalListItem } from "@/lib/care-planning-shared";
import GoalCard from "./goal-card";
import type { PlanningOverview } from "./plan-view";
import { usePlanningDialogs } from "./use-planning-dialogs";

const FILTERS = ["Alle", "Überprüfung fällig", "Meine Bezugspflege", "Ohne Massnahmen"] as const;
const ALL = "Alle Pflegebereiche";

export default function GoalsView({ showToast }: { showToast: ShowToast }) {
  const data = useApiData<{ goals: GoalListItem[]; currentUserId: string; canWrite: boolean }>(
    "/api/care-planning/goals",
  );
  const overview = useApiData<PlanningOverview>("/api/care-planning");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Alle");
  const [category, setCategory] = useState(ALL);
  const goals = data.data?.goals ?? [];
  const planning = usePlanningDialogs({
    staff: overview.data?.staff ?? [],
    showToast,
    onChanged: data.reload,
    residentNameOf: (goal) => goals.find((g) => g.id === goal.id)?.residentName ?? "",
  });
  const filtered = goals.filter(
    (goal) =>
      (category === ALL || goal.category === category) &&
      (filter === "Alle" ||
        (filter === "Überprüfung fällig" && goal.reviewDue) ||
        (filter === "Meine Bezugspflege" && goal.ownerId === data.data?.currentUserId) ||
        (filter === "Ohne Massnahmen" && !goal.interventions.some((i) => i.status === "active"))),
  );
  const categories = [...new Set(goals.map((g) => g.category))];

  return (
    <>
      <PageHeading
        eyebrow="Pflegeplanung"
        title="Ziele & Massnahmen"
        description="Alle aktiven Pflegeziele im Haus – fällige Überprüfungen und fehlende Massnahmen auf einen Blick."
      />
      <SummaryTiles
        label="Pflegeziele im Haus"
        tiles={[
          { icon: "plan", value: goals.length, caption: "aktive Pflegeziele" },
          {
            icon: "calendar",
            value: goals.filter((g) => g.reviewDue).length,
            caption: "Überprüfung fällig",
            tone: "attention",
          },
          {
            icon: "tasks",
            value: goals.reduce((sum, g) => sum + g.interventions.filter((i) => i.status === "active").length, 0),
            caption: "aktive Massnahmen",
          },
          {
            icon: "alert",
            value: goals.filter((g) => !g.interventions.some((i) => i.status === "active")).length,
            caption: "Ziele ohne Massnahme",
            tone: "info",
          },
        ]}
      />
      {data.error && <LoadError message={data.error} onRetry={data.reload} />}
      <section className="card care-goal-filterbar">
        <div className="care-record-filters">
          {FILTERS.map((item) => (
            <button
              key={item}
              type="button"
              className={filter === item ? "active" : ""}
              aria-pressed={filter === item}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <CareSelect
          label="Pflegebereich"
          value={category}
          options={[
            ALL,
            ...GOAL_CATEGORIES.filter((c) => categories.includes(c)),
            ...categories.filter((c) => !(GOAL_CATEGORIES as readonly string[]).includes(c)),
          ]}
          onChange={setCategory}
        />
        <small>
          {filtered.length} von {goals.length} Zielen
        </small>
      </section>
      <div className="care-goal-board">
        {filtered.map((goal) => (
          <GoalCard
            key={goal.id}
            goal={goal}
            actions={data.data?.canWrite ? planning.actions : null}
            heading={
              <p className="care-goal-resident">
                <Link href={`/pflegeplanung?resident=${goal.residentId}`}>{goal.residentName}</Link>
                <span>
                  {[goal.room, goal.ownerName && `Bezugspflege ${goal.ownerName}`].filter(Boolean).join(" · ")}
                </span>
              </p>
            }
          />
        ))}
      </div>
      {!data.loading && !filtered.length && (
        <section className="card">
          <EmptyState
            icon="plan"
            title="Keine Ziele gefunden"
            text={goals.length ? "Filter anpassen." : "Es sind noch keine aktiven Pflegeziele erfasst."}
          />
        </section>
      )}
      {data.loading && !data.data && <p className="list-hint">Pflegeziele werden geladen …</p>}
      {planning.dialogs}
    </>
  );
}
