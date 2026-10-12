import { mayReadFile } from "@/lib/file-access-rules";
import { carecoreDb, type CarecoreActor } from "@/lib/server-data";
import { mediaContent } from "@/lib/storage";

// Who may open a stored file. The file store holds personal files ("Meine Dateien"),
// documents of residents and of the house, and training certificates, so every
// download is checked against what the file belongs to:
// - personal file: only the person who uploaded it
// - resident document: staff who may read resident records
// - house document (standards, instructions): staff who may read documents
// - certificate: the person it belongs to, the uploader and the team leads
// - chat file (shared in the messenger): members of the conversation
// Files in the recycle bin of the storage are not readable until restored.

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StoredFile = { name: string; mime_type: string; content: Buffer };

export async function readableFile(actor: CarecoreActor, fileId: string): Promise<StoredFile | null> {
  if (!actor.organizationId || !UUID.test(fileId)) return null;
  const rows = (await carecoreDb()`
    SELECT f.name, f.mime_type, f.content_base64, f.storage_key, f.purpose, f.uploaded_by,
      d.id AS document_id, d.resident_id AS document_resident_id,
      (SELECT e.user_id FROM carecore_training_enrollments e WHERE e.certificate_file_id = f.id LIMIT 1) AS certificate_user_id,
      EXISTS (SELECT 1 FROM carecore_conversation_members cm
        WHERE cm.conversation_id = f.conversation_id AND cm.user_id = ${actor.id}) AS chat_member
    FROM carecore_cloud_files f
    LEFT JOIN carecore_documents d ON d.file_id = f.id AND d.organization_id = f.organization_id
    WHERE f.id = ${fileId} AND f.organization_id = ${actor.organizationId} AND f.deleted_at IS NULL
    LIMIT 1`) as Array<Record<string, unknown>>;
  const file = rows[0];
  if (!file) return null;
  const allowed = mayReadFile(
    {
      purpose: String(file.purpose),
      uploadedBy: file.uploaded_by ? String(file.uploaded_by) : null,
      documentId: file.document_id ? String(file.document_id) : null,
      certificateUserId: file.certificate_user_id ? String(file.certificate_user_id) : null,
      chatMember: Boolean(file.chat_member),
    },
    actor,
  );
  if (!allowed) return null;
  const content = await mediaContent(file.storage_key, file.content_base64);
  return content ? { name: String(file.name), mime_type: String(file.mime_type ?? ""), content } : null;
}
