// Hilfen für die DB-Integrationstests: eigene Organisation pro Test und ein RosterContext wie im Betrieb.
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { ApiContext } from "@/lib/api-context";
import { carecoreDb } from "@/lib/server-data";
import { accessFor, type RosterContext } from "@/lib/roster/context";
import { ensureRosterDefaults } from "@/lib/roster/data";
import { pool } from "./neon-pg.mjs";

export { pool };

export const q = async <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
  (await pool.query({ text, values, types: pg.types })).rows as T[];

export type Fixture = {
  org: string;
  units: { a: string; b: string };
  people: Record<string, string>;
  ctx: (person: string) => Promise<RosterContext>;
  type: (code: string) => Promise<string>;
};

const ROLE_PERMISSIONS: Record<string, string[]> = {
  leitung: ["residents.read", "schedule.manage", "team.manage"],
  pflege: ["residents.read", "residents.write"],
  admin: ["residents.read", "schedule.manage", "administration.manage"],
};

// Organisation mit zwei Wohnbereichen, je einer Leitung, Mitarbeitenden und einer Person, die in
// beiden Bereichen arbeitet (Springer).
export async function fixture(): Promise<Fixture> {
  const org = randomUUID();
  const site = randomUUID();
  const units = { a: randomUUID(), b: randomUUID() };
  await q(`INSERT INTO carecore_organizations (id, name, timezone) VALUES ($1, $2, 'Europe/Zurich')`, [
    org,
    `Test ${org}`,
  ]);
  await q(`INSERT INTO carecore_sites (id, organization_id, name) VALUES ($1, $2, 'Haus')`, [site, org]);
  await q(
    `INSERT INTO carecore_care_units (id, site_id, name) VALUES ($1, $3, 'Wohngruppe A'), ($2, $3, 'Wohngruppe B')`,
    [units.a, units.b, site],
  );
  const people: Record<string, string> = {};
  const add = async (key: string, name: string, role: string, memberships: Array<[string, boolean, boolean]>) => {
    const id = randomUUID();
    people[key] = id;
    await q(
      `INSERT INTO carecore_users (id, username, display_name, role, password_hash) VALUES ($1, $2, $3, $4, 'x')`,
      [id, `${key}-${id.slice(0, 8)}`, name, role],
    );
    await q(`INSERT INTO carecore_user_profiles (user_id, organization_id, primary_care_unit_id) VALUES ($1, $2, $3)`, [
      id,
      org,
      memberships[0]?.[0] ?? null,
    ]);
    await q(`INSERT INTO carecore_employee_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [id]);
    for (const [unit, plannable, lead] of memberships)
      await q(
        `INSERT INTO carecore_unit_memberships (user_id, care_unit_id, plannable, is_lead) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, care_unit_id) DO UPDATE SET plannable = EXCLUDED.plannable, is_lead = EXCLUDED.is_lead`,
        [id, unit, plannable, lead],
      );
  };
  await add("leadA", "Laura Leitung", "leitung", [[units.a, false, true]]);
  await add("leadB", "Bruno Leitung", "leitung", [[units.b, false, true]]);
  await add("anna", "Anna Müller", "pflege", [[units.a, true, false]]);
  await add("max", "Max Meier", "pflege", [[units.a, true, false]]);
  await add("lea", "Lea Beispiel", "pflege", [[units.a, true, false]]);
  await add("ben", "Ben Berger", "pflege", [[units.b, true, false]]);
  await add("sam", "Sam Springer", "pflege", [
    [units.a, true, false],
    [units.b, true, false],
  ]);

  const contexts = new Map<string, RosterContext>();
  const ctx = async (person: string) => {
    const cached = contexts.get(person);
    if (cached) return { ...cached, correlationId: randomUUID() };
    const [row] = await q<{ id: string; username: string; display_name: string; role: string }>(
      `SELECT id, username, display_name, role FROM carecore_users WHERE id = $1`,
      [people[person]],
    );
    const actor = {
      ...row,
      organizationId: org,
      permissions: ROLE_PERMISSIONS[row.role] ?? [],
    } as unknown as RosterContext["actor"];
    const sql = carecoreDb();
    const context: RosterContext = { actor, sql, access: await accessFor(sql, actor), correlationId: randomUUID() };
    contexts.set(person, context);
    return context;
  };
  await ensureRosterDefaults(await ctx("leadA"));
  const type = async (code: string) =>
    (
      await q<{ id: string }>(`SELECT id FROM carecore_shift_types WHERE organization_id = $1 AND code = $2`, [
        org,
        code,
      ])
    )[0].id;
  return { org, units, people, ctx, type };
}

// ApiContext (Bewohnerakte, Medikation …) für eine Person der Fixture.
export async function apiContextFor(f: Fixture, person: string): Promise<ApiContext> {
  const ctx = await f.ctx(person);
  return { actor: ctx.actor, sql: ctx.sql } as unknown as ApiContext;
}

// Bewohnerin im Wohnbereich A mit eigenem Zimmer.
export async function createResident(f: Fixture, name = "Erna Muster") {
  const id = randomUUID();
  const room = randomUUID();
  const [first, last] = name.split(" ");
  await q(`INSERT INTO carecore_residents (id, organization_id, first_name, last_name) VALUES ($1, $2, $3, $4)`, [
    id,
    f.org,
    first,
    last,
  ]);
  await q(`INSERT INTO carecore_rooms (id, care_unit_id, name) VALUES ($1, $2, $3)`, [
    room,
    f.units.a,
    `Zimmer ${id.slice(0, 4)}`,
  ]);
  await q(
    `INSERT INTO carecore_resident_stays (id, resident_id, care_unit_id, room_id, started_at) VALUES ($1, $2, $3, $4, NOW() - INTERVAL '30 days')`,
    [randomUUID(), id, f.units.a, room],
  );
  return id;
}

// Qualifikation (z. B. HF, FAGE, SRK) einer Person der Fixture zuweisen.
export async function qualify(f: Fixture, person: string, code: string, validFrom = "2000-01-01", validUntil?: string) {
  await q(
    `INSERT INTO carecore_employee_qualifications (user_id, qualification_id, valid_from, valid_until)
     SELECT $1, id, $3::date, $4::date FROM carecore_qualifications WHERE organization_id = $2 AND code = $5`,
    [f.people[person], f.org, validFrom, validUntil ?? null, code],
  );
}
