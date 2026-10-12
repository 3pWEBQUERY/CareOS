import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api-context";
import { reviewDraft } from "@/lib/ai";
import { createOrder, parseOrderInput, setOrderStatus, updateMedicationAllergies } from "@/lib/medication-orders";
import { apiContextFor, createResident, fixture, q } from "../support/db";

const residentLog = (residentId: string) =>
  q<{ entity_type: string; action: string }>(
    `SELECT entity_type, action FROM carecore_audit_log
     WHERE entity_id = $1 OR COALESCE(after_data ->> 'residentId', before_data ->> 'residentId') = $1::text
     ORDER BY created_at`,
    [residentId],
  ).then((rows) => rows.map((row) => `${row.entity_type}:${row.action}`));

test("Verordnungen und Allergien stehen im Änderungsprotokoll der Akte; unveränderter Status wird nicht protokolliert", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  const orderId = await createOrder(
    ctx,
    residentId,
    parseOrderInput({
      name: "Metoprolol",
      strength: "50 mg",
      form: "Tablette",
      amount: "1 Tablette",
      times: ["08:00"],
      prescribedBy: "Dr. Muster",
      startOn: "2026-01-01",
    }),
  );
  await setOrderStatus(ctx, orderId, "paused", "Spitalaufenthalt");
  await setOrderStatus(ctx, orderId, "paused", "doppelt");
  await updateMedicationAllergies(ctx, residentId, "Penicillin");
  assert.deepEqual(await residentLog(residentId), [
    "medication_order:created",
    "medication_order:status_paused",
    "resident:medication_allergies_updated",
  ]);
});

test("KI-Entwurf: doppeltes Übernehmen erzeugt nur einen Dokumentationseintrag", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  const draftId = randomUUID();
  await q(
    `INSERT INTO carecore_ai_drafts (id, organization_id, resident_id, requested_by, type, content)
     VALUES ($1, $2, $3, $4, 'documentation', 'Bewohnerin hat gut geschlafen.')`,
    [draftId, f.org, residentId, f.people.anna],
  );
  const results = await Promise.allSettled([
    reviewDraft(ctx, draftId, { action: "accept" }),
    reviewDraft(ctx, draftId, { action: "accept" }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(rejected && rejected.status === "rejected" && rejected.reason instanceof ApiError);
  const [entries] = await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM carecore_documentation_entries WHERE resident_id = $1`,
    [residentId],
  );
  assert.equal(entries.n, 1);
  const [draft] = await q<{ status: string; saved_entity_id: string | null }>(
    `SELECT status, saved_entity_id FROM carecore_ai_drafts WHERE id = $1`,
    [draftId],
  );
  assert.equal(draft.status, "accepted");
  assert.ok(draft.saved_entity_id);
});
