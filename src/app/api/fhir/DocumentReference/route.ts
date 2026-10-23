import { type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiAudit, apiAuth, apiError, clampInt, isErr, readJson } from '@/lib/api-auth'
import { emit } from '@/lib/events'
import { storageConfigured } from '@/lib/env'
import { storeFile } from '@/lib/files'
import { usersWithPermission } from '@/lib/notify'
import { notifyT } from '@/lib/notify-t'
import { MAX_UPLOAD_BYTES } from '@/lib/storage'
import { bundle, documentReference, fhirBase, fhirJson, refId } from '@/lib/fhir'
import { parseFhirDocumentReference } from '@/lib/fhir-write'

/** base64 (4/3) plus JSON-Hülle */
const MAX_BODY = Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 64 * 1024

/** GET /api/fhir/DocumentReference?patient=&_count= – Dateien der Akte, externe Berichte mit LOINC-Typ. */
export async function GET(req: NextRequest) {
  const api = await apiAuth(req, 'fhir:read', { fhir: true })
  if (isErr(api)) return api
  const sp = req.nextUrl.searchParams
  const count = clampInt(sp.get('_count'), 100, 1, 500)
  const pid = refId(sp.get('patient') ?? sp.get('subject'))
  const where = { resident: { orgId: api.orgId }, file: { orgId: api.orgId }, ...(pid ? { residentId: pid } : {}) }
  const [rows, total] = await Promise.all([
    db.residentFile.findMany({ where, include: { file: { select: { contentType: true, filename: true, size: true, createdAt: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: count }),
    db.residentFile.count({ where }),
  ])
  return fhirJson(bundle(req, rows.map(documentReference), total))
}

/**
 * POST /api/fhir/DocumentReference – externer Bericht (Austrittsbericht, Bericht einer Klinik) als PDF/Bild in die Akte
 * (PRD §41). Scope documents:write. Ablage wie ein Upload unter «Dateien» (Kategorie Bericht), markiert als extern und
 * «eingegangen über Schnittstelle»; die Pflege des Bereichs wird benachrichtigt (dienstbewusst).
 */
export async function POST(req: NextRequest) {
  const api = await apiAuth(req, 'documents:write', { fhir: true })
  if (isErr(api)) return api
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return apiError(413, 'too_large', `Request larger than ${Math.round(MAX_BODY / 1024 / 1024)} MB`, true)
  const p = parseFhirDocumentReference(await readJson(req), MAX_UPLOAD_BYTES)
  if ('error' in p) return apiError(422, 'validation_failed', p.error, true)
  const r = await db.resident.findFirst({ where: { id: p.residentId, orgId: api.orgId, status: { in: ['active', 'absent'] } } })
  if (!r) return apiError(404, 'not_found', `Patient/${p.residentId} not found or not current`, true)
  if (!storageConfigured()) return apiError(503, 'storage_not_configured', 'File storage is not configured', true)
  const obj = await storeFile({ orgId: api.orgId, uploadedById: api.actorId, filename: p.filename, contentType: p.contentType, bytes: p.bytes, purpose: 'resident', clinical: true })
  const rf = await db.residentFile.create({
    data: { residentId: r.id, fileId: obj.id, title: p.title, category: 'report', external: true, receivedVia: 'fhir', reportKind: p.kind, reportDate: p.date },
    include: { file: { select: { contentType: true, filename: true, size: true, createdAt: true } } },
  })
  await apiAudit(api, { action: 'api.fhir.document.create', entityType: 'ResidentFile', entityId: rf.id, after: { title: rf.title, reportKind: p.kind, reportDate: p.date, fileId: obj.id, filename: obj.filename, size: obj.size }, context: { residentId: r.id } })
  await emit({ orgId: api.orgId, type: 'resident.updated', unitId: r.unitId, residentId: r.id, actorId: api.actorId, payload: { file: rf.id, via: 'fhir' } })
  await notifyT({
    orgId: api.orgId, userIds: await usersWithPermission(api.orgId, 'resident.chart.write', r.unitId), priority: 'action', kind: 'resident.file.external',
    titleKey: 'residents.files.notify.' + p.kind, bodyKey: 'residents.files.notify.body', vars: { who: `${r.lastName} ${r.firstName}`, title: rf.title },
    href: `/residents/${r.id}/files`, groupKey: 'ext-report:' + r.id, unitId: r.unitId,
  })
  const res = fhirJson(documentReference(rf), 201)
  res.headers.set('location', `${fhirBase(req)}/DocumentReference/${rf.id}`)
  return res
}
