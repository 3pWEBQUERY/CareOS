"use client";

import { CareDatePicker, CareOptionSelect } from "@/app/components/care-form-controls";
import Image from "next/image";
import { useEffect, useState } from "react";
import { PortalConversation } from "@/app/components/portal-conversation";
import {
  ORDER_STATUSES,
  type PharmacyOrder,
  type PortalKind,
  type PortalResident,
  type PortalThread,
} from "@/lib/portal-shared";

export type PortalMe = {
  account: { displayName: string; kind: PortalKind; mustChangePassword: boolean };
  residents: PortalResident[];
};

export const dateTime = (value: string) =>
  new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
export const date = (value: string | null) =>
  value ? new Intl.DateTimeFormat("de-CH", { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`)) : "–";

export async function send<T>(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    cache: "no-store",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, payload: payload as (T & { error?: string }) | null };
}

// Nachrichten mit der Pflege: Unterhaltungen, neue Nachricht (optional zu einer Person mit Freigabe „Nachrichten“).
export function PortalMessages({ me }: { me: PortalMe }) {
  const [threads, setThreads] = useState<PortalThread[] | null>(null);
  const [selected, setSelected] = useState<PortalThread | null>(null);
  const [draft, setDraft] = useState<{ subject: string; residentId: string; body: string } | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const pharmacy = me.account.kind === "pharmacy";
  const writable = me.residents.filter((resident) => resident.areas.includes("messages"));
  const mayWrite = pharmacy || writable.length > 0;
  useEffect(() => {
    let live = true;
    void send<{ threads: PortalThread[] }>("/api/portal/messages", "GET").then((result) => {
      if (!live) return;
      if (result.ok) setThreads(result.payload?.threads ?? []);
      else setError(result.payload?.error ?? "Nachrichten konnten nicht geladen werden.");
    });
    return () => {
      live = false;
    };
  }, [version]);
  const open = async (id: string) => {
    const result = await send<PortalThread>(`/api/portal/messages/${id}`, "GET");
    if (result.ok && result.payload) setSelected(result.payload);
    else setError(result.payload?.error ?? "Die Unterhaltung konnte nicht geladen werden.");
  };
  return (
    <div className="portal-messages-grid">
      <section className="portal-card">
        <h2>Nachrichten</h2>
        {error && <p className="portal-error">{error}</p>}
        {mayWrite ? (
          <button
            className="primary-button"
            type="button"
            onClick={() => setDraft({ subject: "", residentId: pharmacy ? "" : (writable[0]?.id ?? ""), body: "" })}
          >
            Neue Nachricht
          </button>
        ) : (
          <p className="portal-note">Nachrichten an die Pflege sind für diesen Zugang nicht freigegeben.</p>
        )}
        <ul className="portal-thread-list">
          {(threads ?? []).map((thread) => (
            <li key={thread.id}>
              <button
                type="button"
                className={thread.unread ? "unread" : ""}
                aria-pressed={selected?.id === thread.id}
                onClick={() => void open(thread.id)}
              >
                <strong>{thread.subject}</strong>
                <small>
                  {thread.residentName ?? "Allgemein"} · {dateTime(thread.lastMessageAt)}
                </small>
                <small translate="no">{thread.lastMessage}</small>
              </button>
            </li>
          ))}
          {threads && !threads.length && <li className="portal-note">Noch keine Nachrichten.</li>}
        </ul>
      </section>
      <section className="portal-card">
        {draft ? (
          <form
            className="portal-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const result = await send<{ threadId: string }>("/api/portal/messages", "POST", {
                subject: draft.subject,
                residentId: draft.residentId || null,
                body: draft.body,
              });
              if (!result.ok || !result.payload) return setError(result.payload?.error ?? "Senden fehlgeschlagen.");
              setDraft(null);
              setError("");
              setVersion((value) => value + 1);
              await open(result.payload.threadId);
            }}
          >
            <h2>Neue Nachricht an die Pflege</h2>
            {(writable.length > 0 || pharmacy) && (
              <label>
                Betrifft
                <CareOptionSelect
                  label="Betrifft"
                  value={draft.residentId}
                  options={[
                    ...(pharmacy ? [{ value: "", label: "Allgemein (Einrichtung)" }] : []),
                    ...writable.map((resident) => ({ value: resident.id, label: resident.name })),
                  ]}
                  onChange={(value) => setDraft({ ...draft, residentId: value })}
                />
              </label>
            )}
            <label>
              Betreff
              <input
                value={draft.subject}
                maxLength={160}
                onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
              />
            </label>
            <label>
              Nachricht
              <textarea
                rows={5}
                value={draft.body}
                maxLength={4000}
                onChange={(event) => setDraft({ ...draft, body: event.target.value })}
              />
            </label>
            <div className="portal-top-actions">
              <button className="primary-button" type="submit" disabled={!draft.subject.trim() || !draft.body.trim()}>
                Senden
              </button>
              <button className="secondary-button" type="button" onClick={() => setDraft(null)}>
                Abbrechen
              </button>
            </div>
          </form>
        ) : selected ? (
          <PortalConversation
            thread={selected}
            own="portal"
            onReply={async (body) => {
              const result = await send("/api/portal/messages", "POST", { threadId: selected.id, body });
              if (!result.ok) throw new Error(result.payload?.error ?? "Senden fehlgeschlagen.");
              await open(selected.id);
              setVersion((value) => value + 1);
            }}
          />
        ) : (
          <p className="portal-note">Unterhaltung wählen oder eine neue Nachricht schreiben.</p>
        )}
      </section>
    </div>
  );
}

// Apotheke: Bestellungen der Einrichtung bestätigen, als geliefert melden oder ablehnen.
export function PortalOrders() {
  const [orders, setOrders] = useState<PharmacyOrder[] | null>(null);
  const [inputs, setInputs] = useState<Record<string, { note: string; expectedOn: string }>>({});
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    void send<{ orders: PharmacyOrder[] }>("/api/portal/orders", "GET").then((result) => {
      if (!live) return;
      if (result.ok) setOrders(result.payload?.orders ?? []);
      else setError(result.payload?.error ?? "Bestellungen konnten nicht geladen werden.");
    });
    return () => {
      live = false;
    };
  }, [version]);
  const update = async (order: PharmacyOrder, status: "confirmed" | "delivered" | "rejected") => {
    const input = inputs[order.id] ?? { note: "", expectedOn: "" };
    const result = await send(`/api/portal/orders/${order.id}`, "PATCH", {
      status,
      note: input.note,
      expectedOn: input.expectedOn || null,
    });
    if (!result.ok) return setError(result.payload?.error ?? "Die Bestellung konnte nicht aktualisiert werden.");
    setError("");
    setVersion((value) => value + 1);
  };
  return (
    <section className="portal-card">
      <h2>Bestellungen der Einrichtung</h2>
      {error && <p className="portal-error">{error}</p>}
      <ul className="portal-list">
        {(orders ?? []).map((order) => {
          const input = inputs[order.id] ?? { note: "", expectedOn: "" };
          const setInput = (change: Partial<typeof input>) =>
            setInputs((current) => ({ ...current, [order.id]: { ...input, ...change } }));
          const active = order.status === "open" || order.status === "confirmed";
          return (
            <li key={order.id} className="portal-order">
              <strong>
                {ORDER_STATUSES[order.status]} · {dateTime(order.createdAt)}
              </strong>
              <small>
                {[order.careUnit, order.residentName, order.requestedBy && `bestellt von ${order.requestedBy}`]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
              <ul className="portal-order-items" translate="no">
                {order.items.map((item, index) => (
                  <li key={index}>
                    {item.quantity} {item.unit} {item.medication} {item.strength}
                    {item.note ? ` – ${item.note}` : ""}
                  </li>
                ))}
              </ul>
              {order.note && <p translate="no">Hinweis der Einrichtung: {order.note}</p>}
              {order.pharmacyNote && <p translate="no">Ihr Vermerk: {order.pharmacyNote}</p>}
              {order.expectedOn && <p>Lieferung voraussichtlich {date(order.expectedOn)}</p>}
              {active && (
                <div className="portal-order-actions">
                  <label>
                    Vermerk
                    <input
                      value={input.note}
                      maxLength={2000}
                      onChange={(event) => setInput({ note: event.target.value })}
                    />
                  </label>
                  <label>
                    Liefertag
                    <CareDatePicker
                      label="Liefertag"
                      value={input.expectedOn}
                      onChange={(value) => setInput({ expectedOn: value })}
                    />
                  </label>
                  {order.status === "open" && (
                    <button className="primary-button" type="button" onClick={() => void update(order, "confirmed")}>
                      Bestätigen
                    </button>
                  )}
                  <button className="secondary-button" type="button" onClick={() => void update(order, "delivered")}>
                    Geliefert
                  </button>
                  <button className="quiet-button" type="button" onClick={() => void update(order, "rejected")}>
                    Ablehnen
                  </button>
                </div>
              )}
            </li>
          );
        })}
        {orders && !orders.length && <li>Keine Bestellungen.</li>}
      </ul>
    </section>
  );
}

// Hilfe: So funktioniert das Portal. Die Bilder stammen aus dem Portal mit Testdaten (scripts/portal-help-screenshots.ts).
const HELP_STEPS: Array<{ title: string; image: string; alt: string; text: string[] }> = [
  {
    title: "1. Anmelden",
    image: "/portal-hilfe/01-anmeldung.png",
    alt: "Anmeldeseite des Portals mit Benutzername und Passwort",
    text: [
      "Die Einrichtung richtet Ihren Zugang ein und übergibt Ihnen Benutzername und Einmal-Passwort persönlich.",
      "Öffnen Sie das Portal unter /portal, geben Sie beides ein und wählen Sie „Anmelden“.",
    ],
  },
  {
    title: "2. Eigenes Passwort festlegen",
    image: "/portal-hilfe/02-passwort.png",
    alt: "Formular zum Festlegen eines eigenen Passworts",
    text: [
      "Bei der ersten Anmeldung ersetzen Sie das Einmal-Passwort durch ein eigenes (mindestens 12 Zeichen, Buchstaben und Ziffern).",
      "Erst danach zeigt das Portal Daten an.",
    ],
  },
  {
    title: "3. Freigegebene Daten ansehen",
    image: "/portal-hilfe/03-personen.png",
    alt: "Übersicht einer Person mit Notfalldaten und Medikation",
    text: [
      "Unter „Personen“ sehen Sie nur die Personen und Bereiche, die die Einrichtung für Sie freigegeben hat – zum Beispiel Medikation, Vitalwerte oder Termine.",
      "Das Portal ist nur zum Lesen. Jeder Abruf wird protokolliert.",
      "Ärztinnen und Ärzte mit Freigabe „Visite“ sehen dort die offenen Fragen der Pflege und erfassen ihre Rückmeldung direkt; sie steht danach mit ihrem Namen in der Pflegedokumentation.",
    ],
  },
  {
    title: "4. Nachrichten mit der Pflege",
    image: "/portal-hilfe/04-nachrichten.png",
    alt: "Unterhaltung zwischen Angehöriger und Pflege",
    text: [
      "Unter „Nachrichten“ schreiben Sie der Pflege – mit „Neue Nachricht“, Betreff und Text – und lesen die Antworten.",
      "Nachrichten sind möglich, wenn die Einrichtung den Bereich „Nachrichten“ für Sie freigegeben hat. In Notfällen rufen Sie bitte die Einrichtung an.",
    ],
  },
  {
    title: "5. Für Apotheken: Bestellungen",
    image: "/portal-hilfe/05-bestellungen.png",
    alt: "Bestellung der Einrichtung mit den Knöpfen Bestätigen, Geliefert und Ablehnen",
    text: [
      "Apotheken sehen unter „Bestellungen“ die an sie gerichteten Bestellungen der Einrichtung.",
      "„Bestätigen“ (mit voraussichtlichem Liefertag), „Geliefert“ oder „Ablehnen“ (mit Grund) meldet der Einrichtung den Stand sofort.",
    ],
  },
];

export function PortalHelp() {
  return (
    <section className="portal-card portal-help" aria-labelledby="portal-help-title">
      <h2 id="portal-help-title">So funktioniert das Portal</h2>
      <p className="portal-note">
        Das Portal zeigt Angehörigen, Ärztinnen/Ärzten und Apotheken die Informationen, die die Einrichtung für sie
        freigegeben hat. Oben rechts wählen Sie die Sprache und melden sich ab.
      </p>
      {HELP_STEPS.map((step) => (
        <figure key={step.image}>
          <h3>{step.title}</h3>
          <ol>
            {step.text.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          <Image src={step.image} alt={step.alt} width={1200} height={750} />
          <figcaption>{step.alt}</figcaption>
        </figure>
      ))}
      <h3>Datenschutz</h3>
      <ol>
        <li>Ihr Zugang ist persönlich. Geben Sie Ihr Passwort nicht weiter.</li>
        <li>Die Einrichtung kann Freigaben jederzeit ändern oder widerrufen; die Sitzung endet nach 12 Stunden.</li>
        <li>Bei Fragen zu Ihrem Zugang wenden Sie sich an die Einrichtung.</li>
      </ol>
    </section>
  );
}
