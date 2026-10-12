import { test } from "node:test";
import assert from "node:assert/strict";
import { appointmentLocalParts, initialAppointmentDraft } from "@/lib/resident-appointments";

test("Neuer Termin: an anderen Tagen 09:00, heute nicht in der Vergangenheit", () => {
  const future = initialAppointmentDraft("r1", "2099-01-15");
  assert.equal(future.startTime, "09:00");
  assert.equal(future.endTime, "10:00");

  const now = appointmentLocalParts(new Date());
  const today = initialAppointmentDraft("r1");
  assert.equal(today.date, now.date);
  const hour = Number(now.time.slice(0, 2));
  assert.equal(today.startTime, hour < 9 ? "09:00" : `${String(Math.min(hour + 1, 22)).padStart(2, "0")}:00`);
  assert.ok(today.startTime > now.time || hour >= 22);

  // Ein ausdrücklich gewählter Zeitpunkt (z. B. Klick in den Kalender) bleibt unverändert.
  assert.equal(initialAppointmentDraft("", "2099-01-15", "14:30").startTime, "14:30");
});
