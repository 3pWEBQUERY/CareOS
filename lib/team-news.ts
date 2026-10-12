import { randomUUID } from "node:crypto";
import { ApiError, assertUuid, iso, text, auditStatement, type ApiContext, type Row } from "@/lib/api-context";
import { listCareUnits } from "@/lib/medication";
import { hasPermission } from "@/lib/server-data";
import {
  CHANNEL_COLORS,
  POST_IMPORTANCE,
  type Channel,
  type ChannelColor,
  type OnDutyPerson,
  type Post,
  type PostImportance,
  type TeamNewsPayload,
} from "@/lib/team-news-shared";

const canManage = (ctx: ApiContext) => hasPermission(ctx.actor, "team.manage");

async function ensureDefaultChannel({ sql, actor }: ApiContext) {
  await sql`
    INSERT INTO carecore_channels (id, organization_id, name, description, color, is_default, managers_only)
    SELECT ${randomUUID()}, ${actor.organizationId}, 'Haus', 'Informationen der Leitung an alle Mitarbeitenden', 'orange', TRUE, TRUE
    WHERE NOT EXISTS (SELECT 1 FROM carecore_channels WHERE organization_id = ${actor.organizationId} AND is_default)
    ON CONFLICT (organization_id, name) DO NOTHING`;
}

async function selectChannels(ctx: ApiContext): Promise<Channel[]> {
  const { sql, actor } = ctx;
  const manager = canManage(ctx);
  const rows = (await sql`
    SELECT c.id, c.name, c.description, c.color, c.is_default, c.managers_only, cu.name AS care_unit,
      CASE WHEN c.is_default THEN (
        SELECT COUNT(*) FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
        WHERE p.organization_id = ${actor.organizationId} AND u.active)
      ELSE (
        SELECT COUNT(*) FROM carecore_channel_members m JOIN carecore_users u ON u.id = m.user_id AND u.active
        WHERE m.channel_id = c.id) END::int AS members,
      (c.is_default OR EXISTS (SELECT 1 FROM carecore_channel_members m WHERE m.channel_id = c.id AND m.user_id = ${actor.id})) AS joined,
      (SELECT COUNT(*) FROM carecore_posts p
        WHERE p.channel_id = c.id AND p.archived_at IS NULL AND p.created_at > NOW() - INTERVAL '90 days'
          AND p.author_user_id IS DISTINCT FROM ${actor.id}
          AND NOT EXISTS (SELECT 1 FROM carecore_post_reads r WHERE r.post_id = p.id AND r.user_id = ${actor.id}))::int AS unread
    FROM carecore_channels c
    LEFT JOIN carecore_care_units cu ON cu.id = c.care_unit_id
    WHERE c.organization_id = ${actor.organizationId} AND c.archived_at IS NULL
    ORDER BY c.is_default DESC, c.name`) as Row[];
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    color: (CHANNEL_COLORS as readonly string[]).includes(String(row.color)) ? (row.color as ChannelColor) : "blue",
    isDefault: Boolean(row.is_default),
    managersOnly: Boolean(row.managers_only),
    careUnit: (row.care_unit as string | null) ?? null,
    members: Number(row.members),
    joined: Boolean(row.joined),
    unread: Number(row.unread),
    canPost: manager || (!row.managers_only && Boolean(row.joined)),
  }));
}

// Im Dienst: eingestempelt oder laut veröffentlichtem Dienstplan gerade eingeteilt (auch für den Messenger).
export function onDutyRows({ sql, actor }: Pick<ApiContext, "sql" | "actor">) {
  return sql`
      SELECT DISTINCT ON (u.id) u.id, u.display_name, COALESCE(st.name, 'Ungeplanter Einsatz') AS shift_name,
        cu.name AS unit, e.clock_in AS checked_in_at
      FROM carecore_users u
      LEFT JOIN carecore_time_entries e ON e.employee_id = u.id AND e.status = 'OPEN' AND e.organization_id = ${actor.organizationId}
      LEFT JOIN carecore_roster_shifts s ON s.employee_id = u.id AND s.category <> 'ABSENCE'
        AND (s.id = e.shift_id OR (e.id IS NULL AND s.planned_start <= NOW() AND s.planned_end > NOW()
          AND EXISTS (SELECT 1 FROM carecore_schedule_periods p WHERE p.id = s.period_id AND p.status = 'PUBLISHED')))
      LEFT JOIN carecore_shift_types st ON st.id = s.shift_type_id
      LEFT JOIN carecore_care_units cu ON cu.id = COALESCE(e.care_unit_id, s.care_unit_id)
      WHERE u.active AND COALESCE(e.organization_id, s.organization_id) = ${actor.organizationId}
      ORDER BY u.id, e.clock_in DESC NULLS LAST` as Promise<Row[]>;
}

