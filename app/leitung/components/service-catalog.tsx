"use client";

import { useState } from "react";
import { CareOptionSelect } from "@/app/components/care-form-controls";
import ModulePageShell from "@/app/components/module-page-shell";
import {
  EditorDialog,
  EmptyState,
  LoadError,
  requestJson,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import { MAX_SERVICE_MINUTES, SERVICE_CATEGORIES, type ServiceCatalogItem } from "@/lib/services-shared";
import { LeadershipHeading } from "./leadership-page-parts";

type Draft = {
  id: string | null;
  name: string;
  category: string;
  code: string;
  defaultMinutes: string;
  active: string;
};

const draftOf = (item: ServiceCatalogItem | null): Draft => ({
  id: item?.id ?? null,
  name: item?.name ?? "",
  category: item?.category ?? "Pflege",
  code: item?.code ?? "",
  defaultMinutes: item?.defaultMinutes ? String(item.defaultMinutes) : "",
  active: item && !item.active ? "no" : "yes",
});

function CatalogDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: Draft;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  async function submit() {
    setSaving(true);
    setError("");
    try {
      const body = {
        name: draft.name,
        category: draft.category,
        code: draft.code,
        defaultMinutes: draft.defaultMinutes === "" ? null : Number(draft.defaultMinutes),
        active: draft.active === "yes",
      };
      await requestJson(draft.id ? `/api/services/catalog/${draft.id}` : "/api/services/catalog", {
        method: draft.id ? "PATCH" : "POST",
        body,
      });
      onSaved(draft.id ? "Leistung gespeichert" : "Leistung angelegt");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="service-catalog"
      eyebrow="Leistungskatalog"
      title={draft.id ? "Leistung bearbeiten" : "Leistung anlegen"}
      description="Bezeichnung, Bereich und eigener Code erscheinen in der Erfassung und im Export. Die Minuten sind nur ein Vorschlag beim Erfassen."
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Speichern"
    >
      <label className="area-editor-wide">
        <span>Bezeichnung</span>
        <input required maxLength={160} value={draft.name} onChange={(event) => set("name", event.target.value)} />
      </label>
      <label>
        <span>Bereich</span>
        <CareOptionSelect
          label="Bereich"
          value={draft.category}
          onChange={(value) => set("category", value)}
          options={SERVICE_CATEGORIES.map((category) => ({ value: category, label: category }))}
        />
      </label>
      <label>
        <span>Code (optional)</span>
        <input maxLength={40} value={draft.code} onChange={(event) => set("code", event.target.value)} />
      </label>
      <label>
        <span>Vorschlag Minuten (optional)</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_SERVICE_MINUTES}
          step={1}
          value={draft.defaultMinutes}
          onChange={(event) => set("defaultMinutes", event.target.value)}
        />
      </label>
      <label>
        <span>Status</span>
        <CareOptionSelect
          label="Status"
          value={draft.active}
          onChange={(value) => set("active", value)}
          options={[
            { value: "yes", label: "Aktiv" },
            { value: "no", label: "Inaktiv (nicht mehr wählbar)" },
          ]}
        />
      </label>
    </EditorDialog>
  );
}

function CatalogContent({ showToast }: { showToast: ShowToast }) {
  const data = useApiData<{ items: ServiceCatalogItem[] }>("/api/services/catalog");
  const [editing, setEditing] = useState<Draft | null>(null);
  const items = data.data?.items ?? [];
  return (
    <>
      <LeadershipHeading
        eyebrow="Administration"
        title="Leistungskatalog"
        description="Die Pflegeleistungen der Einrichtung für die Leistungserfassung – mit eigenem Code für Einstufung und Abrechnung."
        action={{ label: "Leistung anlegen", onClick: () => setEditing(draftOf(null)) }}
      />
      {data.error && <LoadError message={data.error} onRetry={data.reload} />}
      <section className="card service-catalog-card" aria-label="Leistungen im Katalog">
        <header>
          <h2 className="card-title">Leistungen</h2>
          <p className="card-subtitle">
            {items.filter((item) => item.active).length} aktiv · {items.length} gesamt
          </p>
        </header>
        {data.data && !items.length ? (
          <EmptyState
            icon="plan"
            title="Noch keine Leistungen im Katalog"
            text="Ohne Katalog lassen sich Leistungen mit freier Bezeichnung erfassen."
          />
        ) : (
          <div className="services-report-table">
            <table>
              <thead>
                <tr>
                  <th>Bezeichnung</th>
                  <th>Bereich</th>
                  <th>Code</th>
                  <th>Vorschlag</th>
                  <th>Status</th>
                  <th aria-label="Aktionen" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className={item.active ? "" : "inactive"}>
                    <td>
                      <strong>{item.name}</strong>
                    </td>
                    <td>{item.category}</td>
                    <td>{item.code || "–"}</td>
                    <td>{item.defaultMinutes ? `${item.defaultMinutes} min` : "–"}</td>
                    <td>
                      <span className={`status-badge ${item.active ? "stable" : "attention"}`}>
                        {item.active ? "Aktiv" : "Inaktiv"}
                      </span>
                    </td>
                    <td>
                      <button className="secondary-button" type="button" onClick={() => setEditing(draftOf(item))}>
                        Bearbeiten
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editing && (
        <CatalogDialog
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            showToast(message);
            data.reload();
          }}
        />
      )}
    </>
  );
}

// Leitung › Administration › Leistungskatalog.
export default function ServiceCatalog() {
  return (
    <ModulePageShell activeModule="admin" activeChild="Leistungskatalog" pageClass="leadership-page">
      {(showToast) => (
        <main className="workspace leadership-workspace service-catalog-page">
          <CatalogContent showToast={showToast} />
        </main>
      )}
    </ModulePageShell>
  );
}
