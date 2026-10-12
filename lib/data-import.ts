import { randomBytes, randomUUID } from "node:crypto";
import { ApiError, auditStatement, type ApiContext, type Row } from "@/lib/api-context";
import { createManagedUser, listManagedRoles, normalizeEmail } from "@/lib/admin-users";
import { parseCsv, parseDate } from "@/lib/csv-import";
import { mailConfigured } from "@/lib/mail";
import { sendPasswordLink } from "@/lib/password-links";
import { hasPermission } from "@/lib/server-data";

// Datenübernahme beim Umstieg: Bewohnerinnen/Bewohner und Mitarbeitende aus einer CSV-Datei (z. B. aus Excel oder
// dem bisherigen System). Erst Vorschau mit Prüfung je Zeile, dann Übernahme nur, wenn alle Zeilen gültig sind.

export type ImportKind = "residents" | "staff";
type Column = { key: string; label: string; required: boolean; hint?: string };

export const IMPORT_COLUMNS: Record<ImportKind, Column[]> = {
  residents: [
    { key: "firstName", label: "Vorname", required: true },
    { key: "lastName", label: "Nachname", required: true },
    { key: "birthDate", label: "Geburtsdatum", required: true, hint: "TT.MM.JJJJ" },
    { key: "gender", label: "Geschlecht", required: false, hint: "weiblich, männlich, divers" },
    { key: "unit", label: "Wohnbereich", required: true, hint: "Name wie in CareOS" },
    { key: "room", label: "Zimmer", required: true },
    { key: "admissionDate", label: "Eintritt", required: true, hint: "TT.MM.JJJJ" },
    { key: "status", label: "Status", required: false, hint: "aktiv oder geplant" },
    { key: "note", label: "Notiz", required: false },
  ],
  staff: [
    { key: "name", label: "Name", required: true },
    { key: "username", label: "Benutzername", required: true },
    { key: "role", label: "Rolle", required: true, hint: "Name oder Schlüssel der Rolle" },
    { key: "jobTitle", label: "Funktion", required: false },
    { key: "phone", label: "Telefon", required: false },
    { key: "email", label: "E-Mail", required: false },
    { key: "unit", label: "Wohnbereich", required: false, hint: "Name wie in CareOS" },
  ],
};

const MAX_ROWS = 1000;
const MAX_BYTES = 1_000_000;
const GENDERS: Record<string, string> = {
  weiblich: "female",
  w: "female",
  männlich: "male",
  maennlich: "male",
  m: "male",
  divers: "diverse",
  d: "diverse",
  "": "unspecified",
};
const STATUSES: Record<string, string> = {
  aktiv: "active",
  "": "active",
  geplant: "planned",
  "eintritt geplant": "planned",
};

export type ImportRow = { line: number; values: Record<string, string>; errors: string[] };
export type ImportPreview = { kind: ImportKind; columns: Column[]; rows: ImportRow[]; valid: number; invalid: number };

const normalizeHeader = (value: string) =>
  value
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-zäöüß0-9]/g, "");

function requireAdmin(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "administration.manage"))
    throw new ApiError("Die Datenübernahme ist Sache der Administration.", 403);
}

function readTable(kind: ImportKind, csv: string) {
  if (csv.length > MAX_BYTES) throw new ApiError("Die Datei ist zu gross (höchstens 1 MB).", 413);
  const table = parseCsv(csv);
  const columns = IMPORT_COLUMNS[kind];
  const positions = new Map<string, number>();
  table.header.forEach((name, index) => {
    const column = columns.find((entry) => normalizeHeader(entry.label) === normalizeHeader(name));
    if (column && !positions.has(column.key)) positions.set(column.key, index);
  });
  const missing = columns.filter((column) => column.required && !positions.has(column.key));
  if (!table.header.length) throw new ApiError("Die Datei ist leer.");
  if (missing.length)
    throw new ApiError(
      `Es fehlen Spalten: ${missing.map((column) => column.label).join(", ")}. Bitte die Vorlage verwenden.`,
    );
  if (!table.rows.length) throw new ApiError("Die Datei enthält keine Zeilen unter der Kopfzeile.");
  if (table.rows.length > MAX_ROWS) throw new ApiError(`Höchstens ${MAX_ROWS} Zeilen auf einmal.`);
  return table.rows.map((row) => ({
    line: row.line,
    values: Object.fromEntries(columns.map((column) => [column.key, row.cells[positions.get(column.key) ?? -1] ?? ""])),
    errors: [] as string[],
  }));
}

