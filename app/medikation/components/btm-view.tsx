"use client";

import { useTerms } from "@/app/components/care-context";
import { useState } from "react";
import { ModuleIcon } from "@/app/components/module-icon";
import {
  EditorDialog,
  EmptyState,
  LoadError,
  PageHeading,
  ReasonDialog,
  SummaryTiles,
  formatDateTime,
  formatNumber,
  requestJson,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import { useEscapeClose } from "@/app/components/use-escape-close";
import { BTM_KIND_LABELS, type BtmBook, type BtmOverview, type BtmStockItem } from "@/lib/medication-btm-shared";
import type { StockItem } from "@/lib/medication-shared";
import { WitnessFields, emptyWitness } from "./btm-witness";
import { ReceiptDialog } from "./stock-dialogs";

type Payload = BtmOverview & {
  careUnits: Array<{ id: string; name: string }>;
  residents: Array<{ id: string; name: string }>;
  canManage: boolean;
};
type Dialog =
  | { kind: "receipt" }
  | { kind: "count"; item: BtmStockItem }
  | { kind: "disposal"; item: BtmStockItem }
  | { kind: "book"; item: BtmStockItem }
  | { kind: "unmark"; medicationId: string; name: string };

const parse = (value: string) => Number(value.replace(",", "."));
const daysSince = (value: string | null) => (value ? Math.floor((Date.now() - Date.parse(value)) / 86_400_000) : null);
// Differenzen mit Vorzeichen (typografisches Minus wie im BtM-Buch).
const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatNumber(Math.abs(value))}`;
const label = (item: BtmStockItem) => `${item.name} ${item.strength}`.trim();

// Für den Wareneingang: BtM-Bestände in der Form der allgemeinen Bestandsliste.
const asStockItem = (item: BtmStockItem): StockItem => ({
  id: item.id,
  medicationId: item.medicationId,
  name: item.name,
  strength: item.strength,
  form: item.form,
  owner: item.owner,
  ownerKind: item.ownerKind,
  location: item.location,
  quantity: item.quantity,
  unit: item.unit,
  minimum: null,
  expiresOn: null,
  batch: "",
  updatedAt: "",
  controlled: true,
});

// BtM-Kontrolle: Betäubungsmittel mit Bestandsbuch, Bestandskontrollen und Zweitunterschrift.
export default function BtmView({ showToast }: { showToast: ShowToast }) {
  const t = useTerms();
  const { data, error, loading, reload } = useApiData<Payload>("/api/medication/btm");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [marking, setMarking] = useState("");
  const items = data?.items ?? [];
  const canManage = data?.canManage ?? false;
  const done = (message: string) => {
    setDialog(null);
    showToast(message);
    reload();
  };
  const withDifference = items.filter((item) => item.lastCount && item.lastCount.counted !== item.lastCount.expected);
  const neverCounted = items.filter((item) => !item.lastCount);
  const interval = data?.countInterval ?? null;
  const dueItems = items.filter((item) => item.countDue?.due);
  const oldestCount = items.reduce<number | null>((oldest, item) => {
    const days = daysSince(item.lastCount?.at ?? null);
    return days === null ? oldest : Math.max(oldest ?? 0, days);
  }, null);

  async function mark(medicationId: string, name: string) {
    setMarking(medicationId);
    try {
      await requestJson(`/api/medication/btm/medications/${medicationId}`, {
        method: "PATCH",
        body: { controlled: true },
      });
      showToast(`${name} wird als Betäubungsmittel geführt`);
      reload();
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Kennzeichnung fehlgeschlagen.");
    } finally {
      setMarking("");
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="Medikamente"
        title="BtM-Kontrolle"
        description="Betäubungsmittel mit lückenlosem Bestandsbuch: jeder Eingang, jede Gabe, Entsorgung und Kontrolle mit Person und Zweitunterschrift."
        action={canManage ? { label: "BtM-Eingang", onClick: () => setDialog({ kind: "receipt" }) } : undefined}
      />
      <SummaryTiles
        label="BtM-Übersicht"
        tiles={[
          { icon: "med", value: items.length, caption: "BtM-Bestände" },
          {
            icon: "alert",
            value: withDifference.length,
            caption: "mit Differenz bei der letzten Kontrolle",
            tone: withDifference.length ? "critical" : undefined,
          },
          interval === null
            ? {
                icon: "check",
                value: neverCounted.length,
                caption: "noch nie kontrolliert",
                tone: neverCounted.length ? "attention" : undefined,
              }
            : {
                icon: "check",
                value: dueItems.length,
                caption: `Kontrolle fällig (alle ${interval} ${interval === 1 ? "Tag" : "Tage"})`,
                tone: dueItems.length ? "attention" : undefined,
              },
          {
            icon: "calendar",
            value: oldestCount === null ? "–" : `${oldestCount} Tage`,
            caption: "älteste letzte Kontrolle",
            tone: "info",
          },
        ]}
      />
      {error && <LoadError message={error} onRetry={reload} />}

      <section className="card med-stock-card">
        <div className="med-stock-toolbar btm-toolbar">
          <div>
            <h2 className="card-title">BtM-Bestände</h2>
            <p className="card-subtitle">Stationsbestände und bewohnereigene Betäubungsmittel</p>
          </div>
        </div>
        <div className="med-stock-head btm-grid">
          <span>Präparat</span>
          <span>Bestand gehört zu</span>
          <span>Menge</span>
          <span>Letzte Kontrolle</span>
          <span>Aktion</span>
        </div>
        <div className="med-stock-list btm-list">
          {items.map((item) => {
            const count = item.lastCount;
            const difference = count ? count.counted - count.expected : 0;
            return (
              <article key={item.id} className="btm-grid">
                <span className="med-pill-icon">
                  <ModuleIcon name="med" />
                </span>
                <span>
                  <strong>
                    {label(item)}
                    <em className="btm-badge">BtM</em>
                  </strong>
                  <small>{item.form || "–"}</small>
                </span>
                <span>
                  <strong>{item.owner}</strong>
                  <small>
                    {item.location ||
                      (item.ownerKind === "resident" ? `${t.prefix}eigener Bestand` : "Kein Lagerort erfasst")}
                  </small>
                </span>
                <span>
                  <strong>
                    {formatNumber(item.quantity)} {item.unit}
                  </strong>
                  <small>
                    {item.lastMovementAt
                      ? `Letzte Buchung ${formatDateTime(item.lastMovementAt)}`
                      : "Noch keine Buchung"}
                  </small>
                </span>
                <span>
                  <strong className={difference ? "critical-text" : item.countDue?.due ? "attention-text" : ""}>
                    {count ? formatDateTime(count.at) : "Noch nie"}
                  </strong>
                  <small>
                    {count
                      ? difference
                        ? `Differenz ${signed(difference)} ${item.unit}`
                        : `ohne Differenz · ${[count.countedBy, count.witness].filter(Boolean).join(" / ")}`
                      : "Bestandskontrolle ausstehend"}
                    {item.countDue &&
                      (item.countDue.due
                        ? " · Kontrolle fällig"
                        : ` · nächste Kontrolle ${formatDateTime(item.countDue.at)}`)}
                  </small>
                </span>
                <span className="btm-actions">
                  {canManage && (
                    <button type="button" onClick={() => setDialog({ kind: "count", item })}>
                      Kontrolle
                    </button>
                  )}
                  <button type="button" onClick={() => setDialog({ kind: "book", item })}>
                    BtM-Buch
                  </button>
                  {canManage && item.quantity > 0 && (
                    <button type="button" onClick={() => setDialog({ kind: "disposal", item })}>
                      Entsorgung
                    </button>
                  )}
                </span>
              </article>
            );
          })}
          {!loading && !items.length && (
            <EmptyState
              title="Noch keine Betäubungsmittel im Bestand"
              text="Präparate unten als BtM kennzeichnen und über „BtM-Eingang“ den ersten Bestand buchen."
            />
          )}
        </div>
      </section>

      <section className="card btm-medications">
        <div className="card-header">
          <div>
            <p className="eyebrow">Präparate</p>
            <h2 className="card-title">Als Betäubungsmittel führen</h2>
            <p className="card-subtitle">
              Gekennzeichnete Präparate brauchen für Eingang, Entsorgung, Korrektur und Kontrolle eine
              Zweitunterschrift. Ihre Buchungen lassen sich nicht nachträglich ändern oder löschen.
            </p>
          </div>
        </div>
        <ul>
          {(data?.medications ?? []).map((medication) => (
            <li key={medication.id} className={medication.controlled ? "controlled" : ""}>
              <span>
                <strong>
                  {medication.name}
                  {medication.controlled && <em className="btm-badge">BtM</em>}
                </strong>
                <small>
                  {[medication.form, medication.hasStock ? "mit Bestand" : "ohne Bestand"].filter(Boolean).join(" · ")}
                </small>
              </span>
              {canManage &&
                (medication.controlled ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setDialog({ kind: "unmark", medicationId: medication.id, name: medication.name })}
                  >
                    Kennzeichnung aufheben
                  </button>
                ) : (
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={marking === medication.id}
                    onClick={() => void mark(medication.id, medication.name)}
                  >
                    Als BtM führen
                  </button>
                ))}
            </li>
          ))}
          {!loading && !data?.medications.length && <li className="list-hint">Noch keine Präparate erfasst.</li>}
        </ul>
      </section>

      {data && dialog?.kind === "receipt" && (
        <ReceiptDialog
          items={items.map(asStockItem)}
          careUnits={data.careUnits}
          residents={data.residents}
          controlledNames={data.medications
            .filter((medication) => medication.controlled)
            .map((medication) => medication.name.split(" ")[0].toLocaleLowerCase("de-CH"))}
          onClose={() => setDialog(null)}
          onSaved={done}
        />
      )}
      {dialog?.kind === "count" && <CountDialog item={dialog.item} onClose={() => setDialog(null)} onSaved={done} />}
      {dialog?.kind === "disposal" && (
        <DisposalDialog item={dialog.item} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {dialog?.kind === "book" && <BookPanel item={dialog.item} onClose={() => setDialog(null)} />}
      {dialog?.kind === "unmark" && (
        <ReasonDialog
          eyebrow="Medikamente · BtM"
          title={`${dialog.name} nicht mehr als BtM führen`}
          description="Die bisherigen Buchungen bleiben unverändert erhalten. Die Aufhebung wird mit Begründung protokolliert."
          label="Begründung"
          placeholder="z. B. irrtümlich gekennzeichnet"
          submitLabel="Kennzeichnung aufheben"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await requestJson(`/api/medication/btm/medications/${dialog.medicationId}`, {
              method: "PATCH",
              body: { controlled: false, reason },
            });
            done(`${dialog.name} wird nicht mehr als BtM geführt`);
          }}
        />
      )}
    </>
  );
}

function CountDialog({
  item,
  onClose,
  onSaved,
}: {
  item: BtmStockItem;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [witness, setWitness] = useState(emptyWitness);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const value = counted.trim() === "" ? null : parse(counted);
  const difference = value === null || Number.isNaN(value) ? null : Math.round((value - item.quantity) * 1000) / 1000;

  async function save() {
    if (value === null || Number.isNaN(value)) {
      setError("Bitte den gezählten Bestand angeben.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await requestJson(`/api/medication/btm/${item.id}/count`, {
        method: "POST",
        body: { counted: value, note, witness },
      });
      onSaved(
        difference
          ? `Kontrolle gespeichert: Differenz ${signed(difference)} ${item.unit} gebucht`
          : "Kontrolle gespeichert: Bestand stimmt",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die Kontrolle konnte nicht gespeichert werden.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="btm-count"
      eyebrow={`BtM-Kontrolle · ${item.owner}`}
      title={label(item)}
      description={`Laut Buch: ${formatNumber(item.quantity)} ${item.unit}. Den tatsächlichen Bestand gemeinsam mit der zweiten Person zählen und eintragen.`}
      onClose={onClose}
      onSubmit={save}
      saving={saving}
      error={error}
      submitLabel="Kontrolle speichern"
    >
      <label>
        <span>Gezählter Bestand ({item.unit})</span>
        <input required inputMode="decimal" value={counted} onChange={(event) => setCounted(event.target.value)} />
      </label>
      <div className={`btm-difference ${difference ? "critical" : difference === 0 ? "ok" : ""}`} aria-live="polite">
        <span>Differenz</span>
        <strong>
          {difference === null ? "–" : difference === 0 ? "Bestand stimmt" : `${signed(difference)} ${item.unit}`}
        </strong>
      </div>
      <label className="area-editor-wide">
        <span>Begründung{difference ? " (Pflicht bei Differenz)" : ""}</span>
        <input
          required={Boolean(difference)}
          maxLength={1000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="z. B. Tablette beim Richten zerbrochen, Buchung vergessen"
        />
      </label>
      <WitnessFields value={witness} onChange={setWitness} />
    </EditorDialog>
  );
}

function DisposalDialog({
  item,
  onClose,
  onSaved,
}: {
  item: BtmStockItem;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const t = useTerms();
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [witness, setWitness] = useState(emptyWitness);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      await requestJson(`/api/medication/btm/${item.id}/disposal`, {
        method: "POST",
        body: { quantity: parse(quantity), note, witness },
      });
      onSaved(`Entsorgung gebucht: ${label(item)} −${formatNumber(parse(quantity))} ${item.unit}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die Entsorgung konnte nicht gebucht werden.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="btm-disposal"
      eyebrow={`BtM-Entsorgung · ${item.owner}`}
      title={label(item)}
      description={`Aktueller Bestand: ${formatNumber(item.quantity)} ${item.unit}. Die Entsorgung wird mit Grund und Zweitunterschrift im BtM-Buch geführt.`}
      onClose={onClose}
      onSubmit={save}
      saving={saving}
      error={error}
      submitLabel="Entsorgung buchen"
      danger
    >
      <label>
        <span>Entsorgte Menge ({item.unit})</span>
        <input required inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
      </label>
      <label>
        <span>Grund</span>
        <input
          required
          maxLength={1000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={`z. B. verfallen, ${t.one} verstorben`}
        />
      </label>
      <WitnessFields value={witness} onChange={setWitness} />
    </EditorDialog>
  );
}

