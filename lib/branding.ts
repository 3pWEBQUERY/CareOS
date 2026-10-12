import { ApiError, auditStatement, type ApiContext, type Row } from "@/lib/api-context";
import { LOGO_MAX_BYTES } from "@/lib/branding-shared";
import { detectImageType } from "@/lib/file-signatures";
import { hasPermission } from "@/lib/server-data";
import { mediaContent, removeMedia, storeMedia } from "@/lib/storage";

// Logo der Einrichtung: JPEG, PNG oder WebP (kein SVG, das Skript enthalten kann), höchstens LOGO_MAX_BYTES.
const LOGO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function requireAdmin(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "administration.manage"))
    throw new ApiError("Das Logo legt die Administration fest.", 403);
}

export async function readLogo(ctx: ApiContext) {
  const rows = (await ctx.sql`
    SELECT logo_base64, logo_storage_key, logo_mime_type, logo_updated_at FROM carecore_organizations
    WHERE id = ${ctx.actor.organizationId}`) as Row[];
  const row = rows[0];
  if (!row || !LOGO_TYPES.has(String(row.logo_mime_type))) return null;
  const bytes = await mediaContent(row.logo_storage_key, row.logo_base64);
  if (!bytes) return null;
  return {
    bytes,
    mimeType: String(row.logo_mime_type),
    updatedAt: row.logo_updated_at instanceof Date ? row.logo_updated_at.toISOString() : String(row.logo_updated_at),
  };
}

export async function logoUpdatedAt(ctx: ApiContext) {
  const rows = (await ctx.sql`
    SELECT logo_updated_at FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}`) as Row[];
  const value = rows[0]?.logo_updated_at;
  return value ? (value instanceof Date ? value.toISOString() : String(value)) : null;
}

export async function saveLogo(ctx: ApiContext, dataUrl: unknown) {
  requireAdmin(ctx);
  const match =
    typeof dataUrl === "string"
      ? /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)
      : null;
  if (!match) throw new ApiError("Erlaubt sind JPEG-, PNG- und WebP-Bilder.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > LOGO_MAX_BYTES)
    throw new ApiError(`Das Logo darf höchstens ${LOGO_MAX_BYTES / 1024 / 1024} MB gross sein.`, 413);
  if (detectImageType(bytes) !== match[1]) throw new ApiError("Die Bilddatei ist ungültig.");
  const [previous] = (await ctx.sql`
    SELECT logo_storage_key FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}`) as Row[];
  // Jede Fassung unter eigenem Schlüssel; die alte wird nach dem Speichern entfernt.
  const key = await storeMedia("logos", ctx.actor.organizationId, crypto.randomUUID(), bytes, match[1]);
  const [rows] = (await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_organizations
      SET logo_base64 = ${key ? null : bytes.toString("base64")}, logo_storage_key = ${key}, logo_mime_type = ${match[1]},
        logo_updated_at = NOW(), updated_at = NOW()
      WHERE id = ${ctx.actor.organizationId} RETURNING logo_updated_at`,
    auditStatement(ctx, "branding", ctx.actor.organizationId, "logo_updated", null, {
      mimeType: match[1],
      bytes: bytes.length,
    }),
  ])) as Row[][];
  await removeMedia([previous?.logo_storage_key]);
  return String(
    rows[0]?.logo_updated_at instanceof Date ? rows[0].logo_updated_at.toISOString() : rows[0]?.logo_updated_at,
  );
}

export async function removeLogo(ctx: ApiContext) {
  requireAdmin(ctx);
  const [previous] = (await ctx.sql`
    SELECT logo_storage_key FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}`) as Row[];
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_organizations SET logo_base64 = NULL, logo_storage_key = NULL, logo_mime_type = NULL,
        logo_updated_at = NULL, updated_at = NOW()
      WHERE id = ${ctx.actor.organizationId}`,
    auditStatement(ctx, "branding", ctx.actor.organizationId, "logo_removed", null, null),
  ]);
  await removeMedia([previous?.logo_storage_key]);
}

// Name der Einrichtung (Kopfzeile, E-Mails, Ausdrucke); legt die Administration fest.
export async function organizationName(ctx: ApiContext) {
  const rows = (await ctx.sql`SELECT name FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}`) as Row[];
  return String(rows[0]?.name ?? "");
}

export async function saveOrganizationName(ctx: ApiContext, value: unknown) {
  if (!hasPermission(ctx.actor, "administration.manage"))
    throw new ApiError("Den Namen der Einrichtung legt die Administration fest.", 403);
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name) throw new ApiError("Bitte einen Namen eingeben.");
  if (name.length > 180) throw new ApiError("Der Name ist zu lang (höchstens 180 Zeichen).");
  const before = await organizationName(ctx);
  if (before === name) return name;
  await ctx.sql.transaction([
    ctx.sql`UPDATE carecore_organizations SET name = ${name}, updated_at = NOW() WHERE id = ${ctx.actor.organizationId}`,
    auditStatement(ctx, "branding", ctx.actor.organizationId, "name_updated", { name: before }, { name }),
  ]);
  return name;
}
