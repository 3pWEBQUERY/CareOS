"use client";

import { useCountry, useTerms } from "@/app/components/care-context";
import { useRef, useState, type ChangeEvent } from "react";
import Image from "next/image";
import { Camera } from "@phosphor-icons/react";
import { PHOTO_ACCEPT, preparePhoto } from "@/lib/resident-photo-client";
import { todayInZurich, useApiData } from "@/app/components/workspace-ui";
import { useEscapeClose } from "@/app/components/use-escape-close";
import { NOT_ASSESSED, careLevelOptions } from "@/lib/country";
import { CareDatePicker, CareOptionSelect, CareSelect, formatCareDate } from "../../components/care-form-controls";
import { Icon } from "./residents-utils";

type IntakeOptions = {
  units: Array<{ id: string; name: string }>;
  rooms: Array<{ id: string; name: string; careUnitId: string; free: number }>;
  staff: Array<{ id: string; name: string }>;
  primaryCareUnitId: string | null;
};

const NO_NURSE = "Noch nicht festgelegt";

type Props = { open: boolean; onClose: () => void; onSuccess: (message: string) => void };

// Rendered only while open, so every admission starts with an empty form.
export function ResidentIntakeEditor(props: Props) {
  return props.open ? <IntakeForm {...props} /> : null;
}

