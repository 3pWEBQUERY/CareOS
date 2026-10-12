import { randomBytes, randomUUID } from "node:crypto";
import { ApiError, assertUuid, auditStatement, iso, text, type ApiContext, type Row } from "@/lib/api-context";
import { hashPassword } from "@/lib/auth";
import { hasPermission } from "@/lib/server-data";
import {
  PORTAL_BASES,
  PORTAL_KINDS,
  portalAreaAllowed,
  portalAreas,
  portalPasswordProblem,
  type PortalAccessEntry,
  type PortalAccount,
  type PortalBasis,
  type PortalGrant,
  type PortalKind,
} from "@/lib/portal-shared";

// Verwaltung des Portals durch die Administration: Zugänge anlegen, Freigaben je Person oder Wohnbereich mit einzeln
// gewählten Bereichen, Gültigkeit und Grundlage. Alles protokolliert; Zugriffe des Portals sind einsehbar.

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function requireAdmin(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "administration.manage"))
    throw new ApiError("Das Portal verwaltet die Administration.", 403);
}

// Einmal-Passwort (wird nur einmal angezeigt; bei der ersten Anmeldung muss es geändert werden).
function oneTimePassword() {
  for (;;) {
    const candidate = randomBytes(12).toString("base64url").replace(/[-_]/g, "x");
    if (!portalPasswordProblem(candidate)) return candidate.match(/.{1,4}/g)!.join("-");
  }
}

const mapGrant = (row: Row): PortalGrant => ({
  id: String(row.id),
  residentId: (row.resident_id as string | null) ?? null,
  residentName: (row.resident_name as string | null) ?? null,
  careUnitId: (row.care_unit_id as string | null) ?? null,
  careUnitName: (row.care_unit_name as string | null) ?? null,
  areas: portalAreas(row.areas),
  validFrom: (row.valid_from as string | null) ?? null,
  validUntil: (row.valid_until as string | null) ?? null,
  basis: row.basis as PortalBasis,
  basisNote: String(row.basis_note),
  createdAt: iso(row.created_at) ?? "",
  createdBy: (row.created_by_name as string | null) ?? null,
  revokedAt: iso(row.revoked_at),
});

export async function listPortalAccounts(ctx: ApiContext) {
  requireAdmin(ctx);
  const org = ctx.actor.organizationId;
  const [accounts, grants, residents, units] = await Promise.all([
    ctx.sql`
      SELECT * FROM carecore_portal_accounts WHERE organization_id = ${org}
      ORDER BY active DESC, LOWER(display_name)` as Promise<Row[]>,
    ctx.sql`
      SELECT g.*, to_char(g.valid_from, 'YYYY-MM-DD') AS valid_from, to_char(g.valid_until, 'YYYY-MM-DD') AS valid_until,
        NULLIF(TRIM(COALESCE(r.first_name, '') || ' ' || COALESCE(r.last_name, '')), '') AS resident_name,
        cu.name AS care_unit_name, u.display_name AS created_by_name
      FROM carecore_portal_grants g
      JOIN carecore_portal_accounts a ON a.id = g.account_id AND a.organization_id = ${org}
      LEFT JOIN carecore_residents r ON r.id = g.resident_id
      LEFT JOIN carecore_care_units cu ON cu.id = g.care_unit_id
      LEFT JOIN carecore_users u ON u.id = g.created_by
      ORDER BY g.revoked_at IS NOT NULL, g.created_at DESC` as Promise<Row[]>,
    ctx.sql`
      SELECT id, first_name, last_name FROM carecore_residents
      WHERE organization_id = ${org} AND status = 'active' ORDER BY last_name, first_name` as Promise<Row[]>,
    ctx.sql`
      SELECT cu.id, cu.name FROM carecore_care_units cu JOIN carecore_sites s ON s.id = cu.site_id
      WHERE s.organization_id = ${org} AND cu.active ORDER BY cu.name` as Promise<Row[]>,
  ]);
  const byAccount = new Map<string, PortalGrant[]>();
  for (const row of grants) {
    const list = byAccount.get(String(row.account_id)) ?? [];
    list.push(mapGrant(row));
    byAccount.set(String(row.account_id), list);
  }
  return {
    accounts: accounts.map((row): PortalAccount => ({
      id: String(row.id),
      kind: row.kind as PortalKind,
      displayName: String(row.display_name),
      username: String(row.username),
      email: String(row.email),
      phone: String(row.phone),
      active: Boolean(row.active),
      mustChangePassword: Boolean(row.must_change_password),
      createdAt: iso(row.created_at) ?? "",
      lastLoginAt: iso(row.last_login_at),
      grants: byAccount.get(String(row.id)) ?? [],
    })),
    residents: residents.map((row) => ({ id: String(row.id), name: `${row.first_name} ${row.last_name}`.trim() })),
    careUnits: units.map((row) => ({ id: String(row.id), name: String(row.name) })),
  };
}

