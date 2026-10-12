import "server-only";
import type { Row, Sql } from "@/lib/api-context";

// Persönliche Anordnung einrichtbarer Seiten. Nur bekannte Seiten; der Inhalt wird streng geprüft, die Bedeutung der
// Bausteine kennt erst die Seite selbst (unbekannte Bausteine ignoriert sie).
export const PAGE_LAYOUT_KEYS = [
  "insights-care",
  "insights-residents",
  "insights-leadership",
  "insights-workforce",
  "insights-mine",
] as const;
export type PageLayoutKey = (typeof PAGE_LAYOUT_KEYS)[number];

export type PageLayout = {
  order: string[];
  hidden: string[];
  sizes: Record<string, string>;
  stacked?: string[];
};

const SIZES = new Set(["third", "half", "twoThirds", "full"]);
const isId = (value: unknown): value is string => typeof value === "string" && /^[a-z][a-zA-Z0-9-]{0,39}$/.test(value);
const idList = (value: unknown) =>
  Array.isArray(value) && value.length <= 40 && value.every(isId) ? [...new Set(value as string[])] : null;

export const pageLayoutKey = (value: unknown): PageLayoutKey | null =>
  PAGE_LAYOUT_KEYS.includes(value as PageLayoutKey) ? (value as PageLayoutKey) : null;

export function normalizePageLayout(input: unknown): PageLayout | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  const order = idList(value.order);
  const hidden = idList(value.hidden ?? []);
  if (!order || !hidden) return null;
  const sizes = value.sizes ?? {};
  if (!sizes || typeof sizes !== "object" || Array.isArray(sizes)) return null;
  const entries = Object.entries(sizes as Record<string, unknown>);
  if (entries.length > 40 || !entries.every(([id, size]) => isId(id) && SIZES.has(String(size)))) return null;
  const layout: PageLayout = { order, hidden, sizes: Object.fromEntries(entries) as Record<string, string> };
  if (value.stacked !== undefined) {
    const stacked = idList(value.stacked);
    if (!stacked) return null;
    layout.stacked = stacked;
  }
  return layout;
}

export async function readPageLayout(sql: Sql, userId: string, page: PageLayoutKey) {
  const rows = (await sql`
    SELECT layout FROM carecore_user_page_layouts WHERE user_id = ${userId} AND page = ${page}`) as Row[];
  return rows[0] ? normalizePageLayout(rows[0].layout) : null;
}

export async function savePageLayout(sql: Sql, userId: string, page: PageLayoutKey, layout: PageLayout) {
  await sql`
    INSERT INTO carecore_user_page_layouts (user_id, page, layout, updated_at)
    VALUES (${userId}, ${page}, ${JSON.stringify(layout)}::jsonb, NOW())
    ON CONFLICT (user_id, page) DO UPDATE SET layout = EXCLUDED.layout, updated_at = NOW()`;
}

export async function deletePageLayout(sql: Sql, userId: string, page: PageLayoutKey) {
  await sql`DELETE FROM carecore_user_page_layouts WHERE user_id = ${userId} AND page = ${page}`;
}
