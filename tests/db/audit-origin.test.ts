import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { auditStatement } from "@/lib/api-context";
import { deviceLabel } from "@/lib/audit-origin";
import { residentAudit } from "@/lib/resident-audit";
import { apiContextFor, createResident, fixture, q } from "../support/db";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

test("Protokoll: Sitzung und Gerät der handelnden Person werden festgehalten", async () => {
  const f = await fixture();
  const base = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  const sessionId = randomUUID();
  // So wie nach der Anmeldung: der Handelnde trägt Sitzung und Browser-Kennung mit.
  const ctx = { ...base, actor: { ...base.actor, session_id: sessionId, user_agent: IPHONE } };
  await ctx.sql.transaction([
    auditStatement(ctx, "resident", residentId, "viewed_test", null, { residentId }),
    residentAudit(ctx.sql, ctx.actor, {
      residentId,
      entityType: "resident_contact",
      entityId: randomUUID(),
      action: "created",
    }),
    // Ohne Sitzung (z. B. Hintergrundlauf) bleiben die Felder leer.
    auditStatement(base, "resident", residentId, "system_test", null, { residentId }),
  ]);
  const rows = await q<{ action: string; session_id: string | null; user_agent: string | null }>(
    `SELECT action, session_id, user_agent FROM carecore_audit_log
     WHERE organization_id = $1 AND action IN ('viewed_test', 'created', 'system_test') ORDER BY action`,
    [f.org],
  );
  const byAction = Object.fromEntries(rows.map((row) => [row.action, row]));
  assert.equal(byAction.viewed_test.session_id, sessionId);
  assert.equal(byAction.viewed_test.user_agent, IPHONE);
  assert.equal(byAction.created.session_id, sessionId);
  assert.equal(byAction.system_test.session_id, null);
  assert.equal(byAction.system_test.user_agent, null);
  assert.equal(deviceLabel(IPHONE), "Safari · iPhone");
});