async function careUnits(ctx: ApiContext) {
  const rows = (await ctx.sql`
    SELECT cu.id, cu.name FROM carecore_care_units cu JOIN carecore_sites s ON s.id = cu.site_id
    WHERE s.organization_id = ${ctx.actor.organizationId} AND cu.active`) as Row[];
  return new Map(rows.map((row) => [String(row.name).toLowerCase(), String(row.id)]));
}

async function validateResidents(ctx: ApiContext, rows: ImportRow[]) {
  const units = await careUnits(ctx);
  const existing = new Set(
    (
      (await ctx.sql`SELECT lower(first_name || ' ' || last_name) || '|' || date_of_birth::text AS key
        FROM carecore_residents WHERE organization_id = ${ctx.actor.organizationId}`) as Row[]
    ).map((row) => String(row.key)),
  );
  const seen = new Set<string>();
  for (const row of rows) {
    const v = row.values;
    for (const column of IMPORT_COLUMNS.residents)
      if (column.required && !v[column.key]) row.errors.push(`${column.label} fehlt`);
    const birth = v.birthDate ? parseDate(v.birthDate) : null;
    const admission = v.admissionDate ? parseDate(v.admissionDate) : null;
    if (v.birthDate && !birth) row.errors.push("Geburtsdatum ungültig (TT.MM.JJJJ)");
    if (v.admissionDate && !admission) row.errors.push("Eintritt ungültig (TT.MM.JJJJ)");
    if (birth && admission && birth > admission) row.errors.push("Geburtsdatum liegt nach dem Eintritt");
    if (v.unit && !units.has(v.unit.toLowerCase())) row.errors.push(`Wohnbereich „${v.unit}“ gibt es nicht`);
    if (!(v.gender.toLowerCase() in GENDERS)) row.errors.push("Geschlecht: weiblich, männlich, divers oder leer");
    if (!(v.status.toLowerCase() in STATUSES)) row.errors.push("Status: aktiv, geplant oder leer");
    if (v.firstName.length > 100 || v.lastName.length > 100) row.errors.push("Name zu lang (höchstens 100 Zeichen)");
    if (v.room.length > 80) row.errors.push("Zimmer zu lang (höchstens 80 Zeichen)");
    if (birth && v.firstName && v.lastName) {
      const key = `${`${v.firstName} ${v.lastName}`.toLowerCase()}|${birth}`;
      if (existing.has(key)) row.errors.push("Ist bereits in CareOS erfasst");
      else if (seen.has(key)) row.errors.push("Steht doppelt in der Datei");
      seen.add(key);
    }
  }
}

async function validateStaff(ctx: ApiContext, rows: ImportRow[]) {
  const units = await careUnits(ctx);
  const roles = await listManagedRoles(ctx.actor.id);
  const [usernames, emails] = await Promise.all([
    ctx.sql`SELECT lower(username) AS v FROM carecore_users`,
    ctx.sql`SELECT lower(email) AS v FROM carecore_user_profiles WHERE email IS NOT NULL`,
  ]);
  const takenNames = new Set((usernames as Row[]).map((row) => String(row.v)));
  const takenEmails = new Set((emails as Row[]).map((row) => String(row.v)));
  const seenNames = new Set<string>();
  const seenEmails = new Set<string>();
  for (const row of rows) {
    const v = row.values;
    for (const column of IMPORT_COLUMNS.staff)
      if (column.required && !v[column.key]) row.errors.push(`${column.label} fehlt`);
    const username = v.username.toLowerCase();
    if (/\s/.test(v.username)) row.errors.push("Benutzername ohne Leerzeichen");
    if (username && takenNames.has(username)) row.errors.push("Benutzername ist bereits vergeben");
    else if (username && seenNames.has(username)) row.errors.push("Benutzername steht doppelt in der Datei");
    seenNames.add(username);
    const role = roles.find(
      (entry) => entry.key.toLowerCase() === v.role.toLowerCase() || entry.name.toLowerCase() === v.role.toLowerCase(),
    );
    if (v.role && !role) row.errors.push(`Rolle „${v.role}“ gibt es nicht`);
    else if (role) v.role = role.key;
    if (v.unit && !units.has(v.unit.toLowerCase())) row.errors.push(`Wohnbereich „${v.unit}“ gibt es nicht`);
    if (v.email) {
      try {
        const email = normalizeEmail(v.email) ?? "";
        if (takenEmails.has(email)) row.errors.push("E-Mail-Adresse gehört bereits zu einem Konto");
        else if (seenEmails.has(email)) row.errors.push("E-Mail-Adresse steht doppelt in der Datei");
        seenEmails.add(email);
      } catch {
        row.errors.push("E-Mail-Adresse ungültig");
      }
    }
    if (v.name.length > 120 || v.username.length > 80) row.errors.push("Name oder Benutzername zu lang");
  }
}

