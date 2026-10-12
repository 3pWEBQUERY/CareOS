"use client";

import { useState } from "react";
import { EditorDialog, requestJson, useApiData } from "@/app/components/workspace-ui";

// Liste, die die Einrichtung selbst festlegt (ein Eintrag pro Zeile, keine Vorgabe), z. B. Checkliste nach einem
// Todesfall oder Themen der Einwilligungen.
export function OrgListCard({
  id,
  eyebrow,
  title,
  endpoint,
  field,
  singular,
  plural,
  usage,
  empty,
  description,
  placeholder,
  savedMessage,
  submitLabel,
  showToast,
}: {
  id: string;
  eyebrow: string;
  title: string;
  endpoint: string;
  field: string;
  singular: string;
  plural: string;
  usage: string;
  empty: string;
  description: string;
  placeholder: string;
  savedMessage: string;
  submitLabel: string;
  showToast: (message: string) => void;
}) {
  const data = useApiData<Record<string, string[]>>(endpoint);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const items = data.data?.[field] ?? [];
  return (
    <section className="card admin-terminology-card admin-retention-card" aria-labelledby={`${id}-card-title`}>
      <div className="card-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="card-title" id={`${id}-card-title`}>
            {title}
          </h2>
          <p className="card-subtitle">
            {items.length ? `${items.length} ${items.length === 1 ? singular : plural} · ${usage}` : empty}
          </p>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={!data.data}
          onClick={() => {
            setError("");
            setDraft(items.join("\n"));
          }}
        >
          {items.length ? "Bearbeiten" : "Festlegen"}
        </button>
      </div>
      <div className="admin-retention-list">
        {data.error && <p className="list-hint">{data.error}</p>}
        {items.map((item, index) => (
          <div className="admin-retention-row" key={item}>
            <span>
              <strong>
                {index + 1}. {item}
              </strong>
            </span>
          </div>
        ))}
      </div>
      {draft !== null && (
        <EditorDialog
          id={id}
          eyebrow={`Konfiguration · ${eyebrow}`}
          title={title}
          description={description}
          onClose={() => setDraft(null)}
          onSubmit={async () => {
            setSaving(true);
            setError("");
            try {
              await requestJson(endpoint, { method: "PUT", body: { [field]: draft.split("\n") } });
              setDraft(null);
              data.reload();
              showToast(savedMessage);
            } catch (cause) {
              setError((cause as Error).message);
            } finally {
              setSaving(false);
            }
          }}
          saving={saving}
          error={error}
          submitLabel={submitLabel}
        >
          <label className="area-editor-wide">
            <span>{plural}</span>
            <textarea
              rows={8}
              placeholder={placeholder}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
        </EditorDialog>
      )}
    </section>
  );
}
