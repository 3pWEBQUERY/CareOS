import { randomUUID } from "node:crypto";
import { readTerms } from "@/lib/settings";
import { ApiError, assertResident, assertUuid, iso, num, text, type ApiContext, type Row } from "@/lib/api-context";
import { initials } from "@/lib/medication-shared";
import { residentAudit } from "@/lib/resident-audit";
import { receiptStatements, withReceipt } from "@/lib/request-receipts";
import {
  EDGE_OPTIONS,
  ENTRY_TYPES,
  EXUDATE_OPTIONS,
  PRESSURE_CATEGORIES,
  SKIN_OPTIONS,
  TISSUE_OPTIONS,
  WOUND_MATERIALS_MAX,
  WOUND_TYPES,
  type Wound,
  type WoundMaterial,
  type WoundEntry,
  type WoundInput,
  type WoundOrigin,
  type WoundStatus,
} from "@/lib/wounds-shared";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const oneOf = <T extends readonly string[]>(options: T, value: unknown) =>
  typeof value === "string" && (options as readonly string[]).includes(value) ? value : null;

function mapEntry(row: Row): WoundEntry {
  return {
    id: String(row.id),
    woundId: String(row.wound_id),
    entryType: String(row.entry_type ?? "Verlaufskontrolle"),
    observedAt: iso(row.observed_at) ?? "",
    author: (row.author as string | null) ?? null,
    lengthCm: num(row.length_cm),
    widthCm: num(row.width_cm),
    depthCm: num(row.depth_cm),
    tissue: (row.tissue as string | null) ?? null,
    exudate: (row.exudate as string | null) ?? null,
    woundEdge: (row.wound_edge as string | null) ?? null,
    surroundingSkin: (row.surrounding_skin as string | null) ?? null,
    odor: Boolean(row.odor),
    infectionSigns: Boolean(row.infection_signs),
    painScore: num(row.pain_score),
    treatment: (row.treatment as string | null) ?? null,
    materials: Array.isArray(row.materials) ? (row.materials as WoundMaterial[]) : [],
    note: (row.note as string | null) ?? null,
  };
}

// ------------------------------------------------------------------ wounds

