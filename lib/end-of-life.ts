import {
  ApiError,
  assertResident,
  assertUuid,
  auditStatement,
  iso,
  text,
  type ApiContext,
  type Row,
  type Sql,
} from "@/lib/api-context";
import { changedFields, residentAudit } from "@/lib/resident-audit";
import { hasPermission } from "@/lib/server-data";
import {
  DEATH_CHECKLIST_MAX_ITEMS,
  DEATH_CHECKLIST_MAX_LENGTH,
  END_OF_LIFE_FIELDS,
  type EndOfLifeFieldKey,
  type EndOfLifeView,
  type EndOfLifeWishes,
} from "@/lib/end-of-life-shared";

// Wünsche für die letzte Lebensphase und Checkliste nach einem Todesfall. Die Wünsche sind besonders schützenswert:
// im Änderungsprotokoll steht nur, welche Abschnitte sich änderten. Die Punkte der Checkliste legt die Einrichtung fest;
// es gibt keine Vorgabe.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COLUMNS: Record<EndOfLifeFieldKey, string> = {
  place: "place",
  companionship: "companionship",
  spiritual: "spiritual",
  funeral: "funeral",
  notify: "notify",
  otherWishes: "other_wishes",
};

function assertWrite(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "residents.write")) throw new ApiError("Keine Berechtigung.", 403);
}

const emptyWishes = (): EndOfLifeWishes => ({
  place: "",
  companionship: "",
  spiritual: "",
  funeral: "",
  notify: "",
  otherWishes: "",
  discussedWith: "",
  discussedOn: null,
  updatedAt: null,
  updatedBy: null,
});

function wishesOf(row: Row | undefined): EndOfLifeWishes {
  if (!row) return emptyWishes();
  return {
    ...(Object.fromEntries(END_OF_LIFE_FIELDS.map(({ key }) => [key, String(row[COLUMNS[key]] ?? "")])) as Record<
      EndOfLifeFieldKey,
      string
    >),
    discussedWith: String(row.discussed_with ?? ""),
    discussedOn: (row.discussed_day as string | null) ?? null,
    updatedAt: iso(row.updated_at),
    updatedBy: (row.updated_by_name as string | null) ?? null,
  };
}

export async function endOfLifeView(ctx: ApiContext, residentInput: unknown): Promise<EndOfLifeView> {
  const residentId = await assertResident(ctx, residentInput);
  const [wishes, resident, items] = (await Promise.all([
    ctx.sql`
      SELECT w.*, to_char(w.discussed_on, 'YYYY-MM-DD') AS discussed_day, u.display_name AS updated_by_name
      FROM carecore_end_of_life_wishes w LEFT JOIN carecore_users u ON u.id = w.updated_by
      WHERE w.resident_id = ${residentId}`,
    ctx.sql`
      SELECT status, to_char(deceased_on, 'YYYY-MM-DD') AS deceased_day FROM carecore_residents WHERE id = ${residentId}`,
    ctx.sql`
      SELECT i.id, i.label, i.done_at, i.note, COALESCE(u.display_name, 'Unbekannt') AS done_by
      FROM carecore_death_checklist_items i LEFT JOIN carecore_users u ON u.id = i.done_by
      WHERE i.resident_id = ${residentId} ORDER BY i.position`,
  ])) as Row[][];
  const deceased = resident[0]?.status === "deceased";
  return {
    residentId,
    canWrite: hasPermission(ctx.actor, "residents.write"),
    wishes: wishesOf(wishes[0]),
    deceasedOn: deceased ? ((resident[0].deceased_day as string | null) ?? null) : null,
    checklist: items.map((row) => ({
      id: String(row.id),
      label: String(row.label),
      doneAt: iso(row.done_at),
      doneBy: row.done_at ? String(row.done_by) : null,
      note: String(row.note),
    })),
  };
}