function IntakeForm({ onClose, onSuccess }: Props) {
  const t = useTerms();
  const options = useApiData<IntakeOptions>("/api/residents/intake-options");
  const units = options.data?.units ?? [];
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState("Weiblich");
  const [admissionDate, setAdmissionDate] = useState(todayInZurich);
  const [chosenUnitId, setUnitId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState("");
  const country = useCountry();
  const [careLevel, setCareLevel] = useState(NOT_ASSESSED);
  const [nurseId, setNurseId] = useState<string | null>(null);
  const [status, setStatus] = useState("Aktiv");
  // Until chosen: the own care unit, otherwise the first one.
  const unitId =
    chosenUnitId ?? units.find((item) => item.id === options.data?.primaryCareUnitId)?.id ?? units[0]?.id ?? null;
  const unit = units.find((item) => item.id === unitId)?.name ?? "";
  const unitRooms = (options.data?.rooms ?? []).filter((item) => item.careUnitId === unitId);
  const room = unitRooms.find((item) => item.id === roomId)?.name ?? "";
  const nurse = options.data?.staff.find((item) => item.id === nurseId)?.name ?? NO_NURSE;
  const [note, setNote] = useState("");
  // Optionales Bild der Person, im Browser verkleinert; wird mit der Aufnahme gespeichert.
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEscapeClose(() => !saving && onClose());
  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError("");
    try {
      setPhoto(await preparePhoto(file));
    } catch (cause) {
      setPhotoError(cause instanceof Error ? cause.message : "Bild konnte nicht verarbeitet werden.");
    } finally {
      setPhotoBusy(false);
      if (photoInput.current) photoInput.current.value = "";
    }
  }
  async function submitIntake(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!birthDate) {
      setError("Bitte das Geburtsdatum wählen.");
      return;
    }
    if (!room) {
      setError("Bitte ein Zimmer wählen.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/residents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName,
          birthDate,
          gender,
          admissionDate,
          careUnitId: unitId,
          roomId,
          careLevel,
          primaryNurseId: nurseId,
          status,
          note,
          photoDataUrl: photo,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Aufnahme fehlgeschlagen.");
      onClose();
      onSuccess(`${firstName} ${lastName} wurde aufgenommen und ${unit} zugewiesen${photo ? " (mit Bild)" : ""}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Aufnahme fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }
  const fullName = `${firstName} ${lastName}`.trim();
  const initials = `${firstName.trim()[0] ?? ""}${lastName.trim()[0] ?? ""}`.toUpperCase();
  return (
    <div
      className="area-editor-overlay"
      role="presentation"
      onMouseDown={(event) => event.currentTarget === event.target && onClose()}
    >
      <section
        className="area-editor-panel resident-intake-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="resident-intake-title"
      >
        <header className="area-editor-header">
          <div>
            <p className="eyebrow">CareOS {t.many} · Aufnahme</p>
            <h2 id="resident-intake-title">{t.oneOblique} aufnehmen</h2>
            <p>Erstelle die {t.prefix}akte und weise die Person direkt einem Zimmer und einer Bezugspflege zu.</p>
          </div>
          <button className="area-editor-close" type="button" onClick={onClose} aria-label="Aufnahmeeditor schliessen">
            ×
          </button>
        </header>
        <form className="area-editor-form" onSubmit={submitIntake}>
          <div className="area-editor-intro">
            <span className="area-editor-icon">
              <Icon name="residents" />
            </span>
            <div>
              <strong>Neue {t.prefix}akte</strong>
              <p>Weitere Angaben wie Hausarzt, Kontakte und Versicherung folgen danach in den Stammdaten.</p>
            </div>
            <span className="duty-assignment-status">
              <i />
              Aufnahme vorbereiten
            </span>
          </div>
          <div className="area-editor-grid">
            <div className="area-editor-wide intake-photo">
              <button
                className="resident-avatar record-photo-trigger"
                type="button"
                aria-label={photo ? `${t.prefix}bild ändern` : `${t.prefix}bild hinzufügen`}
                title={photo ? `${t.prefix}bild ändern` : `${t.prefix}bild hinzufügen`}
                disabled={photoBusy || saving}
                onClick={() => photoInput.current?.click()}
              >
                {photo ? (
                  <Image
                    src={photo}
                    alt={`Bild von ${fullName || "der neuen Person"}`}
                    width={64}
                    height={64}
                    unoptimized
                  />
                ) : (
                  <span>{initials || <Icon name="residents" />}</span>
                )}
                <span className="record-photo-camera" aria-hidden="true">
                  <Camera />
                </span>
              </button>
              <div>
                <strong>{t.prefix}bild</strong>
                <small>
                  {photoBusy
                    ? "Bild wird vorbereitet …"
                    : photo
                      ? "Wird mit der Aufnahme gespeichert. In der Akte jederzeit änderbar."
                      : "Optional · Foto aufnehmen oder Bild wählen (JPEG, PNG, WebP oder HEIC)."}
                </small>
                {photoError && (
                  <small className="intake-photo-error" role="alert">
                    {photoError}
                  </small>
                )}
              </div>
              <span className="intake-photo-actions">
                <button
                  type="button"
                  className="death-checklist-action"
                  disabled={photoBusy || saving}
                  onClick={() => photoInput.current?.click()}
                >
                  {photo ? "Bild ändern" : "Bild hinzufügen"}
                </button>
                {photo && (
                  <button
                    type="button"
                    className="death-checklist-action"
                    disabled={saving}
                    onClick={() => {
                      setPhoto(null);
                      setPhotoError("");
                    }}
                  >
                    Entfernen
                  </button>
                )}
              </span>
              <input
                ref={photoInput}
                className="record-photo-input"
                type="file"
                accept={PHOTO_ACCEPT}
                onChange={choosePhoto}
                tabIndex={-1}
                aria-hidden="true"
              />
            </div>
            <label>
              Vorname
              <input
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                placeholder="z. B. Elisabeth"
                required
              />
            </label>
            <label>
              Nachname
              <input
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                placeholder="z. B. Weber"
                required
              />
            </label>
            <label>
              Geburtsdatum
              <CareDatePicker
                label="Geburtsdatum"
                value={birthDate}
                onChange={setBirthDate}
                max={admissionDate}
                placeholder="Geburtsdatum wählen"
                yearSelect
                showToday={false}
                openAtYear={Number(admissionDate.slice(0, 4)) - 85}
              />
            </label>
            <label>
              Geschlecht
              <CareSelect
                label="Geschlecht"
                value={gender}
                options={["Weiblich", "Männlich", "Divers", "Keine Angabe"]}
                onChange={setGender}
              />
            </label>
            <label>
              Eintrittsdatum
              <CareDatePicker label="Eintrittsdatum" value={admissionDate} onChange={setAdmissionDate} />
            </label>
            <label>
              {country.careLevels.label}
              <CareSelect
                label={country.careLevels.label}
                value={careLevel}
                options={[NOT_ASSESSED, ...careLevelOptions(country.code)]}
                onChange={setCareLevel}
              />
            </label>
            <label>
              Wohnbereich
              <CareSelect
                label="Wohnbereich"
                value={unit || (options.loading ? "Wird geladen …" : "Kein Wohnbereich")}
                options={units.map((item) => item.name)}
                onChange={(name) => {
                  setUnitId(units.find((item) => item.name === name)?.id ?? null);
                  setRoomId("");
                }}
              />
            </label>
            <label>
              Zimmer
              <CareOptionSelect
                label="Zimmer"
                value={roomId}
                placeholder={
                  options.loading ? "Wird geladen …" : unitRooms.length ? "Zimmer wählen" : "Keine Zimmer erfasst"
                }
                disabled={!unitRooms.length}
                options={unitRooms.map((item) => ({
                  value: item.id,
                  label: `${item.name} · ${item.free > 0 ? `${item.free} Bett${item.free === 1 ? "" : "en"} frei` : "belegt"}`,
                  disabled: item.free < 1,
                }))}
                onChange={setRoomId}
              />
              {!options.loading && !unitRooms.some((item) => item.free > 0) && (
                <small className="intake-room-hint">
                  {unitRooms.length ? "Kein Bett frei." : "Für diesen Wohnbereich sind keine Zimmer erfasst."} Zimmer
                  legt die Administration unter „Belegung“ an.
                </small>
              )}
            </label>
            <label>
              Bezugspflege
              <CareSelect
                label="Bezugspflege"
                value={nurse}
                options={[NO_NURSE, ...(options.data?.staff ?? []).map((item) => item.name)]}
                onChange={(name) => setNurseId(options.data?.staff.find((item) => item.name === name)?.id ?? null)}
              />
            </label>
            <label>
              Status
              <CareSelect
                label="Status"
                value={status}
                options={["Aktiv", "Eintritt geplant", "Vorläufig"]}
                onChange={setStatus}
              />
            </label>
            <label className="area-editor-wide">
              Hinweis zur Aufnahme
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="z. B. Angehörige, Diagnosen oder wichtige Hinweise …"
                rows={5}
              />
            </label>
          </div>
          <div className="duty-assignment-summary">
            <span>
              <strong>{fullName || `Neue ${t.prefix}akte`}</strong>
              <small>{[room || "Zimmer offen", unit, careLevel].filter(Boolean).join(" · ")}</small>
            </span>
            <span>
              <strong>Eintritt {formatCareDate(admissionDate)}</strong>
              <small>
                Bezugspflege: {nurse} · {status}
              </small>
            </span>
          </div>
          <footer className="area-editor-actions">
            <button className="secondary-button" type="button" onClick={onClose}>
              Abbrechen
            </button>
            <button className="primary-button" type="submit" disabled={saving || photoBusy || !unitId}>
              <Icon name="check" /> {saving ? "Speichern…" : `${t.oneOblique} aufnehmen`}
            </button>
          </footer>
          {(error || options.error) && (
            <p className="appointment-editor-error" role="alert">
              {error || options.error}
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