export function onDutyPeople(rows: Row[]): OnDutyPerson[] {
  return rows
    .map((row) => ({
      userId: String(row.id),
      name: String(row.display_name),
      detail: [row.unit, row.shift_name].filter(Boolean).join(" · "),
      state: row.checked_in_at ? ("present" as const) : ("planned" as const),
    }))
    .sort((a, b) => (a.state === b.state ? a.name.localeCompare(b.name, "de-CH") : a.state === "present" ? -1 : 1));
}

export async function teamNews(ctx: ApiContext, params: URLSearchParams): Promise<TeamNewsPayload> {
  const { sql, actor } = ctx;
  await ensureDefaultChannel(ctx);
  const channelId = params.get("channelId") ? assertUuid(params.get("channelId"), "Kanal") : null;
  const manager = canManage(ctx);
  const [channels, postRows, dutyRows, careUnits] = await Promise.all([
    selectChannels(ctx),
    sql`
      SELECT p.*, c.name AS channel_name, c.color AS channel_color, u.display_name AS author_name,
        r.read_at, r.acknowledged_at,
        (SELECT COUNT(*) FROM carecore_post_reads x WHERE x.post_id = p.id)::int AS read_count,
        (SELECT COUNT(*) FROM carecore_post_reads x WHERE x.post_id = p.id AND x.acknowledged_at IS NOT NULL)::int AS ack_count
      FROM carecore_posts p
      JOIN carecore_channels c ON c.id = p.channel_id AND c.archived_at IS NULL
      LEFT JOIN carecore_users u ON u.id = p.author_user_id
      LEFT JOIN carecore_post_reads r ON r.post_id = p.id AND r.user_id = ${actor.id}
      WHERE p.organization_id = ${actor.organizationId} AND p.archived_at IS NULL AND p.created_at > NOW() - INTERVAL '90 days'
        AND CASE WHEN ${channelId}::uuid IS NULL
          THEN c.is_default OR EXISTS (SELECT 1 FROM carecore_channel_members m WHERE m.channel_id = c.id AND m.user_id = ${actor.id})
          ELSE p.channel_id = ${channelId}::uuid END
      ORDER BY p.pinned DESC, p.created_at DESC
      LIMIT 200` as Promise<Row[]>,
    onDutyRows(ctx),
    listCareUnits(ctx),
  ]);

  const audience = new Map(channels.map((channel) => [channel.id, channel.members]));
  const posts: Post[] = postRows.map((row) => ({
    id: String(row.id),
    channelId: String(row.channel_id),
    channelName: String(row.channel_name),
    channelColor: row.channel_color as ChannelColor,
    authorName: (row.author_name as string | null) ?? null,
    title: String(row.title),
    body: String(row.body),
    importance: (row.importance as PostImportance) in POST_IMPORTANCE ? (row.importance as PostImportance) : "normal",
    pinned: Boolean(row.pinned),
    requiresAck: Boolean(row.requires_ack),
    createdAt: iso(row.created_at) ?? "",
    editedAt: iso(row.edited_at),
    readAt: row.author_user_id === actor.id ? (iso(row.created_at) ?? "") : iso(row.read_at),
    acknowledgedAt: iso(row.acknowledged_at),
    readCount: Number(row.read_count),
    ackCount: Number(row.ack_count),
    audience: audience.get(String(row.channel_id)) ?? 0,
    canEdit: manager || row.author_user_id === actor.id,
    isOwn: row.author_user_id === actor.id,
  }));
  const onDuty = onDutyPeople(dutyRows as Row[]);

  const weekAgo = Date.now() - 7 * 86_400_000;
  const monthAgo = Date.now() - 30 * 86_400_000;
  const recent = posts.filter((post) => Date.parse(post.createdAt) > monthAgo && post.audience > 0);
  const withAck = recent.filter((post) => post.requiresAck);
  const basis = withAck.length ? withAck : recent;
  const reached = basis.reduce((sum, post) => sum + (withAck.length ? post.ackCount : post.readCount), 0);
  const possible = basis.reduce((sum, post) => sum + post.audience, 0);
  return {
    channels,
    posts,
    onDuty,
    careUnits,
    stats: {
      postsThisWeek: posts.filter((post) => Date.parse(post.createdAt) > weekAgo).length,
      joinedChannels: channels.filter((channel) => channel.joined).length,
      unread: channels.filter((channel) => channel.joined).reduce((sum, channel) => sum + channel.unread, 0),
      reach: possible ? Math.min(Math.round((reached / possible) * 100), 100) : null,
    },
    canManage: manager,
    currentUserId: actor.id,
  };
}