async function queryWounds(ctx: ApiContext, woundId: string | null, includeClosed: boolean): Promise<Wound[]> {
  const rows = (await ctx.sql`
    SELECT w.*, r.first_name, r.last_name, COALESCE(ro.name, '') AS room, COALESCE(cu.name, '') AS care_unit,
      ru.display_name AS responsible_name,
      (SELECT COUNT(*)::int FROM carecore_wound_entries WHERE wound_id = w.id) AS entry_count,
      (SELECT COUNT(*)::int FROM carecore_wound_photos WHERE wound_id = w.id AND deleted_at IS NULL) AS photo_count,
      bo.id AS body_observation_id, bo.label AS body_observation_label, bo.location AS body_observation_location,
      first_sized.length_cm * first_sized.width_cm AS first_area,
      -- A healing trend needs at least two measurements.
      CASE WHEN (SELECT COUNT(*) FROM carecore_wound_entries WHERE wound_id = w.id AND length_cm IS NOT NULL AND width_cm IS NOT NULL) >= 2
        THEN sized.length_cm * sized.width_cm END AS current_area,
      to_jsonb(latest_entry) AS latest,
      COALESCE(latest_entry.observed_at, w.discovered_at, w.created_at) + make_interval(days => w.care_interval_days) AS next_care_at,
      (w.status <> 'closed' AND w.care_interval_days IS NOT NULL
        AND COALESCE(latest_entry.observed_at, w.discovered_at, w.created_at) + make_interval(days => w.care_interval_days) < NOW()) AS overdue,
      (w.status <> 'closed' AND w.care_interval_days IS NOT NULL
        AND ((COALESCE(latest_entry.observed_at, w.discovered_at, w.created_at) + make_interval(days => w.care_interval_days)) AT TIME ZONE org.tz)::date
          <= (NOW() AT TIME ZONE org.tz)::date) AS due_today
    FROM carecore_wounds w
    JOIN carecore_residents r ON r.id = w.resident_id AND r.organization_id = ${ctx.actor.organizationId}
    CROSS JOIN (SELECT timezone AS tz FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}) org
    LEFT JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) stay ON TRUE
    LEFT JOIN carecore_care_units cu ON cu.id = stay.care_unit_id
    LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
    LEFT JOIN carecore_users ru ON ru.id = w.responsible_user_id
    LEFT JOIN carecore_body_observations bo ON bo.wound_id = w.id AND bo.archived_at IS NULL
    LEFT JOIN LATERAL (
      SELECT length_cm, width_cm FROM carecore_wound_entries
      WHERE wound_id = w.id AND length_cm IS NOT NULL AND width_cm IS NOT NULL ORDER BY observed_at LIMIT 1) first_sized ON TRUE
    LEFT JOIN LATERAL (
      SELECT length_cm, width_cm FROM carecore_wound_entries
      WHERE wound_id = w.id AND length_cm IS NOT NULL AND width_cm IS NOT NULL ORDER BY observed_at DESC LIMIT 1) sized ON TRUE
    LEFT JOIN LATERAL (
      SELECT e.*, u.display_name AS author FROM carecore_wound_entries e LEFT JOIN carecore_users u ON u.id = e.author_user_id
      WHERE e.wound_id = w.id ORDER BY e.observed_at DESC LIMIT 1) latest_entry ON TRUE
    WHERE (${woundId}::uuid IS NULL OR w.id = ${woundId}::uuid)
      AND w.status <> 'archived' AND (${includeClosed} OR w.status <> 'closed')
    ORDER BY (w.status = 'closed'), next_care_at NULLS LAST, r.last_name`) as Row[];
  return rows.map((row) => {
    const residentName = `${row.first_name} ${row.last_name}`;
    return {
      id: String(row.id),
      residentId: String(row.resident_id),
      residentName,
      initials: initials(residentName),
      room: String(row.room),
      careUnit: String(row.care_unit),
      title: String(row.title),
      bodyLocation: String(row.body_location),
      woundType: (row.wound_type as string | null) ?? null,
      category: (row.category as string | null) ?? null,
      diagnosis: (row.diagnosis as string | null) ?? null,
      origin: row.origin as WoundOrigin,
      status: (row.status === "healing" || row.status === "closed" ? row.status : "active") as WoundStatus,
      discoveredAt: iso(row.discovered_at),
      careIntervalDays: num(row.care_interval_days),
      treatmentPlan: (row.treatment_plan as string | null) ?? null,
      responsibleId: (row.responsible_user_id as string | null) ?? null,
      responsibleName: (row.responsible_name as string | null) ?? null,
      closedAt: iso(row.closed_at),
      closedReason: (row.closed_reason as string | null) ?? null,
      entryCount: Number(row.entry_count),
      photoCount: Number(row.photo_count),
      bodyObservation: row.body_observation_id
        ? {
            id: String(row.body_observation_id),
            label: String(row.body_observation_label),
            location: String(row.body_observation_location),
          }
        : null,
      firstArea: num(row.first_area),
      currentArea: num(row.current_area),
      latest: row.latest ? mapEntry(row.latest as Row) : null,
      nextCareAt: iso(row.next_care_at),
      overdue: Boolean(row.overdue),
      dueToday: Boolean(row.due_today),
    };
  });
}

