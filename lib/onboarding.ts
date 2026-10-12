import { randomUUID } from "node:crypto";
import { ApiError, assertUuid, auditStatement, iso, text, type ApiContext, type Row } from "@/lib/api-context";
import { hasPermission } from "@/lib/server-data";
import {
  ALL_ROLES,
  ONBOARDING_ITEMS_MAX,
  type Onboarding,
  type OnboardingOverview,
  type OnboardingStaff,
} from "@/lib/onboarding-shared";

// Einarbeitung neuer Mitarbeitender: Checklisten je Rolle (Einrichtung), Start mit Übernahme der Punkte, Abzeichnen
// durch die einarbeitende Person bzw. die Leitung, Abschluss.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LINK = "/c/leitung/teamleitung/einarbeitung";

const canManage = (ctx: ApiContext) => hasPermission(ctx.actor, "team.manage");

function assertManage(ctx: ApiContext) {
  if (!canManage(ctx)) throw new ApiError("Keine Berechtigung.", 403);
}

async function roles(ctx: ApiContext) {
  return (await ctx.sql`
    SELECT key, name FROM carecore_roles
    WHERE system_role OR organization_id = ${ctx.actor.organizationId} ORDER BY name`) as Row[];
}

async function readChecklists(ctx: ApiContext) {
  const [row] = (await ctx.sql`
    SELECT settings->'onboardingChecklists' AS lists FROM carecore_organizations
    WHERE id = ${ctx.actor.organizationId}`) as Row[];
  const value = row?.lists;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, string[]>;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, items]) => [
      key,
      Array.isArray(items)
        ? items.filter((item): item is string => typeof item === "string" && item.trim() !== "")
        : [],
    ]),
  );
}

