"use client";

import { useState } from "react";
import { CareDatePicker } from "@/app/components/care-form-controls";
import { ArrowCounterClockwise, Check, PencilSimple, Plus } from "@phosphor-icons/react";
import {
  EditorDialog,
  formatDate,
  formatDateTime,
  requestJson,
  todayInZurich,
  useApiData,
} from "@/app/components/workspace-ui";
import {
  END_OF_LIFE_FIELDS,
  type DeathChecklistItem,
  type EndOfLifeFieldKey,
  type EndOfLifeView,
} from "@/lib/end-of-life-shared";

type Draft = Record<EndOfLifeFieldKey, string> & { discussedWith: string; discussedOn: string };

// Wünsche für die letzte Lebensphase (Stammdaten) und, nach einem Todesfall, die Checkliste der Einrichtung.
export function RecordEndOfLifeCards({
  residentId,
  residentName,
  onAction,
}: {
  residentId: string;
  residentName: string;
  onAction: (message: string) => void;
}) {
  const view = useApiData<EndOfLifeView>(`/api/residents/${residentId}/end-of-life`);
  const data = view.data;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [doneItem, setDoneItem] = useState<DeathChecklistItem | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const wishes = data?.wishes;
  const filled = wishes ? END_OF_LIFE_FIELDS.filter(({ key }) => wishes[key]) : [];

  async function run(action: () => Promise<unknown>, message: string, onError: (text: string) => void) {
    setSaving(true);
    onError("");
    try {
      await action();
      view.reload();
      onAction(message);
      return true;
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveWishes() {
    if (!draft) return;
    const saved = await run(
      () => requestJson(`/api/residents/${residentId}/end-of-life`, { method: "PUT", body: draft }),
      "Wünsche für die letzte Lebensphase gespeichert",
      setError,
    );
    if (saved) setDraft(null);
  }

  async function toggle(item: DeathChecklistItem, done: boolean, itemNote = "") {
    return run(
      () => requestJson(`/api/end-of-life/checklist/${item.id}`, { method: "PATCH", body: { done, note: itemNote } }),
      done ? `${item.label}: erledigt` : `${item.label}: wieder offen`,
      done ? setError : setListError,
    );
  }

  return (
    <>
      <section className="record-card master-data-card" aria-labelledby="end-of-life-title">
        <div className="record-card-heading">
          <div>
            <span className="record-section-label">Lebensende</span>
            <h3 id="end-of-life-title">Wünsche für die letzte Lebensphase</h3>
          </div>
          {data?.canWrite && (
            <button
              type="button"
              onClick={() => {
                setError("");
                setDraft({
                  ...(Object.fromEntries(END_OF_LIFE_FIELDS.map(({ key }) => [key, data.wishes[key]])) as Record<
                    EndOfLifeFieldKey,
                    string
                  >),
                  discussedWith: data.wishes.discussedWith,
                  discussedOn: data.wishes.discussedOn ?? "",
                });
              }}
            >
              {data.wishes.updatedAt ? (
                <>
                  <PencilSimple aria-hidden="true" /> Bearbeiten
                </>
              ) : (
                <>
                  <Plus aria-hidden="true" /> Erfassen
                </>
              )}
            </button>
          )}
        </div>
        <div className="master-data-form-grid single-column">
          {view.error && !data ? (
            <p className="restraints-error" role="alert">
              {view.error}
            </p>
          ) : !data ? (
            <p className="record-export-note">Wird geladen …</p>
          ) : filled.length === 0 && !data.wishes.discussedWith ? (
            <p className="record-export-note">
              Noch keine Wünsche erfasst – z. B. Ort, Begleitung, religiöse oder spirituelle Wünsche, Bestattung und wer
              informiert werden soll.
            </p>
          ) : (
            <>
              {filled.map(({ key, label }) => (
                <div key={key} className="advance-care-representative end-of-life-wish">
                  <span>{label}</span>
                  <strong>{data.wishes[key]}</strong>
                </div>
              ))}
              {(data.wishes.discussedWith || data.wishes.discussedOn) && (
                <div className="advance-care-representative">
                  <span>Besprochen</span>
                  <strong>
                    {[
                      data.wishes.discussedWith && `mit ${data.wishes.discussedWith}`,
                      data.wishes.discussedOn && `am ${formatDate(data.wishes.discussedOn)}`,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  </strong>
                </div>
              )}
              {data.wishes.updatedAt && (
                <small className="end-of-life-updated">
                  Zuletzt geändert {formatDateTime(data.wishes.updatedAt)}
                  {data.wishes.updatedBy ? ` · ${data.wishes.updatedBy}` : ""}
                </small>
              )}
            </>
          )}
        </div>
      </section>

      {data?.deceasedOn && (
        <section className="record-card master-data-card" aria-labelledby="death-checklist-title">
          <div className="record-card-heading">
            <div>
              <span className="record-section-label">Verstorben am {formatDate(data.deceasedOn)}</span>
              <h3 id="death-checklist-title">Ablauf nach dem Todesfall</h3>
            </div>
          </div>
          <div className="master-data-form-grid single-column">
            {listError && (
              <p className="restraints-error" role="alert">
                {listError}
              </p>
            )}
            {data.checklist.length === 0 ? (
              <div className="death-checklist-empty">
                <p className="record-export-note">
                  Für diese Person gibt es keine Checkliste. Die Punkte legt die Einrichtung unter Leitung ·
                  Konfiguration fest.
                </p>
                {data.canWrite && (
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      void run(
                        () => requestJson(`/api/residents/${residentId}/end-of-life`, { method: "POST" }),
                        "Checkliste der Einrichtung übernommen",
                        setListError,
                      )
                    }
                  >
                    Checkliste der Einrichtung übernehmen
                  </button>
                )}
              </div>
            ) : (
              <ul className="death-checklist" aria-label="Checkliste nach dem Todesfall">
                {data.checklist.map((item) => (
                  <li key={item.id} className={item.doneAt ? "done" : ""}>
                    <span className="death-checklist-mark" aria-hidden="true">
                      {item.doneAt && <Check />}
                    </span>
                    <div>
                      <strong>{item.label}</strong>
                      {item.doneAt && (
                        <small>
                          Erledigt {formatDateTime(item.doneAt)}
                          {item.doneBy ? ` · ${item.doneBy}` : ""}
                          {item.note ? ` · ${item.note}` : ""}
                        </small>
                      )}
                    </div>
                    {data.canWrite &&
                      (item.doneAt ? (
                        <button
                          type="button"
                          className="death-checklist-action"
                          disabled={saving}
                          aria-label={`${item.label} wieder öffnen`}
                          onClick={() => void toggle(item, false)}
                        >
                          <ArrowCounterClockwise aria-hidden="true" /> Wieder öffnen
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="death-checklist-action"
                          disabled={saving}
                          aria-label={`${item.label} erledigt`}
                          onClick={() => {
                            setError("");
                            setNote("");
                            setDoneItem(item);
                          }}
                        >
                          <Check aria-hidden="true" /> Erledigt
                        </button>
                      ))}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {draft && (
        <EditorDialog
          id="end-of-life"
          eyebrow={`${residentName} · Lebensende`}
          title="Wünsche für die letzte Lebensphase"
          description="Festhalten, was die Person bzw. ihre Vertretung wünscht. Leere Felder bleiben offen."
          onClose={() => setDraft(null)}
          onSubmit={saveWishes}
          saving={saving}
          error={error}
          submitLabel="Wünsche speichern"
        >
          {END_OF_LIFE_FIELDS.map(({ key, label, hint }) => (
            <label key={key} className="area-editor-wide">
              <span>{label}</span>
              <textarea
                rows={2}
                maxLength={4000}
                placeholder={hint || undefined}
                value={draft[key]}
                onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
              />
            </label>
          ))}
          <label>
            <span>Besprochen mit</span>
            <input
              maxLength={200}
              placeholder="z. B. mit der Person selbst und der Tochter"
              value={draft.discussedWith}
              onChange={(event) => setDraft({ ...draft, discussedWith: event.target.value })}
            />
          </label>
          <label>
            <span>Besprochen am</span>
            <CareDatePicker
              clearable
              label="Besprochen am"
              value={draft.discussedOn}
              max={todayInZurich()}
              onChange={(value) => setDraft({ ...draft, discussedOn: value })}
            />
          </label>
        </EditorDialog>
      )}

      {doneItem && (
        <EditorDialog
          id="death-checklist-item"
          eyebrow={`${residentName} · Ablauf nach dem Todesfall`}
          title={doneItem.label}
          onClose={() => setDoneItem(null)}
          onSubmit={async () => {
            if (await toggle(doneItem, true, note)) setDoneItem(null);
          }}
          saving={saving}
          error={error}
          submitLabel="Als erledigt markieren"
        >
          <label className="area-editor-wide">
            <span>Vermerk (freiwillig)</span>
            <input
              maxLength={500}
              placeholder="z. B. telefonisch erreicht, kommt um 14 Uhr"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        </EditorDialog>
      )}
    </>
  );
}
