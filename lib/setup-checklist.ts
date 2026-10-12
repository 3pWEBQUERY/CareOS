import { ApiError, auditStatement, type ApiContext, type Row } from "@/lib/api-context";
import { mailConfigured } from "@/lib/mail";
import { hasPermission } from "@/lib/server-data";

// Ersteinrichtung einer neuen Installation: was die Administration (oder der Betreiber für sie) noch erledigen sollte.
// Jeder Schritt wird aus den Daten abgeleitet; die Liste verschwindet, sobald alles erledigt oder ausgeblendet ist.

// href: Seite zum Erledigen; ein Anker (#…) öffnet dort den passenden Dialog bzw. springt zur Karte.
export type SetupStep = { id: string; label: string; detail: string; done: boolean; href: string | null };
export type SetupChecklist = { steps: SetupStep[]; dismissed: boolean };

function requireAdmin(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "administration.manage"))
    throw new ApiError("Die Ersteinrichtung ist Sache der Administration.", 403);
}

export async function setupChecklist(ctx: ApiContext): Promise<SetupChecklist> {
  requireAdmin(ctx);
  const org = ctx.actor.organizationId;
  const [row] = (await ctx.sql`
    SELECT
      o.name,
      o.settings->'setup'->>'dismissedAt' AS dismissed_at,
      o.country_set_at IS NOT NULL AS country_set,
      EXISTS (SELECT 1 FROM carecore_sites s WHERE s.organization_id = o.id AND s.active
        AND COALESCE(s.address_line1, '') <> '' AND COALESCE(s.city, '') <> '') AS site_address,
      (SELECT COUNT(*)::int FROM carecore_care_units cu JOIN carecore_sites s ON s.id = cu.site_id
        WHERE s.organization_id = o.id AND cu.active) AS units,
      EXISTS (SELECT 1 FROM carecore_care_units cu JOIN carecore_sites s ON s.id = cu.site_id
        WHERE s.organization_id = o.id AND cu.active AND cu.name <> 'Wohnbereich 1') AS units_named,
      (SELECT COUNT(*)::int FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
        WHERE p.organization_id = o.id AND u.active) AS staff,
      (SELECT COUNT(*)::int FROM carecore_residents r WHERE r.organization_id = o.id) AS residents,
      EXISTS (SELECT 1 FROM carecore_user_mfa m WHERE m.user_id = ${ctx.actor.id} AND m.confirmed_at IS NOT NULL)
        OR EXISTS (SELECT 1 FROM carecore_passkeys k WHERE k.user_id = ${ctx.actor.id}) AS strong_login
    FROM carecore_organizations o WHERE o.id = ${org}`) as Row[];
  const name = String(row?.name ?? "");
  const steps: SetupStep[] = [
    {
      id: "name",
      label: "Name der Einrichtung",
      detail: "Erscheint in der Kopfzeile aller Mitarbeitenden.",
      done: name !== "" && name !== "CareOS" && name !== "CareCore",
      href: "/c/leitung/administration/konfiguration#name",
    },
    {
      id: "country",
      label: "Land der Einrichtung",
      detail: "Schweiz, Deutschland oder Österreich: bestimmt Pflegestufen, Feiertage und Qualifikationen.",
      done: Boolean(row?.country_set),
      href: "/c/leitung/administration/konfiguration#land",
    },
    {
      id: "site",
      label: "Standort mit Adresse",
      detail: "Adresse für Überleitungsbogen und Ausdrucke.",
      done: Boolean(row?.site_address),
      href: "/c/leitung/administration#standort",
    },
    {
      id: "units",
      label: "Wohnbereiche anlegen",
      detail: "Mit eigenen Namen, Plätzen und Leitung.",
      done: Number(row?.units) > 1 || Boolean(row?.units_named),
      href: "/c/leitung/administration#wohnbereich",
    },
    {
      id: "staff",
      label: "Mitarbeitende erfassen",
      detail: "Mit Rolle, Wohnbereich und am besten mit E-Mail-Adresse; auch per Datenübernahme.",
      done: Number(row?.staff) > 1,
      href: "/c/leitung/administration/mitarbeiter",
    },
    {
      id: "residents",
      label: "Bewohnerinnen und Bewohner aufnehmen",
      detail: "Aus einer Datei übernehmen (Datenübernahme) oder einzeln aufnehmen.",
      done: Number(row?.residents) > 0,
      href: "/c/leitung/administration/import",
    },
    {
      id: "mail",
      label: "E-Mail-Versand",
      detail: "Für „Passwort vergessen“ und Einladungen; richtet der Betreiber von CareOS ein.",
      done: mailConfigured(),
      href: null,
    },
    {
      id: "security",
      label: "Eigenes Konto absichern",
      detail: "Zwei-Faktor-Anmeldung oder Passkey für das Administrationskonto.",
      done: Boolean(row?.strong_login),
      href: "/c/einstellungen/security",
    },
  ];
  return { steps, dismissed: Boolean(row?.dismissed_at) };
}

// Liste ausblenden bzw. wieder zeigen (gilt für die ganze Einrichtung).
export async function dismissSetupChecklist(ctx: ApiContext, dismissed: boolean) {
  requireAdmin(ctx);
  const value = dismissed ? { dismissedAt: new Date().toISOString() } : {};
  await ctx.sql.transaction([
    ctx.sql`UPDATE carecore_organizations
      SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{setup}', ${JSON.stringify(value)}::jsonb), updated_at = NOW()
      WHERE id = ${ctx.actor.organizationId}`,
    auditStatement(
      ctx,
      "organization",
      ctx.actor.organizationId,
      dismissed ? "setup_dismissed" : "setup_shown",
      null,
      null,
    ),
  ]);
  return setupChecklist(ctx);
}
