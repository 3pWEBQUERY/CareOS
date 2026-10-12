import { randomUUID } from "node:crypto";
import { ApiError, assertUuid, auditStatement, text, type ApiContext, type Row } from "@/lib/api-context";
import { INSTRUMENTS, type Instrument, type InstrumentItem, type RiskBand } from "@/lib/assessment-instruments";
import { hasPermission } from "@/lib/server-data";

// Eigene Einschätzungsinstrumente der Einrichtung. CareOS liefert nur frei nutzbare Instrumente mit; geschützte
// Instrumente (z. B. BESD: kommerzielle und elektronische Nutzung nur mit schriftlicher Erlaubnis der Deutschen
// Schmerzgesellschaft) erfasst die Einrichtung selbst, wenn sie das Nutzungsrecht hat – mit Quelle und Vermerk.
// Fragen, Punkte, Bereiche und Intervall stammen vollständig von der Einrichtung; CareOS zählt nur zusammen.
// Eine Änderung nach der ersten Einschätzung ergibt eine neue Fassung, damit frühere Ergebnisse nachvollziehbar bleiben.

type Definition = {
  custom: true;
  description: string;
  source: string;
  category: string;
  reassessDays: number;
  items: InstrumentItem[];
  bands: RiskBand[];
};

const PREFIX = "EIGEN-";

function toInstrument(row: Row): Instrument {
  const definition = row.definition as Definition;
  return {
    code: String(row.code),
    name: String(row.name),
    version: String(row.version),
    category: definition.category,
    description: definition.description,
    items: definition.items,
    bands: definition.bands,
    reassessDays: definition.reassessDays,
    core: false,
    custom: { source: definition.source, version: String(row.version) },
  };
}

// Aktuelle Fassung je eigenem Instrument (nur aktive).
export async function customInstruments(ctx: ApiContext, includeInactive = false) {
  const rows = (await ctx.sql`
    SELECT DISTINCT ON (code) id, code, name, version, definition, active FROM carecore_assessments
    WHERE organization_id = ${ctx.actor.organizationId} AND definition ->> 'custom' = 'true'
    ORDER BY code, (version)::int DESC`) as Row[];
  return rows
    .filter((row) => includeInactive || row.active)
    .map((row) => ({ ...toInstrument(row), active: Boolean(row.active), id: String(row.id) }));
}

// Katalog und eigene Instrumente der Einrichtung.
export async function allInstruments(ctx: ApiContext): Promise<Instrument[]> {
  const custom = await customInstruments(ctx);
  return [
    ...INSTRUMENTS,
    ...custom.map((item) => ({
      code: item.code,
      name: item.name,
      version: item.version,
      category: item.category,
      description: item.description,
      items: item.items,
      bands: item.bands,
      reassessDays: item.reassessDays,
      core: item.core,
      custom: item.custom,
    })),
  ];
}

function requireAdmin(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "administration.manage"))
    throw new ApiError("Eigene Instrumente verwaltet die Administration.", 403);
}

function parseDefinition(body: Record<string, unknown>): { name: string } & Omit<Definition, "custom"> {
  const name = text(body.name, 180);
  if (!name) throw new ApiError("Bitte den Namen des Instruments angeben.");
  const source = text(body.source, 1000);
  if (!source)
    throw new ApiError("Bitte Quelle und Nutzungsrecht angeben (z. B. Herausgeber, Fassung, Erlaubnis zur Nutzung).");
  const reassessDays = Number(body.reassessDays);
  if (!Number.isInteger(reassessDays) || reassessDays < 1 || reassessDays > 730)
    throw new ApiError("Bitte das Intervall bis zur nächsten Einschätzung angeben (1 bis 730 Tage).");
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length || rawItems.length > 60) throw new ApiError("Bitte mindestens eine Frage erfassen.");
  const items: InstrumentItem[] = rawItems.map((raw, index) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const label = text(item.label, 300);
    if (!label) throw new ApiError(`Frage ${index + 1}: Bitte die Frage angeben.`);
    const options = (Array.isArray(item.options) ? item.options : []).map((rawOption) => {
      const option = (rawOption ?? {}) as Record<string, unknown>;
      const value = Number(option.value);
      const optionLabel = text(option.label, 300);
      if (!Number.isInteger(value) || value < -100 || value > 100 || !optionLabel)
        throw new ApiError(`Frage ${index + 1}: Jede Antwort braucht ganze Punkte und einen Text.`);
      return { value, label: optionLabel };
    });
    if (options.length < 2 || options.length > 20)
      throw new ApiError(`Frage ${index + 1}: Bitte 2 bis 20 Antworten erfassen.`);
    if (new Set(options.map((option) => option.value)).size !== options.length)
      throw new ApiError(`Frage ${index + 1}: Jede Antwort braucht eigene Punkte.`);
    return { key: `q${index + 1}`, label, options };
  });
  const bands: RiskBand[] = (Array.isArray(body.bands) ? body.bands : []).map((raw, index) => {
    const band = (raw ?? {}) as Record<string, unknown>;
    const min = Number(band.min);
    const max = Number(band.max);
    const label = text(band.label, 200);
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min || !label)
      throw new ApiError(`Bereich ${index + 1}: Bitte von, bis und Bezeichnung angeben.`);
    return { min, max, level: `band${index + 1}`, label, tone: "attention" as const };
  });
  for (const [index, band] of bands.entries())
    if (bands.some((other, j) => j !== index && band.min <= other.max && other.min <= band.max))
      throw new ApiError("Die Bereiche überschneiden sich.");
  return {
    name,
    source,
    reassessDays,
    items,
    bands,
    description: text(body.description, 2000),
    category: text(body.category, 100) || "Eigenes Instrument",
  };
}

