import { ApiError, iso, auditStatement, type ApiContext } from "@/lib/api-context";
import { SETTING_DEFINITIONS, resolveSettings, type AppSettings, type SettingKey } from "@/lib/settings-shared";
import { TERMINOLOGIES, resolveTerminology, termsFor, type TerminologyKey } from "@/lib/terminology";
import { VITAL_METRICS } from "@/lib/vitals-shared";
import { errorSummary, type ErrorSummary } from "@/lib/error-log";

// Organisation-wide settings (see settings-shared.ts).

export async function readSettings(ctx: ApiContext): Promise<AppSettings> {
  const rows =
    await ctx.sql`SELECT settings->'app' AS app FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}`;
  return resolveSettings(rows[0]?.app);
}

export async function readTerminology(ctx: ApiContext): Promise<TerminologyKey> {
  const rows =
    await ctx.sql`SELECT settings->'terminology' AS terminology FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}`;
  return resolveTerminology(rows[0]?.terminology);
}

// Vitalparameter, die die Einrichtung nicht erfasst (ausgeblendet in Messung und Übersichten).
export const resolveHiddenVitals = (value: unknown) =>
  Array.isArray(value) ? VITAL_METRICS.map((metric) => metric.key).filter((key) => value.includes(key)) : [];

export async function readHiddenVitals(ctx: ApiContext) {
  const rows =
    await ctx.sql`SELECT settings->'hiddenVitals' AS hidden FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}`;
  return resolveHiddenVitals(rows[0]?.hidden);
}

export async function saveHiddenVitals(ctx: ApiContext, body: Record<string, unknown>) {
  const input = body.hidden;
  const keys = VITAL_METRICS.map((metric) => metric.key);
  if (!Array.isArray(input) || !input.every((key) => typeof key === "string" && keys.includes(key)))
    throw new ApiError("Bitte nur bekannte Vitalparameter angeben.");
  const hidden = resolveHiddenVitals(input);
  if (hidden.length === keys.length) throw new ApiError("Mindestens ein Vitalparameter muss erfasst werden.");
  const before = await readHiddenVitals(ctx);
  await ctx.sql.transaction([
    ctx.sql`
    UPDATE carecore_organizations
    SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{hiddenVitals}', ${JSON.stringify(hidden)}::jsonb), updated_at = NOW()
    WHERE id = ${ctx.actor.organizationId}`,
    auditStatement(ctx, "setting", ctx.actor.organizationId, "hidden_vitals", { hidden: before }, { hidden }),
  ]);
  return hidden;
}

// Wortformen der Bezeichnung für Texte, die der Server erzeugt (Kennzahlen, Übersichten).
export const readTerms = async (ctx: ApiContext) => termsFor(await readTerminology(ctx));

// Bezeichnung der betreuten Personen (Bewohner / Patient / Klient) für die ganze Einrichtung.
export async function saveTerminology(ctx: ApiContext, body: Record<string, unknown>) {
  if (typeof body.value !== "string" || !(body.value in TERMINOLOGIES))
    throw new ApiError("Bitte Bewohner, Patient oder Klient wählen.");
  const next = body.value as TerminologyKey;
  const before = await readTerminology(ctx);
  await ctx.sql.transaction([
    ctx.sql`
    UPDATE carecore_organizations
    SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{terminology}', ${JSON.stringify(next)}::jsonb), updated_at = NOW()
    WHERE id = ${ctx.actor.organizationId}`,
    auditStatement(ctx, "setting", ctx.actor.organizationId, "terminology", { value: before }, { value: next }),
  ]);
  return next;
}

export async function saveSetting(ctx: ApiContext, key: unknown, body: Record<string, unknown>) {
  if (typeof key !== "string" || !(key in SETTING_DEFINITIONS)) throw new ApiError("Einstellung ist unbekannt.");
  const settingKey = key as SettingKey;
  const definition = SETTING_DEFINITIONS[settingKey];
  const before = await readSettings(ctx);
  const enabled = typeof body.enabled === "boolean" ? body.enabled : before[settingKey].enabled;
  let value = before[settingKey].value;
  if (definition.unit && body.value !== undefined) {
    const number = Number(body.value);
    if (!Number.isInteger(number) || number < (definition.min ?? 0) || number > (definition.max ?? Infinity))
      throw new ApiError(
        `Bitte einen Wert zwischen ${definition.min} und ${definition.max} ${definition.unit} angeben.`,
      );
    value = number;
  }
  if (enabled && definition.unit && value === null)
    throw new ApiError(`Bitte zuerst einen Wert in ${definition.unit} festlegen.`);
  // Zwei-Faktor-Pflicht nur einschalten, wenn das eigene Konto sie schon erfüllt (sonst sperrt sich die
  // Administration selbst aus der Konfiguration aus).
  if (settingKey === "strongLoginRequired" && enabled && !before.strongLoginRequired.enabled) {
    const [secured] = (await ctx.sql`
      SELECT EXISTS (SELECT 1 FROM carecore_user_mfa WHERE user_id = ${ctx.actor.id} AND confirmed_at IS NOT NULL)
        OR EXISTS (SELECT 1 FROM carecore_passkeys WHERE user_id = ${ctx.actor.id}) AS ok`) as Array<{ ok: boolean }>;
    if (!secured?.ok)
      throw new ApiError(
        "Bitte zuerst für das eigene Konto Zwei-Faktor-Anmeldung oder einen Passkey einrichten (Einstellungen › Sicherheit).",
      );
  }
  const next = { ...before, [settingKey]: { enabled, value } };
  await ctx.sql.transaction([
    ctx.sql`
    UPDATE carecore_organizations
    SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{app}', ${JSON.stringify(next)}::jsonb), updated_at = NOW()
    WHERE id = ${ctx.actor.organizationId}`,
    auditStatement(ctx, "setting", ctx.actor.organizationId, settingKey, before[settingKey], next[settingKey]),
  ]);
  return next;
}

export type SystemStatus = {
  databaseMs: number;
  schemaVersion: string | null;
  migrations: number;
  lastMigrationAt: string | null;
  auditEntries30Days: number;
  lastAuditAt: string | null;
  // Serverfehler der letzten 24 Stunden und die letzten Einträge (Überwachung).
  errors: ErrorSummary;
};

// Live state of the installation for the "Systemstatus" card.
export async function systemStatus(ctx: ApiContext): Promise<SystemStatus> {
  const started = performance.now();
  await ctx.sql`SELECT 1`;
  const databaseMs = Math.round(performance.now() - started);
  const [migrations, audit] = await Promise.all([
    ctx.sql`SELECT COUNT(*)::int AS count, MAX(version) AS version, MAX(applied_at) AS applied_at FROM carecore_schema_migrations`,
    ctx.sql`
      SELECT COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int AS recent, MAX(created_at) AS last_at
      FROM carecore_audit_log WHERE organization_id = ${ctx.actor.organizationId}`,
  ]);
  const errors = await errorSummary(ctx.sql);
  return {
    databaseMs,
    errors,
    schemaVersion: migrations[0]?.version ? String(migrations[0].version).slice(0, 4) : null,
    migrations: Number(migrations[0]?.count ?? 0),
    lastMigrationAt: iso(migrations[0]?.applied_at),
    auditEntries30Days: Number(audit[0]?.recent ?? 0),
    lastAuditAt: iso(audit[0]?.last_at),
  };
}
