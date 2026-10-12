"use client";

import { DEATH_CHECKLIST_MAX_ITEMS } from "@/lib/end-of-life-shared";
import { CONSENT_TOPICS_MAX } from "@/lib/consents-shared";
import { OrgListCard } from "./org-list-card";

// Checkliste nach einem Todesfall: Die Einrichtung legt ihre Punkte selbst fest (keine Vorgabe). Beim Erfassen eines
// Todesfalls werden sie für die Person übernommen; spätere Änderungen gelten für künftige Todesfälle.
export function DeathChecklistCard({ showToast }: { showToast: (message: string) => void }) {
  return (
    <OrgListCard
      id="death-checklist"
      eyebrow="Lebensende"
      title="Checkliste nach einem Todesfall"
      endpoint="/api/admin/death-checklist"
      field="items"
      singular="Punkt"
      plural="Punkte"
      usage="wird beim Erfassen eines Todesfalls übernommen"
      empty="Noch keine Punkte festgelegt – die Einrichtung bestimmt sie selbst"
      description={`Ein Punkt pro Zeile, höchstens ${DEATH_CHECKLIST_MAX_ITEMS}. Änderungen gelten für künftige Todesfälle; bereits übernommene Checklisten bleiben unverändert.`}
      placeholder={"z. B.\nÄrztin bzw. Arzt informiert\nAngehörige informiert\nBestattungsunternehmen beauftragt"}
      savedMessage="Checkliste nach einem Todesfall gespeichert"
      submitLabel="Checkliste speichern"
      showToast={showToast}
    />
  );
}

// Themen der Einwilligungen und Freigaben (z. B. Fotos, Weitergabe von Daten): legt die Einrichtung selbst fest.
export function ConsentTopicsCard({ showToast }: { showToast: (message: string) => void }) {
  return (
    <OrgListCard
      id="consent-topics"
      eyebrow="Datenschutz"
      title="Themen der Einwilligungen"
      endpoint="/api/admin/consent-topics"
      field="topics"
      singular="Thema"
      plural="Themen"
      usage="in der Akte unter Stammdaten › Einwilligungen & Freigaben"
      empty="Noch keine Themen festgelegt – die Einrichtung bestimmt sie selbst"
      description={`Ein Thema pro Zeile, höchstens ${CONSENT_TOPICS_MAX}. Bereits erfasste Entscheide bleiben erhalten.`}
      placeholder={"z. B.\nFotos in der Einrichtung\nWeitergabe von Daten an Angehörige\nTeilnahme an Ausflügen"}
      savedMessage="Themen der Einwilligungen gespeichert"
      submitLabel="Themen speichern"
      showToast={showToast}
    />
  );
}