// Anlegen oder ändern; nach der ersten Einschätzung entsteht eine neue Fassung.
export async function saveCustomInstrument(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  requireAdmin(ctx);
  const parsed = parseDefinition(body);
  const { name, ...rest } = parsed;
  const definition: Definition = { custom: true, ...rest };
  if (!idInput) {
    const id = randomUUID();
    const code = `${PREFIX}${id.slice(0, 8).toUpperCase()}`;
    await ctx.sql.transaction([
      ctx.sql`
        INSERT INTO carecore_assessments (id, organization_id, code, name, version, category, definition)
        VALUES (${id}, ${ctx.actor.organizationId}, ${code}, ${name}, '1', ${definition.category}, ${JSON.stringify(definition)}::jsonb)`,
      auditStatement(ctx, "assessment_instrument", id, "created", null, { name, source: definition.source }),
    ]);
    return { id, code };
  }
  const id = assertUuid(idInput, "Instrument");
  const [current] = (await ctx.sql`
    SELECT a.id, a.code, a.version, a.definition, a.active,
      EXISTS (SELECT 1 FROM carecore_assessment_records r WHERE r.assessment_id = a.id) AS used
    FROM carecore_assessments a
    WHERE a.id = ${id} AND a.organization_id = ${ctx.actor.organizationId} AND a.definition ->> 'custom' = 'true'`) as Row[];
  if (!current) throw new ApiError("Instrument nicht gefunden.", 404);
  if (!current.active) throw new ApiError("Das Instrument wird nicht mehr angeboten.", 409);
  if (!current.used) {
    await ctx.sql.transaction([
      ctx.sql`
        UPDATE carecore_assessments SET name = ${name}, category = ${definition.category},
          definition = ${JSON.stringify(definition)}::jsonb, updated_at = NOW()
        WHERE id = ${id}`,
      auditStatement(ctx, "assessment_instrument", id, "updated", null, { name, source: definition.source }),
    ]);
    return { id, code: String(current.code) };
  }
  const nextId = randomUUID();
  const version = String(Number(current.version) + 1);
  await ctx.sql
    .transaction([
      ctx.sql`
      UPDATE carecore_assessments SET active = FALSE, updated_at = NOW() WHERE id = ${id}`,
      ctx.sql`
      INSERT INTO carecore_assessments (id, organization_id, code, name, version, category, definition)
      VALUES (${nextId}, ${ctx.actor.organizationId}, ${String(current.code)}, ${name}, ${version}, ${definition.category},
        ${JSON.stringify(definition)}::jsonb)`,
      auditStatement(ctx, "assessment_instrument", nextId, "versioned", null, {
        name,
        version,
        source: definition.source,
      }),
    ])
    .catch((error) => {
      // Gleichzeitig eine neue Fassung angelegt.
      if (String(error).includes("carecore_assessments_organization_id_code_version_key"))
        throw new ApiError("Das Instrument wurde inzwischen geändert. Bitte neu laden.", 409);
      throw error;
    });
  return { id: nextId, code: String(current.code) };
}

// Nicht mehr anbieten (frühere Ergebnisse bleiben).
export async function deactivateCustomInstrument(ctx: ApiContext, idInput: unknown) {
  requireAdmin(ctx);
  const id = assertUuid(idInput, "Instrument");
  const [current] = (await ctx.sql`
    SELECT id, code, name FROM carecore_assessments
    WHERE id = ${id} AND organization_id = ${ctx.actor.organizationId} AND definition ->> 'custom' = 'true'`) as Row[];
  if (!current) throw new ApiError("Instrument nicht gefunden.", 404);
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_assessments SET active = FALSE, updated_at = NOW()
      WHERE organization_id = ${ctx.actor.organizationId} AND code = ${String(current.code)}`,
    auditStatement(ctx, "assessment_instrument", id, "deactivated", null, { name: String(current.name) }),
  ]);
}
