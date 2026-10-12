"use client";

import { useState } from "react";
import { setCareResident, useHeaderResident, useTerms, useWorkContext } from "@/app/components/care-context";
import { CareDatePicker, CareOptionSelect } from "@/app/components/care-form-controls";
import HeaderResidentHint from "@/app/components/header-resident-hint";
import ModulePageShell from "@/app/components/module-page-shell";
import { ModuleIcon } from "@/app/components/module-icon";
import {
  EditorDialog,
  EmptyState,
  LoadError,
  PageHeading,
  ReasonDialog,
  SummaryTiles,
  formatDate,
  formatDateTime,
  requestJson,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import {
  FUND_KINDS,
  fundSign,
  formatMoney,
  parseMoney,
  type FundAccount,
  type FundCash,
  type FundEntry,
  type FundKind,
} from "@/lib/funds-shared";

const KIND_KEYS = Object.keys(FUND_KINDS) as FundKind[];

// Monate zur Auswahl: der aktuelle und die 23 davor.
export function monthOptions(today: string) {
  const [year, month] = today.split("-").map(Number);
  return Array.from({ length: 24 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - index, 1));
    const value = date.toISOString().slice(0, 7);
    const label = new Intl.DateTimeFormat("de-CH", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
    return { value, label };
  });
}