export async function woundsOverview(ctx: ApiContext, includeClosed: boolean) {
  const [wounds, residents, staff] = await Promise.all([
    queryWounds(ctx, null, includeClosed),
    ctx.sql`
      SELECT r.id, r.first_name || ' ' || r.last_name AS name, COALESCE(ro.name, '') AS room
      FROM carecore_residents r
      LEFT JOIN LATERAL (SELECT room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) stay ON TRUE
      LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
      WHERE r.organization_id = ${ctx.actor.organizationId} AND r.status = 'active'
      ORDER BY r.last_name, r.first_name` as Promise<Row[]>,
    ctx.sql`
      SELECT u.id, u.display_name AS name FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
      WHERE p.organization_id = ${ctx.actor.organizationId} AND u.active ORDER BY u.display_name` as Promise<Row[]>,
  ]);
  return {
    wounds,
    residents: residents.map((r) => ({ id: String(r.id), name: String(r.name), room: String(r.room) })),
    staff: staff.map((u) => ({ id: String(u.id), name: String(u.name) })),
  };
}

async function loadWound(ctx: ApiContext, woundIdInput: unknown) {
  const id = assertUuid(woundIdInput, "Wunde");
  const [wound] = await queryWounds(ctx, id, true);
  if (!wound) throw new ApiError("Wunde nicht gefunden.", 404);
  return wound;
}

// Verbandwechsel-Intervall in Tagen (1–14) oder leer; ungültige Werte werden nicht stillschweigend verworfen.
function careInterval(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 14)
    throw new ApiError("Das Intervall der Wundversorgung muss zwischen 1 und 14 Tagen liegen.");
  return value as number;
}

export function parseWoundInput(body: Record<string, unknown>): WoundInput {
  const woundType = oneOf(WOUND_TYPES, body.woundType);
  if (!woundType) throw new ApiError("Bitte die Wundart wählen.");
  const category = woundType === "Dekubitus" ? oneOf(PRESSURE_CATEGORIES, body.category) : null;
  if (woundType === "Dekubitus" && !category) throw new ApiError("Für einen Dekubitus ist die Kategorie erforderlich.");
  const input: WoundInput = {
    residentId: String(body.residentId ?? ""),
    title: text(body.title, 180),
    bodyLocation: text(body.bodyLocation, 160),
    woundType,
    category,
    diagnosis: text(body.diagnosis, 180),
    origin: body.origin === "inhouse" || body.origin === "external" ? body.origin : "unknown",
    discoveredOn: typeof body.discoveredOn === "string" && DATE.test(body.discoveredOn) ? body.discoveredOn : "",
    careIntervalDays: careInterval(body.careIntervalDays),
    treatmentPlan: text(body.treatmentPlan, 4000),
    responsibleId: typeof body.responsibleId === "string" && body.responsibleId ? body.responsibleId : null,
    bodyObservationId:
      typeof body.bodyObservationId === "string" && body.bodyObservationId ? body.bodyObservationId : null,
  };
  if (!input.bodyLocation) throw new ApiError("Bitte die Lokalisation angeben, z. B. „Sakralbereich“.");
  if (!input.title) input.title = `${woundType}${category ? ` ${category}` : ""} · ${input.bodyLocation}`.slice(0, 180);
  if (!input.discoveredOn) throw new ApiError("Bitte das Datum der Feststellung angeben.");
  return input;
}

async function assertNotFuture(ctx: ApiContext, discoveredOn: string) {
  const today = (
    await ctx.sql`SELECT to_char(NOW() AT TIME ZONE timezone, 'YYYY-MM-DD') AS d FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}`
  )[0].d as string;
  if (discoveredOn > today) throw new ApiError("Das Feststellungsdatum liegt in der Zukunft.");
}

async function assertStaff(ctx: ApiContext, userId: string | null) {
  if (!userId) return;
  const rows = await ctx.sql`
    SELECT p.user_id FROM carecore_user_profiles p JOIN carecore_users u ON u.id = p.user_id AND u.active
    WHERE p.user_id = ${assertUuid(userId, "Verantwortliche Person")} AND p.organization_id = ${ctx.actor.organizationId}`;
  if (!rows[0])
    throw new ApiError("Die verantwortliche Person gehört nicht zu dieser Organisation oder ist nicht aktiv.");
}

