// Eingabeprüfung des Dienstplans (statt Zod, siehe DECISIONS T3). Wirft verständliche Meldungen;
// die Oberfläche nutzt dieselben Grenzen.
import { invalid } from "./errors";
import { DATE_PATTERN, TIME_PATTERN } from "./time";
import {
  RULE_CODES,
  type ExclusionCategory,
  type PreferenceKind,
  type Priority,
  type RuleCode,
  type ShiftCategory,
  type AbsenceKind,
} from "./types";

export type Body = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

export function uuid(value: unknown, label: string): string {
  if (!isUuid(value)) throw invalid(`${label} ist ungültig.`);
  return value;
}
export const optionalUuid = (value: unknown, label: string) =>
  value === null || value === undefined || value === "" ? null : uuid(value, label);

export function date(value: unknown, label: string): string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T12:00:00Z`)))
    throw invalid(`${label}: bitte ein gültiges Datum angeben.`);
  return value;
}
export const optionalDate = (value: unknown, label: string) =>
  value === null || value === undefined || value === "" ? null : date(value, label);

export function time(value: unknown, label: string): string {
  if (typeof value !== "string" || !TIME_PATTERN.test(value))
    throw invalid(`${label}: bitte eine Uhrzeit (HH:MM) angeben.`);
  return value;
}

export function instant(value: unknown, label: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw invalid(`${label} ist ungültig.`);
  return new Date(value).toISOString();
}

export function int(value: unknown, label: string, min: number, max: number): number {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isInteger(number) || number < min || number > max)
    throw invalid(`${label} muss eine ganze Zahl zwischen ${min} und ${max} sein.`);
  return number;
}
export const optionalInt = (value: unknown, label: string, min: number, max: number) =>
  value === null || value === undefined || value === "" ? null : int(value, label, min, max);

export function num(value: unknown, label: string, min: number, max: number): number {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof number !== "number" || Number.isNaN(number) || number < min || number > max)
    throw invalid(`${label} muss zwischen ${min} und ${max} liegen.`);
  return number;
}

export function text(value: unknown, label: string, max: number, required = false): string | null {
  if (value === null || value === undefined) {
    if (required) throw invalid(`${label} fehlt.`);
    return null;
  }
  if (typeof value !== "string") throw invalid(`${label} ist ungültig.`);
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) throw invalid(`${label} fehlt.`);
    return null;
  }
  if (trimmed.length > max) throw invalid(`${label} darf höchstens ${max} Zeichen lang sein.`);
  return trimmed;
}

export function oneOf<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (typeof value !== "string" || !options.includes(value as T)) throw invalid(`${label} ist ungültig.`);
  return value as T;
}

export const bool = (value: unknown) => value === true || value === "true";

export const CATEGORIES = ["WORK", "STANDBY", "ON_CALL", "ABSENCE"] as const satisfies readonly ShiftCategory[];
export const ABSENCE_KINDS = ["VACATION", "SICK", "TRAINING", "OTHER"] as const satisfies readonly AbsenceKind[];
export const EXCLUSIONS = ["NIGHT", "STANDBY", "ON_CALL"] as const satisfies readonly ExclusionCategory[];
export const PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const satisfies readonly Priority[];
export const PREFERENCE_KINDS = [
  "PREFER_SHIFT_TYPE",
  "AVOID_SHIFT_TYPE",
  "PREFER_WEEKDAY",
  "AVOID_WEEKDAY",
  "AVOID_CATEGORY",
] as const satisfies readonly PreferenceKind[];

// Bestätigte Warnungen und Begründung (Spec 7.1: WARN darf die Leitung mit Begründung übersteuern).
export function acknowledgement(body: Body) {
  const acknowledged = Array.isArray(body.acknowledgedWarnings)
    ? body.acknowledgedWarnings.filter((code): code is RuleCode => RULE_CODES.includes(code as RuleCode))
    : [];
  const reason = text(body.overrideReason, "Begründung", 500);
  if (acknowledged.length && !reason) throw invalid("Bitte eine Begründung für das Übersteuern der Warnungen angeben.");
  return { acknowledged, reason };
}

export function month(value: unknown) {
  const match = typeof value === "string" ? /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value) : null;
  if (!match) throw invalid("Monat ist ungültig.");
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function color(value: unknown) {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) throw invalid("Farbe ist ungültig.");
  return value.toLowerCase();
}

export function uuidList(value: unknown, label: string) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid(`${label} ist ungültig.`);
  return [...new Set(value.map((item) => uuid(item, label)))];
}

export function stringList<T extends string>(value: unknown, options: readonly T[], label: string): T[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid(`${label} ist ungültig.`);
  return [...new Set(value.map((item) => oneOf(item, options, label)))];
}
