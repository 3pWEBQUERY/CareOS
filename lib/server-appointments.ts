import {
  appointmentCategories,
  appointmentStatuses,
  careUnitTaskCategories,
  TRANSPORT_LABELS,
  type AppointmentKind,
  type AppointmentTransport,
  type AppointmentStatus,
} from "@/lib/resident-appointments";

type AppointmentInput = Record<string, unknown>;

const text = (value: unknown, length: number) => (typeof value === "string" ? value.trim().slice(0, length) : "");

export function parseAppointmentInput(input: AppointmentInput) {
  const residentId = text(input.residentId, 80);
  const careUnitId = text(input.careUnitId, 80);
  const kind = text(input.kind, 24) as AppointmentKind;
  const title = text(input.title, 180);
  const category = text(input.category, 40);
  const startsAt = text(input.startsAt, 40);
  const endsAt = text(input.endsAt, 40);
  const location = text(input.location, 180);
  const notes = text(input.notes, 4000);
  const status = text(input.status, 24) as AppointmentStatus;
  const starts = Date.parse(startsAt);
  const ends = Date.parse(endsAt);
  if (kind !== "resident" && kind !== "care_unit_task")
    return { error: "Bitte eine gültige Terminart auswählen." } as const;
  if (kind === "resident" && !/^[0-9a-f-]{36}$/i.test(residentId))
    return { error: "Bitte eine Person auswählen." } as const;
  if (kind === "care_unit_task" && !/^[0-9a-f-]{36}$/i.test(careUnitId))
    return { error: "Bitte einen Wohnbereich auswählen." } as const;
  if (!title) return { error: "Bitte eine Terminbezeichnung eingeben." } as const;
  const categories: readonly string[] = kind === "resident" ? appointmentCategories : careUnitTaskCategories;
  if (!categories.includes(category)) return { error: "Bitte eine gültige Kategorie auswählen." } as const;
  if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts)
    return { error: "Die Endzeit muss nach der Startzeit liegen." } as const;
  if (!appointmentStatuses.includes(status)) return { error: "Bitte einen gültigen Status auswählen." } as const;
  // Ausser Haus (nur Termine einer Person): Transport, Abholung, Begleitung, Unterlagen.
  const outside = kind === "resident" && input.outside === true;
  const transportInput = text(input.transport, 24);
  const transport = outside && transportInput ? (transportInput as AppointmentTransport) : null;
  if (transport && !(transport in TRANSPORT_LABELS))
    return { error: "Bitte einen gültigen Transport auswählen." } as const;
  const pickupInput = outside ? text(input.pickupAt, 40) : "";
  const pickup = pickupInput ? Date.parse(pickupInput) : null;
  if (pickup !== null && !Number.isFinite(pickup)) return { error: "Die Abholzeit ist ungültig." } as const;
  if (pickup !== null && pickup >= ends) return { error: "Die Abholung muss vor dem Terminende liegen." } as const;
  return {
    kind,
    residentId: kind === "resident" ? residentId : null,
    careUnitId: kind === "care_unit_task" ? careUnitId : null,
    title,
    category,
    startsAt: new Date(starts).toISOString(),
    endsAt: new Date(ends).toISOString(),
    location,
    notes,
    status,
    outside,
    transport,
    transportNote: outside ? text(input.transportNote, 300) : "",
    pickupAt: pickup === null ? null : new Date(pickup).toISOString(),
    escort: outside ? text(input.escort, 200) : "",
    documents: outside ? text(input.documents, 2000) : "",
  };
}