export async function createWound(ctx: ApiContext, body: Record<string, unknown>) {
  const input = parseWoundInput(body);
  const residentId = await assertResident(ctx, input.residentId);
  await assertStaff(ctx, input.responsibleId);
  await assertNotFuture(ctx, input.discoveredOn);
  const initial = body.initialEntry ? (body.initialEntry as Record<string, unknown>) : null;
  const entry = initial
    ? parseEntryInput({ ...initial, entryType: "Erstbeurteilung" }, await parseMaterials(ctx, initial.materials))
    : null;
  await assertLinkable(ctx, null, residentId, input.bodyObservationId);
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_wounds (id, resident_id, title, body_location, diagnosis, status, discovered_at, responsible_user_id,
        wound_type, category, origin, care_interval_days, treatment_plan)
      VALUES (${id}, ${residentId}, ${input.title}, ${input.bodyLocation}, ${input.diagnosis || null}, 'active', ${input.discoveredOn}::date,
        ${input.responsibleId}, ${input.woundType}, ${input.category}, ${input.origin}, ${input.careIntervalDays}, ${input.treatmentPlan || null})`,
    ...(entry ? [insertEntry(ctx, id, entry)] : []),
    ...linkStatements(ctx, id, input.bodyObservationId),
    residentAudit(ctx.sql, ctx.actor, {
      residentId,
      entityType: "wound",
      entityId: id,
      action: "created",
      after: { ...input, initialEntry: entry },
    }),
  ]);
  return id;
}

export async function updateWound(ctx: ApiContext, woundId: unknown, body: Record<string, unknown>) {
  const before = await loadWound(ctx, woundId);
  if (before.status === "closed") throw new ApiError("Abgeschlossene Wunden bitte zuerst wieder eröffnen.", 409);
  const input = parseWoundInput({ ...body, residentId: before.residentId });
  await assertNotFuture(ctx, input.discoveredOn);
  await assertStaff(ctx, input.responsibleId);
  await assertLinkable(ctx, before.id, before.residentId, input.bodyObservationId);
  await ctx.sql.transaction([
    ctx.sql`
    UPDATE carecore_wounds SET title = ${input.title}, body_location = ${input.bodyLocation}, diagnosis = ${input.diagnosis || null},
      discovered_at = ${input.discoveredOn}::date, responsible_user_id = ${input.responsibleId}, wound_type = ${input.woundType},
      category = ${input.category}, origin = ${input.origin}, care_interval_days = ${input.careIntervalDays},
      treatment_plan = ${input.treatmentPlan || null}, updated_at = NOW()
    WHERE id = ${before.id}`,
    ...linkStatements(ctx, before.id, input.bodyObservationId),
    residentAudit(ctx.sql, ctx.actor, {
      residentId: before.residentId,
      entityType: "wound",
      entityId: before.id,
      action: "updated",
      before: {
        title: before.title,
        bodyLocation: before.bodyLocation,
        woundType: before.woundType,
        category: before.category,
        diagnosis: before.diagnosis,
        origin: before.origin,
        careIntervalDays: before.careIntervalDays,
        treatmentPlan: before.treatmentPlan,
        responsibleId: before.responsibleId,
        bodyObservationId: before.bodyObservation?.id ?? null,
      },
      after: input,
    }),
  ]);
}

// A body map marker can be linked to one wound of the same resident. Checked before
// writing; the link statements run in the same transaction as the wound itself.
async function assertLinkable(
  ctx: ApiContext,
  woundId: string | null,
  residentId: string,
  observationId: string | null,
) {
  if (!observationId) return;
  const rows = (await ctx.sql`
    SELECT id, wound_id FROM carecore_body_observations
    WHERE id = ${assertUuid(observationId, "Markierung")} AND resident_id = ${residentId} AND archived_at IS NULL`) as Row[];
  if (!rows[0]) throw new ApiError(`Die Markierung gehört nicht zu diesem ${(await readTerms(ctx)).oneOblique}.`);
  if (rows[0].wound_id && rows[0].wound_id !== woundId)
    throw new ApiError("Diese Markierung ist bereits mit einer anderen Wunde verknüpft.", 409);
}

function linkStatements(ctx: ApiContext, woundId: string, observationId: string | null) {
  return [
    ctx.sql`UPDATE carecore_body_observations SET wound_id = NULL WHERE wound_id = ${woundId} AND id IS DISTINCT FROM ${observationId}::uuid`,
    ...(observationId
      ? [
          ctx.sql`UPDATE carecore_body_observations SET wound_id = ${woundId}, updated_at = NOW() WHERE id = ${observationId}`,
        ]
      : []),
  ];
}

export async function setWoundStatus(ctx: ApiContext, woundId: unknown, status: unknown, reasonInput: unknown) {
  if (status !== "active" && status !== "healing" && status !== "closed") throw new ApiError("Ungültiger Status.");
  const reason = text(reasonInput, 1000);
  if (status === "closed" && !reason)
    throw new ApiError("Bitte den Grund für den Abschluss angeben, z. B. „vollständig epithelisiert“.");
  const before = await loadWound(ctx, woundId);
  if (before.status === status) return;
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_wounds SET status = ${status},
        closed_at = CASE WHEN ${status} = 'closed' THEN NOW() ELSE NULL END,
        closed_reason = CASE WHEN ${status} = 'closed' THEN ${reason} ELSE NULL END, updated_at = NOW()
      WHERE id = ${before.id}`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId: before.residentId,
      entityType: "wound",
      entityId: before.id,
      action: `status_${status}`,
      before: { status: before.status },
      after: { status, reason: reason || null },
    }),
  ]);
}

