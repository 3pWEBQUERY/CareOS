"use client";

import { useTerms, useWorkContext } from "@/app/components/care-context";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import ResidentAppointmentEditor from "@/app/components/resident-appointment-editor";
import { Camera, CaretDown, CaretUp, Printer, X } from "@phosphor-icons/react";
import { RESUSCITATION_STATUSES, resuscitationShort } from "@/lib/resident-record-shared";
import { ADVANCE_CARE_LABELS, advanceShort } from "@/lib/advance-care-shared";
import { formatDate } from "@/app/components/workspace-ui";
import { ResidentRecordProps, recordTabs } from "./resident-record-data";
import { useResidentRecord } from "./use-resident-record";
import { RecordOverviewView } from "./record-overview-view";
import { RecordMasterDataView } from "./record-master-data-view";
import { RecordCareView } from "./record-care-view";
import { RecordBiographyView } from "./record-biography-view";
import { RecordAppointmentsView } from "./record-appointments-view";
import { RecordSuppliesView } from "./record-supplies-view";
import { RecordHistoryView } from "./record-history-view";
import { RecordDocumentsView } from "./record-documents-view";
import { RecordDocumentationView } from "./record-documentation-view";
import { RecordRestraintsView } from "./record-restraints-view";
import { BodyObservationDialog } from "./record-body-dialog";
import { ContactEditorDialog } from "./record-contact-dialog";
import { SupplyEditorDialog } from "./record-supply-dialog";
import { PHOTO_ACCEPT } from "@/lib/resident-photo-client";

