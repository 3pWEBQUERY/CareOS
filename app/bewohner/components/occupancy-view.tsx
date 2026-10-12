"use client";

import Link from "next/link";
import { useState } from "react";
import { setCareResident, useTerms } from "@/app/components/care-context";
import { CareDatePicker, CareOptionSelect } from "@/app/components/care-form-controls";
import ModulePageShell from "@/app/components/module-page-shell";
import { ResuscitationBadge } from "@/app/components/resuscitation-badge";
import {
  EditorDialog,
  EmptyState,
  LoadError,
  PageHeading,
  ReasonDialog,
  SummaryTiles,
  formatDate,
  requestJson,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import {
  WAITLIST_STATUS,
  type OccupancyOverview,
  type OccupancyRoom,
  type OccupancyUnit,
  type PlannedAdmission,
  type WaitlistEntry,
} from "@/lib/occupancy-shared";

type WaitlistDraft = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  desiredCareUnitId: string;
  desiredFrom: string;
  registeredOn: string;
  note: string;
};

const draftOf = (item: WaitlistEntry | null, today: string): WaitlistDraft => ({
  firstName: item?.firstName ?? "",
  lastName: item?.lastName ?? "",
  dateOfBirth: item?.dateOfBirth ?? "",
  contactName: item?.contactName ?? "",
  contactPhone: item?.contactPhone ?? "",
  contactEmail: item?.contactEmail ?? "",
  desiredCareUnitId: item?.desiredCareUnitId ?? "",
  desiredFrom: item?.desiredFrom ?? "",
  registeredOn: item?.registeredOn ?? today,
  note: item?.note ?? "",
});

const freeBeds = (room: OccupancyRoom) => Math.max(0, room.beds - room.occupants.length);

// Optionales Datum: Auswahl „offen“ oder ein Datum.
function OptionalDate({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string;
  fallback: string;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <label>
        <span>{label}</span>
        <CareOptionSelect
          label={label}
          value={value ? "set" : ""}
          onChange={(choice) => onChange(choice ? value || fallback : "")}
          options={[
            { value: "", label: "Nicht angegeben" },
            { value: "set", label: "Datum angeben" },
          ]}
        />
      </label>
      {value && (
        <label>
          <span>{label} am</span>
          <CareDatePicker label={label} value={value} onChange={onChange} />
        </label>
      )}
    </>
  );
}

