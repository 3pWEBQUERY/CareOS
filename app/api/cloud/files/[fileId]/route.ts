import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-context";
import { readableFile } from "@/lib/file-access";
import { carecoreActor } from "@/lib/server-data";
import {
  copyFile,
  listVersions,
  officeLive,
  purgeFile,
  readOffice,
  readText,
  restoreVersion,
  saveOffice,
  saveText,
  updateFile,
  versionContent,
} from "@/lib/shared-files";

export const runtime = "nodejs";
type Context = { params: Promise<{ fileId: string }> };

// Only types that cannot execute script are ever rendered inline; everything else is downloaded.
const inlinePreviewTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/ogg",
  "audio/webm",
  "application/pdf",
  "text/plain",
]);

export async function GET(request: Request, { params }: Context) {
  try {
    const actor = await carecoreActor();
    if (!actor?.organizationId) return NextResponse.json({ error: "Bitte erneut anmelden." }, { status: 401 });
    const { fileId } = await params;
    const search = new URL(request.url).searchParams;
    // Bearbeiten als Text bzw. Versionen der Datei (Ablage).
    if (search.get("text") === "1") return NextResponse.json(await readText(actor, fileId));
    if (search.get("office") === "1") return NextResponse.json(await readOffice(actor, fileId));
    if (search.get("versions") === "1") return NextResponse.json({ versions: await listVersions(actor, fileId) });
    const versionId = search.get("version");
    // Not found and not allowed look the same, so file ids cannot be probed.
    const file = versionId
      ? { ...(await versionContent(actor, fileId, versionId)), mime_type: "application/octet-stream" }
      : await readableFile(actor, fileId);
    if (!file) return NextResponse.json({ error: "Datei nicht gefunden." }, { status: 404 });
    const rows = [file];
    const safeName = rows[0].name.replace(/["\r\n]/g, "_");
    const mimeType = (rows[0].mime_type || "").split(";")[0].trim().toLowerCase();
    const preview = new URL(request.url).searchParams.get("preview") === "1" && inlinePreviewTypes.has(mimeType);
    return new Response(new Uint8Array(rows[0].content), {
      headers: {
        "Content-Type": preview
          ? mimeType === "text/plain"
            ? "text/plain; charset=utf-8"
            : mimeType
          : "application/octet-stream",
        "Content-Disposition": `${preview ? "inline" : "attachment"}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(rows[0].name)}`,
        // Chrome's PDF viewer refuses to render in a sandboxed document, so PDFs get a restrictive CSP without sandbox.
        "Content-Security-Policy":
          mimeType === "application/pdf" && preview
            ? "default-src 'none'; object-src 'self'"
            : "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return apiErrorResponse(error, "Datei konnte nicht geladen werden.");
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const actor = await carecoreActor();
    if (!actor?.organizationId) return NextResponse.json({ error: "Bitte erneut anmelden." }, { status: 401 });
    const { fileId } = await params;
    const file = await updateFile(actor, fileId, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ file });
  } catch (error) {
    return apiErrorResponse(error, "Datei konnte nicht geändert werden.");
  }
}

// Text speichern (neue Version; versionNo schützt vor dem Überschreiben fremder Änderungen) oder Dokument, Tabelle
// bzw. Präsentation aus dem Editor ({ model, revision, auto }).
export async function PUT(request: Request, { params }: Context) {
  try {
    const actor = await carecoreActor();
    if (!actor?.organizationId) return NextResponse.json({ error: "Bitte erneut anmelden." }, { status: 401 });
    const { fileId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    if ("model" in body) return NextResponse.json(await saveOffice(actor, fileId, body));
    const file = await saveText(actor, fileId, body);
    return NextResponse.json({ file });
  } catch (error) {
    return apiErrorResponse(error, "Text konnte nicht gespeichert werden.");
  }
}

// Kopieren ({ action: "copy", folderId }) oder frühere Version wiederherstellen ({ action: "restoreVersion", versionId }).
export async function POST(request: Request, { params }: Context) {
  try {
    const actor = await carecoreActor();
    if (!actor?.organizationId) return NextResponse.json({ error: "Bitte erneut anmelden." }, { status: 401 });
    const { fileId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    if (body.action === "copy")
      return NextResponse.json({ file: await copyFile(actor, fileId, body) }, { status: 201 });
    // Gleichzeitiges Bearbeiten: Lebenszeichen und neuester Stand der Datei.
    if (body.action === "live") return NextResponse.json(await officeLive(actor, fileId, body));
    if (body.action === "restoreVersion")
      return NextResponse.json({ file: await restoreVersion(actor, fileId, String(body.versionId)) });
    return NextResponse.json({ error: "Unbekannte Aktion." }, { status: 400 });
  } catch (error) {
    return apiErrorResponse(error, "Datei konnte nicht geändert werden.");
  }
}

// Endgültig löschen (nur aus dem Papierkorb; in den Papierkorb: PATCH { action: "trash" }).
export async function DELETE(_request: Request, { params }: Context) {
  try {
    const actor = await carecoreActor();
    if (!actor?.organizationId) return NextResponse.json({ error: "Bitte erneut anmelden." }, { status: 401 });
    const { fileId } = await params;
    await purgeFile(actor, fileId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Datei konnte nicht gelöscht werden.");
  }
}
