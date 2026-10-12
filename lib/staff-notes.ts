import { ApiError, iso, type Row, type Sql } from "@/lib/api-context";

// Persönliche Notizen auf der Startseite („Meine Notizen“): nur für die eigene Person sichtbar, mit Archiv.
// Alle Änderungen sind wiederholbar, damit offline vorgemerkte Änderungen gefahrlos nachgereicht werden können:
// - Neue Notizen tragen eine vom Gerät erzeugte Kennung; ein zweites Senden legt keine zweite Notiz an.
// - Bearbeiten, Archivieren und Löschen führen bei Wiederholung zum selben Ergebnis.

export type StaffNote = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type Owner = { sql: Sql; userId: string; organizationId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const noteId = (value: unknown) => {
  if (typeof value !== "string" || !UUID.test(value)) throw new ApiError("Ungültige Notiz.");
  return value.toLowerCase();
};

const mapNote = (row: Row): StaffNote => ({
  id: String(row.id),
  title: String(row.title),
  body: String(row.body),
  pinned: Boolean(row.pinned),
  archived_at: iso(row.archived_at),
  created_at: iso(row.created_at) ?? "",
  updated_at: iso(row.updated_at) ?? "",
});

function parseContent(input: Record<string, unknown>) {
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 160) : "";
  const body = typeof input.body === "string" ? input.body.trim().slice(0, 4000) : "";
  if (!title || !body) throw new ApiError("Titel und Notiztext sind erforderlich.");
  return { title, body, pinned: input.pinned === true };
}

// Aktive Notizen (angeheftete zuerst) und das Archiv (zuletzt archivierte zuerst).
export async function listNotes({ sql, userId, organizationId }: Owner) {
  const rows = (await sql`
    (SELECT id, title, body, pinned, archived_at, created_at, updated_at FROM carecore_staff_notes
      WHERE organization_id = ${organizationId} AND user_id = ${userId} AND archived_at IS NULL
      ORDER BY pinned DESC, updated_at DESC LIMIT 100)
    UNION ALL
    (SELECT id, title, body, pinned, archived_at, created_at, updated_at FROM carecore_staff_notes
      WHERE organization_id = ${organizationId} AND user_id = ${userId} AND archived_at IS NOT NULL
      ORDER BY archived_at DESC LIMIT 200)`) as Row[];
  return rows.map(mapNote);
}

export async function createNote({ sql, userId, organizationId }: Owner, input: Record<string, unknown>) {
  const id = noteId(input.id);
  const note = parseContent(input);
  const rows = (await sql`
    INSERT INTO carecore_staff_notes (id, organization_id, user_id, title, body, pinned)
    VALUES (${id}, ${organizationId}, ${userId}, ${note.title}, ${note.body}, ${note.pinned})
    ON CONFLICT (id) DO NOTHING
    RETURNING id, title, body, pinned, archived_at, created_at, updated_at`) as Row[];
  if (rows[0]) return mapNote(rows[0]);
  // Schon gespeichert (erneut gesendet): nur die eigene Notiz zählt.
  const existing = (await sql`
    SELECT id, title, body, pinned, archived_at, created_at, updated_at FROM carecore_staff_notes
    WHERE id = ${id} AND organization_id = ${organizationId} AND user_id = ${userId}`) as Row[];
  if (!existing[0]) throw new ApiError("Diese Notiz-Kennung ist bereits vergeben.", 409);
  return mapNote(existing[0]);
}

// Inhalt ändern und/oder archivieren bzw. wiederherstellen (archived: true/false).
export async function updateNote({ sql, userId, organizationId }: Owner, input: Record<string, unknown>) {
  const id = noteId(input.id);
  const content = input.title !== undefined || input.body !== undefined ? parseContent(input) : null;
  if (input.archived !== undefined && typeof input.archived !== "boolean")
    throw new ApiError("Archiv: Wert ist ungültig.");
  const archived = input.archived as boolean | undefined;
  if (!content && archived === undefined) throw new ApiError("Keine Änderung angegeben.");
  // Stand, auf dem die Bearbeitung beruht: wurde die Notiz seither anderswo geändert, gilt das als Konflikt.
  const base =
    typeof input.baseUpdatedAt === "string" && !Number.isNaN(Date.parse(input.baseUpdatedAt))
      ? new Date(input.baseUpdatedAt).toISOString()
      : null;
  const rows = (await sql`
    UPDATE carecore_staff_notes SET
      title = COALESCE(${content?.title ?? null}, title),
      body = COALESCE(${content?.body ?? null}, body),
      pinned = COALESCE(${content ? content.pinned : null}::boolean, pinned),
      archived_at = CASE
        WHEN ${archived ?? null}::boolean IS TRUE THEN COALESCE(archived_at, NOW())
        WHEN ${archived ?? null}::boolean IS FALSE THEN NULL
        ELSE archived_at END,
      -- Jede Änderung rückt den Stand um mindestens 1 ms weiter (Vergleich auf Millisekunden), auch wenn zwei
      -- Änderungen in derselben Millisekunde eintreffen.
      updated_at = CASE WHEN ${content !== null}
        THEN GREATEST(NOW(), date_trunc('milliseconds', updated_at) + INTERVAL '1 millisecond')
        ELSE updated_at END
    WHERE id = ${id} AND organization_id = ${organizationId} AND user_id = ${userId}
      AND (${base}::timestamptz IS NULL OR date_trunc('milliseconds', updated_at) <= ${base}::timestamptz)
    RETURNING id, title, body, pinned, archived_at, created_at, updated_at`) as Row[];
  if (rows[0]) return mapNote(rows[0]);
  const exists =
    await sql`SELECT 1 FROM carecore_staff_notes WHERE id = ${id} AND organization_id = ${organizationId} AND user_id = ${userId}`;
  if (exists[0]) throw new ApiError("Die Notiz wurde inzwischen auf einem anderen Gerät geändert.", 409);
  throw new ApiError("Notiz nicht gefunden.", 404);
}

// Endgültig löschen; eine bereits gelöschte Notiz gilt als gelöscht.
export async function deleteNote({ sql, userId, organizationId }: Owner, input: Record<string, unknown>) {
  const id = noteId(input.id);
  await sql`DELETE FROM carecore_staff_notes WHERE id = ${id} AND organization_id = ${organizationId} AND user_id = ${userId}`;
  return { success: true };
}
