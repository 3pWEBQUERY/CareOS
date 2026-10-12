"use client";

import { useEffect, useState } from "react";
import { ResidentBiography, emptyBiography } from "./resident-record-data";
import type { ResidentRecordData } from "./resident-record-data";

export function useRecordBiography({
  resident,
  onAction,
}: {
  resident: ResidentRecordData;
  onAction: (message: string) => void;
}) {
  const [biography, setBiography] = useState<ResidentBiography>(emptyBiography);
  const [biographyEditing, setBiographyEditing] = useState(false);
  const [biographyLoading, setBiographyLoading] = useState(Boolean(resident.id));
  const [biographySaving, setBiographySaving] = useState(false);
  const [biographyError, setBiographyError] = useState("");

  useEffect(() => {
    if (!resident.id) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setBiographyLoading(true);
      fetch(`/api/residents/${resident.id}/biography`, { cache: "no-store" })
        .then(async (response) => ({ response, data: await response.json().catch(() => null) }))
        .then(({ response, data }) => {
          if (!active) return;
          if (response.ok && data?.biography) {
            setBiography(data.biography);
            setBiographyError("");
          } else setBiographyError(data?.error || "Biografie konnte nicht geladen werden.");
        })
        .catch(() => active && setBiographyError("Biografie konnte nicht geladen werden."))
        .finally(() => active && setBiographyLoading(false));
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [resident.id]);

  async function saveBiography() {
    if (!resident.id) {
      setBiographyError("Diese Demoakte ist nicht gespeichert.");
      return;
    }
    setBiographySaving(true);
    setBiographyError("");
    try {
      const response = await fetch(`/api/residents/${resident.id}/biography`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(biography),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setBiographyError(data?.error || "Biografie konnte nicht gespeichert werden.");
        return;
      }
      setBiography(data.biography);
      setBiographyEditing(false);
      onAction("Biografie gespeichert");
    } catch {
      setBiographyError("Biografie konnte nicht gespeichert werden.");
    } finally {
      setBiographySaving(false);
    }
  }
  return {
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
  };
}