export function ResidentRecord(props: ResidentRecordProps) {
  const t = useTerms();
  const country = useWorkContext()?.country;
  const r = useResidentRecord(props);
  const {
    resident,
    onClose,
    onAction,
    closeButtonRef,
    residentPhotoInputRef,
    activeView,
    bodyEditor,
    contactEditor,
    supplyEditor,
    appointmentEditor,
    setAppointmentEditor,
    setAppointmentRevision,
    residentPhoto,
    residentPhotoSaving,
    appointmentEditorResidents,
    uploadResidentPhoto,
    selectTab,
    navigation,
    live,
  } = r;
  const tabsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    tabsRef.current
      ?.querySelector<HTMLElement>("[aria-current='page']")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeView]);
  const master = live.summary.data?.master;
  const resuscitation = master?.resuscitationStatus ?? null;
  const representative = live.summary.data?.representative ?? null;
  return (
    <div
      className="resident-record-layer"
      role="presentation"
      onMouseDown={(event) => event.currentTarget === event.target && onClose()}
    >
      <article
        className="resident-record-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="resident-record-title"
      >
        <header className="resident-record-header">
          <div className="record-heading">
            <button
              className={`resident-avatar record-photo-trigger ${resident.status === "critical" ? "critical" : ""}`}
              type="button"
              aria-label={residentPhoto ? `${t.prefix}bild ändern` : `${t.prefix}bild hochladen`}
              title={residentPhoto ? `${t.prefix}bild ändern` : `${t.prefix}bild hochladen`}
              disabled={residentPhotoSaving}
              onClick={() => residentPhotoInputRef.current?.click()}
            >
              {residentPhoto ? (
                <Image src={residentPhoto} alt={`Profilbild von ${resident.name}`} width={76} height={76} unoptimized />
              ) : (
                <span>{resident.initials}</span>
              )}
              <span className="record-photo-camera" aria-hidden="true">
                <Camera />
              </span>
            </button>
            <input
              ref={residentPhotoInputRef}
              className="record-photo-input"
              type="file"
              accept={PHOTO_ACCEPT}
              onChange={uploadResidentPhoto}
              tabIndex={-1}
              aria-hidden="true"
            />
            <div>
              <span className="record-kicker">{`${t.prefix}akte`}</span>
              <h2 id="resident-record-title">{resident.name}</h2>
              <p>
                {resident.room} · {resident.unit} · {resident.careLevel}
              </p>
            </div>
          </div>
          <div className="record-header-actions">
            {navigation && (
              <span className="record-navigation" aria-label={`Zwischen ${t.prefix}akten blättern`}>
                <button
                  type="button"
                  aria-label={`Vorherige ${t.prefix}akte`}
                  title={`Vorherige ${t.prefix}akte (Alt + ↑)`}
                  onClick={navigation.onPrevious}
                >
                  <CaretUp aria-hidden="true" />
                </button>
                <small>
                  {navigation.position} von {navigation.total}
                </small>
                <button
                  type="button"
                  aria-label={`Nächste ${t.prefix}akte`}
                  title={`Nächste ${t.prefix}akte (Alt + ↓)`}
                  onClick={navigation.onNext}
                >
                  <CaretDown aria-hidden="true" />
                </button>
              </span>
            )}
            {resident.id && (
              <a
                className="record-transfer-link"
                href={`/c/bewohner/ueberleitung?resident=${resident.id}`}
                target="_blank"
                rel="noopener"
                title="Überleitungsbogen für Spitaleinweisung oder Verlegung drucken"
              >
                <Printer aria-hidden="true" />
                <span>Überleitungsbogen</span>
              </a>
            )}
            {master && (
              <span className="record-legal-badges">
                <span
                  className={`status-badge record-resuscitation ${resuscitation === "dnr" ? "critical" : resuscitation ? "info" : "attention"}`}
                  title={
                    resuscitation
                      ? `${RESUSCITATION_STATUSES[resuscitation].label} · Grundlage: ${master.resuscitationSource ?? "–"}`
                      : "Reanimationsstatus nicht erfasst (Stammdaten)"
                  }
                >
                  {resuscitationShort(resuscitation)}
                </span>
                <span
                  className={`status-badge record-advance-care ${master.advanceDirective ? "info" : "attention"}`}
                  title={
                    master.advanceDirective === "yes"
                      ? `Patientenverfügung liegt vor${master.advanceDirectiveOn ? ` (${formatDate(master.advanceDirectiveOn)})` : ""}${master.advanceDirectiveLocation ? ` · ${master.advanceDirectiveLocation}` : ""}`
                      : master.advanceDirective === "no"
                        ? "Keine Patientenverfügung"
                        : "Patientenverfügung nicht erfasst (Stammdaten)"
                  }
                >
                  {advanceShort(master.advanceDirective)}
                </span>
                {representative && (
                  <span
                    className="status-badge info record-representative"
                    title={`${representative.name} · ${ADVANCE_CARE_LABELS[country ?? "CH"].roles[representative.role]}${representative.phone ? ` · ${representative.phone}` : ""}`}
                  >
                    Vertretung: {representative.name}
                  </span>
                )}
              </span>
            )}
            <span className={`status-badge ${resident.status}`}>{resident.statusLabel}</span>
            <button
              className="record-close-button"
              ref={closeButtonRef}
              type="button"
              aria-label={`${t.prefix}akte schliessen`}
              onClick={onClose}
            >
              <X aria-hidden="true" />
            </button>
          </div>
        </header>

        <nav className="resident-record-tabs" ref={tabsRef} aria-label={`Bereiche der ${t.prefix}akte`}>
          {recordTabs.map((tab) => {
            const active =
              (tab === "Übersicht" && activeView === "overview") ||
              (tab === "Stammdaten" && activeView === "master-data") ||
              (tab === "Termine" && activeView === "appointments") ||
              (tab === "Dokumentation" && activeView === "documentation") ||
              (tab === "Pflegeakte" && activeView === "care-record") ||
              (tab === "Pflegebedarf" && activeView === "supplies") ||
              (tab === "Verlauf" && activeView === "history") ||
              (tab === "Dokumente" && activeView === "documents") ||
              (tab === "Biografie" && activeView === "biography") ||
              (tab === "FBM" && activeView === "restraints");
            return (
              <button
                className={active ? "active" : ""}
                type="button"
                key={tab}
                aria-current={active ? "page" : undefined}
                onClick={() => selectTab(tab)}
                title={tab === "FBM" ? "Freiheitsbeschränkende Massnahmen" : undefined}
              >
                {tab === "FBM" && country === "DE" ? "FEM" : tab}
              </button>
            );
          })}
        </nav>

        {activeView === "overview" ? (
          <RecordOverviewView r={r} />
        ) : activeView === "master-data" ? (
          <RecordMasterDataView r={r} />
        ) : activeView === "care-record" ? (
          <RecordCareView r={r} />
        ) : activeView === "biography" ? (
          <RecordBiographyView r={r} />
        ) : activeView === "appointments" ? (
          <RecordAppointmentsView r={r} />
        ) : activeView === "supplies" ? (
          <RecordSuppliesView r={r} />
        ) : activeView === "history" ? (
          <RecordHistoryView r={r} />
        ) : activeView === "documents" ? (
          <RecordDocumentsView r={r} />
        ) : activeView === "restraints" ? (
          <RecordRestraintsView r={r} />
        ) : (
          <RecordDocumentationView r={r} />
        )}
      </article>
      {bodyEditor && typeof document !== "undefined" && createPortal(<BodyObservationDialog r={r} />, document.body)}
      {contactEditor && <ContactEditorDialog r={r} />}
      {appointmentEditor && resident.id && (
        <ResidentAppointmentEditor
          key={appointmentEditor === "new" ? "new-appointment" : appointmentEditor.id}
          appointment={appointmentEditor === "new" ? null : appointmentEditor}
          residentId={resident.id}
          residents={appointmentEditorResidents}
          onClose={() => setAppointmentEditor(null)}
          onSaved={() => {
            setAppointmentEditor(null);
            setAppointmentRevision((current) => current + 1);
            onAction("Terminbestand aktualisiert");
          }}
        />
      )}
      {supplyEditor && <SupplyEditorDialog r={r} />}
      {r.confirmDialog}
    </div>
  );
}
