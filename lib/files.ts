import { randomUUID } from "node:crypto";
import { ApiError, type ApiContext } from "@/lib/api-context";
import { contentMatchesType } from "@/lib/file-signatures";
import { storeMedia } from "@/lib/storage";

const MAX_FILE_BYTES = 4 * 1024 * 1024;

// Stores an uploaded file in the organization's file store; `purpose` keeps it out of the personal cloud list.
export async function storeFile(
  ctx: ApiContext,
  file: FormDataEntryValue | null,
  purpose: "certificate" | "document",
  allowedTypes: readonly string[],
) {
  if (!(file instanceof File) || file.size === 0) throw new ApiError("Bitte eine Datei auswählen.");
  if (file.size > MAX_FILE_BYTES) throw new ApiError("Dateien dürfen höchstens 4 MB gross sein.", 413);
  const type = (file.type || "application/octet-stream").split(";")[0].trim().toLowerCase();
  if (!allowedTypes.includes(type)) throw new ApiError("Dieser Dateityp ist hier nicht erlaubt.", 415);
  const name = file.name
    .trim()
    .replace(/[\\/\u0000-\u001f]/g, "-")
    .slice(0, 220);
  if (!name) throw new ApiError("Der Dateiname ist ungültig.");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!contentMatchesType(type, bytes))
    throw new ApiError("Der Inhalt der Datei passt nicht zum Dateityp. Bitte die Originaldatei hochladen.", 415);
  const id = randomUUID();
  const key = await storeMedia("files", ctx.actor.organizationId, id, bytes, type);
  await ctx.sql`
    INSERT INTO carecore_cloud_files (id, organization_id, name, mime_type, size_bytes, content_base64, storage_key, uploaded_by, purpose)
    VALUES (${id}, ${ctx.actor.organizationId}, ${name}, ${type}, ${file.size},
      ${key ? null : bytes.toString("base64")}, ${key}, ${ctx.actor.id}, ${purpose})`;
  return { id, name, type, size: file.size };
}
