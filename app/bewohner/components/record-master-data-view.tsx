"use client";

import { useCountry, useTerms, useWorkContext } from "@/app/components/care-context";
import { useState } from "react";
import { CalendarDots, Check, ClipboardText, PencilSimple, Plus, Trash, User } from "@phosphor-icons/react";
import { formatDate, formatDateTime, requestJson, todayInZurich, useApiData } from "@/app/components/workspace-ui";
import { CareDatePicker, CareOptionSelect } from "@/app/components/care-form-controls";
import { announceResuscitationChange } from "@/app/components/resuscitation-badge";
import {
  LANGUAGES,
  MARITAL_STATUSES,
  RELIGIONS,
  RESUSCITATION_STATUSES,
  type MasterData,
  type RecordSummary,
  type ResuscitationStatus,
} from "@/lib/resident-record-shared";
import type { ResidentRecordState } from "./use-resident-record";
import { EVACUATION_MOBILITY, EVACUATION_MOBILITY_KEYS } from "@/lib/evacuation-shared";
import { RecordDiagnosesCard } from "./record-diagnoses-card";
import { RecordVaccinationsCard } from "./record-vaccinations-card";
import { RecordBelongingsCard } from "./record-belongings-card";
import { RecordConsentsCard } from "./record-consents-card";
import { RecordEndOfLifeCards } from "./record-end-of-life-cards";
import type { InsurerList } from "@/lib/insurers-shared";
import { ADVANCE_ANSWERS, ADVANCE_CARE_LABELS, type AdvanceAnswer } from "@/lib/advance-care-shared";

const GENDERS: Record<string, string> = {
  female: "Weiblich",
  male: "Männlich",
  diverse: "Divers",
  unspecified: "Keine Angabe",
};