// BtM-Buch als Seitenpanel (70 %), mit Druckansicht.
function BookPanel({ item, onClose }: { item: BtmStockItem; onClose: () => void }) {
  const book = useApiData<BtmBook>(`/api/medication/btm/${item.id}`);
  useEscapeClose(onClose);
  return (
    <div
      className="area-editor-overlay"
      role="presentation"
      onMouseDown={(event) => event.currentTarget === event.target && onClose()}
    >
      <section
        className="area-editor-panel btm-book-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="btm-book-title"
      >
        <header className="area-editor-header">
          <div>
            <p className="eyebrow">BtM-Buch · {item.owner}</p>
            <h2 id="btm-book-title">{label(item)}</h2>
            <p>
              Bestand {formatNumber(item.quantity)} {item.unit}. Alle Buchungen mit laufendem Bestand, Person und
              Zweitunterschrift.
            </p>
          </div>
          <button className="area-editor-close" type="button" aria-label="BtM-Buch schliessen" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="btm-book-body">
          <div className="btm-book-actions">
            <a
              className="secondary-button"
              href={`/c/medikation/btm/buch?stock=${item.id}`}
              target="_blank"
              rel="noopener"
            >
              <ModuleIcon name="docs" className="button-icon" /> Drucken / PDF
            </a>
          </div>
          {book.error && <LoadError message={book.error} onRetry={book.reload} />}
          {book.data && <BtmBookTable book={book.data} />}
          {book.loading && !book.data && <p className="list-hint">BtM-Buch wird geladen…</p>}
        </div>
      </section>
    </div>
  );
}