async function loadChannel(ctx: ApiContext, channelIdInput: unknown) {
  const channelId = assertUuid(channelIdInput, "Kanal");
  const channel = (await selectChannels(ctx)).find((c) => c.id === channelId);
  if (!channel) throw new ApiError("Kanal nicht gefunden.", 404);
  return channel;
}

function parsePost(body: Record<string, unknown>) {
  const title = text(body.title, 180);
  if (title.length < 3) throw new ApiError("Bitte einen Titel mit mindestens 3 Zeichen angeben.");
  const content = text(body.body, 10000);
  if (content.length < 3) throw new ApiError("Bitte den Beitrag formulieren.");
  const importance =
    typeof body.importance === "string" && body.importance in POST_IMPORTANCE
      ? (body.importance as PostImportance)
      : "normal";
  return { title, content, importance, requiresAck: body.requiresAck === true };
}

// Sends a notification to everybody who can read the channel (except the author).
async function notifyAudience(ctx: ApiContext, channel: Channel, postId: string, title: string, body: string) {
  await ctx.sql`
    INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url)
    SELECT gen_random_uuid(), u.id, ${title}, ${body}, 'team_post', 'high', ${`/c/personal/team?post=${postId}`}
    FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
    WHERE p.organization_id = ${ctx.actor.organizationId} AND u.active AND u.id <> ${ctx.actor.id}
      AND (${channel.isDefault} OR EXISTS (SELECT 1 FROM carecore_channel_members m WHERE m.channel_id = ${channel.id} AND m.user_id = u.id))`;
}

