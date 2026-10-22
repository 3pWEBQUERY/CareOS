import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCtx, residentInScope } from '@/lib/context'
import { audit } from '@/lib/audit'

/**
 * Datenauskunft pro Person (DSG Art. 25, DSGVO Art. 15): alle gespeicherten Daten einer Person als JSON.
 * Berechtigung: resident.edit im Bereich der Person oder admin.org. Jeder Export wird protokolliert.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getCtx()
  const r = await residentInScope(ctx, id)
  if (!r) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!ctx.can('resident.edit', { unitId: r.unitId, locationId: r.unit.locationId }) && !ctx.can('admin.org')) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const [resident, incidents, tasks, handoverEntries] = await Promise.all([
    db.resident.findUniqueOrThrow({
      where: { id: r.id },
      include: {
        unit: { select: { id: true, name: true } },
        room: { select: { id: true, number: true } },
        contacts: true,
        episodes: true,
        appointments: { orderBy: { at: 'asc' } },
        observations: { orderBy: { at: 'asc' } },
        vitals: { orderBy: { at: 'asc' } },
        vitalLimits: true,
        medications: { orderBy: { createdAt: 'asc' } },
        administrations: { orderBy: { at: 'asc' } },
        carePlans: { include: { areas: true }, orderBy: { version: 'asc' } },
        interventions: true,
        assessments: { orderBy: { at: 'asc' } },
        wounds: { include: { entries: { orderBy: { at: 'asc' } } } },
        nutrition: true,
        intake: { orderBy: { at: 'asc' } },
        files: { include: { file: { select: { id: true, filename: true, contentType: true, size: true, purpose: true, createdAt: true } } } },
      },
    }),
    db.incident.findMany({ where: { orgId: ctx.org.id, residentId: r.id }, include: { type: { select: { key: true, name: true } }, actions: true }, orderBy: { occurredAt: 'asc' } }),
    db.task.findMany({ where: { orgId: ctx.org.id, residentId: r.id }, orderBy: { dueAt: 'asc' } }),
    db.handoverEntry.findMany({ where: { residentId: r.id }, include: { handover: { select: { shiftCode: true, date: true } } } }),
  ])

  // Wundfotos und Foto: nur Metadaten (Dateiinhalte sind über die Akte abrufbar).
  const photoIds = [...(resident.photoFileId ? [resident.photoFileId] : []), ...resident.wounds.flatMap((w) => w.entries.flatMap((e) => e.photoIds))]
  const photos = photoIds.length
    ? await db.fileObject.findMany({ where: { orgId: ctx.org.id, id: { in: photoIds } }, select: { id: true, filename: true, contentType: true, size: true, purpose: true, createdAt: true } })
    : []

  // Beteiligte Mitarbeitende (Autorinnen und Autoren) mit Namen auflösen.
  const ids = new Set<string>()
  const collect = (o: unknown) => {
    if (!o || typeof o !== 'object') return
    if (Array.isArray(o)) return o.forEach(collect)
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' && /^(authorId|recordedById|byId|checkedById|createdById|approvedById|reportedById|closedById|primaryNurseId|completedById|assigneeId|stoppedById|voidedById|doneById)$/.test(k)) ids.add(v)
      else if (v && typeof v === 'object' && !(v instanceof Date)) collect(v)
    }
  }
  collect([resident, incidents, tasks, handoverEntries])
  const staff = await db.user.findMany({ where: { orgId: ctx.org.id, id: { in: [...ids] } }, select: { id: true, firstName: true, lastName: true, jobTitle: true } })

  const { files, ...rest } = resident
  const body = {
    format: 'careos-subject-access',
    version: 1,
    legalBasis: 'DSG Art. 25 / DSGVO Art. 15',
    exportedAt: new Date().toISOString(),
    exportedBy: ctx.user.email,
    organization: { id: ctx.org.id, name: ctx.org.name },
    resident: rest,
    files: files.map((f) => ({ id: f.id, title: f.title, category: f.category, createdAt: f.createdAt, file: f.file })),
    photos,
    incidents,
    tasks,
    handoverEntries,
    staff: staff.map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}`, jobTitle: s.jobTitle })),
  }
  await audit(ctx, { action: 'resident.export', entityType: 'Resident', entityId: r.id, context: { residentId: r.id, observations: resident.observations.length, files: files.length } })
  const name = `careos-auskunft-${r.id}-${new Date().toISOString().slice(0, 10)}.json`
  return new NextResponse(JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'private, no-store' },
  })
}