export const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("de-CH", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}-01T00:00:00Z`),
  );

function BookingDialog({
  residentId,
  residentName,
  account,
  onClose,
  onSaved,
}: {
  residentId: string;
  residentName: string;
  account: FundAccount;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [kind, setKind] = useState<FundKind | null>(null);
  const [amount, setAmount] = useState("");
  const [bookedOn, setBookedOn] = useState(account.today);
  const [purpose, setPurpose] = useState("");
  const [party, setParty] = useState("");
  const [receipt, setReceipt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const cents = parseMoney(amount);
  const after = kind && cents ? account.balanceCents + fundSign(kind) * cents : null;

  async function submit() {
    if (!kind) return setError("Bitte die Art der Buchung wählen.");
    if (!cents) return setError("Bitte einen gültigen Betrag eingeben (z. B. 20.00).");
    if (after !== null && after < 0)
      return setError(`Das Guthaben reicht nicht aus (${formatMoney(account.balanceCents, account.currency)}).`);
    setSaving(true);
    setError("");
    try {
      await requestJson("/api/funds", {
        method: "POST",
        body: { residentId, kind, amountCents: cents, bookedOn, purpose, party, receipt },
      });
      onSaved(`${residentName}: ${FUND_KINDS[kind]} über ${formatMoney(cents, account.currency)} gebucht`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="fund-booking"
      eyebrow={`${residentName} · Guthaben ${formatMoney(account.balanceCents, account.currency)}`}
      title="Buchung erfassen"
      description="Einzahlungen erhöhen das Guthaben, Auszahlungen und Ausgaben verringern es. Gebuchtes wird nicht geändert, sondern bei einem Fehler storniert."
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Buchen"
    >
      <fieldset className="area-editor-wide">
        <legend>Art</legend>
        <div className="repositioning-choices" role="group" aria-label="Art der Buchung">
          {KIND_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className={`day-toggle ${kind === key ? "active" : ""}`}
              aria-pressed={kind === key}
              onClick={() => setKind(key)}
            >
              {FUND_KINDS[key]}
            </button>
          ))}
        </div>
      </fieldset>
      <label>
        <span>{`Betrag (${account.currency})`}</span>
        <input
          inputMode="decimal"
          required
          placeholder="z. B. 20.00"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <CareDatePicker label="Datum" value={bookedOn} onChange={setBookedOn} max={account.today} />
      <label className="area-editor-wide">
        <span>Zweck</span>
        <input
          maxLength={300}
          required
          placeholder={
            kind === "deposit"
              ? "z. B. Taschengeld Oktober"
              : kind === "payout"
                ? "z. B. Bargeld für den Ausflug"
                : "z. B. Coiffeur, Fusspflege, Kiosk"
          }
          value={purpose}
          onChange={(event) => setPurpose(event.target.value)}
        />
      </label>
      <label>
        <span>
          {kind === "deposit" ? "Von (optional)" : kind === "expense" ? "An (optional)" : "Ausbezahlt an (optional)"}
        </span>
        <input
          maxLength={200}
          placeholder={
            kind === "deposit" ? "z. B. Tochter, Beistandschaft" : kind === "expense" ? "z. B. Coiffeur Muster" : ""
          }
          value={party}
          onChange={(event) => setParty(event.target.value)}
        />
      </label>
      <label>
        <span>Beleg-Nr. (optional)</span>
        <input maxLength={60} value={receipt} onChange={(event) => setReceipt(event.target.value)} />
      </label>
      {after !== null && (
        <p className="area-editor-wide fund-preview" data-state={after < 0 ? "negative" : undefined} role="status">
          Guthaben danach: {formatMoney(after, account.currency)}
        </p>
      )}
    </EditorDialog>
  );
}

function CountDialog({ cash, onClose, onSaved }: { cash: FundCash; onClose: () => void; onSaved: () => void }) {
  const [counted, setCounted] = useState("");
  const [witness, setWitness] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const cents = parseMoney(counted);
  const difference = cents === null ? null : cents - cash.totalCents;

  async function submit() {
    if (cents === null) return setError("Bitte den gezählten Betrag eingeben (z. B. 1250.00).");
    if (difference !== 0 && !note.trim()) return setError("Bitte die Differenz in der Bemerkung erklären.");
    setSaving(true);
    setError("");
    try {
      await requestJson("/api/funds/cash", { method: "POST", body: { countedCents: cents, witness, note } });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="fund-count"
      eyebrow={`Sollbestand ${formatMoney(cash.totalCents, cash.currency)}`}
      title="Kassenkontrolle"
      description="Bargeld in der Kasse zählen und mit der Summe aller Guthaben vergleichen. Eine Differenz wird mit Erklärung festgehalten."
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Speichern"
    >
      <label>
        <span>{`Gezählter Betrag (${cash.currency})`}</span>
        <input inputMode="decimal" required value={counted} onChange={(event) => setCounted(event.target.value)} />
      </label>
      <label>
        <span>Zweite Person (optional)</span>
        <input maxLength={200} value={witness} onChange={(event) => setWitness(event.target.value)} />
      </label>
      {difference !== null && (
        <p
          className="area-editor-wide fund-preview"
          data-state={difference !== 0 ? "negative" : "balanced"}
          role="status"
        >
          {difference === 0
            ? "Stimmt mit dem Sollbestand überein."
            : `Differenz: ${difference > 0 ? "+" : "−"}${formatMoney(Math.abs(difference), cash.currency)}`}
        </p>
      )}
      <label className="area-editor-wide">
        <span>{difference ? "Bemerkung (Erklärung der Differenz)" : "Bemerkung (optional)"}</span>
        <input maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
    </EditorDialog>
  );
}

function EntryItem({
  entry,
  currency,
  onCancel,
}: {
  entry: FundEntry;
  currency: string;
  onCancel: ((entry: FundEntry) => void) | null;
}) {
  const details = [entry.party, entry.receipt ? `Beleg ${entry.receipt}` : null, entry.author].filter(Boolean);
  const sign = fundSign(entry.kind);
  return (
    <li className={entry.cancelled ? "cancelled" : ""}>
      <time dateTime={entry.bookedOn}>{formatDate(entry.bookedOn)}</time>
      <div>
        <strong>
          {FUND_KINDS[entry.kind]} · {entry.purpose}
        </strong>
        {details.length > 0 && <small>{details.join(" · ")}</small>}
        {entry.cancelled && (
          <p className="service-cancel-reason">
            Storniert {formatDateTime(entry.cancelled.at)} von {entry.cancelled.by}: {entry.cancelled.reason}
          </p>
        )}
      </div>
      <span className="service-minutes fund-amount" data-direction={sign > 0 ? "in" : "out"}>
        {sign > 0 ? "+" : "−"}
        {formatMoney(entry.amountCents, currency)}
      </span>
      {onCancel && !entry.cancelled && (
        <button className="secondary-button" type="button" onClick={() => onCancel(entry)}>
          Stornieren
        </button>
      )}
    </li>
  );
}

function CashCard({ cash, onCount }: { cash: FundCash; onCount: () => void }) {
  const t = useTerms();
  const last = cash.counts[0];
  return (
    <section className="card service-records fund-cash" aria-labelledby="fund-cash-title">
      <header className="fund-cash-head">
        <div>
          <h2 className="card-title" id="fund-cash-title">
            Kasse
          </h2>
          <p className="card-subtitle">
            Sollbestand {formatMoney(cash.totalCents, cash.currency)}
            {last ? ` · zuletzt gezählt ${formatDateTime(last.countedAt)}` : " · noch keine Kassenkontrolle"}
          </p>
        </div>
        <button className="secondary-button" type="button" onClick={onCount}>
          Kassenkontrolle
        </button>
      </header>
      {!cash.accounts.length ? (
        <EmptyState
          icon="residents"
          title="Noch keine Konten"
          text={`Ein Konto entsteht mit der ersten Buchung für einen ${t.oneOblique}.`}
        />
      ) : (
        <ul aria-label="Guthaben je Person">
          {cash.accounts.map((account) => (
            <li key={account.residentId}>
              <div>
                <button type="button" className="fund-account-link" onClick={() => setCareResident(account.residentId)}>
                  {account.name}
                </button>
                <small>
                  {[account.room, account.unit, account.active ? "" : "ausgetreten"].filter(Boolean).join(" · ") || "–"}
                </small>
              </div>
              <span className="service-minutes">{formatMoney(account.balanceCents, cash.currency)}</span>
            </li>
          ))}
        </ul>
      )}
      {cash.counts.length > 0 && (
        <div className="fund-counts">
          <h3>Kassenkontrollen</h3>
          <ul aria-label="Kassenkontrollen">
            {cash.counts.map((count) => {
              const difference = count.countedCents - count.expectedCents;
              return (
                <li key={count.id} className={difference ? "fund-count-differs" : ""}>
                  <div>
                    <strong>
                      {formatDateTime(count.countedAt)} · gezählt {formatMoney(count.countedCents, cash.currency)}
                    </strong>
                    <small>
                      {[
                        difference
                          ? `Differenz ${difference > 0 ? "+" : "−"}${formatMoney(Math.abs(difference), cash.currency)}`
                          : "stimmt",
                        count.countedBy,
                        count.witness ? `mit ${count.witness}` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                    {count.note && <p>{count.note}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function FundsContent({ showToast }: { showToast: ShowToast }) {
  const t = useTerms();
  const context = useWorkContext();
  const residents = context?.residents ?? [];
  const { resident, missing } = useHeaderResident(residents, !context);
  const [month, setMonth] = useState("");
  const [booking, setBooking] = useState(false);
  const [counting, setCounting] = useState(false);
  const [cancelling, setCancelling] = useState<FundEntry | null>(null);
  const data = useApiData<FundAccount>(
    resident ? `/api/funds?residentId=${resident.id}${month ? `&month=${month}` : ""}` : null,
  );
  const cash = useApiData<FundCash>("/api/funds/cash");
  const account = data.data?.residentId === resident?.id ? data.data : null;
  const canWrite = account?.canWrite ?? false;
  const currency = account?.currency ?? cash.data?.currency ?? "";
  const money = (cents: number | undefined) => (cents === undefined || !currency ? "–" : formatMoney(cents, currency));
  const reload = () => {
    data.reload();
    cash.reload();
  };
  const done = (message: string) => {
    setBooking(false);
    setCancelling(null);
    setCounting(false);
    showToast(message);
    reload();
  };
  const shownMonth = account?.month ?? month;

  return (
    <>
      <PageHeading
        eyebrow={`CareOS ${t.many}`}
        title={`${t.prefix}gelder`}
        description={`Barbetrag bzw. Taschengeld je ${t.one} in der Kasse der Einrichtung: Einzahlungen, Auszahlungen und Ausgaben mit Beleg, Kontoauszug je Monat und Kassenkontrolle.`}
        action={
          resident && account && canWrite ? { label: "Buchung erfassen", onClick: () => setBooking(true) } : undefined
        }
      />
      {!resident ? (
        <HeaderResidentHint loading={!context} missing={missing} />
      ) : (
        <>
          <section className="service-toolbar">
            {account && (
              <CareOptionSelect
                label="Monat"
                value={shownMonth}
                onChange={setMonth}
                options={monthOptions(account.today)}
              />
            )}
            <a
              className="secondary-button"
              href={`/c/bewohner/gelder/drucken?residentId=${resident.id}${shownMonth ? `&month=${shownMonth}` : ""}`}
              target="_blank"
              rel="noreferrer"
            >
              <ModuleIcon name="docs" className="button-icon" /> Kontoauszug drucken
            </a>
            <p>
              {resident.name} · {resident.room}
            </p>
          </section>
          <SummaryTiles
            label="Konto"
            className="fund-summary"
            tiles={[
              { icon: "check", value: money(account?.balanceCents), caption: "Guthaben heute" },
              { icon: "plus", value: money(account?.depositsCents), caption: "Einzahlungen im Monat" },
              { icon: "note", value: money(account?.withdrawalsCents), caption: "Auszahlungen und Ausgaben im Monat" },
            ]}
          />
          {data.error && <LoadError message={data.error} onRetry={data.reload} />}
        </>
      )}
      <div className="service-layout fund-layout">
        {resident ? (
          <section
            className="card service-records repositioning-entries fund-entries"
            aria-labelledby="fund-entries-title"
          >
            <header>
              <h2 className="card-title" id="fund-entries-title">
                Buchungen {shownMonth ? monthLabel(shownMonth) : ""}
              </h2>
              <p className="card-subtitle">
                {account
                  ? `Anfangsbestand ${money(account.openingCents)} · Endbestand ${money(account.closingCents)}`
                  : "Wird geladen …"}
              </p>
            </header>
            {account && !account.entries.length ? (
              <EmptyState icon="note" title="Keine Buchungen" text="Im gewählten Monat ist nichts gebucht." />
            ) : (
              <ul>
                {account?.entries.map((entry) => (
                  <EntryItem
                    key={entry.id}
                    entry={entry}
                    currency={account.currency}
                    onCancel={canWrite ? setCancelling : null}
                  />
                ))}
              </ul>
            )}
          </section>
        ) : (
          <div />
        )}
        {cash.error && <LoadError message={cash.error} onRetry={cash.reload} />}
        {cash.data && <CashCard cash={cash.data} onCount={() => setCounting(true)} />}
      </div>
      {booking && resident && account && (
        <BookingDialog
          residentId={resident.id}
          residentName={resident.name}
          account={account}
          onClose={() => setBooking(false)}
          onSaved={done}
        />
      )}
      {counting && cash.data && (
        <CountDialog
          cash={cash.data}
          onClose={() => setCounting(false)}
          onSaved={() => done("Kassenkontrolle gespeichert")}
        />
      )}
      {cancelling && account && (
        <ReasonDialog
          title="Buchung stornieren"
          description={`„${FUND_KINDS[cancelling.kind]} · ${cancelling.purpose}“ über ${formatMoney(cancelling.amountCents, account.currency)} bleibt sichtbar, zählt aber nicht mehr.`}
          label="Grund der Stornierung"
          placeholder="z. B. doppelt gebucht, falscher Betrag"
          submitLabel="Stornieren"
          danger
          onClose={() => setCancelling(null)}
          onConfirm={async (reason) => {
            await requestJson(`/api/funds/${cancelling.id}/cancel`, { method: "POST", body: { reason } });
            done("Buchung storniert");
          }}
        />
      )}
    </>
  );
}

// Bewohner › Bewohnergelder: Konto der Person in der Kopfzeile und die Kasse der Einrichtung.
export default function FundsView() {
  return (
    <ModulePageShell activeModule="residents" activeChild="Bewohnergelder" pageClass="residents-page funds-page">
      {(showToast) => (
        <main className="workspace module-workspace">
          <FundsContent showToast={showToast} />
        </main>
      )}
    </ModulePageShell>
  );
}
