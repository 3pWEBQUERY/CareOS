import { type NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiAuth, apiError, isErr } from '@/lib/api-auth'
import { residentJson } from '../../serialize'

/** GET /api/v1/residents/{id} – Stammdaten inkl. Kontakte, Risiken und Ernährungshinweisen. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const api = await apiAuth(req, 'residents:read')
  if (isErr(api)) return api
  const { id } = await params
  const r = await db.resident.findFirst({
    where: { id, orgId: api.orgId },
    include: { unit: { select: { id: true, name: true } }, room: { select: { number: true } }, contacts: true },
  })
  if (!r) return apiError(404, 'not_found', 'Resident not found')
  return NextResponse.json({
    data: {
      ...residentJson(r),
      physician: r.physician,
      risks: r.risks,
      diet: r.diet,
      mobility: r.mobility,
      importantNotes: r.importantNotes,
      primaryNurseId: r.primaryNurseId,
      contacts: r.contacts.map((c) => ({ id: c.id, name: c.name, relation: c.relation, phone: c.phone, email: c.email, isEmergency: c.isEmergency, isLegalRep: c.isLegalRep })),
    },
  })
}