export async function saveEndOfLifeWishes(ctx: ApiContext, residentInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const residentId = await assertResident(ctx, residentInput);
  const next = Object.fromEntries(END_OF_LIFE_FIELDS.map(({ key }) => [key, text(body[key], 4000)])) as Record<
    EndOfLifeFieldKey,
    string
  >;
  const discussedWith = text(body.discussedWith, 200);
  const discussedOn =
    body.discussedOn === null || body.discussedOn === undefined || body.discussedOn === ""
      ? null
      : typeof body.discussedOn === "string" && DATE.test(body.discussedOn)
        ? body.discussedOn
        : null;
  if (body.discussedOn && !discussedOn) throw new ApiError("Das Datum des Gesprächs ist ungültig.");
  const [today] = (await ctx.sql`
    SELECT to_char(NOW() AT TIME ZONE timezone, 'YYYY-MM-DD') AS day FROM carecore_organizations
    WHERE id = ${ctx.actor.organizationId}`) as Row[];
  if (discussedOn && discussedOn > String(today.day))
    throw new ApiError("Das Datum des Gesprächs darf nicht in der Zukunft liegen.");
  const [before] = (await ctx.sql`
    SELECT w.*, to_char(w.discussed_on, 'YYYY-MM-DD') AS discussed_day
    FROM carecore_end_of_life_wishes w WHERE w.resident_id = ${residentId}`) as Row[];
  const old = before ? wishesOf(before) : undefined;
  const after = { ...next, discussedWith, discussedOn };
  const sections = changedFields(
    old && {
      ...Object.fromEntries(END_OF_LIFE_FIELDS.map(({ key }) => [key, old[key]])),
      discussedWith: old.discussedWith,
      discussedOn: old.discussedOn,
    },
    after,
  );
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_end_of_life_wishes (resident_id, organization_id, place, companionship, spiritual, funeral,
        notify, other_wishes, discussed_with, discussed_on, updated_by)
      VALUES (${residentId}, ${ctx.actor.organizationId}, ${next.place}, ${next.companionship}, ${next.spiritual},
        ${next.funeral}, ${next.notify}, ${next.otherWishes}, ${discussedWith}, ${discussedOn}, ${ctx.actor.id})
      ON CONFLICT (resident_id) DO UPDATE SET place = EXCLUDED.place, companionship = EXCLUDED.companionship,
        spiritual = EXCLUDED.spiritual, funeral = EXCLUDED.funeral, notify = EXCLUDED.notify,
        other_wishes = EXCLUDED.other_wishes, discussed_with = EXCLUDED.discussed_with,
        discussed_on = EXCLUDED.discussed_on, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId,
      entityType: "end_of_life_wishes",
      entityId: residentId,
      action: before ? "updated" : "created",
      after: { changedSections: sections },
    }),
  ]);
  return endOfLifeView(ctx, residentId);
}

// Checkliste der Einrichtung (Leitung · Konfiguration). Leer, bis die Einrichtung Punkte festlegt.
export const resolveDeathChecklist = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim())
    : [];

export async function readDeathChecklist(ctx: ApiContext) {
  const rows =
    await ctx.sql`SELECT settings->'deathChecklist' AS items FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}`;
  return resolveDeathChecklist(rows[0]?.items);
}