export async function previewImport(ctx: ApiContext, kind: ImportKind, csv: string): Promise<ImportPreview> {
  requireAdmin(ctx);
  const rows = readTable(kind, csv);
  if (kind === "residents") await validateResidents(ctx, rows);
  else await validateStaff(ctx, rows);
  const invalid = rows.filter((row) => row.errors.length).length;
  return { kind, columns: IMPORT_COLUMNS[kind], rows, valid: rows.length - invalid, invalid };
}

export type ImportResult = {
  created: number;
  invited: number;
  // Nur bei Mitarbeitenden ohne Einladung per E-Mail: einmalig angezeigt, nirgends gespeichert.
  startPasswords: Array<{ name: string; username: string; password: string }>;
};

export async function commitImport(ctx: ApiContext, kind: ImportKind, csv: string): Promise<ImportResult> {
  const preview = await previewImport(ctx, kind, csv);
  if (preview.invalid) throw new ApiError("Bitte zuerst alle fehlerhaften Zeilen in der Datei korrigieren.");
  return kind === "residents" ? importResidents(ctx, preview.rows) : importStaff(ctx, preview.rows);
}

// Alle Bewohnerinnen und Bewohner in einer Transaktion: Zimmer (falls neu), Akte, Aufenthalt und Protokoll.
async function importResidents(ctx: ApiContext, rows: ImportRow[]): Promise<ImportResult> {
  const units = await careUnits(ctx);
  const statements = [];
  for (const { values: v } of rows) {
    const unitId = units.get(v.unit.toLowerCase())!;
    const residentId = randomUUID();
    const birth = parseDate(v.birthDate)!;
    const admission = parseDate(v.admissionDate)!;
    statements.push(
      ctx.sql`INSERT INTO carecore_rooms (id, care_unit_id, name, room_number)
        VALUES (${randomUUID()}, ${unitId}, ${v.room}, ${v.room.replace(/\D/g, "") || null})
        ON CONFLICT (care_unit_id, name) DO UPDATE SET active = TRUE`,
      ctx.sql`INSERT INTO carecore_residents (id, organization_id, first_name, last_name, date_of_birth, gender, status,
          admitted_on, notes)
        VALUES (${residentId}, ${ctx.actor.organizationId}, ${v.firstName}, ${v.lastName}, ${birth},
          ${GENDERS[v.gender.toLowerCase()]}, ${STATUSES[v.status.toLowerCase()]}, ${admission}, ${v.note.slice(0, 2000) || null})`,
      ctx.sql`INSERT INTO carecore_resident_stays (id, resident_id, care_unit_id, room_id, started_at, created_by)
        SELECT ${randomUUID()}, ${residentId}, ${unitId}, r.id, ${`${admission}T12:00:00Z`}::timestamptz, ${ctx.actor.id}
        FROM carecore_rooms r WHERE r.care_unit_id = ${unitId} AND r.name = ${v.room}`,
      auditStatement(ctx, "resident", residentId, "imported", null, {
        name: `${v.firstName} ${v.lastName}`,
        careUnitId: unitId,
        room: v.room,
      }),
    );
  }
  await ctx.sql.transaction(statements);
  return { created: rows.length, invited: 0, startPasswords: [] };
}

// Mitarbeitende einzeln anlegen (wie in der Mitarbeiterverwaltung). Mit E-Mail-Adresse und eingerichtetem Versand
// kommt eine Einladung; sonst entsteht ein zufälliges Startpasswort, das nur einmal in der Antwort steht.
async function importStaff(ctx: ApiContext, rows: ImportRow[]): Promise<ImportResult> {
  const units = await careUnits(ctx);
  const result: ImportResult = { created: 0, invited: 0, startPasswords: [] };
  for (const { values: v } of rows) {
    const invite = Boolean(v.email) && mailConfigured();
    const password = randomBytes(12).toString("base64url");
    const list = await createManagedUser(ctx.actor, {
      displayName: v.name,
      username: v.username,
      password,
      generatedPassword: true,
      role: v.role,
      jobTitle: v.jobTitle,
      phone: v.phone,
      email: v.email,
      primaryCareUnitId: v.unit ? units.get(v.unit.toLowerCase())! : null,
    });
    result.created++;
    const user = list.users.find((entry) => entry.username === v.username);
    if (invite && user) {
      const sent = await sendPasswordLink(ctx.actor, user.id).then(
        () => true,
        (error) => {
          console.error("Import invite failed", error);
          return false;
        },
      );
      if (sent) {
        result.invited++;
        continue;
      }
    }
    result.startPasswords.push({ name: v.name, username: v.username, password });
  }
  return result;
}
