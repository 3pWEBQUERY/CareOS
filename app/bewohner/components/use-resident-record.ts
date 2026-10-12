"use client";

import { useTerms } from "@/app/components/care-context";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { isTyping, useShortcutsEnabled } from "@/app/components/keyboard-shortcuts";
import { requestJson, timeInZurich, todayInZurich } from "@/app/components/workspace-ui";
import { zurichTimeToIso } from "@/lib/resident-appointments";
import type { Importance } from "@/lib/documentation-shared";
import {
  ResidentRecordProps,
  RecordView,
  DocumentationFlag,
  HistoryFilter,
  DocumentationEntry,
} from "./resident-record-data";
import { useConfirmDialog } from "@/app/components/confirm-dialog";
import { useRecordLive } from "./use-record-live";
import { useRecordBody } from "./use-record-body";
import { useRecordContacts } from "./use-record-contacts";
import { useRecordBiography } from "./use-record-biography";
import { useRecordSupplies } from "./use-record-supplies";
import { useRecordAppointments } from "./use-record-appointments";
import { useRecordMasterData } from "./use-record-master-data";

export function useResidentRecord({
  resident,
  onClose,
  onAction,
  onGenderChanged,
  onPhotoChanged,
  initialView,
  onViewChange,
  navigation,
}: ResidentRecordProps) {
  const t = useTerms();
  const {
    appointments,
    setAppointments,
    appointmentResidents,
    setAppointmentResidents,
    appointmentsLoading,
    setAppointmentsLoading,
    appointmentsError,
    setAppointmentsError,
    appointmentEditor,
    setAppointmentEditor,
    appointmentRevision,
    setAppointmentRevision,
    clockNow,
    setClockNow,
    upcomingAppointments,
    pastAppointments,
    nextAppointment,
    appointmentEditorResidents,
  } = useRecordAppointments({ resident });
  const { confirm, confirmDialog } = useConfirmDialog();
  const {
    supplies,
    setSupplies,
    careSupplyProducts,
    setCareSupplyProducts,
    suppliesLoading,
    setSuppliesLoading,
    suppliesError,
    setSuppliesError,
    supplyEditor,
    setSupplyEditor,
    supplySaving,
    setSupplySaving,
    openSupplyEditor,
    saveSupply,
    deleteSupply,
  } = useRecordSupplies({ resident, onAction, confirm });
  const {
    biography,
    setBiography,
    biographyEditing,
    setBiographyEditing,
    biographyLoading,
    setBiographyLoading,
    biographySaving,
    setBiographySaving,
    biographyError,
    setBiographyError,
    saveBiography,
  } = useRecordBiography({ resident, onAction });
  const {
    contacts,
    setContacts,
    contactsLoading,
    setContactsLoading,
    contactsError,
    setContactsError,
    contactEditor,
    setContactEditor,
    contactSaving,
    setContactSaving,
    openContactEditor,
    saveContact,
    deleteContact,
  } = useRecordContacts({ resident, onAction, confirm, onChanged: () => reloadSummary.current() });
  const {
    activeBodyObservationId,
    setActiveBodyObservationId,
    bodyObservations,
    setBodyObservations,
    bodyLoading,
    setBodyLoading,
    bodyError,
    setBodyError,
    placingBodyPoint,
    setPlacingBodyPoint,
    bodyEditor,
    setBodyEditor,
    bodySaving,
    setBodySaving,
    newBodyObservation,
    editBodyObservation,
    saveBodyObservation,
    archiveBodyObservation,
  } = useRecordBody({ resident, onAction, confirm });
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const residentPhotoInputRef = useRef<HTMLInputElement>(null);
  const {
    masterDataEditing,
    setMasterDataEditing,
    residentGender,
    setResidentGender,
    genderDraft,
    setGenderDraft,
    masterDataSaving,
    setMasterDataSaving,
    residentPhoto,
    setResidentPhoto,
    residentPhotoSaving,
    setResidentPhotoSaving,
    firstName,
    lastNameParts,
    lastName,
    genderLabel,
    saveGender,
    uploadResidentPhoto,
  } = useRecordMasterData({ resident, setBodyError, onGenderChanged, onAction, onPhotoChanged, residentPhotoInputRef });
  const contentRef = useRef<HTMLElement>(null);
  const live = useRecordLive(resident);
  // Kontaktpersonen bestimmen die Vertretung im Aktenkopf: nach Änderungen die Zusammenfassung neu laden.
  const reloadSummary = useRef<() => void>(() => undefined);
  const { reload: reloadLiveSummary } = live.summary;
  useEffect(() => {
    reloadSummary.current = reloadLiveSummary;
  }, [reloadLiveSummary]);
  const { entries, docEntries, careDomains, historyEntries } = live;
  const [activeView, setActiveView] = useState<RecordView>(initialView ?? "overview");
  useEffect(() => {
    onViewChange?.(activeView);
  }, [activeView, onViewChange]);
  // Alt + arrow up/down or J/K steps to the previous or next resident.
  const letterKeys = useShortcutsEnabled();
  useEffect(() => {
    if (!navigation) return;
    const onKey = (event: KeyboardEvent) => {
      const typing = isTyping(event.target);
      const arrows = event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown");
      const letters =
        letterKeys &&
        !typing &&
        !event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        ["j", "k"].includes(event.key.toLowerCase());
      if (!arrows && !letters) return;
      event.preventDefault();
      if (event.key === "ArrowUp" || event.key.toLowerCase() === "k") navigation.onPrevious();
      else navigation.onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [letterKeys, navigation]);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [documentationText, setDocumentationText] = useState("");
  const [documentationDate, setDocumentationDate] = useState(todayInZurich);
  const [documentationTime, setDocumentationTime] = useState(timeInZurich);
  const [documentationCategory, setDocumentationCategory] = useState("Pflege");
  const [documentationFlags, setDocumentationFlags] = useState<DocumentationFlag[]>([]);
  const [documentationGoals, setDocumentationGoals] = useState<string[]>([]);
  const [documentationSaving, setDocumentationSaving] = useState(false);
  const [documentationError, setDocumentationError] = useState("");
  const [amendingEntryId, setAmendingEntryId] = useState<string | null>(null);
  const [activeCareDomainId, setActiveCareDomainId] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("Alle");
  const [documentSearch, setDocumentSearch] = useState("");
  const [documentCategory, setDocumentCategory] = useState("Alle");
  const [uploadOpen, setUploadOpen] = useState(false);
  const selectedEntry = entries.find((entry) => entry.id === selectedEntryId) ?? null;
  const selectedDocEntry = docEntries.find((entry) => entry.id === selectedEntryId) ?? null;
  const amendingEntry = docEntries.find((entry) => entry.id === amendingEntryId) ?? null;
  const activeCareDomain = careDomains.find((domain) => domain.id === activeCareDomainId) ?? careDomains[0] ?? null;
  const visibleHistoryEntries = historyEntries.filter(
    (entry) => historyFilter === "Alle" || entry.category === historyFilter,
  );
  const residentFiles = live.files.data?.documents ?? [];
  const visibleDocuments = residentFiles.filter((document) => {
    const query = documentSearch.trim().toLocaleLowerCase("de-CH");
    const queryStem = query.endsWith("e") ? query.slice(0, -1) : query;
    const searchableText =
      `${document.title} ${document.category} ${document.uploadedBy ?? ""} ${document.description ?? ""}`.toLocaleLowerCase(
        "de-CH",
      );
    return (
      (documentCategory === "Alle" || document.category === documentCategory) &&
      (!query || searchableText.includes(query) || searchableText.includes(queryStem))
    );
  });

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [activeView, selectedEntryId]);

  // Opening an existing entry shows it read-only; corrections are saved as a Nachtrag.
  function openDocumentation(entry?: DocumentationEntry) {
    const source = entry ? docEntries.find((item) => item.id === entry.id) : null;
    setSelectedEntryId(entry?.id ?? null);
    setDocumentationText(entry?.text ?? "");
    setDocumentationDate(source ? source.occurredAt.slice(0, 10) : todayInZurich());
    setDocumentationTime(source ? timeInZurich(new Date(source.occurredAt)) : timeInZurich());
    setDocumentationCategory(entry?.category ?? "Pflege");
    setDocumentationFlags(
      source?.importance === "critical"
        ? ["important"]
        : source?.importance === "visit"
          ? ["visit"]
          : source?.importance === "observation"
            ? ["observation"]
            : source?.importance === "important"
              ? ["handover"]
              : [],
    );
    setDocumentationGoals([]);
    setDocumentationError("");
    setActiveView("documentation");
  }

  // One marking per entry: it becomes the entry's importance in handover, visit and shift overview.
  function toggleDocumentationFlag(flag: DocumentationFlag) {
    setDocumentationFlags((current) => (current.includes(flag) ? [] : [flag]));
  }

  function toggleDocumentationGoal(category: string) {
    setDocumentationGoals((current) =>
      current.includes(category) ? current.filter((item) => item !== category) : [...current, category],
    );
  }

  function selectTab(tab: string) {
    if (tab === "Übersicht") setActiveView("overview");
    else if (tab === "Stammdaten") setActiveView("master-data");
    else if (tab === "Dokumentation") openDocumentation();
    else if (tab === "Pflegeakte") setActiveView("care-record");
    else if (tab === "Pflegebedarf") setActiveView("supplies");
    else if (tab === "Termine") setActiveView("appointments");
    else if (tab === "Verlauf") setActiveView("history");
    else if (tab === "Dokumente") setActiveView("documents");
    else if (tab === "Biografie") setActiveView("biography");
    else if (tab === "FBM") setActiveView("restraints");
  }

  // The "Speichern & nächster Bewohner" button submits with data-next and opens the next record.
  async function saveDocumentation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const andNext = (event.nativeEvent as SubmitEvent).submitter?.dataset.next === "true";
    if (selectedDocEntry) {
      setAmendingEntryId(selectedDocEntry.id);
      return;
    }
    const flag = documentationFlags[0];
    const importance: Importance =
      flag === "important" ? "critical" : flag === "handover" ? "important" : (flag ?? "standard");
    setDocumentationSaving(true);
    setDocumentationError("");
    try {
      await requestJson("/api/documentation", {
        method: "POST",
        body: {
          residentId: resident.id,
          category: documentationCategory,
          importance,
          body: documentationGoals.length
            ? `${documentationText.trim()}\n\nBezug Pflegeplanung: ${documentationGoals.join(", ")}`
            : documentationText,
          occurredAt: zurichTimeToIso(documentationDate, documentationTime),
        },
      });
      live.reloadDocumentation();
      onAction(andNext ? `Dokumentation gespeichert · nächster ${t.one}` : "Dokumentation gespeichert");
      if (andNext && navigation) {
        navigation.onNext();
        return;
      }
      setDocumentationText("");
      setDocumentationFlags([]);
      setDocumentationGoals([]);
      setDocumentationTime(timeInZurich());
    } catch (error) {
      setDocumentationError(error instanceof Error ? error.message : "Dokumentation konnte nicht gespeichert werden.");
    } finally {
      setDocumentationSaving(false);
    }
  }
  return {
    confirmDialog,
    navigation,
    historyEntries,
    live,
    latestAssessments: live.latestAssessments,
    documentationTime,
    setDocumentationTime,
    documentationGoals,
    toggleDocumentationGoal,
    documentationSaving,
    documentationError,
    amendingEntry,
    setAmendingEntryId,
    selectedDocEntry,
    uploadOpen,
    setUploadOpen,
    careDomains,
    resident,
    onClose,
    onAction,
    onGenderChanged,
    onPhotoChanged,
    closeButtonRef,
    residentPhotoInputRef,
    contentRef,
    entries,
    activeView,
    setActiveView,
    selectedEntryId,
    setSelectedEntryId,
    documentationText,
    setDocumentationText,
    documentationDate,
    setDocumentationDate,
    documentationCategory,
    setDocumentationCategory,
    documentationFlags,
    setDocumentationFlags,
    masterDataEditing,
    setMasterDataEditing,
    activeCareDomainId,
    setActiveCareDomainId,
    activeBodyObservationId,
    setActiveBodyObservationId,
    bodyObservations,
    setBodyObservations,
    bodyLoading,
    setBodyLoading,
    bodyError,
    setBodyError,
    placingBodyPoint,
    setPlacingBodyPoint,
    bodyEditor,
    setBodyEditor,
    bodySaving,
    setBodySaving,
    residentGender,
    setResidentGender,
    genderDraft,
    setGenderDraft,
    masterDataSaving,
    setMasterDataSaving,
    historyFilter,
    setHistoryFilter,
    documentSearch,
    setDocumentSearch,
    documentCategory,
    setDocumentCategory,
    biography,
    setBiography,
    biographyEditing,
    setBiographyEditing,
    biographyLoading,
    setBiographyLoading,
    biographySaving,
    setBiographySaving,
    biographyError,
    setBiographyError,
    contacts,
    setContacts,
    contactsLoading,
    setContactsLoading,
    contactsError,
    setContactsError,
    contactEditor,
    setContactEditor,
    contactSaving,
    setContactSaving,
    supplies,
    setSupplies,
    careSupplyProducts,
    setCareSupplyProducts,
    suppliesLoading,
    setSuppliesLoading,
    suppliesError,
    setSuppliesError,
    supplyEditor,
    setSupplyEditor,
    supplySaving,
    setSupplySaving,
    appointments,
    setAppointments,
    appointmentResidents,
    setAppointmentResidents,
    appointmentsLoading,
    setAppointmentsLoading,
    appointmentsError,
    setAppointmentsError,
    appointmentEditor,
    setAppointmentEditor,
    appointmentRevision,
    setAppointmentRevision,
    clockNow,
    setClockNow,
    residentPhoto,
    setResidentPhoto,
    residentPhotoSaving,
    setResidentPhotoSaving,
    selectedEntry,
    activeCareDomain,
    visibleHistoryEntries,
    upcomingAppointments,
    pastAppointments,
    nextAppointment,
    appointmentEditorResidents,
    visibleDocuments,
    firstName,
    lastNameParts,
    lastName,
    genderLabel,
    saveGender,
    uploadResidentPhoto,
    newBodyObservation,
    editBodyObservation,
    saveBodyObservation,
    archiveBodyObservation,
    openDocumentation,
    toggleDocumentationFlag,
    selectTab,
    openSupplyEditor,
    saveSupply,
    deleteSupply,
    saveBiography,
    openContactEditor,
    saveContact,
    deleteContact,
    saveDocumentation,
  };
}

export type ResidentRecordState = ReturnType<typeof useResidentRecord>;