function parseAccount(body: Record<string, unknown>) {
  const displayName = text(body.displayName, 160);
  const email = text(body.email, 200);
  const phone = text(body.phone, 60);
  if (!displayName) throw new ApiError("Bitte den Namen angeben.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError("Die E-Mail-Adresse ist ungültig.");
  return { displayName, email, phone };
}

export async function createPortalAccount(ctx: ApiContext, body: Record<string, unknown>) {
  requireAdmin(ctx);
  const { displayName, email, phone } = parseAccount(body);
  const kind = typeof body.kind === "string" && body.kind in PORTAL_KINDS ? (body.kind as PortalKind) : null;
  if (!kind) throw new ApiError("Bitte wählen: Angehörige oder Ärztin / Arzt.");
  const username = text(body.username, 80).toLowerCase();
  if (!/^[a-z0-9._@-]{4,80}$/.test(username))
    throw new ApiError("Der Benutzername braucht 4–80 Zeichen (Buchstaben, Ziffern, . _ @ -).");
  const taken = (await ctx.sql`
    SELECT 1 FROM carecore_portal_accounts WHERE LOWER(username) = ${username}
    UNION ALL SELECT 1 FROM carecore_users WHERE LOWER(username) = ${username}`) as Row[];
  if (taken.length) throw new ApiError("Dieser Benutzername ist bereits vergeben.", 409);
  const password = oneTimePassword();
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_portal_accounts (id, organization_id, kind, display_name, username, email, phone, password_hash,
        created_by)
      VALUES (${id}, ${ctx.actor.organizationId}, ${kind}, ${displayName}, ${username}, ${email}, ${phone},
        ${await hashPassword(password)}, ${ctx.actor.id})`,
    auditStatement(ctx, "portal_account", id, "created", null, { kind, displayName, username, email, phone }),
  ]);
  return { id, password };
}

async function loadAccount(ctx: ApiContext, idInput: unknown) {
  const id = assertUuid(idInput, "Portal-Zugang");
  const rows = (await ctx.sql`
    SELECT * FROM carecore_portal_accounts WHERE id = ${id} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!rows[0]) throw new ApiError("Portal-Zugang nicht gefunden.", 404);
  return rows[0];
}

export async function updatePortalAccount(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  requireAdmin(ctx);
  const before = await loadAccount(ctx, idInput);
  const { displayName, email, phone } = parseAccount(body);
  const active = body.active !== false;
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_portal_accounts SET display_name = ${displayName}, email = ${email}, phone = ${phone},
        active = ${active}, updated_at = NOW() WHERE id = ${before.id}`,
    // Gesperrt: laufende Sitzungen enden sofort.
    ctx.sql`DELETE FROM carecore_portal_sessions WHERE account_id = ${before.id} AND ${!active}`,
    auditStatement(
      ctx,
      "portal_account",
      String(before.id),
      active === Boolean(before.active) ? "updated" : active ? "activated" : "deactivated",
      { displayName: before.display_name, email: before.email, phone: before.phone, active: before.active },
      { displayName, email, phone, active },
    ),
  ]);
}

export async function resetPortalPassword(ctx: ApiContext, idInput: unknown) {
  requireAdmin(ctx);
  const before = await loadAccount(ctx, idInput);
  const password = oneTimePassword();
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_portal_accounts SET password_hash = ${await hashPassword(password)}, must_change_password = TRUE,
        updated_at = NOW() WHERE id = ${before.id}`,
    ctx.sql`DELETE FROM carecore_portal_sessions WHERE account_id = ${before.id}`,
    auditStatement(ctx, "portal_account", String(before.id), "password_reset", null, null),
  ]);
  return { password };
}

