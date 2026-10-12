import { ApiError, auditStatement, type ApiContext, type Row } from "@/lib/api-context";
import { COUNTRIES, COUNTRY_CODES, countryCode, regionName, type CountryCode } from "@/lib/country";
import { hasPermission } from "@/lib/server-data";

// Land (und Kanton bzw. Bundesland) der Einrichtung lesen und (Administration) festlegen.
export async function organizationCountry(ctx: Pick<ApiContext, "sql" | "actor">): Promise<CountryCode> {
  return (await organizationLocation(ctx)).country;
}

export async function organizationLocation(ctx: Pick<ApiContext, "sql" | "actor">) {
  const rows = (await ctx.sql`
    SELECT country, region FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}`) as Row[];
  const country = countryCode(rows[0]?.country);
  const region = regionName(country, rows[0]?.region as string | null) ? String(rows[0]?.region) : null;
  return { country, region };
}

export async function countrySettings(ctx: ApiContext) {
  const rows = (await ctx.sql`
    SELECT country, region, country_set_at FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}`) as Row[];
  const country = countryCode(rows[0]?.country);
  return {
    country,
    region: regionName(country, rows[0]?.region as string | null) ? String(rows[0]?.region) : null,
    confirmed: Boolean(rows[0]?.country_set_at),
  };
}

// Speichert Land und Region und ergänzt die üblichen Qualifikationen des Landes (bestehende bleiben unverändert).
export async function saveOrganizationCountry(ctx: ApiContext, value: unknown, regionInput?: unknown) {
  if (!hasPermission(ctx.actor, "administration.manage"))
    throw new ApiError("Das Land der Einrichtung legt die Administration fest.", 403);
  if (!COUNTRY_CODES.includes(value as CountryCode))
    throw new ApiError("Bitte Schweiz, Deutschland oder Österreich wählen.");
  const country = value as CountryCode;
  const region = regionInput === null || regionInput === undefined || regionInput === "" ? null : String(regionInput);
  if (region && !regionName(country, region))
    throw new ApiError(
      `Bitte einen gültigen ${COUNTRIES[country].region.label === "Kanton" ? "Kanton" : "Bundesland"} wählen.`,
    );
  const before = await countrySettings(ctx);
  const org = ctx.actor.organizationId;
  await ctx.sql.transaction([
    ctx.sql`UPDATE carecore_organizations SET country = ${country}, region = ${region}, country_set_at = NOW(),
      updated_at = NOW() WHERE id = ${org}`,
    ...COUNTRIES[country].qualifications.map(
      (q) => ctx.sql`INSERT INTO carecore_qualifications (organization_id, code, name, grants_medication)
        VALUES (${org}, ${q.code}, ${q.name}, ${q.grantsMedication}) ON CONFLICT (organization_id, code) DO NOTHING`,
    ),
    auditStatement(
      ctx,
      "organization",
      org,
      "country_updated",
      { country: before.country, region: before.region },
      { country, region },
    ),
  ]);
  return { country, region, confirmed: true };
}