export async function saveDeathChecklist(ctx: ApiContext, body: Record<string, unknown>) {
  if (!hasPermission(ctx.actor, "administration.manage")) throw new ApiError("Keine Berechtigung.", 403);
  if (!Array.isArray(body.items) || !body.items.every((item) => typeof item === "string"))
    throw new ApiError("Bitte die Punkte der Checkliste angeben.");
  const items = (body.items as string[]).map((item) => item.trim()).filter(Boolean);
  if (items.length > DEATH_CHECKLIST_MAX_ITEMS)
    throw new ApiError(`Höchstens ${DEATH_CHECKLIST_MAX_ITEMS} Punkte möglich.`);
  if (items.some((item) => item.length > DEATH_CHECKLIST_MAX_LENGTH))
    throw new ApiError(`Ein Punkt hat höchstens ${DEATH_CHECKLIST_MAX_LENGTH} Zeichen.`);
  if (new Set(items.map((item) => item.toLowerCase())).size !== items.length)
    throw new ApiError("Jeder Punkt darf nur einmal vorkommen.");
  const before = await readDeathChecklist(ctx);
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_organizations
      SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{deathChecklist}', ${JSON.stringify(items)}::jsonb),
        updated_at = NOW()
      WHERE id = ${ctx.actor.organizationId}`,
    auditStatement(ctx, "setting", ctx.actor.organizationId, "death_checklist", { items: before }, { items }),
  ]);
  return items;
}

// Beim Erfassen des Todesfalls (in derselben Transaktion): die aktuellen Punkte der Einrichtung für die Person übernehmen.
export function deathChecklistSnapshot(sql: Sql, organizationId: string, residentId: string) {
  return sql`
    INSERT INTO carecore_death_checklist_items (id, organization_id, resident_id, position, label)
    SELECT gen_random_uuid(), o.id, ${residentId}, item.position, left(btrim(item.label), ${DEATH_CHECKLIST_MAX_LENGTH})
    FROM carecore_organizations o
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(o.settings->'deathChecklist') = 'array' THEN o.settings->'deathChecklist' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS item(label, position)
    WHERE o.id = ${organizationId} AND btrim(item.label) <> ''
      AND NOT EXISTS (SELECT 1 FROM carecore_death_checklist_items WHERE resident_id = ${residentId})`;
}

// Für Todesfälle, die vor dem Festlegen der Checkliste erfasst wurden: Punkte nachträglich übernehmen.
export async function applyDeathChecklist(ctx: ApiContext, residentInput: unknown) {
  assertWrite(ctx);
  const residentId = await assertResident(ctx, residentInput);
  const [resident] = (await ctx.sql`SELECT status FROM carecore_residents WHERE id = ${residentId}`) as Row[];
  if (resident.status !== "deceased") throw new ApiError("Die Checkliste gilt nur nach einem Todesfall.", 409);
  if (!(await readDeathChecklist(ctx)).length)
    throw new ApiError("Die Einrichtung hat noch keine Checkliste festgelegt.", 409);
  const [existing] = (await ctx.sql`
    SELECT COUNT(*)::int AS count FROM carecore_death_checklist_items WHERE resident_id = ${residentId}`) as Row[];
  if (Number(existing.count) > 0) throw new ApiError("Die Checkliste ist bereits vorhanden.", 409);
  await ctx.sql.transaction([
    deathChecklistSnapshot(ctx.sql, ctx.actor.organizationId, residentId),
    residentAudit(ctx.sql, ctx.actor, {
      residentId,
      entityType: "death_checklist",
      entityId: residentId,
      action: "created",
    }),
  ]);
  return endOfLifeView(ctx, residentId);
}

// Punkt abhaken bzw. wieder öffnen ({ done, note? }); nur, wenn er inzwischen nicht von jemand anderem geändert wurde.
export async function updateDeathChecklistItem(ctx: ApiContext, itemInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const itemId = assertUuid(itemInput, "Punkt");
  if (typeof body.done !== "boolean") throw new ApiError("Bitte angeben, ob der Punkt erledigt ist.");
  const done = body.done;
  const note = text(body.note, 500);
  const [item] = (await ctx.sql`
    SELECT id, resident_id, label, done_at FROM carecore_death_checklist_items
    WHERE id = ${itemId} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!item) throw new ApiError("Punkt nicht gefunden.", 404);
  const conflict = () => new ApiError("Der Punkt wurde inzwischen geändert. Bitte neu laden.", 409);
  if (Boolean(item.done_at) === done) throw conflict();
  await ctx.sql
    .transaction([
      ctx.sql`
        WITH changed AS (
          UPDATE carecore_death_checklist_items
          SET done_at = CASE WHEN ${done} THEN NOW() END, done_by = CASE WHEN ${done} THEN ${ctx.actor.id}::uuid END,
            note = CASE WHEN ${done} THEN ${note} ELSE '' END
          WHERE id = ${itemId} AND (done_at IS NULL) = ${done} RETURNING id)
        SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'ITEM_CHANGED')`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId: String(item.resident_id),
        entityType: "death_checklist",
        entityId: itemId,
        action: done ? "item_done" : "item_reopened",
        after: { label: String(item.label), ...(done && note ? { note } : {}) },
      }),
    ])
    .catch((error) => {
      if (String(error).includes("ITEM_CHANGED")) throw conflict();
      throw error;
    });
  return endOfLifeView(ctx, String(item.resident_id));
}
