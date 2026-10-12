"use client";

import { useTerms } from "@/app/components/care-context";
import { useEffect, useState, type ChangeEvent } from "react";
import { preparePhoto } from "@/lib/resident-photo-client";
import type { ResidentRecordData } from "./resident-record-data";

export function useRecordMasterData({
  resident,
  setBodyError,
  onGenderChanged,
  onAction,
  onPhotoChanged,
  residentPhotoInputRef,
}: {
  resident: ResidentRecordData;
  setBodyError: (message: string) => void;
  onGenderChanged: ((residentId: string, gender: string) => void) | undefined;
  onAction: (message: string) => void;
  onPhotoChanged: (() => void) | undefined;
  residentPhotoInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const t = useTerms();
  const [masterDataEditing, setMasterDataEditing] = useState(false);
  const [residentGender, setResidentGender] = useState(resident.gender ?? "unspecified");
  const [genderDraft, setGenderDraft] = useState(resident.gender ?? "unspecified");
  const [masterDataSaving, setMasterDataSaving] = useState(false);
  const [residentPhoto, setResidentPhoto] = useState<string | null>(null);
  const [residentPhotoSaving, setResidentPhotoSaving] = useState(false);
  const [firstName, ...lastNameParts] = resident.name.split(" ");
  const lastName = lastNameParts.join(" ");
  const genderLabel =
    { female: "Weiblich", male: "Männlich", diverse: "Divers", unspecified: "Keine Angabe" }[residentGender] ??
    "Keine Angabe";

  useEffect(() => {
    if (!resident.id) return;
    let active = true;
    fetch(`/api/residents/${resident.id}/photo`, { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json().catch(() => null) }))
      .then(({ response, data }) => {
        if (active && response.ok) setResidentPhoto(typeof data?.photoDataUrl === "string" ? data.photoDataUrl : null);
      })
      .catch(() => {
        if (active) setResidentPhoto(null);
      });
    return () => {
      active = false;
    };
  }, [resident.id]);

  async function saveGender() {
    if (!resident.id) {
      setBodyError("Diese Akte ist nicht gespeichert.");
      return;
    }
    setMasterDataSaving(true);
    try {
      const response = await fetch(`/api/residents/${resident.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gender: genderDraft }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Geschlecht konnte nicht gespeichert werden.");
      setResidentGender(data.gender);
      setMasterDataEditing(false);
      onGenderChanged?.(resident.id, data.gender);
      onAction("Geschlecht in den Stammdaten gespeichert");
    } catch (error) {
      onAction(error instanceof Error ? error.message : "Geschlecht konnte nicht gespeichert werden.");
    } finally {
      setMasterDataSaving(false);
    }
  }

  async function uploadResidentPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (!resident.id) {
      onAction(`Dieses ${t.prefix}profil kann nicht gespeichert werden.`);
      return;
    }
    setResidentPhotoSaving(true);
    try {
      const photoDataUrl = await preparePhoto(file);
      const response = await fetch(`/api/residents/${resident.id}/photo`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photoDataUrl }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || `${t.prefix}bild konnte nicht gespeichert werden.`);
      setResidentPhoto(data.photoDataUrl);
      onPhotoChanged?.();
      onAction(`${t.prefix}bild für ${resident.name} gespeichert`);
    } catch (error) {
      onAction(error instanceof Error ? error.message : `${t.prefix}bild konnte nicht gespeichert werden.`);
    } finally {
      setResidentPhotoSaving(false);
      if (residentPhotoInputRef.current) residentPhotoInputRef.current.value = "";
    }
  }
  return {
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
  };
}
