// Fehler des Dienstplans mit Code, verständlicher Meldung und optionalen Regelverstössen.
// Datenbankfehler (Constraints, Versionsprüfungen) werden übersetzt und nie roh weitergegeben.
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api-context";
import type { ActionResult, Violation } from "./types";

export class RosterError extends ApiError {
  code: string;
  violations?: Violation[];
  constructor(code: string, message: string, status = 400, violations?: Violation[]) {
    super(message, status);
    this.code = code;
    this.violations = violations;
  }
}

export const notFound = (what = "Eintrag") => new RosterError("NOT_FOUND", `${what} nicht gefunden.`, 404);
export const forbidden = (message = "Dafür fehlt die Berechtigung.") => new RosterError("FORBIDDEN", message, 403);
export const invalid = (message: string) => new RosterError("INVALID", message, 400);
export const conflict = (code: string, message: string) => new RosterError(code, message, 409);

// Codes raised by carecore_assert() inside write statements.
const ASSERT_MESSAGES: Record<string, [string, string]> = {
  STALE_VERSION: ["STALE_VERSION", "Dieser Dienst wurde inzwischen geändert. Bitte neu laden."],
  PLAN_CHANGED: ["STALE_VERSION", "Der Dienstplan wurde inzwischen geändert. Bitte neu laden."],
  PERIOD_LOCKED: ["PERIOD_LOCKED", "Der Monat ist abgeschlossen."],
  PERIOD_CHANGED: ["STALE_VERSION", "Der Monat wurde inzwischen geändert. Bitte neu laden."],
  SWAP_CHANGED: ["EXPIRED", "Der Tausch ist nicht mehr möglich, weil sich die Dienste geändert haben."],
  ENTRY_CHANGED: ["STALE_VERSION", "Der Zeiteintrag wurde inzwischen geändert. Bitte neu laden."],
  REQUEST_CHANGED: ["STALE_VERSION", "Der Antrag wurde inzwischen bearbeitet. Bitte neu laden."],
};

const UNIQUE_MESSAGES: Record<string, string> = {
  carecore_time_entry_one_open_per_employee: "Es läuft bereits ein Zeiteintrag. Bitte zuerst ausstempeln.",
  carecore_time_entry_one_per_shift: "Für diesen Dienst gibt es bereits einen Zeiteintrag.",
  carecore_shift_swap_one_active_per_source: "Für diesen Dienst läuft bereits ein Tausch.",
  carecore_shift_types_organization_id_code_key: "Dieses Kürzel ist bereits vergeben.",
  carecore_staffing_weekday_idx: "Für diesen Wochentag und Diensttyp gibt es bereits eine Vorgabe.",
  carecore_staffing_date_idx: "Für dieses Datum und diesen Diensttyp gibt es bereits eine Vorgabe.",
  carecore_public_holidays_organization_id_date_key: "Für dieses Datum ist bereits ein Feiertag eingetragen.",
  carecore_qualifications_organization_id_code_key: "Dieses Qualifikationskürzel ist bereits vergeben.",
  carecore_payroll_wage_types_code_key: "Diese Lohnart-Nummer ist bereits vergeben.",
  carecore_schedule_periods_care_unit_id_year_month_key: "Diesen Monat gibt es bereits.",
};

const FOREIGN_KEY_MESSAGES: Record<string, [string, string]> = {
  carecore_time_entries_shift_id_fkey: ["SHIFT_HAS_TIME_ENTRY", "Für diesen Dienst wurde bereits Arbeitszeit erfasst."],
  carecore_roster_shifts_shift_type_id_fkey: [
    "IN_USE",
    "Dieser Diensttyp wird in Dienstplänen verwendet. Bitte deaktivieren statt löschen.",
  ],
  carecore_roster_shifts_employee_id_fkey: [
    "IN_USE",
    "Diese Person hat Dienstplan-Einträge und kann nur archiviert werden.",
  ],
  carecore_time_entries_employee_id_fkey: ["IN_USE", "Diese Person hat Zeiteinträge und kann nur archiviert werden."],
};

type DbError = { code?: string; constraint?: string; message?: string };

export function translateDbError(error: unknown): RosterError | null {
  const db = error as DbError;
  if (!db || typeof db !== "object" || typeof db.code !== "string") return null;
  if (db.code === "23P01")
    return conflict("OVERLAP", "Die Person ist zu dieser Zeit bereits eingeteilt. Bitte neu laden und prüfen.");
  if (db.code === "P0001") {
    const [code, message] = ASSERT_MESSAGES[String(db.message)] ?? [
      "CONFLICT",
      "Die Änderung ist nicht mehr möglich. Bitte neu laden.",
    ];
    return conflict(code, message);
  }
  if (db.code === "23505")
    return conflict("DUPLICATE", UNIQUE_MESSAGES[db.constraint ?? ""] ?? "Dieser Eintrag existiert bereits.");
  if (db.code === "23503") {
    const [code, message] = FOREIGN_KEY_MESSAGES[db.constraint ?? ""] ?? [
      "IN_USE",
      "Der Eintrag wird noch verwendet und kann nicht gelöscht werden.",
    ];
    return conflict(code, message);
  }
  if (db.code === "23514") return invalid("Die Eingabe ist ungültig. Bitte die Werte prüfen.");
  return null;
}

const codeForStatus = (status: number) =>
  status === 401 ? "UNAUTHENTICATED" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : "INVALID";

export function toRosterError(error: unknown): RosterError | null {
  if (error instanceof RosterError) return error;
  if (error instanceof ApiError) return new RosterError(codeForStatus(error.status), error.message, error.status);
  return translateDbError(error);
}

// Route handler body: runs the operation and answers in the ActionResult format.
export async function respond<T>(operation: () => Promise<T>, fallback: string, status = 200) {
  try {
    const data = await operation();
    return NextResponse.json({ ok: true, data } satisfies ActionResult<T>, { status });
  } catch (error) {
    const known = toRosterError(error);
    if (known)
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: known.code,
            message: known.message,
            ...(known.violations ? { violations: known.violations } : {}),
          },
        } satisfies ActionResult<T>,
        { status: known.status },
      );
    // No request data in the log: only the operation and the error.
    console.error(`[dienstplan] ${fallback}`, error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: { code: "INTERNAL", message: fallback } } satisfies ActionResult<T>, {
      status: 500,
    });
  }
}
