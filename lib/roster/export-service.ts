import "server-only";
import type { RosterContext } from "./context";
import { unitName } from "./context";
import { decimalHours, fileSlug, toCsv, type CsvValue } from "./csv";
import { invalid } from "./errors";
import { formatDate, localTime, monthKey } from "./time";
import { timesheet } from "./time-service";
import { ABSENCE_LABELS, TIME_ENTRY_STATUS_LABELS, type AbsenceKind } from "./types";
import { loadEmployees } from "./data";
import { wageQuantity, wageUnit } from "./payroll-shared";
import { employeeNumbers, loadWageTypes } from "./settings-service";

// Arbeitszeit-Export (Spec 8.10) für die Lohnbuchhaltung: Summen je Person oder alle Zeiteinträge.
// Berechtigungen und Filter wie in der Arbeitszeitübersicht (dieselbe Auswertung).
export async function timesheetCsv(ctx: RosterContext, params: URLSearchParams) {
  const kind = params.get("art") ?? "summen";
  if (kind !== "summen" && kind !== "eintraege" && kind !== "lohn") throw invalid("Unbekannte Exportart.");
  if (kind === "lohn" && params.get("eigene") === "1") throw invalid("Unbekannte Exportart.");
  const sheet = await timesheet(ctx, params);
  const unit = sheet.unitId ? await unitName(ctx, sheet.unitId) : "Eigene Zeiten";
  const month = monthKey(sheet.year, sheet.month);
  const tz = sheet.timezone;
  let rows: CsvValue[][];
  if (kind === "lohn") {
    rows = await payrollRows(ctx, sheet, month);
  } else if (kind === "summen") {
    const absenceKinds = Object.keys(ABSENCE_LABELS) as AbsenceKind[];
    rows = [
      [
        "Monat",
        "Wohnbereich",
        "Person",
        "Pensum %",
        "Soll (h)",
        "Geplant (h)",
        "Ist (h)",
        "Saldo (h)",
        "Nacht (h)",
        "Wochenende (h)",
        "Feiertag (h)",
        ...absenceKinds.map((k) => `${ABSENCE_LABELS[k]} (Tage)`),
        "Nicht erfasst",
        "Unvollständig",
      ],
      ...sheet.rows.map((row) => [
        month,
        unit,
        row.name,
        row.pensumPercent,
        decimalHours(row.targetMinutes),
        decimalHours(row.plannedMinutes),
        decimalHours(row.actualMinutes),
        decimalHours(row.balanceMinutes),
        decimalHours(row.nightMinutes),
        decimalHours(row.weekendMinutes),
        decimalHours(row.holidayMinutes),
        ...absenceKinds.map((k) => row.absenceDays[k] ?? 0),
        row.notRecorded,
        row.incomplete,
      ]),
    ];
  } else {
    rows = [
      [
        "Datum",
        "Wohnbereich",
        "Person",
        "Dienst",
        "Geplant",
        "Beginn",
        "Ende",
        "Pause (Min)",
        "Netto (h)",
        "Differenz (Min)",
        "Status",
        "Korrektur offen",
      ],
      ...[...sheet.entries]
        .sort((a, b) => a.clockIn.localeCompare(b.clockIn))
        .map((entry) => [
          formatDate(entry.date, true),
          unit,
          entry.employee,
          entry.shift ?? "ungeplant",
          entry.planned ?? "",
          localTime(entry.clockIn, tz),
          entry.clockOut ? localTime(entry.clockOut, tz) : "",
          entry.breakMinutes,
          decimalHours(entry.actualMinutes),
          entry.differenceMinutes,
          TIME_ENTRY_STATUS_LABELS[entry.status],
          entry.correction ? "ja" : "nein",
        ]),
    ];
  }
  return {
    filename: `arbeitszeit-${kind}-${fileSlug(unit)}-${month}.csv`,
    body: toCsv(rows),
  };
}

// Lohn-Export: je Person und Lohnart eine Zeile mit der Menge des Monats (ohne Nullwerte). Damit niemand doppelt
// abgerechnet wird, enthält der Export eines Wohnbereichs nur die Personen mit diesem Stammwohnbereich.
async function payrollRows(
  ctx: RosterContext,
  sheet: Awaited<ReturnType<typeof timesheet>>,
  month: string,
): Promise<CsvValue[][]> {
  const wageTypes = await loadWageTypes(ctx);
  if (!wageTypes.length)
    throw invalid("Es sind noch keine Lohnarten festgelegt (Dienstplan › Einstellungen › Lohnarten).");
  const ids = sheet.rows.map((row) => row.employeeId);
  const [employees, numbers] = await Promise.all([loadEmployees(ctx, ids), employeeNumbers(ctx, ids)]);
  const rows: CsvValue[][] = [["Periode", "Personalnummer", "Person", "Lohnart", "Bezeichnung", "Menge", "Einheit"]];
  for (const row of sheet.rows) {
    if (sheet.unitId && employees[row.employeeId]?.unitIds[0] !== sheet.unitId) continue;
    for (const wageType of wageTypes) {
      const quantity = wageQuantity(wageType.source, row);
      if (!quantity) continue;
      rows.push([
        month,
        numbers.get(row.employeeId) ?? "",
        row.name,
        wageType.code,
        wageType.name,
        quantity,
        wageUnit(wageType.source),
      ]);
    }
  }
  return rows;
}