// ----------------------------------------------------------------- entries

type EntryInput = Omit<WoundEntry, "id" | "woundId" | "author">;

// Material aus dem aktiven Katalog der Organisation, je Produkt eine Zeile mit ganzer Menge.
export async function parseMaterials(ctx: ApiContext, input: unknown): Promise<WoundMaterial[]> {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new ApiError("Das Verbandsmaterial ist ungültig.");
  if (input.length > WOUND_MATERIALS_MAX)
    throw new ApiError(`Höchstens ${WOUND_MATERIALS_MAX} Materialien je Versorgung.`);
  const wanted = input.map((item) => {
    const entry = (item ?? {}) as Record<string, unknown>;
    const productId = assertUuid(entry.productId, "Material");
    const quantity = Number(entry.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999)
      throw new ApiError("Die Menge je Material muss zwischen 1 und 999 liegen.");
    return { productId, quantity };
  });
  if (new Set(wanted.map((w) => w.productId)).size !== wanted.length)
    throw new ApiError("Jedes Material bitte nur einmal mit der gesamten Menge angeben.");
  if (!wanted.length) return [];
  const rows = (await ctx.sql`
    SELECT id, item_name, unit FROM carecore_care_supply_products
    WHERE organization_id = ${ctx.actor.organizationId} AND status = 'active'
      AND id = ANY(${wanted.map((w) => w.productId)}::uuid[])`) as Row[];
  const products = new Map(rows.map((row) => [String(row.id), row]));
  return wanted.map(({ productId, quantity }) => {
    const product = products.get(productId);
    if (!product) throw new ApiError("Ein Material ist nicht (mehr) im Katalog.", 404);
    return { productId, name: String(product.item_name), unit: String(product.unit), quantity };
  });
}

