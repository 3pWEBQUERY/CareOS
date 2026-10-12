"use client";

import { useEffect, useRef, useState } from "react";
import { WebMCPContext, DashboardTask, DashboardResident } from "./dashboard-shared";

export function useDashboardTasks({
  primaryCareUnitName,
  setToast,
}: {
  primaryCareUnitName: string;
  setToast: (message: string) => void;
}) {
  const [tasks, setTasks] = useState<DashboardTask[]>([]);
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  const [assignedResidents, setAssignedResidents] = useState<DashboardResident[]>([]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch("/api/tasks?scope=mine", { cache: "no-store" }),
      fetch("/api/residents", { cache: "no-store" }),
    ])
      .then(async ([tasksResponse, residentsResponse]) => {
        if (!tasksResponse.ok || !residentsResponse.ok)
          throw new Error("Dashboard-Daten konnten nicht geladen werden.");
        const taskData = (await tasksResponse.json()) as {
          tasks: Array<{
            id: string;
            title: string;
            residentName: string | null;
            dueAt: string | null;
            status: string;
            overdue: boolean;
          }>;
        };
        const residentData = (await residentsResponse.json()) as {
          residents: Array<{
            id: string;
            first_name: string;
            last_name: string;
            room: string;
            care_unit: string;
            note: string;
            severity: string;
            status: string;
          }>;
        };
        if (!active) return;
        setTasks(
          taskData.tasks
            .filter((item) => item.status !== "cancelled")
            .map((item) => ({
              id: item.id,
              title: item.title,
              resident: item.residentName ?? "",
              dueAt: item.dueAt,
              time: item.dueAt
                ? new Date(item.dueAt).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })
                : "—",
              completed: ["completed", "partial", "skipped"].includes(item.status),
              overdue: item.overdue,
            })),
        );
        setAssignedResidents(
          residentData.residents
            .filter(
              (item) => item.status === "active" && (!primaryCareUnitName || item.care_unit === primaryCareUnitName),
            )
            .map((item) => ({
              id: item.id,
              initials: `${item.first_name[0] ?? ""}${item.last_name[0] ?? ""}`,
              name: `${item.first_name} ${item.last_name}`,
              room: item.room || "Zimmer offen",
              risk: item.note,
              critical: item.severity === "critical",
            })),
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [primaryCareUnitName]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: WebMCPContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const completeTask = {
      name: "complete_shift_task",
      title: "Schichtaufgabe abschliessen",
      description: "Markiert eine sichtbare Aufgabe der aktuellen Schicht als erledigt.",
      inputSchema: {
        type: "object",
        properties: { taskId: { type: "string", format: "uuid" } },
        required: ["taskId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input: unknown) {
        const taskId = (input as { taskId?: unknown })?.taskId;
        const task = tasksRef.current.find((item) => item.id === taskId);
        if (!task || typeof taskId !== "string") throw new Error("Unbekannte Aufgaben-ID");
        const response = await fetch("/api/tasks", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: taskId, completed: true }),
        });
        if (!response.ok) throw new Error("Aufgabe konnte nicht gespeichert werden");
        setTasks((current) => current.map((item) => (item.id === taskId ? { ...item, completed: true } : item)));
        setToast(`„${task.title}“ als erledigt markiert`);
        return { taskId, status: "completed" };
      },
    };
    try {
      void Promise.resolve(context.registerTool(completeTask, { signal: lifecycle.signal })).catch(() => undefined);
    } catch {
      return () => lifecycle.abort();
    }
    return () => lifecycle.abort();
  }, [setToast]);

  async function toggleTask(id: string) {
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    const response = await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, completed: !task.completed }),
    });
    if (!response.ok) {
      setToast("Aufgabe konnte nicht gespeichert werden");
      return;
    }
    setTasks((current) => current.map((item) => (item.id === id ? { ...item, completed: !item.completed } : item)));
    if (!task.completed) setToast(`„${task.title}“ als erledigt markiert`);
  }
  return { tasks, setTasks, tasksRef, assignedResidents, setAssignedResidents, toggleTask };
}
