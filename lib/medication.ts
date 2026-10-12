import { type ApiContext } from "@/lib/api-context";

export const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function listCareUnits({ sql, actor }: ApiContext) {
  return (await sql`
    SELECT cu.id, cu.name FROM carecore_care_units cu JOIN carecore_sites si ON si.id = cu.site_id
    WHERE si.organization_id = ${actor.organizationId} AND cu.active = TRUE ORDER BY cu.name`) as Array<{
    id: string;
    name: string;
  }>;
}