function WaitlistDialog({
  entry,
  overview,
  onClose,
  onSaved,
}: {
  entry: WaitlistEntry | null;
  overview: OccupancyOverview;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [draft, setDraft] = useState(() => draftOf(entry, overview.today));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof WaitlistDraft>(key: K, value: WaitlistDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  async function submit() {
    setSaving(true);
    setError("");
    const body = { ...draft, desiredCareUnitId: draft.desiredCareUnitId || null };
    try {
      if (entry) await requestJson(`/api/occupancy/waitlist/${entry.id}`, { method: "PATCH", body });
      else await requestJson("/api/occupancy/waitlist", { method: "POST", body });
      onSaved(entry ? "Eintrag gespeichert" : "Auf die Warteliste gesetzt");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="waitlist"
      eyebrow="Belegung & Eintritt"
      title={entry ? "Eintrag bearbeiten" : "Auf die Warteliste setzen"}
      description="Angaben zur Person und zum Bedarf, wie sie mitgeteilt wurden."
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Speichern"
    >
      <label>
        <span>Vorname</span>
        <input required maxLength={100} value={draft.firstName} onChange={(e) => set("firstName", e.target.value)} />
      </label>
      <label>
        <span>Nachname</span>
        <input required maxLength={100} value={draft.lastName} onChange={(e) => set("lastName", e.target.value)} />
      </label>
      <OptionalDate
        label="Geburtsdatum"
        value={draft.dateOfBirth}
        fallback="1940-01-01"
        onChange={(value) => set("dateOfBirth", value)}
      />
      <label>
        <span>Angemeldet am</span>
        <CareDatePicker label="Angemeldet am" value={draft.registeredOn} onChange={(v) => set("registeredOn", v)} />
      </label>
      <label>
        <span>Gewünschter Wohnbereich</span>
        <CareOptionSelect
          label="Gewünschter Wohnbereich"
          value={draft.desiredCareUnitId}
          onChange={(value) => set("desiredCareUnitId", value)}
          options={[
            { value: "", label: "Kein Wunsch" },
            ...overview.units.map((unit) => ({ value: unit.id, label: unit.name })),
          ]}
        />
      </label>
      <OptionalDate
        label="Gewünschter Eintritt"
        value={draft.desiredFrom}
        fallback={overview.today}
        onChange={(value) => set("desiredFrom", value)}
      />
      <label>
        <span>Kontaktperson (optional)</span>
        <input
          maxLength={160}
          value={draft.contactName}
          onChange={(e) => set("contactName", e.target.value)}
          placeholder="Name, Beziehung"
        />
      </label>
      <label>
        <span>Telefon (optional)</span>
        <input maxLength={60} value={draft.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} />
      </label>
      <label className="area-editor-wide">
        <span>E-Mail (optional)</span>
        <input
          type="email"
          maxLength={200}
          value={draft.contactEmail}
          onChange={(e) => set("contactEmail", e.target.value)}
        />
      </label>
      <label className="area-editor-wide">
        <span>Bedarf und Bemerkungen (optional)</span>
        <textarea
          rows={3}
          maxLength={4000}
          value={draft.note}
          onChange={(e) => set("note", e.target.value)}
          placeholder="z. B. Einstufung laut Abklärung, Wünsche zum Zimmer, Zeitpunkt"
        />
      </label>
    </EditorDialog>
  );
}

function AdmitDialog({
  entry,
  overview,
  onClose,
  onSaved,
}: {
  entry: WaitlistEntry;
  overview: OccupancyOverview;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const options = overview.units.flatMap((unit) =>
    unit.rooms
      .filter((room) => room.active && freeBeds(room) > 0)
      .map((room) => ({
        value: room.id,
        label: `${unit.name} · ${room.name} (${freeBeds(room)} ${freeBeds(room) === 1 ? "Bett" : "Betten"} frei)`,
        unitId: unit.id,
      })),
  );
  const preferred = options.find((option) => option.unitId === entry.desiredCareUnitId) ?? options[0];
  const [roomId, setRoomId] = useState(preferred?.value ?? "");
  const [day, setDay] = useState(
    entry.desiredFrom && entry.desiredFrom > overview.today ? entry.desiredFrom : overview.today,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!roomId) {
      setError("Bitte ein Zimmer mit freiem Bett wählen.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await requestJson(`/api/occupancy/waitlist/${entry.id}/admit`, {
        method: "POST",
        body: { roomId, admittedOn: day },
      });
      onSaved(`Eintritt für ${entry.firstName} ${entry.lastName} geplant`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="waitlist-admit"
      eyebrow={`${entry.firstName} ${entry.lastName}`}
      title="Eintritt planen"
      description="Das Bett ist ab jetzt reserviert. Am Eintrittstag wird der Eintritt bestätigt und die Akte vervollständigt."
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={
        error ||
        (options.length
          ? ""
          : "In den erfassten Zimmern ist kein Bett frei. Fehlende Zimmer legt die Administration unter „Zimmer anlegen“ an.")
      }
      submitLabel="Eintritt planen"
    >
      <label className="area-editor-wide">
        <span>Zimmer</span>
        <CareOptionSelect
          label="Zimmer"
          value={roomId}
          onChange={setRoomId}
          placeholder="Kein freies Bett"
          options={options.map(({ value, label }) => ({ value, label }))}
        />
      </label>
      <label>
        <span>Eintritt am</span>
        <CareDatePicker label="Eintritt am" value={day} onChange={setDay} />
      </label>
    </EditorDialog>
  );
}

function ConfirmDialog({
  admission,
  today,
  onClose,
  onSaved,
}: {
  admission: PlannedAdmission;
  today: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [day, setDay] = useState(admission.admittedOn && admission.admittedOn < today ? admission.admittedOn : today);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setSaving(true);
    setError("");
    try {
      await requestJson(`/api/occupancy/admissions/${admission.id}/confirm`, {
        method: "POST",
        body: { admittedOn: day },
      });
      onSaved(`Eintritt von ${admission.name} bestätigt`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="admission-confirm"
      eyebrow={admission.name}
      title="Eintritt bestätigen"
      description={`${[admission.careUnit, admission.room].filter(Boolean).join(" · ")}. Die Person erscheint danach in allen Listen; Stammdaten und Pflegeplanung werden in der Akte ergänzt.`}
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Eintritt bestätigen"
    >
      <label>
        <span>Eingetreten am</span>
        <CareDatePicker label="Eingetreten am" value={day} onChange={setDay} />
      </label>
    </EditorDialog>
  );
}

type RoomDraft = { id: string | null; careUnitId: string; name: string; beds: string; active: string };

function RoomDialog({
  draft: initial,
  unitName,
  onClose,
  onSaved,
}: {
  draft: RoomDraft;
  unitName: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setSaving(true);
    setError("");
    const body = {
      careUnitId: draft.careUnitId,
      name: draft.name,
      beds: Number(draft.beds),
      active: draft.active === "yes",
    };
    try {
      if (draft.id) await requestJson(`/api/occupancy/rooms/${draft.id}`, { method: "PATCH", body });
      else await requestJson("/api/occupancy/rooms", { method: "POST", body });
      onSaved(draft.id ? "Zimmer gespeichert" : "Zimmer angelegt");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="room"
      eyebrow={unitName}
      title={draft.id ? "Zimmer bearbeiten" : "Zimmer anlegen"}
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Speichern"
    >
      <label>
        <span>Zimmer</span>
        <input
          required
          maxLength={80}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="z. B. Zimmer 105"
        />
      </label>
      <label>
        <span>Betten</span>
        <input
          required
          type="number"
          inputMode="numeric"
          min={1}
          max={20}
          value={draft.beds}
          onChange={(e) => setDraft({ ...draft, beds: e.target.value })}
        />
      </label>
      {draft.id && (
        <label>
          <span>Status</span>
          <CareOptionSelect
            label="Status"
            value={draft.active}
            onChange={(value) => setDraft({ ...draft, active: value })}
            options={[
              { value: "yes", label: "In Betrieb" },
              { value: "no", label: "Stillgelegt" },
            ]}
          />
        </label>
      )}
    </EditorDialog>
  );
}

function UnitCard({
  unit,
  canManageRooms,
  onRoom,
}: {
  unit: OccupancyUnit;
  canManageRooms: boolean;
  onRoom: (draft: RoomDraft) => void;
}) {
  const used = unit.places ? Math.min(100, ((unit.occupied + unit.reserved) / unit.places) * 100) : 0;
  return (
    <section className="card occupancy-unit" aria-label={`Belegung ${unit.name}`}>
      <header>
        <div>
          <h2 className="card-title">{unit.name}</h2>
          <p className="card-subtitle">
            {unit.occupied} von {unit.places} Plätzen belegt · {unit.reserved} reserviert ·{" "}
            <strong>{unit.free} frei</strong>
            {unit.places !== unit.beds && ` · ${unit.beds} Betten in Zimmern erfasst`}
          </p>
        </div>
        <div className="occupancy-actions">
          {unit.rooms.some((room) => room.active) && (
            <a
              className="secondary-button"
              href={`/c/bewohner/belegung/etiketten?unit=${unit.id}`}
              target="_blank"
              rel="noopener"
              aria-label={`QR-Etiketten ${unit.name} drucken`}
            >
              QR-Etiketten
            </a>
          )}
          {unit.occupied > 0 && (
            <a
              className="secondary-button"
              href={`/c/bewohner/belegung/evakuierung?unit=${unit.id}`}
              target="_blank"
              rel="noopener"
              aria-label={`Evakuierungsliste ${unit.name} drucken`}
            >
              Evakuierungsliste
            </a>
          )}
          {canManageRooms && (
            <button
              className="secondary-button"
              type="button"
              onClick={() => onRoom({ id: null, careUnitId: unit.id, name: "", beds: "1", active: "yes" })}
            >
              Zimmer anlegen
            </button>
          )}
        </div>
      </header>
      <div className="occupancy-bar" aria-hidden="true">
        <i style={{ width: `${used}%` }} />
      </div>
      <ul className="occupancy-rooms">
        {unit.rooms.map((room) => (
          <li key={room.id} className={room.active ? "" : "inactive"}>
            <div className="occupancy-room-head">
              <strong>{room.name}</strong>
              <small>
                {room.active
                  ? `${room.beds} ${room.beds === 1 ? "Bett" : "Betten"} · ${freeBeds(room)} frei`
                  : "Stillgelegt"}
              </small>
            </div>
            <div className="occupancy-occupants">
              {room.occupants.map((person) => (
                <span key={person.id} className={person.status}>
                  {person.name}
                  {person.status === "planned" && " (Eintritt geplant)"}
                  <ResuscitationBadge residentId={person.id} />
                  {person.status === "transferred" && " (verlegt)"}
                </span>
              ))}
            </div>
            {canManageRooms && (
              <button
                className="secondary-button"
                type="button"
                aria-label={`${room.name} bearbeiten`}
                onClick={() =>
                  onRoom({
                    id: room.id,
                    careUnitId: unit.id,
                    name: room.name,
                    beds: String(room.beds),
                    active: room.active ? "yes" : "no",
                  })
                }
              >
                Bearbeiten
              </button>
            )}
          </li>
        ))}
        {!unit.rooms.length && <li className="occupancy-empty">Noch keine Zimmer erfasst.</li>}
      </ul>
    </section>
  );
}

function OccupancyContent({ showToast }: { showToast: ShowToast }) {
  const t = useTerms();
  const data = useApiData<OccupancyOverview>("/api/occupancy");
  const overview = data.data;
  const [editing, setEditing] = useState<WaitlistEntry | null | "new">(null);
  const [admitting, setAdmitting] = useState<WaitlistEntry | null>(null);
  const [withdrawing, setWithdrawing] = useState<WaitlistEntry | null>(null);
  const [confirming, setConfirming] = useState<PlannedAdmission | null>(null);
  const [cancelling, setCancelling] = useState<PlannedAdmission | null>(null);
  const [room, setRoom] = useState<RoomDraft | null>(null);
  const done = (message: string) => {
    setEditing(null);
    setAdmitting(null);
    setConfirming(null);
    setRoom(null);
    showToast(message);
    data.reload();
  };
  const canWrite = overview?.canWrite ?? false;

  async function setStatus(entry: WaitlistEntry, status: "waiting" | "offered") {
    try {
      await requestJson(`/api/occupancy/waitlist/${entry.id}/status`, { method: "POST", body: { status } });
      showToast(status === "offered" ? "Platz angeboten" : "Wartet wieder");
      data.reload();
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
    }
  }

  return (
    <>
      <PageHeading
        eyebrow={`CareOS ${t.many}`}
        title="Belegung & Eintritt"
        description="Freie Plätze je Wohnbereich, geplante Eintritte und die Warteliste an einem Ort."
        action={canWrite ? { label: "Auf Warteliste setzen", onClick: () => setEditing("new") } : undefined}
      />
      <SummaryTiles
        label="Belegung"
        tiles={[
          { icon: "check", value: overview ? overview.totals.free : "–", caption: "freie Plätze", tone: "info" },
          {
            icon: "residents",
            value: overview ? `${overview.totals.occupied} / ${overview.totals.places}` : "–",
            caption: "Plätze belegt",
          },
          { icon: "calendar", value: overview ? overview.planned.length : "–", caption: "geplante Eintritte" },
          { icon: "tasks", value: overview ? overview.waitlist.length : "–", caption: "auf der Warteliste" },
        ]}
      />
      {data.error && <LoadError message={data.error} onRetry={data.reload} />}

      {overview && (
        <div className="occupancy-layout">
          <div className="occupancy-units">
            {overview.units.map((unit) => (
              <UnitCard key={unit.id} unit={unit} canManageRooms={overview.canManageRooms} onRoom={setRoom} />
            ))}
          </div>
          <div className="occupancy-side">
            <section className="card occupancy-planned" aria-label="Geplante Eintritte">
              <header>
                <h2 className="card-title">Geplante Eintritte</h2>
                <p className="card-subtitle">Bett reserviert, Eintritt noch nicht bestätigt</p>
              </header>
              {overview.planned.length ? (
                <ul>
                  {overview.planned.map((admission) => (
                    <li key={admission.id}>
                      <div>
                        <Link
                          href={`/c/bewohner?resident=${admission.id}`}
                          onClick={() => setCareResident(admission.id)}
                        >
                          {admission.name}
                        </Link>
                        <small>
                          {admission.admittedOn ? `Eintritt ${formatDate(admission.admittedOn)}` : "Datum offen"} ·{" "}
                          {[admission.careUnit, admission.room].filter(Boolean).join(" · ")}
                        </small>
                      </div>
                      {canWrite && (
                        <div className="occupancy-actions">
                          <button className="secondary-button" type="button" onClick={() => setConfirming(admission)}>
                            Eintritt bestätigen
                          </button>
                          <button className="secondary-button" type="button" onClick={() => setCancelling(admission)}>
                            Absagen
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="occupancy-empty">Keine geplanten Eintritte.</p>
              )}
            </section>

            <section className="card occupancy-waitlist" aria-label="Warteliste">
              <header>
                <h2 className="card-title">Warteliste</h2>
                <p className="card-subtitle">Nach Anmeldedatum; die Reihenfolge der Vergabe entscheidet die Leitung.</p>
              </header>
              {overview.waitlist.length ? (
                <ul>
                  {overview.waitlist.map((entry) => (
                    <li key={entry.id}>
                      <div className="waitlist-head">
                        <strong>
                          {entry.firstName} {entry.lastName}
                        </strong>
                        <span className={`status-badge ${entry.status === "offered" ? "info" : "stable"}`}>
                          {WAITLIST_STATUS[entry.status]}
                        </span>
                      </div>
                      <small>
                        {[
                          entry.dateOfBirth && `geb. ${formatDate(entry.dateOfBirth)}`,
                          `angemeldet ${formatDate(entry.registeredOn)}`,
                          entry.desiredCareUnit && `Wunsch: ${entry.desiredCareUnit}`,
                          entry.desiredFrom && `ab ${formatDate(entry.desiredFrom)}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                      {(entry.contactName || entry.contactPhone || entry.contactEmail) && (
                        <small>
                          Kontakt:{" "}
                          {[entry.contactName, entry.contactPhone, entry.contactEmail].filter(Boolean).join(" · ")}
                        </small>
                      )}
                      {entry.note && <p>{entry.note}</p>}
                      {entry.statusNote && <p className="waitlist-status-note">{entry.statusNote}</p>}
                      {canWrite && (
                        <div className="occupancy-actions">
                          <button className="secondary-button" type="button" onClick={() => setAdmitting(entry)}>
                            Eintritt planen
                          </button>
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => void setStatus(entry, entry.status === "offered" ? "waiting" : "offered")}
                          >
                            {entry.status === "offered" ? "Wartet wieder" : "Platz angeboten"}
                          </button>
                          <button className="secondary-button" type="button" onClick={() => setEditing(entry)}>
                            Bearbeiten
                          </button>
                          <button className="secondary-button" type="button" onClick={() => setWithdrawing(entry)}>
                            Zurückziehen
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon="tasks" title="Niemand auf der Warteliste" text="Anfragen hier erfassen." />
              )}
            </section>

            {overview.closed.length > 0 && (
              <section className="card occupancy-closed" aria-label="Abgeschlossene Anfragen">
                <header>
                  <h2 className="card-title">Abgeschlossen (180 Tage)</h2>
                </header>
                <ul>
                  {overview.closed.map((entry) => (
                    <li key={entry.id}>
                      <strong>
                        {entry.firstName} {entry.lastName}
                      </strong>
                      <small>
                        {WAITLIST_STATUS[entry.status]}
                        {entry.statusNote ? ` · ${entry.statusNote}` : ""}
                      </small>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}

      {editing && overview && (
        <WaitlistDialog
          entry={editing === "new" ? null : editing}
          overview={overview}
          onClose={() => setEditing(null)}
          onSaved={done}
        />
      )}
      {admitting && overview && (
        <AdmitDialog entry={admitting} overview={overview} onClose={() => setAdmitting(null)} onSaved={done} />
      )}
      {confirming && overview && (
        <ConfirmDialog
          admission={confirming}
          today={overview.today}
          onClose={() => setConfirming(null)}
          onSaved={done}
        />
      )}
      {room && overview && (
        <RoomDialog
          draft={room}
          unitName={overview.units.find((unit) => unit.id === room.careUnitId)?.name ?? ""}
          onClose={() => setRoom(null)}
          onSaved={done}
        />
      )}
      {withdrawing && (
        <ReasonDialog
          eyebrow="Belegung & Eintritt"
          title="Anfrage zurückziehen"
          description={`${withdrawing.firstName} ${withdrawing.lastName} wird von der Warteliste genommen.`}
          label="Grund"
          placeholder="z. B. anderer Platz gefunden, verstorben, kein Bedarf mehr"
          submitLabel="Zurückziehen"
          onClose={() => setWithdrawing(null)}
          onConfirm={async (note) => {
            await requestJson(`/api/occupancy/waitlist/${withdrawing.id}/status`, {
              method: "POST",
              body: { status: "withdrawn", note },
            });
            setWithdrawing(null);
            showToast("Anfrage zurückgezogen");
            data.reload();
          }}
        />
      )}
      {cancelling && (
        <ReasonDialog
          eyebrow="Belegung & Eintritt"
          title="Eintritt absagen"
          description={`Der geplante Eintritt von ${cancelling.name} wird abgesagt; das Bett wird frei. Kam die Person von der Warteliste, wartet sie dort wieder.`}
          label="Grund"
          placeholder="z. B. Eintritt verschoben, anderer Platz gewählt"
          submitLabel="Eintritt absagen"
          danger
          onClose={() => setCancelling(null)}
          onConfirm={async (reason) => {
            await requestJson(`/api/occupancy/admissions/${cancelling.id}/cancel`, {
              method: "POST",
              body: { reason },
            });
            setCancelling(null);
            showToast("Eintritt abgesagt");
            data.reload();
          }}
        />
      )}
    </>
  );
}

// Bewohner › Belegung: Plätze, geplante Eintritte und Warteliste.
export default function OccupancyView() {
  return (
    <ModulePageShell activeModule="residents" activeChild="Belegung" pageClass="occupancy-page">
      {(showToast) => (
        <main className="workspace module-workspace occupancy-workspace">
          <OccupancyContent showToast={showToast} />
        </main>
      )}
    </ModulePageShell>
  );
}