export function parseEntryInput(body: Record<string, unknown>, materials: WoundMaterial[] = []): EntryInput {
  const size = (value: unknown, max: number, label: string) => {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > max)
      throw new ApiError(`${label} muss zwischen 0 und ${max} cm liegen.`);
    return Math.round(value * 10) / 10;
  };
  const observedAt =
    typeof body.observedAt === "string" && !Number.isNaN(Date.parse(body.observedAt))
      ? new Date(body.observedAt)
      : new Date();
  if (observedAt.getTime() > Date.now() + 5 * 60_000) throw new ApiError("Der Zeitpunkt liegt in der Zukunft.");
  if (observedAt.getTime() < Date.now() - 7 * 86_400_000)
    throw new ApiError("Einträge können höchstens 7 Tage rückwirkend erfasst werden.");
  const entry: EntryInput = {
    entryType: oneOf(ENTRY_TYPES, body.entryType) ?? "Verlaufskontrolle",
    observedAt: observedAt.toISOString(),
    lengthCm: size(body.lengthCm, 100, "Die Länge"),
    widthCm: size(body.widthCm, 100, "Die Breite"),
    depthCm: size(body.depthCm, 30, "Die Tiefe"),
    tissue: oneOf(TISSUE_OPTIONS, body.tissue),
    exudate: oneOf(EXUDATE_OPTIONS, body.exudate),
    woundEdge: oneOf(EDGE_OPTIONS, body.woundEdge),
    surroundingSkin: oneOf(SKIN_OPTIONS, body.surroundingSkin),
    odor: body.odor === true,
    infectionSigns: body.infectionSigns === true,
    painScore:
      Number.isInteger(body.painScore) && (body.painScore as number) >= 0 && (body.painScore as number) <= 10
        ? (body.painScore as number)
        : null,
    treatment: text(body.treatment, 4000) || null,
    materials,
    note: text(body.note, 4000) || null,
  };
  if ((entry.lengthCm === null) !== (entry.widthCm === null))
    throw new ApiError("Bitte Länge und Breite gemeinsam angeben.");
  if (entry.lengthCm === null && !entry.tissue && !entry.treatment && !entry.materials.length && !entry.note)
    throw new ApiError("Bitte mindestens Grösse, Wundgrund, Versorgung oder eine Bemerkung dokumentieren.");
  return entry;
}

function insertEntry(ctx: ApiContext, woundId: string, entry: EntryInput) {
  return ctx.sql`
    INSERT INTO carecore_wound_entries (id, wound_id, author_user_id, observed_at, entry_type, length_cm, width_cm, depth_cm, tissue, exudate,
      wound_edge, surrounding_skin, odor, infection_signs, pain_score, treatment, materials, note)
    VALUES (${randomUUID()}, ${woundId}, ${ctx.actor.id}, ${entry.observedAt}, ${entry.entryType}, ${entry.lengthCm}, ${entry.widthCm},
      ${entry.depthCm}, ${entry.tissue}, ${entry.exudate}, ${entry.woundEdge}, ${entry.surroundingSkin}, ${entry.odor},
      ${entry.infectionSigns}, ${entry.painScore}, ${entry.treatment}, ${JSON.stringify(entry.materials)}::jsonb, ${entry.note})`;
}

export async function addEntry(
  ctx: ApiContext,
  woundId: unknown,
  body: Record<string, unknown>,
  requestId: string | null = null,
) {
  const wound = await loadWound(ctx, woundId);
  if (wound.status === "closed") throw new ApiError("Die Wunde ist abgeschlossen. Bitte zuerst wieder eröffnen.", 409);
  const entry = parseEntryInput(body, await parseMaterials(ctx, body.materials));
  const nextStatus = body.woundStatus === "healing" || body.woundStatus === "active" ? body.woundStatus : wound.status;
  await withReceipt(() =>
    ctx.sql.transaction([
      insertEntry(ctx, wound.id, entry),
      ctx.sql`UPDATE carecore_wounds SET status = ${nextStatus}, updated_at = NOW() WHERE id = ${wound.id}`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId: wound.residentId,
        entityType: "wound_entry",
        entityId: wound.id,
        action: "documented",
        after: { ...entry, woundStatus: nextStatus },
      }),
      ...receiptStatements(ctx, requestId),
    ]),
  );
}

export async function listEntries(ctx: ApiContext, woundId: unknown) {
  const wound = await loadWound(ctx, woundId);
  const rows = (await ctx.sql`
    SELECT e.*, u.display_name AS author FROM carecore_wound_entries e LEFT JOIN carecore_users u ON u.id = e.author_user_id
    WHERE e.wound_id = ${wound.id} ORDER BY e.observed_at DESC`) as Row[];
  return { wound, entries: rows.map(mapEntry) };
}