// Checkliste einer Rolle festlegen ({ role, items }); role "" = Punkte für alle Rollen.
export async function saveOnboardingChecklist(ctx: ApiContext, body: Record<string, unknown>) {
  assertManage(ctx);
  const role = typeof body.role === "string" ? body.role : null;
  if (role === null) throw new ApiError("Bitte die Rolle angeben.");
  if (role !== ALL_ROLES && !(await roles(ctx)).some((item) => item.key === role))
    throw new ApiError("Rolle nicht gefunden.", 404);
  if (!Array.isArray(body.items) || !body.items.every((item) => typeof item === "string"))
    throw new ApiError("Bitte die Punkte angeben.");
  const items = (body.items as string[]).map((item) => item.trim()).filter(Boolean);
  if (items.length > ONBOARDING_ITEMS_MAX) throw new ApiError(`Höchstens ${ONBOARDING_ITEMS_MAX} Punkte möglich.`);
  if (items.some((item) => item.length > 200)) throw new ApiError("Ein Punkt hat höchstens 200 Zeichen.");
  if (new Set(items.map((item) => item.toLowerCase())).size !== items.length)
    throw new ApiError("Jeder Punkt darf nur einmal vorkommen.");
  const before = (await readChecklists(ctx))[role] ?? [];
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_organizations
      SET settings = jsonb_set(
          jsonb_set(COALESCE(settings, '{}'::jsonb), '{onboardingChecklists}',
            COALESCE(settings->'onboardingChecklists', '{}'::jsonb)),
          ARRAY['onboardingChecklists', ${role}], ${JSON.stringify(items)}::jsonb),
        updated_at = NOW()
      WHERE id = ${ctx.actor.organizationId}`,
    auditStatement(
      ctx,
      "setting",
      ctx.actor.organizationId,
      "onboarding_checklist",
      { role, items: before },
      {
        role,
        items,
      },
    ),
  ]);
  return items;
}

async function staff(ctx: ApiContext): Promise<OnboardingStaff[]> {
  const rows = (await ctx.sql`
    SELECT u.id, u.display_name, u.role, COALESCE(r.name, u.role) AS role_name
    FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
    LEFT JOIN carecore_roles r ON r.key = u.role
    WHERE p.organization_id = ${ctx.actor.organizationId} AND u.active AND u.archived_at IS NULL
    ORDER BY u.display_name`) as Row[];
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.display_name),
    roleKey: String(row.role),
    roleName: String(row.role_name),
  }));
}

export async function onboardingOverview(ctx: ApiContext): Promise<OnboardingOverview> {
  const manage = canManage(ctx);
  const org = ctx.actor.organizationId;
  const [onboardings, steps, roleRows, checklists, people] = await Promise.all([
    ctx.sql`
      SELECT o.*, to_char(o.started_on, 'YYYY-MM-DD') AS started_day, u.display_name AS user_name,
        COALESCE(r.name, u.role) AS role_name, m.display_name AS mentor_name, c.display_name AS completed_name
      FROM carecore_onboardings o
      JOIN carecore_users u ON u.id = o.user_id
      LEFT JOIN carecore_roles r ON r.key = u.role
      LEFT JOIN carecore_users m ON m.id = o.mentor_id
      LEFT JOIN carecore_users c ON c.id = o.completed_by
      WHERE o.organization_id = ${org}
        AND (${manage} OR o.mentor_id = ${ctx.actor.id} OR o.user_id = ${ctx.actor.id})
      ORDER BY o.completed_at IS NOT NULL, o.completed_at DESC, o.started_on DESC` as Promise<Row[]>,
    ctx.sql`
      SELECT s.*, d.display_name AS done_name FROM carecore_onboarding_steps s
      LEFT JOIN carecore_users d ON d.id = s.done_by
      WHERE s.organization_id = ${org} ORDER BY s.position` as Promise<Row[]>,
    manage ? roles(ctx) : Promise.resolve([] as Row[]),
    manage ? readChecklists(ctx) : Promise.resolve({} as Record<string, string[]>),
    manage ? staff(ctx) : Promise.resolve([] as OnboardingStaff[]),
  ]);
  return {
    canManage: manage,
    roles: roleRows.map((row) => ({ key: String(row.key), name: String(row.name) })),
    checklists,
    staff: people,
    onboardings: onboardings.map((row): Onboarding => ({
      id: String(row.id),
      userId: String(row.user_id),
      userName: String(row.user_name),
      roleName: String(row.role_name),
      mentorId: (row.mentor_id as string | null) ?? null,
      mentorName: (row.mentor_name as string | null) ?? null,
      startedOn: String(row.started_day),
      note: String(row.note),
      completed: row.completed_at
        ? { at: iso(row.completed_at) ?? "", by: (row.completed_name as string | null) ?? null }
        : null,
      steps: steps
        .filter((step) => step.onboarding_id === row.id)
        .map((step) => ({
          id: String(step.id),
          title: String(step.title),
          done: step.done_at ? { at: iso(step.done_at) ?? "", by: (step.done_name as string | null) ?? null } : null,
          note: String(step.note),
        })),
      canSign: !row.completed_at && (manage || row.mentor_id === ctx.actor.id),
    })),
  };
}

// Einarbeitung starten ({ userId, mentorId?, startedOn, note? }): übernimmt die Punkte für alle Rollen und die der
// Rolle der Person.
export async function startOnboarding(ctx: ApiContext, body: Record<string, unknown>) {
  assertManage(ctx);
  const userId = assertUuid(body.userId, "Mitarbeitende Person");
  const mentorId = body.mentorId ? assertUuid(body.mentorId, "Einarbeitende Person") : null;
  if (mentorId === userId) throw new ApiError("Die einarbeitende Person muss jemand anderes sein.");
  const startedOn = typeof body.startedOn === "string" && DATE.test(body.startedOn) ? body.startedOn : null;
  if (!startedOn) throw new ApiError("Bitte den Beginn angeben.");
  const people = await staff(ctx);
  const person = people.find((item) => item.id === userId);
  if (!person) throw new ApiError("Mitarbeitende Person nicht gefunden.", 404);
  const mentor = mentorId ? people.find((item) => item.id === mentorId) : null;
  if (mentorId && !mentor) throw new ApiError("Einarbeitende Person nicht gefunden.", 404);
  const lists = await readChecklists(ctx);
  const items = [...(lists[ALL_ROLES] ?? []), ...(lists[person.roleKey] ?? [])].filter(
    (item, index, all) => all.findIndex((other) => other.toLowerCase() === item.toLowerCase()) === index,
  );
  if (!items.length)
    throw new ApiError(
      `Für die Rolle „${person.roleName}“ ist noch keine Checkliste festgelegt. Bitte zuerst die Punkte festlegen.`,
    );
  const id = randomUUID();
  const note = text(body.note, 2000);
  await ctx.sql
    .transaction([
      ctx.sql`
        INSERT INTO carecore_onboardings (id, organization_id, user_id, mentor_id, started_on, note, created_by)
        VALUES (${id}, ${ctx.actor.organizationId}, ${userId}, ${mentorId}, ${startedOn}, ${note}, ${ctx.actor.id})`,
      ctx.sql`
        INSERT INTO carecore_onboarding_steps (id, organization_id, onboarding_id, position, title)
        SELECT gen_random_uuid(), ${ctx.actor.organizationId}, ${id}, item.position::smallint, item.title
        FROM unnest(${items}::text[]) WITH ORDINALITY AS item(title, position)`,
      auditStatement(ctx, "onboarding", id, "started", null, {
        person: person.name,
        mentor: mentor?.name ?? null,
        startedOn,
        items: items.length,
      }),
      ...(mentorId && mentorId !== ctx.actor.id
        ? [
            ctx.sql`
              INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url, entity_type, entity_id)
              VALUES (gen_random_uuid(), ${mentorId}, ${`Einarbeitung: ${person.name}`},
                ${`Du begleitest die Einarbeitung ab ${startedOn.split("-").reverse().join(".")} und zeichnest die Punkte ab.`},
                'onboarding_mentor', 'normal', ${LINK}, 'onboarding', ${id})`,
          ]
        : []),
    ])
    .catch((error) => {
      if (String(error).includes("carecore_onboardings_open_idx"))
        throw new ApiError("Für diese Person läuft bereits eine Einarbeitung.", 409);
      throw error;
    });
  return { id };
}

// Punkt abzeichnen ({ done: true, note? }) oder zurücknehmen ({ done: false }); Leitung oder einarbeitende Person.
export async function signOnboardingStep(ctx: ApiContext, stepInput: unknown, body: Record<string, unknown>) {
  const stepId = assertUuid(stepInput, "Punkt");
  const [step] = (await ctx.sql`
    SELECT s.id, s.title, s.done_at, s.done_by, o.id AS onboarding_id, o.mentor_id, o.completed_at
    FROM carecore_onboarding_steps s JOIN carecore_onboardings o ON o.id = s.onboarding_id
    WHERE s.id = ${stepId} AND s.organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!step) throw new ApiError("Punkt nicht gefunden.", 404);
  if (!canManage(ctx) && step.mentor_id !== ctx.actor.id) throw new ApiError("Keine Berechtigung.", 403);
  if (step.completed_at) throw new ApiError("Die Einarbeitung ist abgeschlossen.", 409);
  const done = body.done === true;
  if (done && step.done_at) throw new ApiError("Der Punkt ist bereits abgezeichnet.", 409);
  if (!done && !step.done_at) throw new ApiError("Der Punkt ist nicht abgezeichnet.", 409);
  const note = done ? text(body.note, 500) : "";
  await ctx.sql
    .transaction([
      ctx.sql`
        WITH changed AS (
          UPDATE carecore_onboarding_steps
          SET done_at = CASE WHEN ${done} THEN NOW() END, done_by = CASE WHEN ${done} THEN ${ctx.actor.id}::uuid END,
            note = ${note}
          WHERE id = ${stepId} AND (done_at IS NULL) = ${done} RETURNING id)
        SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'ONBOARDING_STEP_CHANGED')`,
      auditStatement(ctx, "onboarding", String(step.onboarding_id), done ? "step_signed" : "step_reopened", null, {
        item: step.title,
        note,
      }),
    ])
    .catch((error) => {
      if (String(error).includes("ONBOARDING_STEP_CHANGED"))
        throw new ApiError("Der Punkt wurde inzwischen geändert. Bitte neu laden.", 409);
      throw error;
    });
}