// Im Ausdruck stehen absolute Zeitpunkte statt „Heute“/„Gestern“.
const printedAt = new Intl.DateTimeFormat("de-CH", {
  timeZone: "Europe/Zurich",
  dateStyle: "medium",
  timeStyle: "short",
});

export function BtmBookTable({ book, print = false }: { book: BtmBook; print?: boolean }) {
  const t = useTerms();
  const unit = book.stock.unit;
  return (
    <table className="btm-book">
      <thead>
        <tr>
          <th>Datum</th>
          <th>Art</th>
          <th>{t.one} / Hinweis</th>
          <th className="number">Menge</th>
          <th className="number">Bestand</th>
          <th>Person</th>
          <th>Zweitunterschrift</th>
        </tr>
      </thead>
      <tbody>
        {book.entries.map((entry) => (
          <tr key={entry.id} className={entry.kind}>
            <td>{print ? printedAt.format(new Date(entry.at)) : formatDateTime(entry.at)}</td>
            <td>{BTM_KIND_LABELS[entry.kind]}</td>
            <td>
              {entry.resident && <strong>{entry.resident}</strong>}
              {entry.kind === "count" && entry.expected !== null && entry.counted !== null && (
                <span>
                  Soll {formatNumber(entry.expected)} · Ist {formatNumber(entry.counted)}
                </span>
              )}
              {entry.note && <span>{entry.note}</span>}
            </td>
            <td className="number">
              {entry.delta === 0 ? "±0" : `${entry.delta > 0 ? "+" : "−"}${formatNumber(Math.abs(entry.delta))}`}
            </td>
            <td className="number">
              {formatNumber(entry.balance)} {unit}
            </td>
            <td>{entry.user ?? "–"}</td>
            <td>{entry.witness ?? (entry.kind === "administration" ? "nicht erforderlich" : "–")}</td>
          </tr>
        ))}
        {book.opening !== 0 && (
          <tr className="opening">
            <td colSpan={4}>Übertrag (Bestand vor der ersten Buchung)</td>
            <td className="number">
              {formatNumber(book.opening)} {unit}
            </td>
            <td colSpan={2} />
          </tr>
        )}
        {!book.entries.length && book.opening === 0 && (
          <tr>
            <td colSpan={7}>Noch keine Buchungen.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