export async function createPost(ctx: ApiContext, body: Record<string, unknown>) {
  const channel = await loadChannel(ctx, body.channelId);
  if (!channel.canPost)
    throw new ApiError(
      channel.managersOnly ? "In diesem Kanal schreibt nur die Leitung." : "Tritt dem Kanal bei, um zu schreiben.",
      403,
    );
  const post = parsePost(body);
  const pinned = body.pinned === true && canManage(ctx);
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_posts (id, organization_id, channel_id, author_user_id, title, body, importance, pinned, requires_ack)
      VALUES (${id}, ${ctx.actor.organizationId}, ${channel.id}, ${ctx.actor.id}, ${post.title}, ${post.content},
        ${post.importance}, ${pinned}, ${post.requiresAck})`,
    ctx.sql`INSERT INTO carecore_post_reads (post_id, user_id, acknowledged_at) VALUES (${id}, ${ctx.actor.id}, NOW())`,
    auditStatement(ctx, "team_post", id, "created", null, {
      channelId: channel.id,
      title: post.title,
      importance: post.importance,
    }),
  ]);
  if (post.importance === "critical" || post.requiresAck)
    await notifyAudience(
      ctx,
      channel,
      id,
      `${post.importance === "critical" ? "Dringend" : "Bitte bestätigen"}: ${post.title}`,
      `${ctx.actor.display_name} in „${channel.name}“${post.requiresAck ? " – Lesebestätigung erforderlich" : ""}.`,
    );
  return id;
}

export async function postAction(ctx: ApiContext, postIdInput: unknown, body: Record<string, unknown>) {
  const { sql, actor } = ctx;
  const postId = assertUuid(postIdInput, "Beitrag");
  const rows = (await sql`
    SELECT p.*, c.is_default, c.archived_at AS channel_archived FROM carecore_posts p JOIN carecore_channels c ON c.id = p.channel_id
    WHERE p.id = ${postId} AND p.organization_id = ${actor.organizationId}`) as Row[];
  const post = rows[0];
  if (!post || post.archived_at || post.channel_archived) throw new ApiError("Beitrag nicht gefunden.", 404);
  const own = post.author_user_id === actor.id;

  if (body.action === "read" || body.action === "ack") {
    const ack = body.action === "ack";
    // Die Bestätigung wird nur beim ersten Mal protokolliert.
    const [read] = (await sql`
      SELECT acknowledged_at FROM carecore_post_reads WHERE post_id = ${postId} AND user_id = ${actor.id}`) as Row[];
    await sql.transaction([
      sql`
        INSERT INTO carecore_post_reads (post_id, user_id, acknowledged_at) VALUES (${postId}, ${actor.id}, ${ack ? new Date().toISOString() : null})
        ON CONFLICT (post_id, user_id) DO UPDATE SET acknowledged_at = COALESCE(carecore_post_reads.acknowledged_at, EXCLUDED.acknowledged_at)`,
      ...(ack && !read?.acknowledged_at ? [auditStatement(ctx, "team_post", postId, "acknowledged", null, null)] : []),
    ]);
    return;
  }
  if (body.action === "edit") {
    if (!own) throw new ApiError("Nur die verfassende Person kann den Beitrag bearbeiten.", 403);
    const next = parsePost(body);
    await sql.transaction([
      sql`
      UPDATE carecore_posts SET title = ${next.title}, body = ${next.content}, importance = ${next.importance},
        requires_ack = ${next.requiresAck}, edited_at = NOW() WHERE id = ${postId}`,
      auditStatement(ctx, "team_post", postId, "edited", { title: post.title, body: post.body }, next),
    ]);
    return;
  }
  if (body.action === "pin" || body.action === "unpin") {
    if (!canManage(ctx)) throw new ApiError("Nur die Leitung kann Beiträge anheften.", 403);
    await sql.transaction([
      sql`UPDATE carecore_posts SET pinned = ${body.action === "pin"} WHERE id = ${postId}`,
      auditStatement(ctx, "team_post", postId, body.action === "pin" ? "pinned" : "unpinned", null, null),
    ]);
    return;
  }
  if (body.action === "archive") {
    if (!own && !canManage(ctx))
      throw new ApiError("Nur die verfassende Person oder die Leitung kann archivieren.", 403);
    const reason = text(body.reason, 1000);
    if (!reason) throw new ApiError("Bitte einen Grund angeben.");
    await sql.transaction([
      sql`
      UPDATE carecore_posts SET archived_at = NOW(), archived_by = ${actor.id}, archive_reason = ${reason} WHERE id = ${postId}`,
      auditStatement(ctx, "team_post", postId, "archived", null, { reason }),
    ]);
    return;
  }
  throw new ApiError("Unbekannte Aktion.");
}

export async function markAllRead(ctx: ApiContext, body: Record<string, unknown>) {
  const channelId = body.channelId ? assertUuid(body.channelId, "Kanal") : null;
  const rows = (await ctx.sql`
    INSERT INTO carecore_post_reads (post_id, user_id)
    SELECT p.id, ${ctx.actor.id} FROM carecore_posts p JOIN carecore_channels c ON c.id = p.channel_id AND c.archived_at IS NULL
    WHERE p.organization_id = ${ctx.actor.organizationId} AND p.archived_at IS NULL AND p.created_at > NOW() - INTERVAL '90 days'
      AND CASE WHEN ${channelId}::uuid IS NULL
        THEN c.is_default OR EXISTS (SELECT 1 FROM carecore_channel_members m WHERE m.channel_id = c.id AND m.user_id = ${ctx.actor.id})
        ELSE p.channel_id = ${channelId}::uuid END
    ON CONFLICT (post_id, user_id) DO NOTHING
    RETURNING post_id`) as Row[];
  return rows.length;
}

export async function createChannel(ctx: ApiContext, body: Record<string, unknown>) {
  if (!canManage(ctx)) throw new ApiError("Nur die Leitung kann Kanäle anlegen.", 403);
  const { sql, actor } = ctx;
  const name = text(body.name, 80);
  if (name.length < 2) throw new ApiError("Bitte einen Kanalnamen angeben.");
  const color =
    typeof body.color === "string" && (CHANNEL_COLORS as readonly string[]).includes(body.color) ? body.color : "blue";
  let careUnitId: string | null = null;
  if (body.careUnitId) {
    careUnitId = assertUuid(body.careUnitId, "Wohnbereich");
    const unit = (await sql`
      SELECT cu.id FROM carecore_care_units cu JOIN carecore_sites si ON si.id = cu.site_id
      WHERE cu.id = ${careUnitId} AND si.organization_id = ${actor.organizationId}`) as Row[];
    if (!unit[0]) throw new ApiError("Wohnbereich nicht gefunden.", 404);
  }
  const existing = (await sql`
    SELECT id FROM carecore_channels WHERE organization_id = ${actor.organizationId} AND lower(name) = lower(${name})`) as Row[];
  if (existing[0]) throw new ApiError("Ein Kanal mit diesem Namen existiert bereits.", 409);
  const id = randomUUID();
  await sql.transaction([
    sql`
      INSERT INTO carecore_channels (id, organization_id, name, description, color, managers_only, care_unit_id, created_by)
      VALUES (${id}, ${actor.organizationId}, ${name}, ${text(body.description, 500) || null}, ${color},
        ${body.managersOnly === true}, ${careUnitId}, ${actor.id})`,
    sql`INSERT INTO carecore_channel_members (channel_id, user_id) VALUES (${id}, ${actor.id})`,
    // A care-unit channel starts with the people of that unit.
    sql`
      INSERT INTO carecore_channel_members (channel_id, user_id)
      SELECT ${id}, p.user_id FROM carecore_user_profiles p JOIN carecore_users u ON u.id = p.user_id AND u.active
      WHERE ${careUnitId}::uuid IS NOT NULL AND p.primary_care_unit_id = ${careUnitId}::uuid
      ON CONFLICT DO NOTHING`,
    auditStatement(ctx, "team_channel", id, "created", null, { name, color, careUnitId }),
  ]);
  return id;
}

export async function channelAction(ctx: ApiContext, channelIdInput: unknown, body: Record<string, unknown>) {
  const channel = await loadChannel(ctx, channelIdInput);
  if (channel.isDefault) throw new ApiError("Der Hauskanal gilt für alle und kann nicht verlassen werden.", 409);
  if (body.action === "join") {
    await ctx.sql`INSERT INTO carecore_channel_members (channel_id, user_id) VALUES (${channel.id}, ${ctx.actor.id}) ON CONFLICT DO NOTHING`;
    return;
  }
  if (body.action === "leave") {
    await ctx.sql`DELETE FROM carecore_channel_members WHERE channel_id = ${channel.id} AND user_id = ${ctx.actor.id}`;
    return;
  }
  if (body.action === "archive") {
    if (!canManage(ctx)) throw new ApiError("Nur die Leitung kann Kanäle archivieren.", 403);
    await ctx.sql.transaction([
      ctx.sql`UPDATE carecore_channels SET archived_at = NOW() WHERE id = ${channel.id}`,
      auditStatement(ctx, "team_channel", channel.id, "archived", null, null),
    ]);
    return;
  }
  throw new ApiError("Unbekannte Aktion.");
}