// Einarbeitung abschliessen: nur Leitung und erst, wenn alle Punkte abgezeichnet sind.
export async function completeOnboarding(ctx: ApiContext, idInput: unknown) {
  assertManage(ctx);
  const id = assertUuid(idInput, "Einarbeitung");
  const [row] = (await ctx.sql`
    SELECT o.id, o.completed_at, u.display_name,
      (SELECT COUNT(*) FROM carecore_onboarding_steps s WHERE s.onboarding_id = o.id AND s.done_at IS NULL)::int AS open
    FROM carecore_onboardings o JOIN carecore_users u ON u.id = o.user_id
    WHERE o.id = ${id} AND o.organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!row) throw new ApiError("Einarbeitung nicht gefunden.", 404);
  if (row.completed_at) throw new ApiError("Die Einarbeitung ist bereits abgeschlossen.", 409);
  if (Number(row.open) > 0)
    throw new ApiError(`Noch ${row.open} ${Number(row.open) === 1 ? "Punkt" : "Punkte"} offen.`, 409);
  await ctx.sql
    .transaction([
      ctx.sql`
        WITH changed AS (
          UPDATE carecore_onboardings SET completed_at = NOW(), completed_by = ${ctx.actor.id}
          WHERE id = ${id} AND completed_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM carecore_onboarding_steps WHERE onboarding_id = ${id} AND done_at IS NULL)
          RETURNING id)
        SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'ONBOARDING_CHANGED')`,
      auditStatement(ctx, "onboarding", id, "completed", null, { person: row.display_name }),
    ])
    .catch((error) => {
      if (String(error).includes("ONBOARDING_CHANGED"))
        throw new ApiError("Die Einarbeitung wurde inzwischen geändert. Bitte neu laden.", 409);
      throw error;
    });
}