async function parseGrant(ctx: ApiContext, kind: PortalKind, body: Record<string, unknown>) {
  const org = ctx.actor.organizationId;
  const residentId = typeof body.residentId === "string" && body.residentId ? body.residentId : null;
  const careUnitId = typeof body.careUnitId === "string" && body.careUnitId ? body.careUnitId : null;
  if ((residentId === null) === (careUnitId === null))
    throw new ApiError("Bitte entweder eine Person oder einen Wohnbereich wählen.");
  if (residentId) {
    const found = (await ctx.sql`
      SELECT 1 FROM carecore_residents WHERE id = ${assertUuid(residentId, "Person")} AND organization_id = ${org}`) as Row[];
    if (!found.length) throw new ApiError("Person nicht gefunden.", 404);
  }
  if (careUnitId) {
    const found = (await ctx.sql`
      SELECT 1 FROM carecore_care_units cu JOIN carecore_sites s ON s.id = cu.site_id
      WHERE cu.id = ${assertUuid(careUnitId, "Wohnbereich")} AND s.organization_id = ${org}`) as Row[];
    if (!found.length) throw new ApiError("Wohnbereich nicht gefunden.", 404);
  }
  const areas = portalAreas(body.areas);
  if (!areas.length) throw new ApiError("Bitte mindestens einen Bereich freigeben.");
  if (areas.some((area) => !portalAreaAllowed(kind, area)))
    throw new ApiError("Die Visite kann nur einem Zugang für Ärztin / Arzt freigegeben werden.");
  const basis = typeof body.basis === "string" && body.basis in PORTAL_BASES ? (body.basis as PortalBasis) : null;
  if (!basis) throw new ApiError("Bitte die Grundlage der Freigabe wählen.");
  const validFrom = typeof body.validFrom === "string" && DATE.test(body.validFrom) ? body.validFrom : null;
  const validUntil = typeof body.validUntil === "string" && DATE.test(body.validUntil) ? body.validUntil : null;
  if (validFrom && validUntil && validUntil < validFrom) throw new ApiError("Das Ende liegt vor dem Beginn.");
  return { residentId, careUnitId, areas, basis, basisNote: text(body.basisNote, 500), validFrom, validUntil };
}

export async function createPortalGrant(ctx: ApiContext, accountIdInput: unknown, body: Record<string, unknown>) {
  requireAdmin(ctx);
  const account = await loadAccount(ctx, accountIdInput);
  const grant = await parseGrant(ctx, account.kind as PortalKind, body);
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_portal_grants (id, account_id, resident_id, care_unit_id, areas, valid_from, valid_until, basis,
        basis_note, created_by, updated_by)
      VALUES (${id}, ${account.id}, ${grant.residentId}, ${grant.careUnitId}, ${JSON.stringify(grant.areas)}::jsonb,
        ${grant.validFrom}, ${grant.validUntil}, ${grant.basis}, ${grant.basisNote}, ${ctx.actor.id}, ${ctx.actor.id})`,
    auditStatement(ctx, "portal_grant", id, "created", null, { accountId: account.id, ...grant }),
  ]);
  return id;
}

async function loadGrant(ctx: ApiContext, idInput: unknown) {
  const id = assertUuid(idInput, "Freigabe");
  const rows = (await ctx.sql`
    SELECT g.*, a.kind AS account_kind FROM carecore_portal_grants g JOIN carecore_portal_accounts a ON a.id = g.account_id
    WHERE g.id = ${id} AND a.organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!rows[0]) throw new ApiError("Freigabe nicht gefunden.", 404);
  if (rows[0].revoked_at) throw new ApiError("Die Freigabe ist bereits widerrufen.", 409);
  return rows[0];
}

export async function updatePortalGrant(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  requireAdmin(ctx);
  const { account_kind: kind, ...before } = await loadGrant(ctx, idInput);
  const grant = await parseGrant(ctx, kind as PortalKind, body);
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_portal_grants SET resident_id = ${grant.residentId}, care_unit_id = ${grant.careUnitId},
        areas = ${JSON.stringify(grant.areas)}::jsonb, valid_from = ${grant.validFrom}, valid_until = ${grant.validUntil},
        basis = ${grant.basis}, basis_note = ${grant.basisNote}, updated_by = ${ctx.actor.id}, updated_at = NOW()
      WHERE id = ${before.id}`,
    auditStatement(ctx, "portal_grant", String(before.id), "updated", before, grant),
  ]);
}

export async function revokePortalGrant(ctx: ApiContext, idInput: unknown) {
  requireAdmin(ctx);
  const before = await loadGrant(ctx, idInput);
  await ctx.sql.transaction([
    ctx.sql`UPDATE carecore_portal_grants SET revoked_at = NOW(), revoked_by = ${ctx.actor.id} WHERE id = ${before.id}`,
    auditStatement(ctx, "portal_grant", String(before.id), "revoked", { areas: before.areas }, null),
  ]);
}

export async function portalAccessLog(ctx: ApiContext, accountIdInput: unknown): Promise<PortalAccessEntry[]> {
  requireAdmin(ctx);
  const account = await loadAccount(ctx, accountIdInput);
  const rows = (await ctx.sql`
    SELECT l.id, l.action, l.areas, l.created_at,
      NULLIF(TRIM(COALESCE(r.first_name, '') || ' ' || COALESCE(r.last_name, '')), '') AS resident_name
    FROM carecore_portal_access_log l LEFT JOIN carecore_residents r ON r.id = l.resident_id
    WHERE l.account_id = ${account.id} ORDER BY l.created_at DESC LIMIT 100`) as Row[];
  return rows.map((row) => ({
    id: String(row.id),
    action: String(row.action),
    residentName: (row.resident_name as string | null) ?? null,
    areas: portalAreas(row.areas),
    createdAt: iso(row.created_at) ?? "",
  }));
}
