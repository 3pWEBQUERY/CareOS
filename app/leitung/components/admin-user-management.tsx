"use client";
import { useEffect, useMemo, useState } from "react";
import { ModuleIcon } from "@/app/components/module-icon";
import type { ManagedRole, ManagedUser } from "@/lib/admin-users";
import { Data, initials } from "./admin-user-parts";
import { EmployeeEditor, EmployeeCreator } from "./employee-editor";
import { RoleEditor } from "./role-editor";

export default function AdminUserManagement({
  showToast,
  createOpen,
  onCloseCreate,
}: {
  showToast: (message: string) => void;
  createOpen: boolean;
  onCloseCreate: () => void;
}) {
  const [data, setData] = useState<Data | null>(null),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<ManagedUser | null>(null),
    [roleEditor, setRoleEditor] = useState<ManagedRole | "create" | null>(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    void fetch("/api/admin/users")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => showToast("Mitarbeiter konnten nicht aus Neon geladen werden"))
      .finally(() => setLoading(false));
  }, [showToast]);
  const users = useMemo(
    () =>
      (data?.users ?? []).filter((u) =>
        `${u.displayName} ${u.username} ${u.role}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [data, query],
  );
  const roleName = (key: string) => data?.roles.find((r) => r.key === key)?.name ?? key;
  return (
    <>
      <div className="admin-users-layout">
        <section className="card admin-users-card">
          <div className="admin-table-header">
            <div>
              <p className="eyebrow">Zugriffsverwaltung</p>
              <h2 className="card-title">Mitarbeiter</h2>
              <p className="card-subtitle">
                {loading
                  ? "Mitarbeiter werden geladen…"
                  : `${users.filter((u) => u.active).length} aktiv · ${users.filter((u) => !u.active).length} archiviert`}
              </p>
            </div>
            <label className="resident-search">
              <ModuleIcon name="search" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name oder Benutzername suchen"
              />
            </label>
          </div>
          <div className="admin-user-table-head">
            <span>Profil</span>
            <span>Rolle</span>
            <span>Arbeitsbereich</span>
            <span>Status</span>
          </div>
          {users.map((u) => (
            <button
              className={`admin-user-row ${selected?.id === u.id ? "selected" : ""}`}
              type="button"
              key={u.id}
              onClick={() => setSelected(u)}
            >
              <span className="avatar">{initials(u.displayName)}</span>
              <span>
                <strong>{u.displayName}</strong>
                <small>
                  @{u.username} · {u.jobTitle}
                </small>
              </span>
              <span>{roleName(u.role)}</span>
              <span>{u.primaryCareUnitName ?? "Nicht zugeteilt"}</span>
              <span className={`status-badge ${u.active ? "stable" : "attention"}`}>
                {u.active ? "Aktiv" : "Archiviert"}
              </span>
            </button>
          ))}
        </section>
        <aside className="card admin-access-card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Ausgewählt</p>
              <h2 className="card-title">{selected?.displayName ?? "Mitarbeiter auswählen"}</h2>
            </div>
            <ModuleIcon name="quality" />
          </div>
          {selected ? (
            <>
              <p>Das Profil kann bearbeitet, archiviert oder gelöscht werden.</p>
              <dl>
                <div>
                  <dt>Rolle</dt>
                  <dd>{roleName(selected.role)}</dd>
                </div>
                <div>
                  <dt>Fester Bereich</dt>
                  <dd>{selected.primaryCareUnitName ?? "Nicht zugeteilt"}</dd>
                </div>
              </dl>
              <button className="primary-button" type="button" onClick={() => setSelected(selected)}>
                Mitarbeiter verwalten
              </button>
            </>
          ) : (
            <p>Wähle einen Mitarbeiter aus der Liste aus.</p>
          )}
        </aside>
      </div>
      <section className="card admin-roles-card">
        <div className="admin-table-header">
          <div>
            <p className="eyebrow">Rollenverwaltung</p>
            <h2 className="card-title">Rollen und Berechtigungen</h2>
            <p className="card-subtitle">{data?.roles.length ?? 0} Rollen stehen für Mitarbeiter zur Verfügung.</p>
          </div>
          <button className="primary-button" type="button" onClick={() => setRoleEditor("create")}>
            <ModuleIcon name="plus" />
            Rolle erstellen
          </button>
        </div>
        <div className="admin-role-grid">
          {(data?.roles ?? []).map((role) => (
            <button className="admin-role-row" key={role.id} type="button" onClick={() => setRoleEditor(role)}>
              <span className="admin-role-icon">
                <ModuleIcon name={role.systemRole ? "quality" : "team"} />
              </span>
              <span>
                <strong>{role.name}</strong>
                <small>{role.description || "Keine Beschreibung"}</small>
              </span>
              <span className="admin-role-meta">
                <small>{role.userCount} Mitarbeiter</small>
                <em>{role.systemRole ? "Systemrolle" : "Eigene Rolle"}</em>
              </span>
              <ModuleIcon name="chevron" />
            </button>
          ))}
        </div>
      </section>
      {selected && (
        <EmployeeEditor
          user={selected}
          careUnits={data?.careUnits ?? []}
          roles={data?.roles ?? []}
          qualifications={data?.qualifications ?? []}
          mailEnabled={Boolean(data?.mailEnabled)}
          onClose={() => setSelected(null)}
          onUpdated={(next, message) => {
            setData(next);
            setSelected(null);
            showToast(message);
          }}
        />
      )}{" "}
      {createOpen && (
        <EmployeeCreator
          careUnits={data?.careUnits ?? []}
          roles={data?.roles ?? []}
          mailEnabled={Boolean(data?.mailEnabled)}
          onClose={onCloseCreate}
          onCreated={(next, message) => {
            setData(next);
            onCloseCreate();
            showToast(message);
          }}
        />
      )}{" "}
      {roleEditor && (
        <RoleEditor
          role={roleEditor === "create" ? null : roleEditor}
          onClose={() => setRoleEditor(null)}
          onUpdated={(roles, message) => {
            setData((current) => (current ? { ...current, roles } : current));
            setRoleEditor(null);
            showToast(message);
          }}
        />
      )}
    </>
  );
}