export function RecordMasterDataView({ r }: { r: ResidentRecordState }) {
  const t = useTerms();
  const country = useCountry();
  const countryCode = useWorkContext()?.country ?? "CH";
  const advanceLabels = ADVANCE_CARE_LABELS[countryCode];
  const {
    resident,
    contentRef,
    masterDataEditing,
    setMasterDataEditing,
    contacts,
    contactsLoading,
    contactsError,
    openContactEditor,
    deleteContact,
    live,
    onAction,
    onGenderChanged,
    onPhotoChanged: reloadResidents,
    setResidentGender,
  } = r;
  const summary = live.summary.data;
  const [draft, setDraft] = useState<MasterData | null>(null);
  // Zimmer aus der Liste der Administration (Belegung); leer = unverändert.
  const [roomId, setRoomId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const values: Partial<MasterData> = (masterDataEditing ? draft : summary?.master) ?? {};
  const editable = masterDataEditing && Boolean(draft);
  const roomOptions = useApiData<{
    units: Array<{ id: string; name: string }>;
    rooms: Array<{ id: string; name: string; careUnitId: string; free: number }>;
  }>(editable ? "/api/residents/intake-options" : null);
  const insurerList = useApiData<InsurerList>(editable ? "/api/insurers" : null);
  const insurerOptions = (() => {
    const list = insurerList.data?.insurers ?? [];
    const current = values.insurer ?? "";
    // Ein früher frei erfasster Wert, der nicht in der Liste steht, bleibt wählbar.
    const kept =
      current && !list.includes(current) ? [{ value: current, label: `${current} (bisheriger Eintrag)` }] : [];
    return [{ value: "", label: "Keine Angabe" }, ...kept, ...list.map((name) => ({ value: name, label: name }))];
  })();
  const unitName = (id: string) => roomOptions.data?.units.find((unit) => unit.id === id)?.name ?? "";
  const currentRoom = roomOptions.data?.rooms.find(
    (room) => room.name === resident.room && unitName(room.careUnitId) === resident.unit,
  );
  const set = <K extends keyof MasterData>(key: K, value: MasterData[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  const field = (key: keyof MasterData) => ({
    value: (values[key] as string | null | undefined) ?? "",
    readOnly: !editable,
    onChange: (event: { target: { value: string } }) => set(key, event.target.value as never),
  });
  const canWrite = summary?.canWrite ?? false;
  // Datumsfelder mit der eigenen Kalenderauswahl; schreibgeschützt als formatiertes Datum.
  const dateField = (
    key: keyof MasterData,
    label: string,
    options: { yearSelect?: boolean; clearable?: boolean; disabled?: boolean; future?: boolean } = {},
  ) => {
    const value = (values[key] as string | null | undefined) ?? "";
    return editable ? (
      <CareDatePicker
        label={label}
        value={value}
        onChange={(next) => set(key, next as never)}
        max={options.future ? undefined : todayInZurich()}
        showToday={!options.yearSelect}
        yearSelect={options.yearSelect}
        openAtYear={options.yearSelect ? Number(todayInZurich().slice(0, 4)) - 85 : undefined}
        clearable={options.clearable}
        disabled={options.disabled}
      />
    ) : (
      <input readOnly value={value ? formatDate(value) : ""} />
    );
  };

  async function save() {
    if (!draft || !resident.id) return;
    setSaving(true);
    setError("");
    try {
      const movedTo = roomId && roomId !== currentRoom?.id ? roomId : undefined;
      const next = await requestJson<RecordSummary>(`/api/residents/${resident.id}/record`, {
        method: "PATCH",
        body: { ...draft, roomId: movedTo },
      });
      // Zimmerwechsel: Liste und Aktenkopf zeigen das neue Zimmer.
      if (movedTo) reloadResidents?.();
      live.summary.reload();
      announceResuscitationChange();
      live.care.reload();
      setResidentGender(next.master.gender);
      onGenderChanged?.(resident.id, next.master.gender);
      setMasterDataEditing(false);
      setRoomId("");
      onAction(movedTo ? "Stammdaten gespeichert, Zimmer gewechselt" : "Stammdaten gespeichert");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Stammdaten konnten nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="resident-record-content record-master-data-view" ref={contentRef} key="master-data">
      <div className="master-data-page-heading">
        <div>
          <span className="record-section-label">{`${t.prefix}akte`}</span>
          <h3>Stammdaten</h3>
          <p>Persönliche, organisatorische und administrative Angaben zu {resident.name}.</p>
        </div>
        <div className="master-data-heading-actions">
          {masterDataEditing && (
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setDraft(null);
                setRoomId("");
                setError("");
                setMasterDataEditing(false);
              }}
            >
              Abbrechen
            </button>
          )}
          {canWrite && (
            <button
              className="primary-button"
              type="button"
              disabled={saving || !summary}
              onClick={() => {
                if (masterDataEditing) void save();
                else if (summary) {
                  setDraft(summary.master);
                  setRoomId("");
                  setMasterDataEditing(true);
                }
              }}
            >
              {masterDataEditing ? (
                <>
                  <Check aria-hidden="true" /> {saving ? "Speichern…" : "Stammdaten speichern"}
                </>
              ) : (
                "Stammdaten bearbeiten"
              )}
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="appointment-editor-error" role="alert">
          {error}
        </p>
      )}

      <section className="master-data-status" aria-label="Status der Stammdaten">
        <div>
          <span>
            <Check aria-hidden="true" />
          </span>
          <p>
            <small>Aktenstatus</small>
            <strong title={summary?.missing.join(", ")}>
              {!summary ? "–" : summary.missing.length ? `Es fehlen: ${summary.missing.join(", ")}` : "Vollständig"}
            </strong>
          </p>
        </div>
        <div>
          <span>
            <User aria-hidden="true" />
          </span>
          <p>
            <small>{t.prefix}nummer</small>
            <strong>{summary?.master.externalNumber ?? "Nicht vergeben"}</strong>
          </p>
        </div>
        <div>
          <span>
            <CalendarDots aria-hidden="true" />
          </span>
          <p>
            <small>Eintritt</small>
            <strong>{summary?.master.admittedOn ? formatDate(summary.master.admittedOn) : "Nicht erfasst"}</strong>
          </p>
        </div>
        <div>
          <span>
            <ClipboardText aria-hidden="true" />
          </span>
          <p>
            <small>Letzte Prüfung</small>
            <strong>
              {summary?.checkedAt
                ? `${formatDateTime(summary.checkedAt)}${summary.checkedBy ? ` · ${summary.checkedBy}` : ""}`
                : "Noch nicht geprüft"}
            </strong>
          </p>
        </div>
      </section>

      <div className="master-data-layout">
        <div className="master-data-primary">
          <section className="record-card master-data-card">
            <div className="record-card-heading">
              <div>
                <span className="record-section-label">Person</span>
                <h3>Persönliche Angaben</h3>
              </div>
            </div>
            <div className="master-data-form-grid">
              <label>
                <span>Vorname</span>
                <input required {...field("firstName")} />
              </label>
              <label>
                <span>Nachname</span>
                <input required {...field("lastName")} />
              </label>
              <label>
                <span>Geburtsdatum</span>
                {dateField("dateOfBirth", "Geburtsdatum", { yearSelect: true })}
              </label>
              <label>
                <span>Geschlecht</span>
                <CareOptionSelect
                  label="Geschlecht"
                  value={values.gender ?? "unspecified"}
                  onChange={(value) => set("gender", value)}
                  disabled={!editable}
                  options={Object.entries(GENDERS).map(([value, label]) => ({ value, label }))}
                />
              </label>
              <label>
                <span>Zivilstand</span>
                <CareOptionSelect
                  label="Zivilstand"
                  value={values.maritalStatus ?? ""}
                  onChange={(value) => set("maritalStatus", value || null)}
                  disabled={!editable}
                  options={[
                    { value: "", label: "Nicht erfasst" },
                    ...MARITAL_STATUSES.map((status) => ({ value: status, label: status })),
                  ]}
                />
              </label>
              <label>
                <span>Bevorzugte Sprache</span>
                <CareOptionSelect
                  label="Bevorzugte Sprache"
                  value={values.language ?? "de-CH"}
                  onChange={(value) => set("language", value)}
                  disabled={!editable}
                  options={Object.entries(LANGUAGES).map(([value, label]) => ({ value, label }))}
                />
              </label>
              <label>
                <span>{country.socialNumber.label}</span>
                <input
                  placeholder={editable ? country.socialNumber.placeholder : undefined}
                  {...field("socialSecurityNumber")}
                />
              </label>
              <label>
                <span>Konfession</span>
                <CareOptionSelect
                  label="Konfession"
                  value={values.religion ?? ""}
                  onChange={(value) => set("religion", value || null)}
                  disabled={!editable}
                  options={[
                    { value: "", label: "Nicht erfasst" },
                    // Ein früher frei erfasster Wert bleibt wählbar.
                    ...(values.religion && !RELIGIONS[countryCode].includes(values.religion)
                      ? [{ value: values.religion, label: values.religion }]
                      : []),
                    ...RELIGIONS[countryCode].map((item) => ({ value: item, label: item })),
                  ]}
                />
              </label>
            </div>
          </section>

          <section className="record-card master-data-card">
            <div className="record-card-heading">
              <div>
                <span className="record-section-label">Aufenthalt</span>
                <h3>Organisation und Wohnen</h3>
              </div>
            </div>
            <div className="master-data-form-grid">
              <label>
                <span>Wohnbereich</span>
                <input
                  value={
                    editable && roomId
                      ? unitName(roomOptions.data?.rooms.find((room) => room.id === roomId)?.careUnitId ?? "")
                      : resident.unit
                  }
                  readOnly
                  title="Ergibt sich aus dem Zimmer"
                />
              </label>
              <label>
                <span>Zimmer</span>
                {editable ? (
                  <CareOptionSelect
                    label="Zimmer"
                    value={roomId || currentRoom?.id || ""}
                    placeholder={roomOptions.data ? resident.room || "Zimmer wählen" : "Wird geladen …"}
                    disabled={!roomOptions.data?.rooms.length}
                    options={(roomOptions.data?.rooms ?? [])
                      .map((room) => ({
                        value: room.id,
                        label: `${unitName(room.careUnitId)} · ${room.name}${
                          room.id === currentRoom?.id
                            ? " · bisheriges Zimmer"
                            : room.free > 0
                              ? ` · ${room.free} Bett${room.free === 1 ? "" : "en"} frei`
                              : " · belegt"
                        }`,
                        disabled: room.id !== currentRoom?.id && room.free < 1,
                      }))
                      .sort((a, b) => a.label.localeCompare(b.label, "de-CH"))}
                    onChange={setRoomId}
                  />
                ) : (
                  <input value={resident.room} readOnly />
                )}
              </label>
              <label>
                <span>Pflegebedarf</span>
                <input
                  value={summary?.careLevel ?? resident.careLevel}
                  readOnly
                  title="Wird in der Pflegeplanung gepflegt"
                />
              </label>
              <label>
                <span>Bezugspflege</span>
                <CareOptionSelect
                  label="Bezugspflege"
                  value={values.primaryNurseId ?? ""}
                  onChange={(value) => set("primaryNurseId", value || null)}
                  disabled={!editable}
                  options={[
                    { value: "", label: "Nicht festgelegt" },
                    ...(summary?.staff ?? []).map((person) => ({ value: person.id, label: person.name })),
                  ]}
                />
              </label>
              <label>
                <span>Eintrittsdatum</span>
                {dateField("admittedOn", "Eintrittsdatum", { future: true })}
              </label>
              <label>
                <span>Eintrittsgrund</span>
                <input placeholder={editable ? "z. B. Langzeitpflege" : undefined} {...field("admissionReason")} />
              </label>
            </div>
          </section>
          {resident.id && (
            <RecordDiagnosesCard residentId={resident.id} residentName={resident.name} onAction={onAction} />
          )}
          {resident.id && (
            <RecordVaccinationsCard residentId={resident.id} residentName={resident.name} onAction={onAction} />
          )}
          {resident.id && (
            <RecordBelongingsCard residentId={resident.id} residentName={resident.name} onAction={onAction} />
          )}
          {resident.id && (
            <RecordConsentsCard residentId={resident.id} residentName={resident.name} onAction={onAction} />
          )}
        </div>

        <aside className="master-data-secondary">
          <section className="record-card master-data-card" aria-labelledby="resuscitation-title">
            <div className="record-card-heading">
              <div>
                <span className="record-section-label">Notfall</span>
                <h3 id="resuscitation-title">Reanimationsstatus</h3>
              </div>
            </div>
            <div className="master-data-form-grid single-column">
              <label>
                <span>Entscheid</span>
                <CareOptionSelect
                  label="Reanimationsstatus"
                  value={values.resuscitationStatus ?? ""}
                  onChange={(value) =>
                    setDraft((current) =>
                      current
                        ? value
                          ? { ...current, resuscitationStatus: value as ResuscitationStatus }
                          : {
                              ...current,
                              resuscitationStatus: null,
                              resuscitationSource: null,
                              resuscitationDecidedOn: null,
                            }
                        : current,
                    )
                  }
                  disabled={!editable}
                  options={[
                    { value: "", label: "Nicht erfasst" },
                    ...Object.entries(RESUSCITATION_STATUSES).map(([value, status]) => ({
                      value,
                      label: status.label,
                    })),
                  ]}
                />
              </label>
              <label>
                <span>Grundlage</span>
                <input
                  placeholder={editable ? "z. B. Patientenverfügung" : undefined}
                  disabled={editable && !values.resuscitationStatus}
                  {...field("resuscitationSource")}
                />
              </label>
              <label>
                <span>Entscheid vom</span>
                {dateField("resuscitationDecidedOn", "Entscheid vom", {
                  clearable: true,
                  disabled: !values.resuscitationStatus,
                })}
              </label>
            </div>
          </section>

          <section className="record-card master-data-card" aria-labelledby="evacuation-title">
            <div className="record-card-heading">
              <div>
                <span className="record-section-label">Notfall</span>
                <h3 id="evacuation-title">Brandfall &amp; Evakuation</h3>
              </div>
            </div>
            <div className="master-data-form-grid single-column">
              <label>
                <span>Mobilität im Notfall</span>
                <CareOptionSelect
                  label="Mobilität im Notfall"
                  value={values.evacuationMobility ?? ""}
                  onChange={(value) => set("evacuationMobility", (value || null) as MasterData["evacuationMobility"])}
                  disabled={!editable}
                  options={[
                    { value: "", label: "Nicht erfasst" },
                    ...EVACUATION_MOBILITY_KEYS.map((value) => ({ value, label: EVACUATION_MOBILITY[value].label })),
                  ]}
                />
              </label>
              <label>
                <span>Hinweise für den Notfall</span>
                <input
                  maxLength={300}
                  placeholder={editable ? "z. B. Sauerstoff, Hörgerät, nachts orientierungslos" : undefined}
                  {...field("evacuationNote")}
                />
              </label>
            </div>
          </section>

          <section className="record-card master-data-card" aria-labelledby="advance-care-title">
            <div className="record-card-heading">
              <div>
                <span className="record-section-label">Vorsorge</span>
                <h3 id="advance-care-title">Vorsorge &amp; Vertretung</h3>
              </div>
            </div>
            <div className="master-data-form-grid single-column">
              <label>
                <span>Patientenverfügung</span>
                <CareOptionSelect
                  label="Patientenverfügung"
                  value={values.advanceDirective ?? ""}
                  onChange={(value) =>
                    setDraft((current) =>
                      current
                        ? value
                          ? { ...current, advanceDirective: value as AdvanceAnswer }
                          : {
                              ...current,
                              advanceDirective: null,
                              advanceDirectiveOn: null,
                              advanceDirectiveLocation: null,
                            }
                        : current,
                    )
                  }
                  disabled={!editable}
                  options={[
                    { value: "", label: "Nicht erfasst" },
                    ...Object.entries(ADVANCE_ANSWERS).map(([value, label]) => ({ value, label })),
                  ]}
                />
              </label>
              {values.advanceDirective === "yes" && (
                <>
                  <label>
                    <span>Verfasst am</span>
                    {dateField("advanceDirectiveOn", "Verfasst am", { clearable: true })}
                  </label>
                  <label>
                    <span>Aufbewahrungsort</span>
                    <input
                      placeholder={editable ? "z. B. Kopie unter Dokumente, Original bei der Tochter" : undefined}
                      {...field("advanceDirectiveLocation")}
                    />
                  </label>
                </>
              )}
              <label>
                <span>{advanceLabels.careMandate}</span>
                <CareOptionSelect
                  label={advanceLabels.careMandate}
                  value={values.careMandate ?? ""}
                  onChange={(value) =>
                    setDraft((current) =>
                      current
                        ? value
                          ? { ...current, careMandate: value as AdvanceAnswer }
                          : { ...current, careMandate: null, careMandateOn: null, careMandateEffectiveOn: null }
                        : current,
                    )
                  }
                  disabled={!editable}
                  options={[
                    { value: "", label: "Nicht erfasst" },
                    ...Object.entries(ADVANCE_ANSWERS).map(([value, label]) => ({ value, label })),
                  ]}
                />
              </label>
              {values.careMandate === "yes" && (
                <>
                  <label>
                    <span>Errichtet am</span>
                    {dateField("careMandateOn", "Errichtet am", { clearable: true })}
                  </label>
                  <label>
                    <span>{advanceLabels.careMandateEffective}</span>
                    {dateField("careMandateEffectiveOn", advanceLabels.careMandateEffective, { clearable: true })}
                  </label>
                </>
              )}
              <div className="advance-care-representative">
                <span>Vertretungsberechtigte Person</span>
                {summary?.representative ? (
                  <strong>
                    {summary.representative.name} · {advanceLabels.roles[summary.representative.role]}
                    {summary.representative.phone ? ` · ${summary.representative.phone}` : ""}
                  </strong>
                ) : (
                  <small>Keine erfasst – bei der Kontaktperson unter „Vertretungsberechtigt als“ festlegen.</small>
                )}
              </div>
            </div>
          </section>

          {resident.id && (
            <RecordEndOfLifeCards residentId={resident.id} residentName={resident.name} onAction={onAction} />
          )}

          <section className="record-card master-data-card">
            <div className="record-card-heading">
              <div>
                <span className="record-section-label">Medizin</span>
                <h3>Medizinische Kontakte</h3>
              </div>
            </div>
            <div className="master-data-form-grid single-column">
              <label>
                <span>Hausarzt</span>
                <input {...field("gpName")} />
              </label>
              <label>
                <span>Hausarztpraxis</span>
                <input {...field("gpPractice")} />
              </label>
              <label>
                <span>Stammapotheke</span>
                <input {...field("pharmacy")} />
              </label>
            </div>
          </section>

          <section className="record-card master-data-card">
            <div className="record-card-heading contact-card-heading">
              <div>
                <span className="record-section-label">Notfall</span>
                <h3>Kontaktpersonen</h3>
              </div>
              <button type="button" onClick={() => openContactEditor()}>
                <Plus aria-hidden="true" /> Kontakt hinzufügen
              </button>
            </div>
            <div className="resident-contacts-list">
              {contactsLoading ? (
                <p className="resident-contacts-loading">Kontaktpersonen werden geladen…</p>
              ) : (
                contacts.map((contact) => (
                  <article key={contact.id} className="resident-contact-card">
                    <div className="resident-contact-card-head">
                      <span className="resident-contact-avatar">
                        {contact.full_name
                          .split(" ")
                          .filter(Boolean)
                          .slice(0, 2)
                          .map((name) => name[0])
                          .join("")
                          .toUpperCase()}
                      </span>
                      <div>
                        <strong>{contact.full_name}</strong>
                        <small>{contact.relationship || "Beziehung nicht angegeben"}</small>
                      </div>
                      <div className="resident-contact-badges">
                        {contact.is_primary && <span>Hauptkontakt</span>}
                        {contact.is_emergency_contact && <span className="emergency">Notfall</span>}
                        {contact.representative_role && (
                          <span title={advanceLabels.roles[contact.representative_role]}>Vertretung</span>
                        )}
                      </div>
                    </div>
                    <div className="resident-contact-details">
                      <a href={contact.phone ? `tel:${contact.phone}` : undefined}>
                        {contact.phone || "Keine Telefonnummer"}
                      </a>
                      <a href={contact.email ? `mailto:${contact.email}` : undefined}>
                        {contact.email || "Keine E-Mail-Adresse"}
                      </a>
                    </div>
                    <div className="resident-contact-actions">
                      <button
                        type="button"
                        onClick={() => openContactEditor(contact)}
                        aria-label={`${contact.full_name} bearbeiten`}
                      >
                        <PencilSimple aria-hidden="true" />
                        <span>Bearbeiten</span>
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => void deleteContact(contact)}
                        aria-label={`${contact.full_name} entfernen`}
                      >
                        <Trash aria-hidden="true" />
                        <span>Entfernen</span>
                      </button>
                    </div>
                  </article>
                ))
              )}
              {!contactsLoading && !contacts.length && (
                <div className="resident-contacts-empty">
                  <User aria-hidden="true" />
                  <strong>Noch keine Kontaktperson</strong>
                  <p>Hinterlege Angehörige, Vertrauenspersonen oder weitere Notfallkontakte.</p>
                  <button className="secondary-button" type="button" onClick={() => openContactEditor()}>
                    <Plus /> Erste Kontaktperson hinzufügen
                  </button>
                </div>
              )}
            </div>
            {contactsError && (
              <p className="resident-contacts-error" role="alert">
                {contactsError}
              </p>
            )}
          </section>

          <section className="record-card master-data-card">
            <div className="record-card-heading">
              <div>
                <span className="record-section-label">Administration</span>
                <h3>Versicherung</h3>
              </div>
            </div>
            <div className="master-data-form-grid single-column">
              <label>
                <span>{country.insurance.insurerLabel}</span>
                {editable ? (
                  <CareOptionSelect
                    label={country.insurance.insurerLabel}
                    value={values.insurer ?? ""}
                    placeholder={insurerList.data ? "Keine Angabe" : "Wird geladen …"}
                    options={insurerOptions}
                    onChange={(value) => set("insurer", value || null)}
                  />
                ) : (
                  <input {...field("insurer")} />
                )}
              </label>
              <label>
                <span>{country.insurance.numberLabel}</span>
                <input
                  placeholder={
                    editable && country.insurance.numberPlaceholder ? country.insurance.numberPlaceholder : undefined
                  }
                  {...field("insuranceNumber")}
                />
              </label>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