// Erinnerung beim Laden der Benachrichtigungen (und im Push-Zeitplan): überfällige Wundversorgungen, je Wunde
// einmal pro Versorgungszyklus. Empfänger ist die verantwortliche Person; ohne Verantwortliche alle, die
// dokumentieren dürfen und diesen Wohnbereich als festen Wohnbereich haben. Mit dem nächsten Verlaufseintrag
// beginnt ein neuer Zyklus.
export async function createWoundReminders(ctx: ApiContext) {
  if (!ctx.actor.permissions.includes("documentation.write")) return;
  await ctx.sql`
    WITH home AS (SELECT primary_care_unit_id AS unit FROM carecore_user_profiles WHERE user_id = ${ctx.actor.id}),
    due AS (
      SELECT w.id, w.body_location, r.first_name || ' ' || r.last_name AS resident,
        COALESCE(latest.observed_at, w.discovered_at, w.created_at) + make_interval(days => w.care_interval_days) AS due_at
      FROM carecore_wounds w
      JOIN carecore_residents r ON r.id = w.resident_id AND r.organization_id = ${ctx.actor.organizationId}
      LEFT JOIN LATERAL (SELECT care_unit_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) stay ON TRUE
      LEFT JOIN LATERAL (SELECT observed_at FROM carecore_wound_entries WHERE wound_id = w.id ORDER BY observed_at DESC LIMIT 1) latest ON TRUE
      WHERE w.status IN ('active', 'healing') AND w.care_interval_days IS NOT NULL
        AND (w.responsible_user_id = ${ctx.actor.id}
          OR (w.responsible_user_id IS NULL AND stay.care_unit_id IS NOT NULL AND stay.care_unit_id = (SELECT unit FROM home)))
    )
    INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url, entity_type, entity_id)
    SELECT gen_random_uuid(), ${ctx.actor.id}, 'Wundversorgung überfällig: ' || due.resident,
      due.body_location || ' · fällig seit ' ||
        to_char(due.due_at AT TIME ZONE COALESCE((SELECT timezone FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}), 'Europe/Zurich'), 'DD.MM.YYYY HH24:MI') || ' Uhr.',
      'wound_overdue', 'high', '/c/wundmanagement?wound=' || due.id, 'wound', due.id
    FROM due
    WHERE due.due_at < NOW()
      AND NOT EXISTS (SELECT 1 FROM carecore_notifications n
        WHERE n.user_id = ${ctx.actor.id} AND n.type = 'wound_overdue' AND n.entity_type = 'wound' AND n.entity_id = due.id
          AND n.created_at >= due.due_at)`;
}

// Recent entries across the house for the documentation feed.
export async function recentEntries(ctx: ApiContext, daysInput: unknown) {
  const days = [7, 30, 90].includes(Number(daysInput)) ? Number(daysInput) : 30;
  const rows = (await ctx.sql`
    SELECT e.*, u.display_name AS author, w.title AS wound_title, w.body_location, w.wound_type, w.category,
      r.id AS resident_id, r.first_name || ' ' || r.last_name AS resident_name
    FROM carecore_wound_entries e
    JOIN carecore_wounds w ON w.id = e.wound_id
    JOIN carecore_residents r ON r.id = w.resident_id AND r.organization_id = ${ctx.actor.organizationId}
    LEFT JOIN carecore_users u ON u.id = e.author_user_id
    WHERE e.observed_at > NOW() - make_interval(days => ${days})
    ORDER BY e.observed_at DESC LIMIT 300`) as Row[];
  return {
    days,
    entries: rows.map((row) => ({
      ...mapEntry(row),
      residentId: String(row.resident_id),
      residentName: String(row.resident_name),
      woundTitle: String(row.wound_title),
      bodyLocation: String(row.body_location),
      woundType: (row.wound_type as string | null) ?? null,
      category: (row.category as string | null) ?? null,
    })),
  };
}
