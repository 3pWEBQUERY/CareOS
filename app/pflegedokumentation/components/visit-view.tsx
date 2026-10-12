"use client";

import Link from "next/link";
import { useState } from "react";
import { setCareResident, useTerms, useWorkContext } from "@/app/components/care-context";
import { CareOptionSelect } from "@/app/components/care-form-controls";
import ModulePageShell from "@/app/components/module-page-shell";
import { ModuleIcon } from "@/app/components/module-icon";
import {
  EditorDialog,
  EmptyState,
  LoadError,
  PageHeading,
  SummaryTiles,
  formatDateTime,
  requestJson,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import type { VisitItem, VisitOverview, VisitResident } from "@/lib/visits-shared";

type Answering = { item: VisitItem; resident: VisitResident; physician: string };

function AnswerDialog({
  answering,
  onClose,
  onSaved,
}: {
  answering: Answering;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [response, setResponse] = useState("");
  const [physician, setPhysician] = useState(answering.physician);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setSaving(true);
    setError("");
    try {
      await requestJson("/api/visits/answer", {
        method: "POST",
        body: { entryId: answering.item.id, response, physician },
      });
      onSaved(`Rückmeldung für ${answering.resident.name} dokumentiert`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="visit-answer"
      eyebrow={answering.resident.name}
      title="Rückmeldung erfassen"
      description="Die Rückmeldung wird als Eintrag „Arztvisite“ dokumentiert und die Frage gilt als erledigt."
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Rückmeldung speichern"
    >
      <div className="visit-answer-question area-editor-wide">
        <span>Frage der Pflege</span>
        <p>{answering.item.body}</p>
      </div>
      <label className="area-editor-wide">
        <span>Ärztin / Arzt</span>
        <input maxLength={160} value={physician} onChange={(event) => setPhysician(event.target.value)} />
      </label>
      <label className="area-editor-wide">
        <span>Rückmeldung</span>
        <textarea
          required
          rows={5}
          maxLength={10000}
          value={response}
          onChange={(event) => setResponse(event.target.value)}
          placeholder="Was wurde besprochen oder angeordnet?"
        />
      </label>
    </EditorDialog>
  );
}

function VisitContent({ showToast }: { showToast: ShowToast }) {
  const t = useTerms();
  const context = useWorkContext();
  const [unitId, setUnitId] = useState("");
  const [answering, setAnswering] = useState<Answering | null>(null);
  const query = unitId ? `?careUnitId=${encodeURIComponent(unitId)}` : "";
  const data = useApiData<VisitOverview>(`/api/visits${query}`);
  const units = context?.careUnits ?? [];
  const overview = data.data;
  const residents = overview?.groups.reduce((sum, group) => sum + group.residents.length, 0);

  return (
    <>
      <PageHeading
        eyebrow="Dokumentation"
        title="Visite vorbereiten"
        description={`Einträge „Für Visite“ gesammelt je Hausärztin bzw. Hausarzt – zum Mitnehmen, Abarbeiten und Dokumentieren der Rückmeldung.`}
      />
      <section className="visit-toolbar">
        <CareOptionSelect
          label="Wohnbereich"
          value={unitId}
          onChange={setUnitId}
          options={[
            { value: "", label: "Alle Wohnbereiche" },
            ...units.map((unit) => ({ value: unit.id, label: unit.name })),
          ]}
        />
        <a
          className="secondary-button"
          href={`/c/pflegedokumentation/visite/drucken${query}`}
          target="_blank"
          rel="noreferrer"
          aria-disabled={!overview?.open}
        >
          <ModuleIcon name="docs" className="button-icon" /> Visitenliste drucken
        </a>
      </section>
      <SummaryTiles
        label="Visite"
        tiles={[
          { icon: "note", value: overview?.open ?? "–", caption: "offene Fragen", tone: "info" },
          { icon: "residents", value: residents ?? "–", caption: `${t.many} mit Fragen` },
          { icon: "check", value: overview?.resolved.length ?? "–", caption: "Rückmeldungen in 14 Tagen" },
        ]}
      />
      {data.error && <LoadError message={data.error} onRetry={data.reload} />}
      {overview && !overview.groups.length && (
        <EmptyState
          icon="check"
          title="Keine offenen Fragen"
          text="Einträge mit der Einordnung „Für Visite“ erscheinen hier, bis die Rückmeldung erfasst ist."
        />
      )}
      <div className="visit-groups">
        {overview?.groups.map((group) => (
          <section
            className="card visit-group"
            key={group.physician?.name ?? "none"}
            aria-label={group.physician?.name ?? "Hausarzt nicht erfasst"}
          >
            <header>
              <h2 className="card-title">{group.physician?.name ?? "Hausarzt nicht erfasst"}</h2>
              <p className="card-subtitle">
                {group.physician
                  ? [group.physician.practice, group.physician.phone].filter(Boolean).join(" · ") ||
                    "Praxis und Telefon nicht erfasst"
                  : `In den Stammdaten der ${t.prefix}akte ergänzen.`}
              </p>
            </header>
            {group.residents.map((resident) => (
              <div className="visit-resident" key={resident.id}>
                <h3>
                  <Link href={`/c/bewohner?resident=${resident.id}`} onClick={() => setCareResident(resident.id)}>
                    {resident.name}
                  </Link>
                  <span>{[resident.room, resident.careUnit].filter(Boolean).join(" · ")}</span>
                </h3>
                {resident.diagnoses.length > 0 && (
                  <p className="visit-diagnoses">Diagnosen: {resident.diagnoses.join(" · ")}</p>
                )}
                <ul>
                  {resident.items.map((item) => (
                    <li key={item.id}>
                      <div>
                        <p>{item.body}</p>
                        <small>
                          {item.category} · {formatDateTime(item.occurredAt)} · {item.author}
                        </small>
                      </div>
                      {overview.canWrite && (
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => setAnswering({ item, resident, physician: group.physician?.name ?? "" })}
                        >
                          Rückmeldung erfassen
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>
      {overview && overview.resolved.length > 0 && (
        <section className="card visit-resolved" aria-label="Rückmeldungen der letzten 14 Tage">
          <header>
            <h2 className="card-title">Rückmeldungen der letzten 14 Tage</h2>
          </header>
          <ul>
            {overview.resolved.map((item) => (
              <li key={item.entryId}>
                <strong>{item.residentName}</strong>
                <p>
                  <span>Frage:</span> {item.question}
                </p>
                <p>
                  <span>Rückmeldung:</span> {item.response}
                </p>
                <small>
                  {[item.physician, formatDateTime(item.resolvedAt), `erfasst von ${item.resolvedBy}`]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}
      {answering && (
        <AnswerDialog
          answering={answering}
          onClose={() => setAnswering(null)}
          onSaved={(message) => {
            setAnswering(null);
            showToast(message);
            data.reload();
          }}
        />
      )}
    </>
  );
}

// Dokumentation › Visite: offene Fragen an die Ärztin bzw. den Arzt und die erfassten Rückmeldungen.
export default function VisitView() {
  return (
    <ModulePageShell activeModule="chart" activeChild="Visite" pageClass="documentation-page documentation-visit">
      {(showToast) => (
        <main className="workspace module-workspace documentation-workspace">
          <VisitContent showToast={showToast} />
        </main>
      )}
    </ModulePageShell>
  );
}
