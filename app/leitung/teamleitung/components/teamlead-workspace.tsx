"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Archive, CheckCircle, ClipboardText, Plus, UserPlus, UsersThree, WarningCircle } from "@phosphor-icons/react";
import ModulePageShell from "@/app/components/module-page-shell";
import { View, Employee, TeamleadRow, Unit, config, endpointFor } from "./teamlead-utils";
import { TeamleadEmployeeEditor } from "./teamlead-employee-editor";
import { TeamleadForm } from "./teamlead-form";
import { TasksView } from "./teamlead-tasks-view";
import { EmployeesView } from "./teamlead-views";

type TeamleadData = { role: string | null; rows: TeamleadRow[]; employees: Employee[]; units: Unit[] };

async function fetchTeamlead(view: View): Promise<TeamleadData> {
  const [context, result] = await Promise.all([
    fetch("/api/work-context")
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null),
    fetch(endpointFor(view), { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null),
  ]);
  return {
    role: context?.profile?.role ?? null,
    // Die Aufgaben-Antwort enthält zusätzlich die Personen für die Zuweisung: Zeilen sind dort die Aufgaben.
    rows: ((view === "tasks" ? result?.tasks : result?.employees) ?? []) as TeamleadRow[],
    employees: (result?.employees ?? []) as Employee[],
    units: (result?.units ?? []) as Unit[],
  };
}

export default function TeamleadWorkspace({ view }: { view: View }) {
  const [role, setRole] = useState<string | null>(null);
  const [rows, setRows] = useState<TeamleadRow[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<TeamleadRow | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const content = config[view];

  const apply = useCallback((data: TeamleadData) => {
    setRole(data.role);
    setRows(data.rows);
    setEmployees(data.employees);
    setUnits(data.units);
  }, []);
  const load = useCallback(async () => apply(await fetchTeamlead(view)), [apply, view]);

  // Daten des gewählten Arbeitsbereichs laden; eine überholte Antwort (Wechsel des Bereichs) wird verworfen.
  useEffect(() => {
    let current = true;
    void fetchTeamlead(view).then((data) => {
      if (current) apply(data);
    });
    return () => {
      current = false;
    };
  }, [apply, view]);

  const canLead = role === "admin" || role === "leitung";
  const isArchived = useCallback(
    (row: TeamleadRow) => Boolean(row.archived_at || row.status === "cancelled" || row.active === false),
    [],
  );
  const totals = useMemo(
    () => ({
      active: rows.filter((row) => !isArchived(row)).length,
      attention:
        view === "employees"
          ? rows.filter((row) => row.role === "leitung").length
          : rows.filter((row) => row.priority === "high" || row.priority === "critical").length,
      archived: rows.filter(isArchived).length,
    }),
    [isArchived, rows, view],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = form;
    const response = await fetch(endpointFor(view), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice(body.error ?? "Die Änderung konnte nicht gespeichert werden.");
      return;
    }
    setNotice(`${content.title} wurde gespeichert.`);
    setForm({});
    setShowForm(false);
    await load();
  }
  async function updateState(id: string, action: "archive" | "restore") {
    const response = await fetch(endpointFor(view), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    if (!response.ok) {
      setNotice("Die Änderung konnte nicht gespeichert werden.");
      return;
    }
    setNotice(action === "archive" ? "Eintrag wurde archiviert." : "Eintrag wurde wiederhergestellt.");
    await load();
  }
  const metrics =
    view === "employees"
      ? [
          [totals.active, "Aktive Mitarbeitende", "im Team verfügbar"],
          [totals.attention, "Leitungsrollen", "mit erweiterter Berechtigung"],
          [totals.archived, "Archiviert", "nicht im Tagesgeschäft"],
        ]
      : [
          [totals.active, "Aktive Aufgaben", "im Team in Bearbeitung"],
          [totals.attention, "Hohe Priorität", "brauchen heute Fokus"],
          [totals.archived, "Archiviert", "abgeschlossen oder verworfen"],
        ];

  return (
    <ModulePageShell activeModule="teamlead" activeChild={content.title} pageClass="leadership-page">
      {() => (
        <main className="workspace teamlead-workspace">
          <header className="teamlead-hero">
            <div>
              <p className="eyebrow">{content.eyebrow}</p>
              <h1>{content.title}</h1>
              <p>{content.subtitle}</p>
            </div>
            <button className="primary-button teamlead-create" type="button" onClick={() => setShowForm(true)}>
              {view === "employees" ? <UserPlus /> : <Plus />}
              {content.action}
            </button>
          </header>
          {!canLead ? (
            <section className="teamlead-denied">
              <WarningCircle />
              <div>
                <strong>Zugriff beschränkt</strong>
                <p>Dieser Bereich ist ausschließlich für Administratoren und Leitungen verfügbar.</p>
              </div>
            </section>
          ) : (
            <>
              <section className="teamlead-metrics">
                {metrics.map(([value, label, detail], index) => (
                  <article key={label as string}>
                    <span className={`teamlead-metric-icon tone-${index}`}>
                      {index === 0 ? (
                        view === "employees" ? (
                          <UsersThree />
                        ) : (
                          <ClipboardText />
                        )
                      ) : index === 1 ? (
                        <WarningCircle />
                      ) : (
                        <Archive />
                      )}
                    </span>
                    <div>
                      <strong>{value}</strong>
                      <span>{label}</span>
                      <small>{detail}</small>
                    </div>
                  </article>
                ))}
              </section>
              {view === "employees" && (
                <EmployeesView
                  rows={rows}
                  isArchived={isArchived}
                  onUpdate={updateState}
                  onSelect={setSelectedEmployee}
                />
              )}
              {view === "tasks" && <TasksView rows={rows} isArchived={isArchived} onUpdate={updateState} />}
            </>
          )}
          {notice && (
            <p className="teamlead-notice">
              <CheckCircle />
              {notice}
            </p>
          )}
          {showForm && (
            <TeamleadForm
              view={view}
              form={form}
              setForm={setForm}
              units={units}
              employees={employees}
              onClose={() => setShowForm(false)}
              onSubmit={submit}
            />
          )}
          {selectedEmployee && (
            <TeamleadEmployeeEditor
              employee={selectedEmployee}
              units={units}
              onClose={() => setSelectedEmployee(null)}
              onUpdated={async (message) => {
                setSelectedEmployee(null);
                setNotice(message);
                await load();
              }}
            />
          )}
        </main>
      )}
    </ModulePageShell>
  );
}
