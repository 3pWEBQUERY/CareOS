import { ApiError, auditStatement, type ApiContext, type Row } from "@/lib/api-context";
import { countryCode, type CountryCode } from "@/lib/country";
import { DEFAULT_INSURERS, INSURERS_MAX, type InsurerList } from "@/lib/insurers-shared";
import { hasPermission } from "@/lib/server-data";

const customList = (value: unknown, country: CountryCode) => {
  const lists = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const list = lists[country];
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string" && item !== "") : null;
};

// Versicherungen für das Land der Einrichtung: die eigene Liste der Administration, sonst die Vorgabe.
export async function readInsurers(ctx: Pick<ApiContext, "sql" | "actor">): Promise<InsurerList> {
  const rows = (await ctx.sql`
    SELECT country, settings->'insurers' AS insurers FROM carecore_organizations
    WHERE id = ${ctx.actor.organizationId}`) as Row[];
  const country = countryCode(rows[0]?.country);
  const custom = customList(rows[0]?.insurers, country);
  return { country, insurers: custom ?? DEFAULT_INSURERS[country], custom: custom !== null };
}

// Eigene Liste für das aktuelle Land speichern; `insurers: null` stellt die Vorgabe wieder her.
export async function saveInsurers(ctx: ApiContext, body: Record<string, unknown>): Promise<InsurerList> {
  if (!hasPermission(ctx.actor, "administration.manage")) throw new ApiError("Keine Berechtigung.", 403);
  const before = await readInsurers(ctx);
  let insurers: string[] | null = null;
  if (body.insurers !== null) {
    if (!Array.isArray(body.insurers) || !body.insurers.every((item) => typeof item === "string"))
      throw new ApiError("Bitte die Versicherungen angeben.");
    insurers = (body.insurers as string[]).map((item) => item.trim()).filter(Boolean);
    if (!insurers.length) throw new ApiError("Bitte mindestens eine Versicherung angeben.");
    if (insurers.length > INSURERS_MAX) throw new ApiError(`Höchstens ${INSURERS_MAX} Versicherungen möglich.`);
    if (insurers.some((item) => item.length > 160)) throw new ApiError("Eine Bezeichnung hat höchstens 160 Zeichen.");
    if (new Set(insurers.map((item) => item.toLowerCase())).size !== insurers.length)
      throw new ApiError("Jede Versicherung darf nur einmal vorkommen.");
  }
  await ctx.sql.transaction([
    insurers
      ? ctx.sql`
          UPDATE carecore_organizations
          SET settings = jsonb_set(
              jsonb_set(COALESCE(settings, '{}'::jsonb), '{insurers}', COALESCE(settings->'insurers', '{}'::jsonb)),
              ARRAY['insurers', ${before.country}], ${JSON.stringify(insurers)}::jsonb),
            updated_at = NOW()
          WHERE id = ${ctx.actor.organizationId}`
      : ctx.sql`
          UPDATE carecore_organizations SET settings = settings #- ARRAY['insurers', ${before.country}], updated_at = NOW()
          WHERE id = ${ctx.actor.organizationId}`,
    auditStatement(
      ctx,
      "setting",
      ctx.actor.organizationId,
      "insurers",
      { insurers: before.custom ? before.insurers : "Vorgabe" },
      { insurers: insurers ?? "Vorgabe" },
    ),
  ]);
  return readInsurers(ctx);
}
