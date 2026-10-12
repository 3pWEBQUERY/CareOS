import { mediaContent, removeMedia, storeMedia } from "@/lib/storage";
import { NextResponse } from "next/server";
import { residentAudit } from "@/lib/resident-audit";
import { PHOTO_TYPES, parsePhotoDataUrl } from "@/lib/resident-photo";
import { carecoreActor, carecoreDb, forbidden, hasPermission, type Permission } from "@/lib/server-data";

export const runtime = "nodejs";

async function access(residentId: string, permission: Permission) {
  const actor = await carecoreActor();
  if (!actor?.organizationId || !/^[0-9a-f-]{36}$/i.test(residentId)) return null;
  if (!hasPermission(actor, permission)) return "forbidden" as const;
  const sql = carecoreDb();
  const rows =
    await sql`SELECT id FROM carecore_residents WHERE id = ${residentId} AND organization_id = ${actor.organizationId} LIMIT 1`;
  return rows[0] ? { sql, actor } : null;
}

export async function GET(request: Request, context: { params: Promise<{ residentId: string }> }) {
  try {
    const { residentId } = await context.params;
    const allowed = await access(residentId, "residents.read");
    if (!allowed) return NextResponse.json({ error: "Akte nicht verfügbar." }, { status: 404 });
    if (allowed === "forbidden") return forbidden();
    const { sql } = allowed;
    const rows =
      await sql`SELECT photo_base64, photo_storage_key, photo_mime_type, photo_updated_at FROM carecore_residents WHERE id = ${residentId} LIMIT 1`;
    const resident = rows[0];
    const stored =
      resident && PHOTO_TYPES.has(String(resident.photo_mime_type))
        ? await mediaContent(resident.photo_storage_key, resident.photo_base64)
        : null;
    if (new URL(request.url).searchParams.get("format") === "raw") {
      if (!stored) {
        return new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
      }
      const image = stored;
      return new NextResponse(new Uint8Array(image), {
        headers: {
          "Content-Type": String(resident.photo_mime_type),
          "Content-Length": String(image.byteLength),
          "Cache-Control": "private, max-age=60",
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": "inline",
        },
      });
    }
    const photoDataUrl = stored ? `data:${resident.photo_mime_type};base64,${stored.toString("base64")}` : null;
    return NextResponse.json(
      { photoDataUrl, updatedAt: resident?.photo_updated_at ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Resident photo GET failed", error);
    return NextResponse.json({ error: "Bild konnte nicht geladen werden." }, { status: 500 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ residentId: string }> }) {
  try {
    const { residentId } = await context.params;
    const allowed = await access(residentId, "residents.write");
    if (!allowed) return NextResponse.json({ error: "Akte nicht verfügbar." }, { status: 404 });
    if (allowed === "forbidden") return forbidden();
    const { sql, actor } = allowed;
    const input = (await request.json()) as { photoDataUrl?: unknown };
    const photo = parsePhotoDataUrl(input.photoDataUrl);
    if (!photo.ok) return NextResponse.json({ error: photo.error }, { status: photo.status });
    const { image, mimeType } = photo;
    const base64 = image.toString("base64");
    const [previous] = await sql`SELECT photo_storage_key FROM carecore_residents WHERE id = ${residentId}`;
    // Jede Fassung unter eigenem Schlüssel; die alte wird nach dem Speichern entfernt.
    const organizationId = actor.organizationId ?? "unknown";
    const key = await storeMedia("resident-photos", organizationId, crypto.randomUUID(), image, mimeType);
    const [rows] = await sql.transaction([
      sql`UPDATE carecore_residents SET photo_base64 = ${key ? null : base64}, photo_storage_key = ${key}, photo_mime_type = ${mimeType}, photo_updated_at = NOW(), updated_at = NOW() WHERE id = ${residentId} RETURNING photo_updated_at`,
      residentAudit(sql, actor, {
        residentId,
        entityType: "resident_photo",
        entityId: residentId,
        action: "updated",
        after: { mimeType, bytes: image.length },
      }),
    ]);
    if (!rows[0]) return NextResponse.json({ error: "Akte nicht gefunden." }, { status: 404 });
    await removeMedia([previous?.photo_storage_key]);
    return NextResponse.json({
      photoDataUrl: `data:${mimeType};base64,${base64}`,
      updatedAt: rows[0].photo_updated_at,
    });
  } catch (error) {
    console.error("Resident photo PUT failed", error);
    return NextResponse.json({ error: "Bild konnte nicht gespeichert werden." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ residentId: string }> }) {
  try {
    const { residentId } = await context.params;
    const allowed = await access(residentId, "residents.write");
    if (!allowed) return NextResponse.json({ error: "Akte nicht verfügbar." }, { status: 404 });
    if (allowed === "forbidden") return forbidden();
    const { sql, actor } = allowed;
    const [previous] = await sql`SELECT photo_storage_key FROM carecore_residents WHERE id = ${residentId}`;
    await sql.transaction([
      sql`UPDATE carecore_residents SET photo_base64 = NULL, photo_storage_key = NULL, photo_mime_type = NULL, photo_updated_at = NULL, updated_at = NOW() WHERE id = ${residentId}`,
      residentAudit(sql, actor, { residentId, entityType: "resident_photo", entityId: residentId, action: "deleted" }),
    ]);
    await removeMedia([previous?.photo_storage_key]);
    return NextResponse.json({ photoDataUrl: null });
  } catch (error) {
    console.error("Resident photo DELETE failed", error);
    return NextResponse.json({ error: "Bild konnte nicht entfernt werden." }, { status: 500 });
  }
}
