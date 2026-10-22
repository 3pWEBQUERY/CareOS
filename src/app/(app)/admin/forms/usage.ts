import 'server-only'
import { db } from '@/lib/db'

/** Anzahl Verlaufseinträge je Formularschlüssel (Observation.structured.formKey), nur eigene Organisation. */
export async function formUsage(orgId: string, keys: string[]) {
  const out = new Map<string, number>()
  if (!keys.length) return out
  const rows = await db.$queryRaw<{ key: string; n: bigint }[]>`
    SELECT o.structured->>'formKey' AS key, count(*)::bigint AS n
    FROM "Observation" o JOIN "Resident" r ON r.id = o."residentId"
    WHERE r."orgId" = ${orgId} AND o.structured->>'formKey' = ANY(${keys})
    GROUP BY 1`
  for (const r of rows) out.set(r.key, Number(r.n))
  return out
}
