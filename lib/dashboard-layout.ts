import { neon } from "@neondatabase/serverless";
import "@/database/pg-fetch.mjs";

export type DashboardLayout = {
  order: string[];
  hidden: string[];
  // Bausteine im Kopfbereich und gewählte Breiten; ältere Layouts haben beides nicht.
  top?: string[];
  sizes?: Record<string, string>;
};

const SIZES = new Set(["third", "half", "twoThirds", "full"]);

function database() {
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!connectionString) throw new Error("DATABASE_URL_NOT_CONFIGURED");
  return neon(connectionString);
}

export function normalizeDashboardLayout(input: unknown): DashboardLayout | null {
  if (!input || typeof input !== "object") return null;
  const value = input as { order?: unknown; hidden?: unknown; top?: unknown; sizes?: unknown };
  if (!Array.isArray(value.order) || !Array.isArray(value.hidden)) return null;
  const isValidId = (item: unknown): item is string => typeof item === "string" && item.length > 0 && item.length <= 80;
  const isValidList = (items: unknown[]) => items.length <= 50 && items.every(isValidId);
  if (!isValidList(value.order) || !isValidList(value.hidden)) return null;
  const layout: DashboardLayout = {
    order: [...new Set(value.order as string[])],
    hidden: [...new Set(value.hidden as string[])],
  };
  if (value.top !== undefined) {
    if (!Array.isArray(value.top) || !isValidList(value.top)) return null;
    layout.top = [...new Set(value.top as string[])];
  }
  if (value.sizes !== undefined) {
    if (!value.sizes || typeof value.sizes !== "object" || Array.isArray(value.sizes)) return null;
    const entries = Object.entries(value.sizes as Record<string, unknown>);
    if (entries.length > 50 || !entries.every(([id, size]) => isValidId(id) && SIZES.has(String(size)))) return null;
    layout.sizes = Object.fromEntries(entries) as Record<string, string>;
  }
  return layout;
}

export async function getDashboardLayout(userId: string): Promise<DashboardLayout | null> {
  const sql = database();
  const rows =
    (await sql`SELECT layout FROM carecore_user_dashboard_layouts WHERE user_id = ${userId} LIMIT 1`) as unknown as Array<{
      layout: unknown;
    }>;
  return rows[0] ? normalizeDashboardLayout(rows[0].layout) : null;
}

export async function saveDashboardLayout(userId: string, layout: DashboardLayout) {
  const sql = database();
  await sql`
    INSERT INTO carecore_user_dashboard_layouts (user_id, layout, updated_at)
    VALUES (${userId}, ${JSON.stringify(layout)}::jsonb, NOW())
    ON CONFLICT (user_id) DO UPDATE SET layout = EXCLUDED.layout, updated_at = NOW()
  `;
}

export async function deleteDashboardLayout(userId: string) {
  const sql = database();
  await sql`DELETE FROM carecore_user_dashboard_layouts WHERE user_id = ${userId}`;
}
